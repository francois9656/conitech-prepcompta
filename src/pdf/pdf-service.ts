import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

export interface ExtractedPdfData {
  dataBase64: string;
  pageCount?: number;
  passwordProtected?: boolean;
  passwordRequired?: boolean;
  previewPageDataUrl?: string;
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

type PasswordProvider = (isRetry: boolean) => Promise<string | null>;

export async function extractPdfData(
  file: File,
  passwordProvider?: PasswordProvider
): Promise<ExtractedPdfData> {
  if (file.size <= 0) {
    throw new Error("Le fichier est vide.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  if (!hasPdfSignature(data)) {
    throw new Error("Le fichier sélectionné n'est pas un PDF valide.");
  }

  const dataBase64 = uint8ArrayToBase64(data);

  let password: string | undefined;
  let passwordProtected = false;

  while (true) {
    try {
      const loadingTask = getDocument({ data, password });
      const pdfDocument = await loadingTask.promise;
      const previewPageDataUrl = await renderFirstPagePreview(pdfDocument);

      return {
        dataBase64,
        pageCount: pdfDocument.numPages,
        passwordProtected,
        passwordRequired: false,
        previewPageDataUrl
      };
    } catch (error) {
      if (!isPasswordError(error)) {
        throw error;
      }

      passwordProtected = true;
      if (!passwordProvider) {
        return {
          dataBase64,
          passwordProtected: true,
          passwordRequired: true
        };
      }

      const providedPassword = await passwordProvider(Boolean(password));
      if (!providedPassword) {
        return {
          dataBase64,
          passwordProtected: true,
          passwordRequired: true
        };
      }

      password = providedPassword;
    }
  }
}

function hasPdfSignature(data: Uint8Array): boolean {
  if (data.length < PDF_SIGNATURE.length) {
    return false;
  }

  return PDF_SIGNATURE.every((value, index) => data[index] === value);
}

function isPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "PasswordException";
}

async function renderFirstPagePreview(pdfDocument: { getPage: (pageNumber: number) => Promise<any> }): Promise<string> {
  const page = await pdfDocument.getPage(1);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Impossible de créer le contexte 2D pour l'aperçu PDF.");
  }

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  return canvas.toDataURL("image/jpeg", 0.8);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
