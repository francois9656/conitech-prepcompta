
import type { BankTransaction, LayoutAnalysisResult, StatementExtractionResult } from "../../../core/types/extraction";
import { parseAmount } from "../../../core/utils/number-parsing";
import type { BankParser, BankParserInput } from "../types";

const BMO_MARKERS = [
  /\bbmo\b/i,
  /banque\s+de\s+montreal/i,
  /sommaire\s+du\s+compte/i,
  /www\.bmo\.com/i,
  /carte\s+mastercard\s+bmo/i,
  /transactions\s+depuis\s+votre\s+dernier\s+releve/i
];
const SUMMARY_PATTERN = /solde\s+d(?:e|['’])?\s*(ouverture|fermeture)|total\s+des\s+(debits|credits)/i;
const FRENCH_MONTH_TOKEN =
  "(?:janv?|fevr?|févr?|mars|avr|mai|juin|juil|juill?|aout|août|sept?|oct|nov|dec|déc)";
const DATE_TOKEN = `\\d{1,2}\\s*${FRENCH_MONTH_TOKEN}\\.?(?:\\s+\\d{4})?`;
const OCR_MASTER_CARD_DATE_TOKEN = DATE_TOKEN;
const MASTERCARD_TRANSACTION_START_REGEX = new RegExp(
  `(${OCR_MASTER_CARD_DATE_TOKEN})\\s+(${OCR_MASTER_CARD_DATE_TOKEN})\\s+`,
  "gi"
);
const MASTERCARD_CARDHOLDER_REGEX = /n[°o]\s*de\s+carte\s*:?\s+(?:x{4}\s+){3}(\d{4})\s+([A-Za-zÀ-ÿ' -]+?)(?=\s+\d{1,2}\s*[A-Za-zÀ-ÿ]{3,})/i;
const MASTERCARD_CARDHOLDER_REGEX_GLOBAL = /n[°o]\s*de\s+carte\s*:?\s+(?:x{4}\s+){3}(\d{4})\s+([A-Za-zÀ-ÿ' -]+?)(?=\s+\d{1,2}\s*[A-Za-zÀ-ÿ]{3,})/gi;
const MASTERCARD_BLOCK_STOP_REGEX = /^(?:sous\s+total\s+pour|total\s+pour\s+le\s+numero\s+de\s+carte|important\b|page\s+\d+\s+de\s+\d+)/i;
const MASTERCARD_AMOUNT_REGEX = /-?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2}/g;
const TRANSACTION_SECTION_MARKER = "transactions depuis votre dernier releve";
const OCR_BMO_REGEX = new RegExp(
  `^(${DATE_TOKEN})\\s*[=\\-|—–]?\\s*(.+?)\\s+(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})\\s+(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})$`,
  "i"
);
const OCR_BMO_EMBEDDED_REGEX = new RegExp(
  `(${DATE_TOKEN})\\s*[=\\-|—–]?\\s*(.+?)\\s+(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})\\s+(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})`,
  "gi"
);
const OCR_BMO_LOOSE_RAW_REGEX = new RegExp(
  `(${DATE_TOKEN}).{0,80}?(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2}).{0,40}?(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})`,
  "gi"
);
const IGNORE_PATTERNS = [
  /totaux?\s+a\s+la\s+fermeture/i,
  /solde\s+d\s+ouverture/i,
  /suite\s+a\s+la\s+page\s+suivante/i,
  /nombre\s+d\s+articles/i,
  /compte\s+d\s+entreprise/i
];
const CREDIT_PATTERNS = [/depot/i, /dépôt/i];

function parseOcrDate(str: string): string | null {
  const match = str.match(/^(\d{1,2})\s*([A-Za-zéèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]{3,})$/i);
  if (!match) {
    return null;
  }

  const [, day, monthRaw] = match;
  const norm = monthRaw
    .toLowerCase()
    .replace(/[éèêë]/g, "e")
    .replace(/[àâä]/g, "a")
    .replace(/[îï]/g, "i")
    .replace(/[ôö]/g, "o")
    .replace(/[ùûü]/g, "u")
    .replace(/[ç]/g, "c");

  const monthPrefixes: Array<[string, number]> = [
    ["jan", 1],
    ["fev", 2],
    ["mar", 3],
    ["avr", 4],
    ["mai", 5],
    ["juin", 6],
    ["juil", 7],
    ["aou", 8],
    ["sep", 9],
    ["oct", 10],
    ["nov", 11],
    ["dec", 12]
  ];
  const monthNum = monthPrefixes.find(([prefix]) => norm.startsWith(prefix))?.[1];
  if (!monthNum) {
    return null;
  }

  const year = new Date().getFullYear();
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export class BmoBankParser implements BankParser {
  readonly bankId = "bmo";

  canParse(layout: LayoutAnalysisResult): boolean {
    if (isBmoMastercardLayout(layout)) {
      return true;
    }

    const ocrCandidates = layout.lines.filter((line) => OCR_BMO_REGEX.test(normalizeOcrLine(line.text)));
    if (ocrCandidates.length >= 2) return true;
    // Sinon, détection classique
    const haystack = layout.lines
      .slice(0, 80)
      .map((line) => line.text)
      .join("\n");
    return BMO_MARKERS.some((marker) => marker.test(haystack));
  }

  parse(input: BankParserInput): StatementExtractionResult {
    const decision = chooseBmoTemplate(input);

    if (decision.template === "bmo-mastercard-ocr") {
      const mastercardTransactions = parseBmoMastercardTransactions(input.layout, input.rawOcrPages);
      return {
        bank: "BMO",
        periodEnd: extractFrenchPeriodEnd(input.layout),
        transactions: mastercardTransactions,
        warnings:
          mastercardTransactions.length > 0
            ? []
            : ["Template BMO Mastercard detecte, mais aucune transaction n'a pu etre reconstruite."],
        metadata: {
          usedOCR: true,
          detectedTemplate: "bmo-mastercard-ocr",
          detectedTemplateReason: decision.reason,
          confidence: 1
        }
      };
    }

    const ocrTransactions = parseBmoOcrTransactions(input.layout, input.rawOcrPages);
    if (decision.template === "bmo-ocr" || ocrTransactions.length >= 2) {
      return {
        bank: "BMO",
        transactions: ocrTransactions,
        warnings: [],
        metadata: {
          usedOCR: true,
          detectedTemplate: "bmo-ocr",
          detectedTemplateReason:
            decision.template === "bmo-ocr"
              ? decision.reason
              : "Lignes OCR de transactions BMO detectees.",
          confidence: 1
        }
      };
    }
    // Sinon, fallback sur la logique classique
    const transactions: BankTransaction[] = input.reconstructedTable.rows.map((row) => ({
      date: row.dateText,
      description: row.descriptionText,
      debit: parseAmount(row.debitText),
      credit: parseAmount(row.creditText),
      balance: parseAmount(row.balanceText),
      rawText: row.sourceLine,
      confidence: row.confidence
    }));

    const summaryValues = extractSummaryValues(input.layout);

    return {
      bank: "BMO",
      accountLabel: extractAccountLabel(input.layout),
      periodEnd: extractPeriodEnd(input.layout),
      openingBalance: summaryValues.openingBalance,
      closingBalance: summaryValues.closingBalance,
      totalDebits: summaryValues.totalDebits,
      totalCredits: summaryValues.totalCredits,
      transactions,
      warnings: [],
      metadata: {
        usedOCR: false,
        detectedTemplate: "bmo-standard",
        detectedTemplateReason: decision.template === "bmo-standard" ? decision.reason : "Fallback tableau standard BMO.",
        confidence: computeResultConfidence(transactions)
      }
    };
  }
}

function chooseBmoTemplate(input: BankParserInput): { template: "bmo-mastercard-ocr" | "bmo-ocr" | "bmo-standard"; reason: string } {
  const override = input.parserTemplateOverride;
  if (override === "bmo-mastercard-ocr") {
    return { template: "bmo-mastercard-ocr", reason: "Selection manuelle temporaire du parseur." };
  }
  if (override === "bmo-ocr") {
    return { template: "bmo-ocr", reason: "Selection manuelle temporaire du parseur." };
  }
  if (override === "bmo-standard") {
    return { template: "bmo-standard", reason: "Selection manuelle temporaire du parseur." };
  }

  if (isBmoMastercardLayout(input.layout)) {
    return { template: "bmo-mastercard-ocr", reason: 'Marqueur "Carte Mastercard BMO" detecte dans le layout OCR.' };
  }

  if ((input.rawOcrPages ?? []).some((page) => normalizeComparisonText(page.text).includes("carte mastercard bmo"))) {
    return { template: "bmo-mastercard-ocr", reason: 'Marqueur "Carte Mastercard BMO" detecte dans le texte OCR brut.' };
  }

  const ocrCandidateCount = input.layout.lines.filter((line) => OCR_BMO_REGEX.test(normalizeOcrLine(line.text))).length;
  const rawOcrCandidateCount = countBmoRawOcrTransactionMatches(input.rawOcrPages ?? []);
  if (ocrCandidateCount >= 2 || rawOcrCandidateCount >= 2) {
    const candidateCount = Math.max(ocrCandidateCount, rawOcrCandidateCount);
    return { template: "bmo-ocr", reason: `${candidateCount} ligne(s) de transaction OCR BMO detectee(s).` };
  }

  return { template: "bmo-standard", reason: "Aucun marqueur OCR prioritaire detecte, utilisation du tableau standard." };
}

function extractSummaryValues(layout: LayoutAnalysisResult): {
  openingBalance: number | null;
  closingBalance: number | null;
  totalDebits: number | null;
  totalCredits: number | null;
} {
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  let totalDebits: number | null = null;
  let totalCredits: number | null = null;

  for (const line of layout.lines) {
    const text = line.text;
    if (!SUMMARY_PATTERN.test(text)) {
      continue;
    }

    const amountMatch = text.match(/-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})/);
    const amount = parseAmount(amountMatch?.[0] ?? null);
    if (amount === null) {
      continue;
    }

    if (/ouverture/i.test(text)) {
      openingBalance = amount;
    } else if (/fermeture/i.test(text)) {
      closingBalance = amount;
    } else if (/debits/i.test(text)) {
      totalDebits = amount;
    } else if (/credits/i.test(text)) {
      totalCredits = amount;
    }
  }

  return { openingBalance, closingBalance, totalDebits, totalCredits };
}

function extractAccountLabel(layout: LayoutAnalysisResult): string | null {
  const accountLine = layout.lines.find((line) => /compte/i.test(line.text) && /\d{3,}/.test(line.text));
  return accountLine ? accountLine.text : null;
}

function extractPeriodEnd(layout: LayoutAnalysisResult): string | null {
  const periodLine = layout.lines.find((line) => /periode|period/i.test(line.text));
  if (!periodLine) {
    return null;
  }

  const dateMatches = [...periodLine.text.matchAll(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/g)];
  if (dateMatches.length === 0) {
    return null;
  }

  return dateMatches[dateMatches.length - 1][1];
}

function computeResultConfidence(transactions: BankTransaction[]): number {
  if (transactions.length === 0) {
    return 0.2;
  }

  const total = transactions.reduce((sum, transaction) => sum + (transaction.confidence ?? 0.5), 0);
  return total / transactions.length;
}

function normalizeOcrLine(text: string): string {
  return text
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(\d{1,2})\s*([A-Za-zéèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]{3,})\b/g, "$1 $2")
    .trim();
}

function shouldIgnoreOcrDescription(description: string): boolean {
  const normalizedDescription = normalizeComparisonText(description);
  return IGNORE_PATTERNS.some((pattern) => pattern.test(normalizedDescription));
}

function normalizeComparisonText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseBmoOcrTransactions(
  layout: LayoutAnalysisResult,
  rawOcrPages?: Array<{ pageNumber: number; text: string }>
): BankTransaction[] {
  const rawTransactions = parseBmoOcrTransactionsFromRawOcr(rawOcrPages ?? []);
  if (rawTransactions.length > 0) {
    return rawTransactions;
  }

  return parseBmoOcrTransactionsFromLines(layout.lines.map((line) => line.text));
}

function parseBmoOcrTransactionsFromLines(lines: string[]): BankTransaction[] {
  return lines
    .map((line) => parseBmoOcrTransactionLine(normalizeOcrLine(line)))
    .filter((transaction): transaction is BankTransaction => transaction !== null);
}

function parseBmoOcrTransactionsFromRawOcr(rawOcrPages: Array<{ pageNumber: number; text: string }>): BankTransaction[] {
  if (rawOcrPages.length === 0) {
    return [];
  }

  const normalizedText = extractBankStatementTransactionSectionFromRawOcr(rawOcrPages);
  const matches = [...normalizedText.matchAll(new RegExp(OCR_BMO_EMBEDDED_REGEX.source, "gi"))];

  return matches
    .map((match) => parseBmoOcrRawMatch(match, normalizedText))
    .filter((transaction): transaction is BankTransaction => transaction !== null);
}

function parseBmoOcrRawMatch(match: RegExpMatchArray, sourceText: string): BankTransaction | null {
  const transaction = parseBmoOcrTransactionLine(match[0]);
  if (!transaction) {
    return null;
  }

  const matchIndex = match.index ?? -1;
  if (matchIndex < 0) {
    return transaction;
  }

  const afterMatch = sourceText.slice(matchIndex + match[0].length).trim();
  const nextWord = afterMatch.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'/-]*)\b/)?.[1];
  if (!nextWord) {
    return transaction;
  }

  if (/\b(de|des|du|d')$/i.test(transaction.description)) {
    return {
      ...transaction,
      description: `${transaction.description} ${nextWord}`.replace(/\s+/g, " ").trim()
    };
  }

  return transaction;
}

function parseBmoOcrTransactionLine(normalizedLine: string): BankTransaction | null {
  const match = normalizedLine.match(OCR_BMO_REGEX);
  if (!match) return null;
  const [, date, description, amount, balance] = match;
  if (shouldIgnoreOcrDescription(description)) return null;
  const amountNum = parseAmount(amount);
  const balanceNum = parseAmount(balance);
  if (amountNum === null || balanceNum === null) {
    return null;
  }

  const isCredit = CREDIT_PATTERNS.some((pattern) => pattern.test(description));
  return {
    date: parseOcrDate(date),
    description: description.trim(),
    debit: isCredit ? null : Math.abs(amountNum),
    credit: isCredit ? Math.abs(amountNum) : null,
    balance: balanceNum,
    rawText: normalizedLine,
    confidence: 1
  };
}

function countBmoRawOcrTransactionMatches(rawOcrPages: Array<{ pageNumber: number; text: string }>): number {
  if (rawOcrPages.length === 0) {
    return 0;
  }

  const normalizedText = extractBankStatementTransactionSectionFromRawOcr(rawOcrPages);

  const strictMatches = [...normalizedText.matchAll(new RegExp(OCR_BMO_EMBEDDED_REGEX.source, "gi"))].length;
  if (strictMatches > 0) {
    return strictMatches;
  }

  return [...normalizedText.matchAll(new RegExp(OCR_BMO_LOOSE_RAW_REGEX.source, "gi"))].length;
}

function extractBankStatementTransactionSectionFromRawOcr(rawOcrPages: Array<{ pageNumber: number; text: string }>): string {
  const joined = rawOcrPages
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => normalizeBankStatementSourceText(page.text))
    .join(" ");

  const startMarkers = ["details des transactions", "details transactions"];
  let startIndex = -1;
  for (const marker of startMarkers) {
    startIndex = findRawIndexForNormalizedSubstring(joined, marker);
    if (startIndex >= 0) {
      break;
    }
  }

  const section = startIndex >= 0 ? joined.slice(startIndex) : joined;
  const stopMarkers = ["totaux a la fermeture", "nombre d articles", "page 2 de 3", "page 3 de 3"];
  let endIndex = section.length;
  for (const marker of stopMarkers) {
    const markerIndex = findRawIndexForNormalizedSubstring(section, marker);
    if (markerIndex >= 0) {
      endIndex = Math.min(endIndex, markerIndex);
    }
  }

  return section.slice(0, endIndex).trim();
}

function normalizeBankStatementSourceText(text: string): string {
  return normalizeOcrLine(text)
    .replace(
      /(\d{1,2}\s*[A-Za-zéèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]{3,})\s+(Frais de)\s+(-?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2})\s+(-?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2})\s+(programme)\b/gi,
      "$1 $2 $5 $3 $4"
    )
    .replace(/\b(Date|Description|Montants?|Détails des transactions|Compte d'entreprise|Nom de l'entreprise|Suite à la page suivante|Page \d+ de \d+)\b/gi, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBmoMastercardTransactions(
  layout: LayoutAnalysisResult,
  rawOcrPages?: Array<{ pageNumber: number; text: string }>
): BankTransaction[] {
  const hasMastercardMarkerInLayout = isBmoMastercardLayout(layout);
  const hasMastercardMarkerInRawOcr =
    (rawOcrPages ?? []).some((page) => normalizeComparisonText(page.text).includes("carte mastercard bmo"));

  if (!hasMastercardMarkerInLayout && !hasMastercardMarkerInRawOcr) {
    return [];
  }

  const periodEnd = extractFrenchPeriodEnd(layout);
  const blocks = extractMastercardCardholderBlocks(layout);
  const layoutTransactions = blocks.flatMap((block) => parseMastercardTransactionBlock(block.cardholder, block.lines, periodEnd));

  if (layoutTransactions.length > 0) {
    return layoutTransactions;
  }

  const rawTextBlocks = extractMastercardCardholderBlocksFromRawOcr(rawOcrPages ?? []);
  return rawTextBlocks.flatMap((block) => parseMastercardTransactionBlock(block.cardholder, block.lines, periodEnd));
}

function isBmoMastercardLayout(layout: LayoutAnalysisResult): boolean {
  const normalizedHaystack = normalizeComparisonText(
    layout.lines
      .slice(0, 120)
      .map((line) => normalizeOcrLine(line.text))
      .join(" ")
  );

  return normalizedHaystack.includes("carte mastercard bmo");
}

function extractMastercardCardholderBlocks(
  layout: LayoutAnalysisResult
): Array<{ cardholder: string; lines: string[] }> {
  const joined = normalizeMastercardSourceText(layout.lines.map((line) => line.text).join(" "));
  const sectionStart = findRawIndexForNormalizedSubstring(joined, TRANSACTION_SECTION_MARKER);
  if (sectionStart < 0) {
    return [];
  }

  const transactionSection = joined.slice(sectionStart + "Transactions depuis votre dernier relevé".length).trim();
  const blocks = [...transactionSection.matchAll(MASTERCARD_CARDHOLDER_REGEX_GLOBAL)];
  if (blocks.length === 0) {
    const trimmedBlock = trimMastercardBlockTail(transactionSection);
    return trimmedBlock
      ? [
          {
            cardholder: "Titulaire non identifié",
            lines: [trimmedBlock]
          }
        ]
      : [];
  }

  return blocks.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < blocks.length ? blocks[index + 1].index ?? transactionSection.length : transactionSection.length;
    const blockText = transactionSection.slice(start, end).trim();
    const trimmedBlock = trimMastercardBlockTail(blockText);
    return {
      cardholder: match[2].replace(/\s+/g, " ").trim(),
      lines: trimmedBlock ? [trimmedBlock] : []
    };
  });
}

function extractMastercardCardholderBlocksFromRawOcr(
  rawOcrPages: Array<{ pageNumber: number; text: string }>
): Array<{ cardholder: string; lines: string[] }> {
  if (rawOcrPages.length === 0) {
    return [];
  }

  const joined = normalizeMastercardSourceText(
    rawOcrPages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page) => page.text)
      .join(" ")
  );
  const sectionStart = findRawIndexForNormalizedSubstring(joined, TRANSACTION_SECTION_MARKER);
  if (sectionStart < 0) {
    return [];
  }

  const transactionSection = joined.slice(sectionStart + "Transactions depuis votre dernier relevé".length).trim();
  const blocks = [...transactionSection.matchAll(MASTERCARD_CARDHOLDER_REGEX_GLOBAL)];
  if (blocks.length === 0) {
    const trimmedBlock = trimMastercardBlockTail(transactionSection);
    return trimmedBlock
      ? [
          {
            cardholder: "Titulaire non identifié",
            lines: [trimmedBlock]
          }
        ]
      : [];
  }

  return blocks.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < blocks.length ? blocks[index + 1].index ?? transactionSection.length : transactionSection.length;
    const blockText = transactionSection.slice(start, end).trim();
    const trimmedBlock = trimMastercardBlockTail(blockText);
    return {
      cardholder: match[2].replace(/\s+/g, " ").trim(),
      lines: trimmedBlock ? [trimmedBlock] : []
    };
  });
}

