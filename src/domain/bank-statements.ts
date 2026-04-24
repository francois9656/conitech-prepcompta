import {
  type BankStatementMonthItem,
  type MonthlyDocumentSectionKey,
  type MonthlyDocumentSectionState,
  type MonthDocumentStatus,
  type Period
} from "./models";

const monthFormatter = new Intl.DateTimeFormat("fr-CA", {
  month: "long",
  year: "numeric"
});

export function createDefaultPeriod(): Period {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end)
  };
}

export function buildBankStatementsState(
  period: Period,
  previousItems: BankStatementMonthItem[] = [],
  sectionKey: MonthlyDocumentSectionKey = "bankStatements"
): MonthlyDocumentSectionState {
  const expectedMonths = generateExpectedMonths(period, previousItems);
  const completedCount = expectedMonths.filter((item) => item.status !== "missing_unresolved").length;
  const unresolvedCount = expectedMonths.filter((item) => item.status === "missing_unresolved").length;

  return {
    sectionKey,
    periodStart: period.start,
    periodEnd: period.end,
    expectedMonths,
    completedCount,
    unresolvedCount
  };
}

export function generateExpectedMonths(
  period: Period,
  previousItems: BankStatementMonthItem[] = []
): BankStatementMonthItem[] {
  const start = parseDate(period.start);
  const end = parseDate(period.end);

  if (!start || !end || start > end) {
    return [];
  }

  const previousByMonth = new Map(previousItems.map((item) => [item.monthKey, item]));
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  const months: BankStatementMonthItem[] = [];

  while (cursor <= last) {
    const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const existing = previousByMonth.get(monthKey);
    const status = deriveStatus(existing);

    months.push({
      monthKey,
      label: capitalizeLabel(monthFormatter.format(cursor)),
      status,
      fileId: existing?.fileId,
      fileName: existing?.fileName,
      pageCount: existing?.pageCount,
      passwordProtected: existing?.passwordProtected,
      missingReason: existing?.missingReason,
      notes: existing?.notes
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function deriveStatus(existing?: BankStatementMonthItem): MonthDocumentStatus {
  if (existing?.fileId) {
    return "provided";
  }

  if (existing?.status === "missing_justified" && existing.missingReason) {
    return "missing_justified";
  }

  return "missing_unresolved";
}

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function capitalizeLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
