import { getDocument } from "pdfjs-dist";

import type { PageInspection, PdfInspectionResult } from "../../core/types/extraction";
import { fileToUint8Array, ensurePdfJsWorkerConfigured } from "../../core/utils/pdfjs";

const TEXT_RICH_PAGE_THRESHOLD = 40;

export async function inspectPdf(file: File): Promise<PdfInspectionResult> {
  ensurePdfJsWorkerConfigured();

  const data = await fileToUint8Array(file);
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages: PageInspection[] = [];
  let pagesWithText = 0;

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();

    const normalizedText = textContent.items
      .map((item: any) => (typeof item.str === "string" ? item.str.trim() : ""))
      .join(" ")
      .trim();

    const extractedTextLength = normalizedText.length;
    const hasAnyText = extractedTextLength > 0;

    if (extractedTextLength >= TEXT_RICH_PAGE_THRESHOLD) {
      pagesWithText += 1;
    }

    pages.push({
      pageNumber: pageIndex,
      extractedTextLength,
      hasAnyText
    });
  }

  const pageCount = pdf.numPages;
  const textCoverageRatio = pageCount > 0 ? pagesWithText / pageCount : 0;

  let extractionMode: PdfInspectionResult["extractionMode"] = "hybrid";
  if (textCoverageRatio >= 0.8) {
    extractionMode = "text";
  } else if (textCoverageRatio <= 0.2) {
    extractionMode = "ocr";
  }

  return {
    pageCount,
    extractionMode,
    textCoverageRatio,
    pages
  };
}
