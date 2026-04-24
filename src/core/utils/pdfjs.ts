import { GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

let isPdfJsConfigured = false;

export function ensurePdfJsWorkerConfigured(): void {
  if (isPdfJsConfigured) {
    return;
  }

  GlobalWorkerOptions.workerSrc = workerSrc;
  isPdfJsConfigured = true;
}

export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
