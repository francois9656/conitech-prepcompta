import { describe, expect, it } from "vitest";

import type { LayoutAnalysisResult } from "../../../core/types/extraction";
import { DesjardinsCreditCardParser } from "./desjardins-parser";

describe("DesjardinsCreditCardParser", () => {
  it("reconstruit les transactions du relevé carte de crédit Desjardins fourni en OCR", () => {
    const parser = new DesjardinsCreditCardParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 780, tokens: [], text: "CARTE AFFAIRES VISA DESJARDINS" },
        { pageNumber: 1, y: 760, tokens: [], text: "DATE DU RELEVÉ Jour 01 Mois 05 Année 2025 AFFAIRES / MARGE DE CREDIT" },
        { pageNumber: 1, y: 740, tokens: [], text: "DESCRIPTION DES TRANSACTIONS COURANTES" },
        { pageNumber: 1, y: 720, tokens: [], text: "Opérations au compte 4530 92** **** 1003" },
        { pageNumber: 1, y: 700, tokens: [], text: "16 04 16 04 001 FRAIS SOLUTIONS LIBRE AFFAIRES 17,00" },
        { pageNumber: 1, y: 680, tokens: [], text: "25 04 25 04 002 PAIEMENT AUTORISÉ - PRÉLÈVEMENT EFFECTUÉ 17,00CR" },
        { pageNumber: 2, y: 780, tokens: [], text: "CARTE AFFAIRES VISA DESJARDINS" },
        { pageNumber: 2, y: 760, tokens: [], text: "DATE DU RELEVÉ Jour 01 Mois 05 Année 2025 Page : 1" },
        { pageNumber: 2, y: 740, tokens: [], text: "01 05 01 05 001 FRANCOIS MORISSETTE 35,60CR" }
      ]
    };

    expect(parser.canParse(layout)).toBe(true);

    const result = parser.parse({
      layout,
      reconstructedTable: { rows: [] },
      rawOcrPages: [{ pageNumber: 1, text: "CARTE AFFAIRES VISA DESJARDINS" }]
    });

    expect(result.bank).toBe("Desjardins");
    expect(result.metadata.detectedTemplate).toBe("desjardins-credit-card");
    expect(result.periodEnd).toBe("2025-05-01");
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({
      date: "2025-04-16",
      description: "FRAIS SOLUTIONS LIBRE AFFAIRES",
      debit: 17,
      credit: null
    });
    expect(result.transactions[1]).toMatchObject({
      date: "2025-04-25",
      description: "PAIEMENT AUTORISÉ - PRÉLÈVEMENT EFFECTUÉ",
      debit: null,
      credit: 17
    });
    expect(result.transactions[2]).toMatchObject({
      date: "2025-05-01",
      description: "FRANCOIS MORISSETTE",
      debit: null,
      credit: 35.6
    });
  });

  it("reconstruit les transactions d'un relevé de compte Desjardins OCR", () => {
    const parser = new DesjardinsCreditCardParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 800, tokens: [], text: "CAISSE DESJARDINS DE CHARLESBOURG Pour la période" },
        { pageNumber: 1, y: 790, tokens: [], text: "du 1er juin au 30 juin 2025" },
        { pageNumber: 1, y: 780, tokens: [], text: "RELEVÉ DE COMPTE" },
        { pageNumber: 1, y: 770, tokens: [], text: "EOP EPARGNE AVEC OPERATIONS (C)" },
        { pageNumber: 1, y: 760, tokens: [], text: "Date Code Description Frais Retrait Dépôt Solde" },
        { pageNumber: 1, y: 750, tokens: [], text: "Solde reporté 13 057.46" },
        {
          pageNumber: 1,
          y: 740,
          tokens: [],
          text: "2 JUN GTW Remise gouvernementale TPS-TVQ / Groupe Conitech 2 950.07 10 107.39"
        },
        {
          pageNumber: 1,
          y: 730,
          tokens: [],
          text: "2 JUN PWW Paiement facture - AccèsD Internet / CODE PAIEMENT"
        },
        { pageNumber: 1, y: 720, tokens: [], text: "RQ 0.82 10 106.57" },
        { pageNumber: 1, y: 710, tokens: [], text: "2 JUN RA Assurance vie / DESJARDINS.SEC.FIN. 674.69 9 431.88" },
        { pageNumber: 1, y: 700, tokens: [], text: "2 JUN RIS Ristourne 2.71 9 434.59" },
        { pageNumber: 1, y: 690, tokens: [], text: "30 JUN RA Assurance vie / DESJARDINS.SEC.FIN. 47.93 9 386.66" },
        { pageNumber: 1, y: 680, tokens: [], text: "30 JUN RA Paiement / VISA DESJARDINS 06/25 17.00 9 369.66" },
        { pageNumber: 1, y: 670, tokens: [], text: "30 JUN FIX Frais fixes d'utilisation 3.00 9 366.66" },
        { pageNumber: 1, y: 660, tokens: [], text: "COMPTE D'EPARGNE ET DE PLACEMENT" }
      ]
    };

    expect(parser.canParse(layout)).toBe(true);

    const result = parser.parse({
      layout,
      reconstructedTable: { rows: [] },
      rawOcrPages: [{ pageNumber: 1, text: layout.lines.map((line) => line.text).join("\n") }]
    });

    expect(result.metadata.detectedTemplate).toBe("desjardins-account");
    expect(result.periodEnd).toBe("2025-06-30");
    expect(result.accountLabel).toBe("EOP EPARGNE AVEC OPERATIONS (C)");
    expect(result.transactions).toHaveLength(7);
    expect(result.transactions[0]).toMatchObject({
      date: "2025-06-02",
      description: "GTW Remise gouvernementale TPS-TVQ / Groupe Conitech",
      debit: 2950.07,
      credit: null,
      balance: 10107.39
    });
    expect(result.transactions[1]).toMatchObject({
      description: "PWW Paiement facture - AccèsD Internet / CODE PAIEMENT RQ",
      debit: 0.82,
      credit: null,
      balance: 10106.57
    });
    expect(result.transactions[3]).toMatchObject({
      description: "RIS Ristourne",
      debit: null,
      credit: 2.71,
      balance: 9434.59
    });
  });

  it("utilise la période du relevé de compte Desjardins pour dater les transactions", () => {
    const parser = new DesjardinsCreditCardParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        {
          pageNumber: 1,
          y: 800,
          tokens: [],
          text: "777 BOUL. LEBOURGNEUF du 1er mai au 31 mai 2025"
        },
        { pageNumber: 1, y: 790, tokens: [], text: "RELEVÉ DE COMPTE" },
        { pageNumber: 1, y: 780, tokens: [], text: "EOP EPARGNE AVEC OPERATIONS (C)" },
        { pageNumber: 1, y: 770, tokens: [], text: "Date Code Description Frais Retrait Dépôt Solde" },
        { pageNumber: 1, y: 760, tokens: [], text: "Solde reporté 100.00" },
        { pageNumber: 1, y: 750, tokens: [], text: "2 MAY FIX Frais fixes d'utilisation 3.00 97.00" },
        { pageNumber: 1, y: 740, tokens: [], text: "31 MAY RIS Ristourne 2.00 99.00" }
      ]
    };

    const result = parser.parse({
      layout,
      reconstructedTable: { rows: [] },
      rawOcrPages: [{ pageNumber: 1, text: layout.lines.map((line) => line.text).join("\n") }]
    });

    expect(result.periodEnd).toBe("2025-05-31");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].date).toBe("2025-05-02");
    expect(result.transactions[1].date).toBe("2025-05-31");
  });
});
