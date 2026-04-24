import type { StatementExtractionResult } from "../core/types/extraction";

export function exportStatementToJson(result: StatementExtractionResult): string {
  return JSON.stringify(result, null, 2);
}
