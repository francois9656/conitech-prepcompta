import type { LayoutAnalysisResult, ReconstructedStatementTable, ReconstructedTableRow } from "../../core/types/extraction";

const BMO_DETAILS_HEADER = /details?\s+des\s+transactions/i;
const DATE_PREFIX = /^(\d{2}\/\d{2})\b/;
const TRANSACTION_CANDIDATE = /^\d{2}\/\d{2}\b.*\d{1,3}(?:,\d{3})*(?:\.\d{2})/;

export function buildTableFromLayout(layout: LayoutAnalysisResult): ReconstructedStatementTable {
  const rows: ReconstructedTableRow[] = [];

  let inTransactionSection = false;

  for (const line of layout.lines) {
    const normalizedLine = line.text.replace(/\s+/g, " ").trim();
    if (!normalizedLine) {
      continue;
    }

    if (BMO_DETAILS_HEADER.test(normalizedLine)) {
      inTransactionSection = true;
      continue;
    }

    const looksLikeTransactionCandidate = TRANSACTION_CANDIDATE.test(normalizedLine);

    if (!inTransactionSection && !looksLikeTransactionCandidate) {
      continue;
    }

    const row = parseBmoTransactionLikeLine(line.pageNumber, normalizedLine);
    if (row) {
      rows.push(row);
      inTransactionSection = true;
    }
  }

  return { rows };
}

function parseBmoTransactionLikeLine(pageNumber: number, line: string): ReconstructedTableRow | null {
  const trimmed = line.trim();
  const dateMatch = trimmed.match(DATE_PREFIX);
  if (!dateMatch) {
    return null;
  }

  const afterDate = trimmed.slice(dateMatch[0].length).trim();
  const amountMatches = [...afterDate.matchAll(/-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})/g)];

  let descriptionText = afterDate;
  let debitText: string | null = null;
  let creditText: string | null = null;
  let balanceText: string | null = null;

  if (amountMatches.length >= 1) {
    const firstAmountIndex = amountMatches[0].index ?? -1;
    if (firstAmountIndex > 0) {
      descriptionText = afterDate.slice(0, firstAmountIndex).trim();
    }

    const amountTexts = amountMatches.map((match) => match[0]);

    if (amountTexts.length === 1) {
      debitText = amountTexts[0];
    }

    if (amountTexts.length === 2) {
      debitText = amountTexts[0];
      balanceText = amountTexts[1];
    }

    if (amountTexts.length >= 3) {
      debitText = amountTexts[0];
      creditText = amountTexts[1];
      balanceText = amountTexts[2];
    }
  }

  return {
    pageNumber,
    sourceLine: line,
    dateText: dateMatch[1],
    descriptionText,
    debitText,
    creditText,
    balanceText,
    confidence: amountMatches.length > 0 ? 0.8 : 0.55
  };
}
