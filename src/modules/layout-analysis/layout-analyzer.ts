import type { LayoutAnalysisResult, OcrPageResult, TextToken } from "../../core/types/extraction";

export interface AnalyzeLayoutInput {
  textPages: OcrPageResult[];
  ocrPages: OcrPageResult[];
}

const LINE_Y_TOLERANCE = 4;

export function analyzeLayout(input: AnalyzeLayoutInput): LayoutAnalysisResult {
  const pagesByNumber = new Map<number, TextToken[]>();

  for (const page of input.textPages) {
    pagesByNumber.set(page.pageNumber, [...(pagesByNumber.get(page.pageNumber) ?? []), ...page.tokens]);
  }

  for (const page of input.ocrPages) {
    pagesByNumber.set(page.pageNumber, [
      ...(pagesByNumber.get(page.pageNumber) ?? []),
      ...page.tokens.map((token) => ({
        ...token,
        // Tesseract utilise un repere top-left, alors que le texte PDF natif
        // arrive generalement dans un repere bottom-left.
        y: -token.y
      }))
    ]);
  }

  const lines: LayoutAnalysisResult["lines"] = [];

  for (const [pageNumber, tokens] of pagesByNumber) {
    const sorted = [...tokens].sort((a, b) => (a.y === b.y ? a.x - b.x : b.y - a.y));
    const lineBuckets: Array<{ y: number; tokens: TextToken[] }> = [];

    for (const token of sorted) {
      const bucket = lineBuckets.find((entry) => Math.abs(entry.y - token.y) <= LINE_Y_TOLERANCE);
      if (bucket) {
        bucket.tokens.push(token);
      } else {
        lineBuckets.push({
          y: token.y,
          tokens: [token]
        });
      }
    }

    for (const bucket of lineBuckets) {
      const orderedTokens = [...bucket.tokens].sort((a, b) => a.x - b.x);

      lines.push({
        pageNumber,
        y: bucket.y,
        tokens: orderedTokens,
        text: orderedTokens.map((token) => token.text).join(" ").trim()
      });
    }
  }

  lines.sort((a, b) => (a.pageNumber === b.pageNumber ? b.y - a.y : a.pageNumber - b.pageNumber));
  return { lines };
}
