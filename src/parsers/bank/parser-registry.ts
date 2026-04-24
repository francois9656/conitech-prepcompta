import type { LayoutAnalysisResult } from "../../core/types/extraction";


import { BmoBankParser } from "./bmo/bmo-parser";
import type { BankParser } from "./types";
import { desjardinsParser } from "./desjardins/desjardins-parser";

// Désactivation du parser Desjardins (pas d’exemple réel)
const PARSERS: BankParser[] = [
  new BmoBankParser()
];

export function resolveBankParser(layout: LayoutAnalysisResult, overrideBankId?: string | null): BankParser | null {
  if (overrideBankId) {
    return PARSERS.find((parser) => parser.bankId === overrideBankId) ?? null;
  }

  for (const parser of PARSERS) {
    if (parser.canParse(layout)) {
      return parser;
    }
  }

  return null;
}
