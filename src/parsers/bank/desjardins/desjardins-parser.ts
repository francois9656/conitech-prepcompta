import type { LayoutAnalysisResult, StatementExtractionResult } from "../../../core/types/extraction";
import { parseAmount } from "../../../core/utils/number-parsing";
import type { BankParser, BankParserInput } from "../types";

const DESJARDINS_MARKERS = [
  /desjardins/i,
  /carte\s+affaires\s+visa\s+desjardins/i,
  /visa\s+desjardins/i,
  /relev[ée]\s+d['’]échéance/i,
  /description\s+des\s+transactions\s+courantes/i,
  /op[ée]rations\s+au\s+compte/i
];

const TRANSACTION_LINE_REGEX =
  /^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d+)\s+(.+?)\s+(-?\d[\d\s.,]*)\s*(CR)?$/i;
const ACCOUNT_TRANSACTION_START_REGEX = /^(\d{1,2})\s+([A-ZÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]{3,})\s+([A-Z0-9]{1,4})\s+(.+)$/i;
const ACCOUNT_AMOUNT_REGEX = /-?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2}/g;
const STATEMENT_YEAR_REGEX = /DATE\s+DU\s+RELEV[ÉE].*?ANN[ÉE]E\s+(\d{4})/i;
const STATEMENT_DATE_REGEX = /DATE\s+DU\s+RELEV[ÉE]\s+Jour\s+(\d{1,2})\s+Mois\s+(\d{1,2})\s+Ann(?:ée|ee)\s+(\d{4})/i;
const ACCOUNT_PERIOD_REGEX =
  /du\s+(\d{1,2})(?:er)?\s+([a-zéû]+)(?:\s+(\d{4}))?\s+au\s+(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})/i;

type StatementPeriod = {
  start: string;
  end: string;
  startDay: number;
  startMonth: number;
  startYear: number;
  endDay: number;
  endMonth: number;
  endYear: number;
};

export class DesjardinsCreditCardParser implements BankParser {
  readonly bankId = "desjardins";

  canParse(layout: LayoutAnalysisResult): boolean {
    const haystack = layout.lines.map((line) => line.text).join("\n");
    return DESJARDINS_MARKERS.some((marker) => marker.test(haystack));
  }

  parse(input: BankParserInput): StatementExtractionResult {
    const accountPeriod = extractAccountPeriod(input.layout);
    const year = extractStatementYear(input.layout) ?? accountPeriod?.endYear ?? new Date().getFullYear();
    const statementDate = extractStatementDate(input.layout, year) ?? accountPeriod?.end ?? null;
    const accountLabel = extractAccountLabel(input.layout);
    const transactions = extractTransactions(input.layout.lines, year, accountPeriod);
    const detectedTemplate = hasAccountStatementMarkers(input.layout)
      ? "desjardins-account"
      : "desjardins-credit-card";

    return {
      bank: "Desjardins",
      accountLabel,
      periodEnd: statementDate,
      transactions,
      warnings:
        transactions.length > 0
          ? []
          : ["Aucune transaction Desjardins n'a pu etre reconstruite a partir du relevé OCR."],
      metadata: {
        usedOCR: (input.rawOcrPages?.length ?? 0) > 0,
        detectedTemplate,
        detectedTemplateReason: "Marqueurs Desjardins detectes dans le relevé OCR.",
        confidence: transactions.length > 0 ? 0.95 : 0.5
      }
    };
  }
}

function extractTransactions(
  lines: LayoutAnalysisResult["lines"],
  year: number,
  accountPeriod: StatementPeriod | null
): StatementExtractionResult["transactions"] {
  const accountTransactions = extractAccountTransactions(lines, year, accountPeriod);
  if (accountTransactions.length > 0) {
    return accountTransactions;
  }

  const transactions: StatementExtractionResult["transactions"] = [];
  let inTransactionSection = false;

  for (const line of lines) {
    const text = normalizeLine(line.text);
    if (!text) {
      continue;
    }

    if (/description\s+des\s+transactions\s+courantes/i.test(text) || /op[ée]rations\s+au\s+compte/i.test(text)) {
      inTransactionSection = true;
      continue;
    }

    if (inTransactionSection && /^(informations\s+relatives|programme|message|solde\s+pr[ée]c[ée]dent)/i.test(text)) {
      inTransactionSection = false;
      continue;
    }

    const row = parseTransactionLine(text, year);
    if (row && (inTransactionSection || TRANSACTION_LINE_REGEX.test(text))) {
      transactions.push(row);
      inTransactionSection = true;
    }
  }

  return transactions;
}

