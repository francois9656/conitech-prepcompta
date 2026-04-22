import type { MonthDocumentStatus } from "../domain/models";

export function formatStatus(status: MonthDocumentStatus): string {
  switch (status) {
    case "provided":
      return "Fourni";
    case "missing_justified":
      return "Manquant justifié";
    case "missing_unresolved":
      return "À fournir";
  }
}

export function pluralizePages(pageCount?: number): string {
  if (!pageCount) {
    return "Pages inconnues";
  }

  return `${pageCount} page${pageCount > 1 ? "s" : ""}`;
}

export function toProgressRatio(completedCount: number, totalCount: number): number {
  if (totalCount === 0) {
    return 0;
  }

  return Math.round((completedCount / totalCount) * 100);
}