function trimMastercardBlockTail(text: string): string {
  const normalized = normalizeComparisonText(text);
  const stopPatterns = [
    "sous total pour",
    "total pour le numero de carte",
    "renseignements importants",
    "page 3 de 5",
    "page 2 de 5"
  ];

  let endIndex = text.length;
  for (const stopPattern of stopPatterns) {
    const stopIndex = normalized.indexOf(stopPattern);
    if (stopIndex >= 0) {
      const rawIndex = findRawIndexForNormalizedSubstring(text, stopPattern);
      if (rawIndex >= 0) {
        endIndex = Math.min(endIndex, rawIndex);
      }
    }
  }

  return text.slice(0, endIndex).trim();
}

function findRawIndexForNormalizedSubstring(rawText: string, normalizedNeedle: string): number {
  const lowerNeedle = normalizedNeedle.toLowerCase();
  for (let index = 0; index < rawText.length; index += 1) {
    const slice = rawText.slice(index);
    if (normalizeComparisonText(slice).startsWith(lowerNeedle)) {
      return index;
    }
  }

  return -1;
}

function normalizeMastercardSourceText(text: string): string {
  return normalizeOcrLine(text)
    .replace(/DATE\s+DE.+?MONTANT\s+\(\$\)/i, "")
    .replace(/(\d{1,2})\s+(\d{1,2})\s+(PAIEMENT\s+RE[ÇC]U\s+-\s+MERCI\s+\d(?:[\d\s.,])*?\s+CR)\s+(janv|févr|fevr|fev|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)\s+(janv|févr|fevr|fev|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)/i, "$1 $4 $2 $5 $3")
    .replace(/~~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMastercardTransactionBlock(
  cardholder: string,
  lines: string[],
  periodEnd: string | null
): BankTransaction[] {
  if (lines.length === 0) {
    return [];
  }

  const joined = lines.join(" ").replace(/\s+/g, " ").trim();
  const starts = [...joined.matchAll(MASTERCARD_TRANSACTION_START_REGEX)];
  if (starts.length === 0) {
    return [];
  }

  const chunks = starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < starts.length ? starts[index + 1].index ?? joined.length : joined.length;
    return joined.slice(start, end).trim();
  });

  return chunks
    .map((chunk) => parseMastercardTransactionChunk(chunk, cardholder, periodEnd))
    .filter((transaction): transaction is BankTransaction => transaction !== null);
}