function extractAccountTransactions(
  lines: LayoutAnalysisResult["lines"],
  fallbackYear: number,
  accountPeriod: StatementPeriod | null
): StatementExtractionResult["transactions"] {
  const transactions: StatementExtractionResult["transactions"] = [];
  let inTransactionSection = false;
  let previousBalance: number | null = null;
  let pendingLine: string | null = null;

  for (const line of lines) {
    const text = normalizeLine(line.text);
    if (!text) {
      continue;
    }

    if (/date\s+code\s+description\s+frais\s+retrait\s+d[ée]p[oô]t\s+solde/i.test(text)) {
      inTransactionSection = true;
      pendingLine = null;
      continue;
    }

    if (!inTransactionSection) {
      continue;
    }

    const openingBalanceMatch = text.match(/^solde\s+report[ée]\s+(.+)$/i);
    if (openingBalanceMatch) {
      previousBalance = parseAmount(openingBalanceMatch[1]);
      pendingLine = null;
      continue;
    }

    if (isAccountSectionStop(text)) {
      pendingLine = null;
      continue;
    }

    const isTransactionStart = ACCOUNT_TRANSACTION_START_REGEX.test(text);
    const candidateText = pendingLine && !isTransactionStart ? `${pendingLine} ${text}` : text;
    const parsed = parseAccountTransactionLine(candidateText, fallbackYear, accountPeriod, previousBalance);
    if (parsed) {
      transactions.push(parsed.transaction);
      previousBalance = parsed.transaction.balance;
      pendingLine = null;
      continue;
    }

    pendingLine = isTransactionStart ? text : pendingLine;
  }

  return transactions;
}

function parseAccountTransactionLine(
  text: string,
  fallbackYear: number,
  accountPeriod: StatementPeriod | null,
  previousBalance: number | null
): { transaction: StatementExtractionResult["transactions"][number] } | null {
  const startMatch = text.match(ACCOUNT_TRANSACTION_START_REGEX);
  if (!startMatch) {
    return null;
  }

  const amountMatches = [...text.matchAll(ACCOUNT_AMOUNT_REGEX)];
  if (amountMatches.length < 2) {
    return null;
  }

  const [, day, monthText, code, rest] = startMatch;
  const transactionAmountText = amountMatches[amountMatches.length - 2][0];
  const balanceText = amountMatches[amountMatches.length - 1][0];
  const amount = parseAmount(transactionAmountText);
  const balance = parseAmount(balanceText);
  const month = parseMonthToken(monthText);
  if (amount === null || balance === null || month === null) {
    return null;
  }

  const amountStart = rest.lastIndexOf(transactionAmountText);
  const description = `${code} ${amountStart >= 0 ? rest.slice(0, amountStart) : rest}`
    .replace(/\s+/g, " ")
    .trim();
  const inferredCredit =
    previousBalance !== null ? balance > previousBalance : /ristourne|d[ée]p[oô]t|remise|cr[ée]dit/i.test(description);

  return {
    transaction: {
      date: `${resolveAccountTransactionYear(Number(day), month, accountPeriod, fallbackYear)}-${pad2(month)}-${pad2(Number(day))}`,
      description,
      debit: inferredCredit ? null : amount,
      credit: inferredCredit ? amount : null,
      balance,
      rawText: text,
      confidence: previousBalance !== null ? 0.92 : 0.82
    }
  };
}

