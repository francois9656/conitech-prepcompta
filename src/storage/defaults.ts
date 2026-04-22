import { buildBankStatementsState, createDefaultPeriod } from "../domain/bank-statements";
import type { AppState } from "../domain/models";

export function createDefaultAppState(): AppState {
  const period = createDefaultPeriod();

  return {
    ui: {
      themeMode: "system"
    },
    company: {
      name: ""
    },
    bankStatements: buildBankStatementsState(period),
    pdfFiles: {}
  };
}
