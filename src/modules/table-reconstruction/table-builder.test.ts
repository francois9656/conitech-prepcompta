import { describe, expect, it } from "vitest";

import type { LayoutAnalysisResult } from "../../core/types/extraction";
import { buildTableFromLayout } from "./table-builder";

describe("buildTableFromLayout", () => {
  it("reconstruit des lignes BMO apres l'entete de details", () => {
    const layout: LayoutAnalysisResult = {
      lines: [
        {
          pageNumber: 1,
          y: 720,
          tokens: [],
          text: "Details des transactions"
        },
        {
          pageNumber: 1,
          y: 700,
          tokens: [],
          text: "04/15 VIREMENT CLIENT 125.00 1,250.00"
        },
        {
          pageNumber: 1,
          y: 680,
          tokens: [],
          text: "04/16 FRAIS BANCAIRES 12.95 1,237.05"
        }
      ]
    };

    const result = buildTableFromLayout(layout);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      dateText: "04/15",
      descriptionText: "VIREMENT CLIENT",
      debitText: "125.00",
      balanceText: "1,250.00"
    });
  });
});