function isAccountSectionStop(text: string): boolean {
  return /^(compte\s+d['’]epargne|cs\s+part|sommaire\s+des\s+frais|p[ée]riode\s+frais|aviser\s+votre\s+caisse|veuillez\s+v[ée]rifier)/i.test(
    text
  );
}

function parseTransactionLine(
  text: string,
  year: number
): StatementExtractionResult["transactions"][number] | null {
  const match = text.match(TRANSACTION_LINE_REGEX);
  if (!match) {
    return null;
  }

  const [, day, month, postingDay, postingMonth, , description, amountText, creditMarker] = match;
  const amount = parseAmount(amountText);
  if (amount === null) {
    return null;
  }

  const isCredit = Boolean(creditMarker);
  return {
    date: `${year}-${pad2(Number(month))}-${pad2(Number(day))}`,
    description: description.trim(),
    debit: isCredit ? null : amount,
    credit: isCredit ? amount : null,
    balance: null,
    rawText: `${day} ${month} ${postingDay} ${postingMonth} ${description} ${amountText}${creditMarker ?? ""}`.trim(),
    confidence: 0.95
  };
}

function extractStatementYear(layout: LayoutAnalysisResult): number | null {
  for (const line of layout.lines) {
    const yearMatch = line.text.match(STATEMENT_YEAR_REGEX);
    if (yearMatch) {
      return Number(yearMatch[1]);
    }
  }

  return null;
}

function extractAccountPeriod(layout: LayoutAnalysisResult): StatementPeriod | null {
  for (const line of layout.lines) {
    const match = normalizeLine(line.text).match(ACCOUNT_PERIOD_REGEX);
    if (!match) {
      continue;
    }

    const [, startDayText, startMonthText, startYearText, endDayText, endMonthText, endYearText] = match;
    const startMonth = parseMonthToken(startMonthText);
    const endMonth = parseMonthToken(endMonthText);
    const endYear = Number(endYearText);
    if (startMonth === null || endMonth === null || !Number.isFinite(endYear)) {
      continue;
    }

    const startDay = Number(startDayText);
    const endDay = Number(endDayText);
    const startYear = startYearText
      ? Number(startYearText)
      : startMonth > endMonth
        ? endYear - 1
        : endYear;

    return {
      start: `${startYear}-${pad2(startMonth)}-${pad2(startDay)}`,
      end: `${endYear}-${pad2(endMonth)}-${pad2(endDay)}`,
      startDay,
      startMonth,
      startYear,
      endDay,
      endMonth,
      endYear
    };
  }

  return null;
}

function extractStatementDate(layout: LayoutAnalysisResult, fallbackYear: number): string | null {
  for (const line of layout.lines) {
    const match = line.text.match(STATEMENT_DATE_REGEX);
    if (!match) {
      continue;
    }

    const [, day, month, year] = match;
    return `${year ?? fallbackYear}-${pad2(Number(month))}-${pad2(Number(day))}`;
  }

  return null;
}

function extractAccountLabel(layout: LayoutAnalysisResult): string | null {
  for (const line of layout.lines) {
    const text = normalizeLine(line.text);
    if (/^[A-Z]{2,4}\s+.+\([A-Z]\)$/i.test(text)) {
      return text;
    }
    if (/\d{4}\s+\d{2}\*\*\s+\*\*\*\*\s+\d{4}/.test(text)) {
      return text;
    }
  }

  return null;
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseMonthToken(value: string): number | null {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const monthPrefixes: Array<[string, number]> = [
    ["jan", 1],
    ["fev", 2],
    ["feb", 2],
    ["mar", 3],
    ["avr", 4],
    ["apr", 4],
    ["mai", 5],
    ["may", 5],
    ["juin", 6],
    ["jun", 6],
    ["juil", 7],
    ["jui", 7],
    ["jul", 7],
    ["aou", 8],
    ["aug", 8],
    ["sep", 9],
    ["oct", 10],
    ["nov", 11],
    ["dec", 12]
  ];

  return monthPrefixes.find(([prefix]) => normalized.startsWith(prefix))?.[1] ?? null;
}

function resolveAccountTransactionYear(
  day: number,
  month: number,
  accountPeriod: StatementPeriod | null,
  fallbackYear: number
): number {
  if (!accountPeriod) {
    return fallbackYear;
  }

  if (accountPeriod.startYear === accountPeriod.endYear) {
    return accountPeriod.endYear;
  }

  if (month > accountPeriod.endMonth || (month === accountPeriod.startMonth && day >= accountPeriod.startDay)) {
    return accountPeriod.startYear;
  }

  return accountPeriod.endYear;
}

function hasAccountStatementMarkers(layout: LayoutAnalysisResult): boolean {
  return layout.lines.some((line) =>
    /date\s+code\s+description\s+frais\s+retrait\s+d[ée]p[oô]t\s+solde/i.test(normalizeLine(line.text))
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
