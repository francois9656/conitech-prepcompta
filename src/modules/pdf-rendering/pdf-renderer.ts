import { getDocument } from "pdfjs-dist";

import type { RenderedPageImage } from "../../core/types/extraction";
import { fileToUint8Array, ensurePdfJsWorkerConfigured } from "../../core/utils/pdfjs";

export interface PdfRenderingOptions {
  scale?: number;
  includePageNumbers?: number[];
}

const DEFAULT_SCALE = 2;

export async function renderPdfToImages(
  file: File,
  options: PdfRenderingOptions = {}
): Promise<RenderedPageImage[]> {
  ensurePdfJsWorkerConfigured();

  const scale = options.scale ?? DEFAULT_SCALE;
  const data = await fileToUint8Array(file);
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;

  const pageNumbers =
    options.includePageNumbers && options.includePageNumbers.length > 0
      ? options.includePageNumbers
      : Array.from({ length: pdf.numPages }, (_, index) => index + 1);

  const renderedPages: RenderedPageImage[] = [];

  for (const pageNumber of pageNumbers) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Impossible de creer le contexte 2D pour le rendu PDF.");
    }

    await page.render({ canvasContext: context, viewport }).promise;

    renderedPages.push({
      pageNumber,
      width: canvas.width,
      height: canvas.height,
      dataUrl: canvas.toDataURL("image/png")
    });
  }

  return renderedPages;
}
