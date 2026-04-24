import type { StatementExtractionResult } from "../core/types/extraction";

export function validateStatementExtraction(result: StatementExtractionResult): StatementExtractionResult {
  const warnings = [...result.warnings];

  if (result.transactions.length === 0) {
    warnings.push("Aucune transaction n'a pu etre extraite.");
  }

  const computedDebits = sumValues(result.transactions.map((row) => row.debit));
  const computedCredits = sumValues(result.transactions.map((row) => row.credit));

  if (result.totalDebits !== undefined && result.totalDebits !== null && Math.abs(result.totalDebits - computedDebits) > 0.01) {
    warnings.push("Le total des debits ne correspond pas au detail des transactions.");
  }

  if (result.totalCredits !== undefined && result.totalCredits !== null && Math.abs(result.totalCredits - computedCredits) > 0.01) {
    warnings.push("Le total des credits ne correspond pas au detail des transactions.");
  }

  if (
    result.openingBalance !== undefined &&
    result.openingBalance !== null &&
    result.closingBalance !== undefined &&
    result.closingBalance !== null
  ) {
    const computedClosing = result.openingBalance - computedDebits + computedCredits;
    if (Math.abs(computedClosing - result.closingBalance) > 0.01) {
      warnings.push("Le solde de fermeture ne correspond pas au calcul ouverture - debits + credits.");
    }
  }

  return {
    ...result,
    warnings
  };
}

function sumValues(values: Array<number | null | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
