import type { StatementExtractionResult } from "../core/types/extraction";
import { clamp01 } from "../core/utils/number-parsing";

export function normalizeStatementResult(result: StatementExtractionResult): StatementExtractionResult {
  const transactions = result.transactions.map((transaction) => ({
    ...transaction,
    description: transaction.description.replace(/\s+/g, " ").trim(),
    confidence: clamp01(transaction.confidence ?? 0.5)
  }));

  const confidence =
    transactions.length > 0
      ? transactions.reduce((sum, transaction) => sum + (transaction.confidence ?? 0), 0) / transactions.length
      : result.metadata.confidence ?? 0;

  return {
    ...result,
    transactions,
    metadata: {
      ...result.metadata,
      confidence: clamp01(confidence)
    }
  };
}
