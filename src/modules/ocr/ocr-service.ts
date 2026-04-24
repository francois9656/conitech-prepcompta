import type { OcrPageResult, RenderedPageImage } from "../../core/types/extraction";

import type { OcrEngine } from "./ocr-engine";

export async function runOcrOnRenderedPages(
  pages: RenderedPageImage[],
  engine: OcrEngine
): Promise<OcrPageResult[]> {
  const results: OcrPageResult[] = [];

  for (const page of pages) {
    const pageResult = await engine.recognizePage(page);
    results.push(pageResult);
  }

  return results;
}
