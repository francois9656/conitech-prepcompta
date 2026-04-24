import { getDocument } from "pdfjs-dist";

import type { OcrPageResult } from "../../core/types/extraction";
import { fileToUint8Array, ensurePdfJsWorkerConfigured } from "../../core/utils/pdfjs";

export async function extractTextTokensFromPdf(file: File): Promise<OcrPageResult[]> {
  ensurePdfJsWorkerConfigured();

  const data = await fileToUint8Array(file);
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages: OcrPageResult[] = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();

    const tokens = textContent.items
      .map((item: any) => {
        const text = typeof item.str === "string" ? item.str.trim() : "";
        if (!text) {
          return null;
        }

        const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        const x = Number(transform[4] ?? 0);
        const y = Number(transform[5] ?? 0);
        const width = Number(item.width ?? text.length * 6);
        const height = Number(item.height ?? 10);

        return {
          text,
          x,
          y,
          width,
          height,
          confidence: 1
        };
      })
      .filter((token): token is NonNullable<typeof token> => token !== null);

    pages.push({
      pageNumber: pageIndex,
      tokens
    });
  }

  return pages;
}