function parseMastercardTransactionChunk(
  chunk: string,
  cardholder: string,
  periodEnd: string | null
): BankTransaction | null {
  const startMatch = chunk.match(new RegExp(`^(${OCR_MASTER_CARD_DATE_TOKEN})\\s+(${OCR_MASTER_CARD_DATE_TOKEN})\\s+`, "i"));
  if (!startMatch) {
    return null;
  }

  const [, operationDateText, postingDateText] = startMatch;
  const remainder = chunk.slice(startMatch[0].length).trim();
  const amountMatches = [...remainder.matchAll(MASTERCARD_AMOUNT_REGEX)];
  const amountMatch = amountMatches[amountMatches.length - 1];
  if (!amountMatch || amountMatch.index === undefined) {
    return null;
  }

  const amountText = amountMatch[0];
  const amountValue = parseAmount(amountText);
  if (amountValue === null) {
    return null;
  }

  const beforeAmount = remainder.slice(0, amountMatch.index).trim();
  let afterAmount = remainder.slice(amountMatch.index + amountText.length).trim();
  let isCredit = false;
  if (/^cr\b/i.test(afterAmount)) {
    isCredit = true;
    afterAmount = afterAmount.replace(/^cr\b/i, "").trim();
  }
  if (/paiement\s+recu/i.test(beforeAmount)) {
    isCredit = true;
  }

  const descriptionParts = [cardholder, beforeAmount, afterAmount].filter(Boolean);
  const description = descriptionParts.join(" - ").replace(/\s+-\s+/g, " - ").trim();

  return {
    date: parseMastercardDateToken(postingDateText, periodEnd),
    description,
    debit: isCredit ? null : Math.abs(amountValue),
    credit: isCredit ? Math.abs(amountValue) : null,
    balance: null,
    rawText: chunk,
    confidence: 1
  };
}

