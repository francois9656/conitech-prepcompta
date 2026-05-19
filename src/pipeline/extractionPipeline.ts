import type { StatementExtractionResult } from "../core/types/extraction";
import { parseAmount } from "../core/utils/number-parsing";
import { analyzeLayout } from "../modules/layout-analysis/layout-analyzer";
import { NoopOcrEngine, type OcrEngine } from "../modules/ocr/ocr-engine";
import { runOcrOnRenderedPages } from "../modules/ocr/ocr-service";
import { inspectPdf } from "../modules/pdf-inspection/pdf-inspector";
import { extractTextTokensFromPdf } from "../modules/pdf-inspection/pdf-text-extractor";
import { renderPdfToImages } from "../modules/pdf-rendering/pdf-renderer";
import { buildTableFromLayout } from "../modules/table-reconstruction";
import { normalizeStatementResult } from "../normalization/statement-normalizer";
import { resolveBankParser } from "../parsers/bank/parser-registry";
import { validateStatementExtraction } from "../validation/statement-validation-service";

export interface ExtractionPipelineOptions {
  ocrEngine?: OcrEngine;
  renderScale?: number;
  parserTemplateOverride?: string | null;
}

const TEXT_TOKEN_MIN_LENGTH = 40;

export async function runExtractionPipeline(
  file: File,
  options: ExtractionPipelineOptions = {}
): Promise<StatementExtractionResult> {
  const pipelineWarnings: string[] = [];
  const inspection = await inspectPdf(file);
  const forceFullDocumentOcr = shouldForceFullDocumentOcr(options.parserTemplateOverride ?? null);
  const preferOcrOnlyLayout = shouldPreferOcrOnlyLayout(options.parserTemplateOverride ?? null);

  const textPages = await extractTextTokensFromPdf(file);

  const ocrPageNumbers =
    forceFullDocumentOcr
      ? inspection.pages.map((page) => page.pageNumber)
      : inspection.extractionMode === "ocr"
      ? inspection.pages.map((page) => page.pageNumber)
      : inspection.extractionMode === "hybrid"
        ? inspection.pages
            .filter((page) => page.extractedTextLength < TEXT_TOKEN_MIN_LENGTH)
            .map((page) => page.pageNumber)
        : [];

  const renderedPages =
    ocrPageNumbers.length > 0
      ? await renderPdfToImages(file, {
          scale: options.renderScale,
          includePageNumbers: ocrPageNumbers
        })
      : [];

  const ocrEngine = options.ocrEngine ?? new NoopOcrEngine();
  const ocrPages = renderedPages.length > 0 ? await runOcrOnRenderedPages(renderedPages, ocrEngine) : [];
  const rawOcrPages = ocrPages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.tokens.map((token) => token.text).join(" ").replace(/\s+/g, " ").trim()
  }));

  if (ocrPageNumbers.length > 0 && ocrEngine instanceof NoopOcrEngine) {
    pipelineWarnings.push("OCR requis mais moteur OCR non configure: resultat potentiellement incomplet.");
  }

  if (forceFullDocumentOcr) {
    pipelineWarnings.push("OCR force sur toutes les pages a cause du parseur OCR selectionne manuellement.");
  }

  if (ocrPageNumbers.length > 0 && ocrPages.every((page) => page.tokens.length === 0)) {
    pipelineWarnings.push("OCR execute sans texte detecte sur les pages ciblees.");
  }

  const primaryLayout = analyzeLayout({
    textPages: preferOcrOnlyLayout ? [] : textPages,
    ocrPages
  });
  const primaryReconstructedTable = buildTableFromLayout(primaryLayout);

  const parserOverride = normalizeParserOverride(options.parserTemplateOverride ?? null);
  const parser = resolveBankParser(primaryLayout, parserOverride);
  if (!parser) {
    if (primaryReconstructedTable.rows.length > 0) {
      const fallbackResult: StatementExtractionResult = {
        bank: null,
        transactions: primaryReconstructedTable.rows.map((row) => ({
          date: row.dateText,
          description: row.descriptionText,
          debit: parseAmount(row.debitText),
          credit: parseAmount(row.creditText),
          balance: parseAmount(row.balanceText),
          rawText: row.sourceLine,
          confidence: row.confidence
        })),
        warnings: [
          ...pipelineWarnings,
          "Template bancaire non reconnu: extraction partielle retournee en mode generique."
        ],
        metadata: {
          usedOCR: ocrPages.length > 0,
          detectedTemplate: null,
          confidence: null
        }
      };

      const normalizedFallback = normalizeStatementResult(fallbackResult);
      return validateStatementExtraction(normalizedFallback);
    }

    return {
      bank: null,
      transactions: [],
      warnings: [...pipelineWarnings, "Aucun parser bancaire compatible n'a ete detecte."],
      metadata: {
        usedOCR: ocrPages.length > 0,
        detectedTemplate: null,
        confidence: 0
      }
    };
  }

  let parsed = parser.parse({
    layout: primaryLayout,
    reconstructedTable: primaryReconstructedTable,
    parserTemplateOverride: options.parserTemplateOverride ?? null,
    rawOcrPages
  });

  if (
    !preferOcrOnlyLayout &&
    shouldRetryWithOcrOnlyLayout(parsed, textPages, ocrPages)
  ) {
    const ocrOnlyLayout = analyzeLayout({ textPages: [], ocrPages });
    const ocrOnlyReconstructedTable = buildTableFromLayout(ocrOnlyLayout);
    const retryParsed = parser.parse({
      layout: ocrOnlyLayout,
      reconstructedTable: ocrOnlyReconstructedTable,
      parserTemplateOverride: options.parserTemplateOverride ?? null,
      rawOcrPages
    });

    if (retryParsed.transactions.length > parsed.transactions.length) {
      parsed = {
        ...retryParsed,
        warnings: [...retryParsed.warnings, "Extraction relancee en mode OCR uniquement pour stabiliser le layout."]
      };
    }
  }

  const normalized = normalizeStatementResult({
    ...parsed,
    warnings: [...pipelineWarnings, ...parsed.warnings],
    metadata: {
      ...parsed.metadata,
      usedOCR: ocrPages.length > 0,
      detectedTemplate: parsed.metadata.detectedTemplate ?? parser.bankId,
      detectedTemplateReason: parsed.metadata.detectedTemplateReason ?? null,
      parserInputText: buildParserInputText(
        parsed.metadata.detectedTemplate ?? parser.bankId,
        rawOcrPages,
        primaryLayout.lines.map((line) => ({ pageNumber: line.pageNumber, text: line.text }))
      )
    }
  });

  return validateStatementExtraction(normalized);
}

