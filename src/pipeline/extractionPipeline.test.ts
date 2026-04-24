import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  inspectPdfMock,
  extractTextTokensFromPdfMock,
  renderPdfToImagesMock,
  runOcrOnRenderedPagesMock,
  analyzeLayoutMock,
  buildTableFromLayoutMock,
  resolveBankParserMock,
  normalizeStatementResultMock,
  validateStatementExtractionMock
} = vi.hoisted(() => ({
  inspectPdfMock: vi.fn(),
  extractTextTokensFromPdfMock: vi.fn(),
  renderPdfToImagesMock: vi.fn(),
  runOcrOnRenderedPagesMock: vi.fn(),
  analyzeLayoutMock: vi.fn(),
  buildTableFromLayoutMock: vi.fn(),
  resolveBankParserMock: vi.fn(),
  normalizeStatementResultMock: vi.fn(),
  validateStatementExtractionMock: vi.fn()
}));

import { runExtractionPipeline } from "./extractionPipeline";

vi.mock("../modules/pdf-inspection/pdf-inspector", () => ({
  inspectPdf: inspectPdfMock
}));

vi.mock("../modules/pdf-inspection/pdf-text-extractor", () => ({
  extractTextTokensFromPdf: extractTextTokensFromPdfMock
}));

vi.mock("../modules/pdf-rendering/pdf-renderer", () => ({
  renderPdfToImages: renderPdfToImagesMock
}));

vi.mock("../modules/ocr/ocr-service", () => ({
  runOcrOnRenderedPages: runOcrOnRenderedPagesMock
}));

vi.mock("../modules/layout-analysis/layout-analyzer", () => ({
  analyzeLayout: analyzeLayoutMock
}));

vi.mock("../modules/table-reconstruction", () => ({
  buildTableFromLayout: buildTableFromLayoutMock
}));

vi.mock("../parsers/bank/parser-registry", () => ({
  resolveBankParser: resolveBankParserMock
}));

vi.mock("../normalization/statement-normalizer", () => ({
  normalizeStatementResult: normalizeStatementResultMock
}));

vi.mock("../validation/statement-validation-service", () => ({
  validateStatementExtraction: validateStatementExtractionMock
}));

describe("runExtractionPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    inspectPdfMock.mockResolvedValue({
      extractionMode: "text",
      pages: [
        { pageNumber: 1, extractedTextLength: 120, hasAnyText: true },
        { pageNumber: 2, extractedTextLength: 140, hasAnyText: true }
      ]
    });
    extractTextTokensFromPdfMock.mockResolvedValue([
      { pageNumber: 1, tokens: [] },
      { pageNumber: 2, tokens: [] }
    ]);
    renderPdfToImagesMock.mockResolvedValue([
      { pageNumber: 1, imageDataUrl: "page-1" },
      { pageNumber: 2, imageDataUrl: "page-2" }
    ]);
    runOcrOnRenderedPagesMock.mockResolvedValue([
      {
        pageNumber: 1,
        tokens: [
          { text: "Carte Mastercard BMO", x: 0, y: 0, width: 1, height: 1, confidence: 1 },
          { text: "Transactions depuis votre dernier relevé", x: 0, y: 1, width: 1, height: 1, confidence: 1 }
        ]
      },
      {
        pageNumber: 2,
        tokens: [{ text: "1 mars 2 mars ATLASSIAN 58,54", x: 0, y: 0, width: 1, height: 1, confidence: 1 }]
      }
    ]);
    analyzeLayoutMock.mockReturnValue({
      lines: [
        { pageNumber: 1, text: "Carte Mastercard BMO" },
        { pageNumber: 1, text: "Transactions depuis votre dernier relevé" },
        { pageNumber: 2, text: "1 mars 2 mars ATLASSIAN 58,54" }
      ]
    });
    buildTableFromLayoutMock.mockReturnValue({ rows: [] });

    const parser = {
      bankId: "bmo",
      parse: vi.fn().mockReturnValue({
        bank: "BMO",
        transactions: [
          {
            date: "2026-03-02",
            description: "BENOIT FORTIER - ATLASSIAN",
            debit: 58.54,
            credit: null,
            balance: null,
            rawText: "1 mars 2 mars ATLASSIAN 58,54",
            confidence: 1
          }
        ],
        warnings: [],
        metadata: {
          usedOCR: true,
          detectedTemplate: "bmo-mastercard-ocr",
          detectedTemplateReason: "Selection manuelle temporaire du parseur.",
          confidence: 1
        }
      })
    };

    resolveBankParserMock.mockReturnValue(parser);
    normalizeStatementResultMock.mockImplementation((result) => result);
    validateStatementExtractionMock.mockImplementation((result) => result);
  });

  it("force l'OCR sur toutes les pages quand un parseur OCR est selectionne manuellement", async () => {
    const result = await runExtractionPipeline(new File(["fake"], "statement.pdf", { type: "application/pdf" }), {
      parserTemplateOverride: "bmo-mastercard-ocr"
    });

    expect(analyzeLayoutMock).toHaveBeenCalledWith({
      textPages: [],
      ocrPages: expect.any(Array)
    });
    expect(renderPdfToImagesMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        includePageNumbers: [1, 2]
      })
    );
    expect(runOcrOnRenderedPagesMock).toHaveBeenCalledTimes(1);
    expect(resolveBankParserMock).toHaveBeenCalledWith(expect.anything(), "bmo");
    expect(result.transactions).toHaveLength(1);
    expect(result.metadata.usedOCR).toBe(true);
    expect(result.warnings).toContain("OCR force sur toutes les pages a cause du parseur OCR selectionne manuellement.");
  });
});