function parseMastercardDateToken(dateText: string, periodEnd: string | null): string | null {
  const match = dateText.match(/^(\d{1,2})\s*([A-Za-zéèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]{3,})\.?(?:\s+(\d{4}))?$/i);
  if (!match) {
    return null;
  }

  const [, dayText, monthText, explicitYearText] = match;
  const normalizedMonth = normalizeComparisonText(monthText);
  const monthPrefixes: Array<[string, number]> = [
    ["jan", 1],
    ["fev", 2],
    ["mar", 3],
    ["avr", 4],
    ["mai", 5],
    ["juin", 6],
    ["juil", 7],
    ["aou", 8],
    ["sep", 9],
    ["oct", 10],
    ["nov", 11],
    ["dec", 12]
  ];
  const month = monthPrefixes.find(([prefix]) => normalizedMonth.startsWith(prefix))?.[1];
  if (!month) {
    return null;
  }

  let year = explicitYearText ? Number(explicitYearText) : new Date().getFullYear();
  if (!explicitYearText && periodEnd) {
    const periodEndDate = new Date(periodEnd);
    if (!Number.isNaN(periodEndDate.getTime())) {
      year = periodEndDate.getFullYear();
      const periodEndMonth = periodEndDate.getMonth() + 1;
      if (month > periodEndMonth) {
        year -= 1;
      }
    }
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(Number(dayText)).padStart(2, "0")}`;
}

function extractFrenchPeriodEnd(layout: LayoutAnalysisResult): string | null {
  for (const line of layout.lines) {
    const normalizedLine = normalizeOcrLine(line.text);
    const match = normalizedLine.match(/(\d{1,2}\s+[A-Za-zéèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]{3,}\.?\s+\d{4})/i);
    if (!match) {
      continue;
    }

    const parsed = parseMastercardDateToken(match[1], null);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}
