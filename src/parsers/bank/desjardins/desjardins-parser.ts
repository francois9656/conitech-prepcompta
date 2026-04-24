import type { LayoutAnalysisResult, StatementExtractionResult } from "../../../core/types/extraction";

const TRANSACTION_REGEX = /^(\d{1,2}\s+\w+)\s+(.+?)\s+(-?\d{1,3}(?:[ .]\d{3})*,\d{2})\s+(-?\d{1,3}(?:[ .]\d{3})*,\d{2})$/;
const IGNORE_KEYWORDS = ["Totaux", "Frais de programme"];

function parseAmount(str: string): number | null {
  if (!str) return null;
  return parseFloat(str.replace(/[ .]/g, "").replace(",", "."));
}

function parseDate(str: string): string | null {
  // Ex: "02 Mars" => "2026-03-02" (suppose année courante)
  const months = [
    "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    "janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"
  ];
  const [day, monthRaw] = str.split(/\s+/);
  const month = months.findIndex(m => m.toLowerCase().startsWith(monthRaw.toLowerCase().slice(0, 3)));
  if (month === -1) return null;
  const monthNum = (month % 12) + 1;
  const year = new Date().getFullYear();
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const desjardinsParser = {
  bankId: "desjardins",
  parse({ layout }: { layout: LayoutAnalysisResult }): StatementExtractionResult {
    const transactions = layout.lines
      .map(line => {
        const match = line.text.match(TRANSACTION_REGEX);
        if (!match) return null;
        const [, date, description, amount, balance] = match;
        if (IGNORE_KEYWORDS.some(keyword => description.includes(keyword))) return null;
        const amountValue = parseAmount(amount);
        const balanceValue = parseAmount(balance);
        return {
          date: parseDate(date),
          description: description.trim(),
          debit: amountValue != null && amountValue < 0 ? Math.abs(amountValue) : null,
          credit: amountValue != null && amountValue > 0 ? amountValue : null,
          balance: balanceValue,
          rawText: line.text,
          confidence: 1
        };
      })
      .filter(Boolean);
    return {
      bank: "Desjardins",
      transactions: transactions as any,
      warnings: [],
      metadata: {
        usedOCR: true,
        detectedTemplate: "desjardins",
        confidence: 1
      }
    };
  }
};