function shouldForceFullDocumentOcr(parserTemplateOverride: string | null): boolean {
  if (!parserTemplateOverride) {
    return false;
  }

  return parserTemplateOverride.endsWith("-ocr");
}

function shouldPreferOcrOnlyLayout(parserTemplateOverride: string | null): boolean {
  return shouldForceFullDocumentOcr(parserTemplateOverride);
}

function normalizeParserOverride(parserTemplateOverride: string | null): string | null {
  if (!parserTemplateOverride || parserTemplateOverride === "auto") {
    return null;
  }

  if (parserTemplateOverride.startsWith("bmo")) {
    return "bmo";
  }

  if (parserTemplateOverride.startsWith("desjardins")) {
    return "desjardins";
  }

  return parserTemplateOverride;
}

function shouldRetryWithOcrOnlyLayout(
  parsed: StatementExtractionResult,
  textPages: Awaited<ReturnType<typeof extractTextTokensFromPdf>>,
  ocrPages: Awaited<ReturnType<typeof runOcrOnRenderedPages>>
): boolean {
  if (!parsed.metadata.detectedTemplate?.endsWith("-ocr")) {
    return false;
  }

  if (parsed.transactions.length > 0) {
    return false;
  }

  if (ocrPages.length === 0) {
    return false;
  }

  return textPages.some((page) => page.tokens.length > 0);
}

function buildParserInputText(
  detectedTemplate: string | null | undefined,
  rawOcrPages: Array<{ pageNumber: number; text: string }>,
  candidateLines: Array<{ pageNumber: number; text: string }>
): string | null {
  if ((detectedTemplate === "bmo-mastercard-ocr" || detectedTemplate === "bmo-ocr") && rawOcrPages.length > 0) {
    return rawOcrPages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page) => `Page ${page.pageNumber}:\n${page.text}`)
      .join("\n\n");
  }

  if (candidateLines.length > 0) {
    return candidateLines.map((line) => `Page ${line.pageNumber}: ${line.text}`).join("\n");
  }

  return null;
}
