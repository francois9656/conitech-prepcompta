import { describe, expect, it } from "vitest";

import type { LayoutAnalysisResult, ReconstructedStatementTable } from "../../../core/types/extraction";
import { BmoBankParser } from "./bmo-parser";
import { parseAmount } from "../../../core/utils/number-parsing";

describe("BmoBankParser", () => {
  it("detecte un template BMO et parse le resume ainsi que les transactions", () => {
    const parser = new BmoBankParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 780, tokens: [], text: "BMO Banque de Montreal" },
        { pageNumber: 1, y: 760, tokens: [], text: "Sommaire du compte" },
        { pageNumber: 1, y: 740, tokens: [], text: "Solde d'ouverture 1,000.00" },
        { pageNumber: 1, y: 720, tokens: [], text: "Total des debits 20.00" },
        { pageNumber: 1, y: 700, tokens: [], text: "Total des credits 50.00" },
        { pageNumber: 1, y: 680, tokens: [], text: "Solde de fermeture 1,030.00" },
        { pageNumber: 1, y: 660, tokens: [], text: "Compte cheques 1234567" },
        { pageNumber: 1, y: 640, tokens: [], text: "Periode 2026-03-01 au 2026-03-31" }
      ]
    };
    const reconstructedTable: ReconstructedStatementTable = {
      rows: [
        {
          pageNumber: 1,
          sourceLine: "03/05 Depot client 50.00 1,050.00",
          dateText: "03/05",
          descriptionText: "Depot client",
          debitText: null,
          creditText: "50.00",
          balanceText: "1,050.00",
          confidence: 0.92
        },
        {
          pageNumber: 1,
          sourceLine: "03/06 Frais 20.00 1,030.00",
          dateText: "03/06",
          descriptionText: "Frais",
          debitText: "20.00",
          creditText: null,
          balanceText: "1,030.00",
          confidence: 0.88
        }
      ]
    };

    expect(parser.canParse(layout)).toBe(true);

    const result = parser.parse({ layout, reconstructedTable });

    expect(result.bank).toBe("BMO");
    expect(result.accountLabel).toContain("1234567");
    expect(result.periodEnd).toBe("2026-03-31");
    expect(result.openingBalance).toBe(1000);
    expect(result.totalDebits).toBe(20);
    expect(result.totalCredits).toBe(50);
    expect(result.closingBalance).toBe(1030);
    expect(result.transactions).toHaveLength(2);
  });

  it("parse les transactions OCR BMO en francais avec dates compactes et montants espaces", () => {
    const parser = new BmoBankParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 780, tokens: [], text: "BMO Banque de Montreal" },
        { pageNumber: 1, y: 760, tokens: [], text: "05Janv = Dépôt direct, CO AP /CC 6 519,08 54 905,59" },
        { pageNumber: 1, y: 740, tokens: [], text: "05Janv Cheque, NO DE CHEQUE 616 5521,15 49 384,44" },
        { pageNumber: 1, y: 720, tokens: [], text: "12 Janv Regl. de fact. en ligne, BMO MASTERCARD 1 480,10 47 904,34" },
        { pageNumber: 1, y: 700, tokens: [], text: "15Janv Prélèv. aut. sans f. de .s., TRESOR. FRAIS BOM/B/M 12,00 47 892,34" },
        { pageNumber: 1, y: 680, tokens: [], text: "15Janv Prélèv. aut. sans f. de .s., CANACT BUS/ENT 2739,93 45 152,41" },
        { pageNumber: 1, y: 660, tokens: [], text: "15Janv — Prélèv. aut. sans f. de .s., CANACT BUS/ENT 4 015,64 41 136,77" },
        { pageNumber: 1, y: 640, tokens: [], text: "19Janv Dépôt direct, FXINNOVATION CO AP /CC 7243,43 48 380,20" },
        { pageNumber: 1, y: 620, tokens: [], text: "19janv Prélev. aut. sans f. de .s., CANACT BUS/ENT 3 460,13 44 920,07" },
        { pageNumber: 1, y: 600, tokens: [], text: "19 Janv — Prélèv. aut. sans f. de .s., CANACT BUS/ENT 3.208,04 41 712,03" },
        { pageNumber: 1, y: 580, tokens: [], text: "19Janv Chèque, NO DE CHEQUE 617 2 471,96 39 240,07" },
        { pageNumber: 2, y: 780, tokens: [], text: "30 Janv Frais de programme 22,50 39 217,57" },
        { pageNumber: 2, y: 760, tokens: [], text: "30janv Totaux à la fermeture 22 931,45 13 762,51" }
      ]
    };

    const result = parser.parse({ layout, reconstructedTable: { rows: [] } });

    expect(result.metadata.usedOCR).toBe(true);
    expect(result.transactions).toHaveLength(11);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-01-05",
      description: "Dépôt direct, CO AP /CC",
      credit: 6519.08,
      balance: 54905.59
    });
    expect(result.transactions[1]).toMatchObject({
      date: "2026-01-05",
      description: "Cheque, NO DE CHEQUE 616",
      debit: 5521.15,
      balance: 49384.44
    });
    expect(result.transactions[2]).toMatchObject({
      date: "2026-01-12",
      debit: 1480.1,
      balance: 47904.34
    });
    expect(result.transactions[8]).toMatchObject({
      date: "2026-01-19",
      debit: 3208.04,
      balance: 41712.03
    });
    expect(result.transactions[10]).toMatchObject({
      date: "2026-01-30",
      description: "Frais de programme",
      debit: 22.5,
      balance: 39217.57
    });
  });

  it("parseAmount gere les formats anglais et francais", () => {
    expect(parseAmount("1,030.00")).toBe(1030);
    expect(parseAmount("1 480,10")).toBe(1480.1);
    expect(parseAmount("47 904,34")).toBe(47904.34);
    expect(parseAmount("3.208,04")).toBe(3208.04);
  });

  it("parse les transactions OCR d'une carte Mastercard BMO", () => {
    const parser = new BmoBankParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 780, tokens: [], text: "Carte Mastercard BMO AIR MILES d’entreprise" },
        { pageNumber: 1, y: 760, tokens: [], text: "Date du relevé | 28 janv 2026" },
        { pageNumber: 2, y: 740, tokens: [], text: "Transactions depuis votre dernier relevé" },
        { pageNumber: 2, y: 720, tokens: [], text: "N° de carte XXXX XXXX XXXX 6641 BENOIT FORTIER" },
        { pageNumber: 2, y: 700, tokens: [], text: "1janv 1 janv USD 41.68@1 407389635 ATLASSIAN 58,66 VANCOUVER BC" },
        { pageNumber: 2, y: 680, tokens: [], text: "1janv 2janv GOOGLE *CLOUD DNHWDR HALIFAX NS 13,67" },
        { pageNumber: 2, y: 660, tokens: [], text: "2janv 2 janv Amazon Web Services TORONTO ON 3,89" },
        { pageNumber: 2, y: 640, tokens: [], text: "12 janv 13 janv PAIEMENT REÇU - MERCI 1 480,10 CR" },
        { pageNumber: 2, y: 620, tokens: [], text: "13 janv 14 janv MICROSOFT#G135329884 HALIFAX NS 8,21" },
        { pageNumber: 2, y: 600, tokens: [], text: "18 janv 19 janv USD 63@1.427619047 OPENAI *CHATGPT 89,94 SUBSCR SAN FRANCISCOCA" },
        { pageNumber: 2, y: 580, tokens: [], text: "Sous-total pour BENOIT FORTIER 174,37" },
        { pageNumber: 2, y: 560, tokens: [], text: "N° de carte XXXX XXXX XXXX 6658 FRANCOIS MORISSETTE" },
        { pageNumber: 2, y: 540, tokens: [], text: "31 déc. 1 janv UNIVERSITE TRADING SAINT-JEROME QC 1 034,78" },
        { pageNumber: 2, y: 520, tokens: [], text: "1janv 1 janv APPLE COM/BILL TORONTO ON 9,19" },
        { pageNumber: 2, y: 500, tokens: [], text: "1janv 2janv GOOGLE *Workspace_grou 650-253-0000 ON 53,20" },
        { pageNumber: 2, y: 480, tokens: [], text: "1janv 2 janv Audible CA*8Z5SM9BI3 NEWARK NJ 1,14" },
        { pageNumber: 2, y: 460, tokens: [], text: "9janv 9janv Microsoft-G133749988 msbill info ON 15,68" },
        { pageNumber: 2, y: 440, tokens: [], text: "9 janv 12 janv ing Mktp CA*203QD2PD3 TORONTO 149,04 10 janv" },
        { pageNumber: 2, y: 420, tokens: [], text: "12 janv USD 24 95@1 425250501 HOSTWAY.COM 35,56 CHICAGO IL" },
        { pageNumber: 2, y: 400, tokens: [], text: "13 janv 14 janv AMZN Mktp CA TORONTO ON 149,04 CR" },
        { pageNumber: 2, y: 380, tokens: [], text: "14 janv 14 janv AMZN Mktp CA*\"5A3OX84P3 TORONTO ON 434,65 14 janv" },
        { pageNumber: 2, y: 360, tokens: [], text: "16 janv FIZZ (TX INCL) MONTREAL QC 31,68" },
        { pageNumber: 2, y: 340, tokens: [], text: "17 janv 19 janv APPLE COM/BILL TORONTO ON 14,94 21 janv 22 janv USD 23@1 419130434 OPENAI *CHATGPT 32,64" },
        { pageNumber: 2, y: 320, tokens: [], text: "Sous-total pour FRANCOIS MORISSETTE 1 663,46" },
        { pageNumber: 2, y: 300, tokens: [], text: "Total pour le numéro de carte XXXX XXXX XXXX 6641 1 837,83 $" }
      ]
    };

    const result = parser.parse({ layout, reconstructedTable: { rows: [] } });
    const findTransaction = (needle: string) =>
      result.transactions.find((transaction) => transaction.description.includes(needle));

    expect(result.metadata.detectedTemplate).toBe("bmo-mastercard-ocr");
    expect(result.periodEnd).toBe("2026-01-28");
    expect(result.transactions).toHaveLength(18);
    expect(findTransaction("ATLASSIAN")).toMatchObject({
      date: "2026-01-01",
      description: "BENOIT FORTIER - USD 41.68@1 407389635 ATLASSIAN - VANCOUVER BC",
      debit: 58.66
    });
    expect(findTransaction("PAIEMENT REÇU - MERCI")).toMatchObject({
      date: "2026-01-13",
      description: "BENOIT FORTIER - PAIEMENT REÇU - MERCI",
      credit: 1480.1
    });
    expect(findTransaction("UNIVERSITE TRADING")).toMatchObject({
      date: "2026-01-01",
      description: "FRANCOIS MORISSETTE - UNIVERSITE TRADING SAINT-JEROME QC",
      debit: 1034.78
    });
    expect(findTransaction("ing Mktp")).toMatchObject({
      date: "2026-01-12",
      description: "FRANCOIS MORISSETTE - ing Mktp CA*203QD2PD3 TORONTO",
      debit: 149.04
    });
    expect(findTransaction("HOSTWAY.COM")).toMatchObject({
      date: "2026-01-12",
      description: "FRANCOIS MORISSETTE - USD 24 95@1 425250501 HOSTWAY.COM - CHICAGO IL",
      debit: 35.56
    });
    expect(findTransaction("AMZN Mktp CA TORONTO ON")).toMatchObject({
      date: "2026-01-14",
      credit: 149.04
    });
    expect(findTransaction("23@1 419130434 OPENAI *CHATGPT")).toMatchObject({
      date: "2026-01-22",
      description: "FRANCOIS MORISSETTE - USD 23@1 419130434 OPENAI *CHATGPT",
      debit: 32.64
    });
  });

  it("force le template bmo-mastercard-ocr des que le marqueur Carte Mastercard BMO est present", () => {
    const parser = new BmoBankParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 780, tokens: [], text: "Carte Mastercard BMO AIR MILES d’entreprise" },
        { pageNumber: 1, y: 760, tokens: [], text: "Contenu OCR incomplet" }
      ]
    };

    const result = parser.parse({ layout, reconstructedTable: { rows: [] } });

    expect(result.metadata.detectedTemplate).toBe("bmo-mastercard-ocr");
    expect(result.warnings).toContain("Template BMO Mastercard detecte, mais aucune transaction n'a pu etre reconstruite.");
  });

  it("force aussi le template mastercard avec une ligne OCR bruitée contenant Carte Mastercard BMO", () => {
    const parser = new BmoBankParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        { pageNumber: 1, y: 780, tokens: [], text: "JMO1772750 BMO € Carte Mastercard BMO AIR | = MILES d’entreprise" },
        { pageNumber: 1, y: 760, tokens: [], text: "Résumé de votre compte" }
      ]
    };

    const result = parser.parse({ layout, reconstructedTable: { rows: [] } });

    expect(parser.canParse(layout)).toBe(true);
    expect(result.metadata.detectedTemplate).toBe("bmo-mastercard-ocr");
  });

  it("selectionne bmo-mastercard-ocr a partir du texte OCR brut", () => {
    const parser = new BmoBankParser();
    const result = parser.parse({
      layout: {
        lines: [{ pageNumber: 1, y: 0, tokens: [], text: "Contenu OCR degrade" }]
      },
      reconstructedTable: { rows: [] },
      rawOcrPages: [
        {
          pageNumber: 1,
          text: "Carte Mastercard BMO AIR MILES d'entreprise Transactions depuis votre dernier relevé"
        }
      ]
    });

    expect(result.metadata.detectedTemplate).toBe("bmo-mastercard-ocr");
  });

  it("selectionne bmo-ocr avec des lignes bancaires OCR brutes", () => {
    const parser = new BmoBankParser();
    const result = parser.parse({
      layout: {
        lines: [
          { pageNumber: 1, y: 100, tokens: [], text: "BMO Banque de Montreal" },
          { pageNumber: 1, y: 90, tokens: [], text: "05Janv Dépôt direct, CO AP /CC 6 519,08 54 905,59" },
          { pageNumber: 1, y: 80, tokens: [], text: "12 Janv Regl. de fact. en ligne, BMO MASTERCARD 1 480,10 47 904,34" }
        ]
      },
      reconstructedTable: { rows: [] }
    });

    expect(result.metadata.detectedTemplate).toBe("bmo-ocr");
    expect(result.transactions).toHaveLength(2);
  });

  it("reconstruit les transactions du releve bancaire a partir du texte OCR brut par page", () => {
    const parser = new BmoBankParser();
    const result = parser.parse({
      layout: {
        lines: [
          { pageNumber: 1, y: 100, tokens: [], text: "Adresse votre succursales Services bancaires entreprises" },
          { pageNumber: 2, y: 90, tokens: [], text: "30 Janv Frais de 22,50 39 217,57" },
          { pageNumber: 2, y: 80, tokens: [], text: "programme" }
        ]
      },
      reconstructedTable: { rows: [] },
      parserTemplateOverride: "bmo-ocr",
      rawOcrPages: [
        {
          pageNumber: 1,
          text: "Adresse votre succursales Services bancaires entreprises 9230-6851 QUEBEC INC."
        },
        {
          pageNumber: 2,
          text: "30 Janv Frais de 22,50 39 217,57 programme 30janv Totaux à la fermeture 22 931,45 13 762,51"
        }
      ]
    });

    expect(result.metadata.detectedTemplate).toBe("bmo-ocr");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-01-30",
      description: "Frais de programme",
      debit: 22.5,
      balance: 39217.57
    });
  });

  it("selectionne bmo-standard avec un releve tabulaire classique", () => {
    const parser = new BmoBankParser();
    const result = parser.parse({
      layout: {
        lines: [
          { pageNumber: 1, y: 100, tokens: [], text: "BMO Banque de Montreal" },
          { pageNumber: 1, y: 90, tokens: [], text: "Sommaire du compte" },
          { pageNumber: 1, y: 80, tokens: [], text: "Compte cheques 1234567" }
        ]
      },
      reconstructedTable: {
        rows: [
          {
            pageNumber: 1,
            sourceLine: "03/05 Depot client 50.00 1,050.00",
            dateText: "03/05",
            descriptionText: "Depot client",
            debitText: null,
            creditText: "50.00",
            balanceText: "1,050.00",
            confidence: 0.92
          }
        ]
      }
    });

    expect(result.metadata.detectedTemplate).toBe("bmo-standard");
    expect(result.transactions).toHaveLength(1);
  });

  it("identifie les transactions mastercard quand toute la page OCR arrive en un seul bloc", () => {
    const parser = new BmoBankParser();
    const layout: LayoutAnalysisResult = {
      lines: [
        {
          pageNumber: 2,
          y: 700,
          tokens: [],
          text: "JTA1986735-0008241-02106-0003-0002-00- Carte Mastercard BMO AIR MILES d'entreprise mo © Benoit Fortier 9230-6851 Quebec Inc N° de carte : XXXX XXXX XXXX 6641 Transactions depuis votre dernier relevé DATE DE tog D'AFFICHE DESCRIPTION MONTANT ($) N° de carte XXXX XXXX XXXX 6641 BENOIT FORTIER 1 mars 2 mars USD 41.68@1.404510556 ATLASSIAN 58,54 VANCOUVER BC 2 mars 2 mars Amazon Web Services TORONTO ON 3,85 13 mars 16 mars PA MISSISSAUGA 8,21 18 mars 19 mars USD 63@1.406825396 OPENAI *CHATGPT 88,63 SUBSCR SAN FRANCISCOCA 18 19 PAIEMENT REÇU - MERCI 1 824,38 CR mars mars 25 mars 26 mars ACADEMIE DU SAVOIR QUEBEC QC 1 500,00 Sous-total pour BENOIT FORTIER 1 659,23 N° de carte XXXX XXXX XXXX 6658 FRANCOIS MORISSETTE 28 févr 2 mars UNIVERSITE TRADING SAINT-JEROME QC 1 034,78 1 mars 2 mars GOOGLE *Workspace_grou 650-253-0000 ON 53,20 1mars 2 mars Audible CA*H958K5SP3 NEWARK ~~ NJ 17,19 9 mars 9 mars Microsoft-G145083599 msbill.info ON 13,60 14 mars 16 mars FIZZ (TX INCL) MONTREAL QC 31,68 17 mars 18 mars APPLE COM/BILL TORONTO ON 14,94 21 mars 23 mars USD 23@1 409130434 OPENAI *CHATGPT 32,41 SUBSCR SAN FRANCISCOCA Sous-total pour FRANCOIS MORISSETTE 1 197,80 Total pour le numéro de carte XXXX XXXX XXXX 6641 2 857,03 $ Renseignements importants au sujet des changements apportés à votre compte de carte de crédit pour entreprise de BMO à compter du 2 juin 2026."
        }
      ]
    };

    const result = parser.parse({ layout, reconstructedTable: { rows: [] } });
    const findTransaction = (needle: string) =>
      result.transactions.find((transaction) => transaction.description.includes(needle));

    expect(result.metadata.detectedTemplate).toBe("bmo-mastercard-ocr");
    expect(result.transactions.map((transaction) => transaction.description)).toEqual([
      "BENOIT FORTIER - USD 41.68@1.404510556 ATLASSIAN - VANCOUVER BC",
      "BENOIT FORTIER - Amazon Web Services TORONTO ON",
      "BENOIT FORTIER - PA MISSISSAUGA",
      "BENOIT FORTIER - USD 63@1.406825396 OPENAI *CHATGPT - SUBSCR SAN FRANCISCOCA",
      "BENOIT FORTIER - PAIEMENT REÇU - MERCI",
      "BENOIT FORTIER - ACADEMIE DU SAVOIR QUEBEC QC",
      "FRANCOIS MORISSETTE - UNIVERSITE TRADING SAINT-JEROME QC",
      "FRANCOIS MORISSETTE - GOOGLE *Workspace_grou 650-253-0000 ON",
      "FRANCOIS MORISSETTE - Audible CA*H958K5SP3 NEWARK NJ",
      "FRANCOIS MORISSETTE - Microsoft-G145083599 msbill.info ON",
      "FRANCOIS MORISSETTE - FIZZ (TX INCL) MONTREAL QC",
      "FRANCOIS MORISSETTE - APPLE COM/BILL TORONTO ON",
      "FRANCOIS MORISSETTE - USD 23@1 409130434 OPENAI *CHATGPT - SUBSCR SAN FRANCISCOCA"
    ]);
    expect(findTransaction("ATLASSIAN")).toMatchObject({
      date: "2026-03-02",
      debit: 58.54
    });
    expect(findTransaction("PA MISSISSAUGA")).toMatchObject({
      date: "2026-03-16",
      debit: 8.21
    });
    expect(findTransaction("PAIEMENT REÇU - MERCI")).toMatchObject({
      date: "2026-03-19",
      credit: 1824.38
    });
    expect(findTransaction("ACADEMIE DU SAVOIR")).toMatchObject({
      date: "2026-03-26",
      debit: 1500
    });
    expect(findTransaction("UNIVERSITE TRADING")).toMatchObject({
      date: "2026-03-02",
      debit: 1034.78
    });
    expect(findTransaction("23@1 409130434 OPENAI *CHATGPT")).toMatchObject({
      date: "2026-03-23",
      debit: 32.41
    });
  });

  it("retombe sur le texte OCR brut par page quand le layout ne permet pas de reconstruire les transactions mastercard", () => {
    const parser = new BmoBankParser();
    const result = parser.parse({
      layout: {
        lines: [
          { pageNumber: 2, y: 0, tokens: [], text: "Document OCR dégradé" },
          { pageNumber: 2, y: -10, tokens: [], text: "Contenu layout inutilisable" }
        ]
      },
      reconstructedTable: { rows: [] },
      parserTemplateOverride: "bmo-mastercard-ocr",
      rawOcrPages: [
        {
          pageNumber: 2,
          text: "JTA1986735-0008241-02106-0003-0002-00- Carte Mastercard BMO AIR MILES d'entreprise mo © Benoit Fortier 9230-6851 Quebec Inc N° de carte : XXXX XXXX XXXX 6641 Transactions depuis votre dernier relevé DATE DE tog D'AFFICHE DESCRIPTION MONTANT ($) N° de carte XXXX XXXX XXXX 6641 BENOIT FORTIER 1 mars 2 mars USD 41.68@1.404510556 ATLASSIAN 58,54 VANCOUVER BC 2 mars 2 mars Amazon Web Services TORONTO ON 3,85 13 mars 16 mars PA MISSISSAUGA 8,21 18 mars 19 mars USD 63@1.406825396 OPENAI *CHATGPT 88,63 SUBSCR SAN FRANCISCOCA 18 19 PAIEMENT REÇU - MERCI 1 824,38 CR mars mars 25 mars 26 mars ACADEMIE DU SAVOIR QUEBEC QC 1 500,00 Sous-total pour BENOIT FORTIER 1 659,23 N° de carte XXXX XXXX XXXX 6658 FRANCOIS MORISSETTE 28 févr 2 mars UNIVERSITE TRADING SAINT-JEROME QC 1 034,78 1 mars 2 mars GOOGLE *Workspace_grou 650-253-0000 ON 53,20 1mars 2 mars Audible CA*H958K5SP3 NEWARK ~~ NJ 17,19 9 mars 9 mars Microsoft-G145083599 msbill.info ON 13,60 14 mars 16 mars FIZZ (TX INCL) MONTREAL QC 31,68 17 mars 18 mars APPLE COM/BILL TORONTO ON 14,94 21 mars 23 mars USD 23@1 409130434 OPENAI *CHATGPT 32,41 SUBSCR SAN FRANCISCOCA Sous-total pour FRANCOIS MORISSETTE 1 197,80 Total pour le numéro de carte XXXX XXXX XXXX 6641 2 857,03 $"
        }
      ]
    });

    expect(result.metadata.detectedTemplate).toBe("bmo-mastercard-ocr");
    expect(result.transactions).toHaveLength(13);
    expect(result.transactions.some((transaction) => transaction.description.includes("PAIEMENT REÇU - MERCI"))).toBe(true);
  });
});
