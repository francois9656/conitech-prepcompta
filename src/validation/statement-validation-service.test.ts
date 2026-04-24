import { describe, expect, it } from "vitest";

import type { StatementExtractionResult } from "../core/types/extraction";
import { validateStatementExtraction } from "./statement-validation-service";

describe("validateStatementExtraction", () => {
  it("retourne sans warning quand les totaux et le solde sont coherents", () => {
    const input: StatementExtractionResult = {
      bank: "BMO",
      openingBalance: 100,
      closingBalance: 130,
      totalDebits: 20,
      totalCredits: 50,
      transactions: [
        {
          date: "03/01",
          description: "Depot",
          debit: null,
          credit: 50,
          balance: 150
        },
        {
          date: "03/02",
          description: "Frais",
          debit: 20,
          credit: null,
          balance: 130
        }
      ],
      warnings: [],
      metadata: {
        usedOCR: false,
        confidence: 0.9,
        detectedTemplate: "bmo-standard"
      }
    };

    const result = validateStatementExtraction(input);

    expect(result.warnings).toEqual([]);
  });

  it("ajoute des warnings quand les totaux ne correspondent pas", () => {
    const input: StatementExtractionResult = {
      bank: "BMO",
      openingBalance: 100,
      closingBalance: 125,
      totalDebits: 40,
      totalCredits: 50,
      transactions: [
        {
          date: "03/01",
          description: "Depot",
          debit: null,
          credit: 50,
          balance: 150
        },
        {
          date: "03/02",
          description: "Frais",
          debit: 20,
          credit: null,
          balance: 130
        }
      ],
      warnings: [],
      metadata: {
        usedOCR: true,
        confidence: 0.7,
        detectedTemplate: "bmo-standard"
      }
    };

    const result = validateStatementExtraction(input);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join(" ")).toContain("debits");
  });
});