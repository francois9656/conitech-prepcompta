import * as Tesseract from "tesseract.js";

import type { OcrPageResult, OcrToken, RenderedPageImage } from "../../core/types/extraction";
import type { OcrEngine } from "./ocr-engine";

export interface TesseractOcrEngineOptions {
  language?: string;
}

const TESSERACT_ASSET_ROOT = "assets/tesseract";

export class TesseractOcrEngine implements OcrEngine {
  private workerPromise: Promise<Tesseract.Worker> | null = null;
  private readonly language: string;

  constructor(options: TesseractOcrEngineOptions = {}) {
    this.language = options.language ?? "eng";
  }

  async recognizePage(image: RenderedPageImage): Promise<OcrPageResult> {
    const worker = await this.getWorker();
    const recognized = await worker.recognize(
      image.dataUrl,
      {},
      {
        text: true,
        blocks: true,
        tsv: true
      }
    );

    const tokens =
      getTokensFromBlocks(recognized.data.blocks) ??
      getTokensFromTsv(recognized.data.tsv) ??
      getTokensFromText(recognized.data.text, image);

    return {
      pageNumber: image.pageNumber,
      tokens
    };
  }

  async terminate(): Promise<void> {
    if (!this.workerPromise) {
      return;
    }

    const worker = await this.workerPromise;
    await worker.terminate();
    this.workerPromise = null;
  }

  private async getWorker(): Promise<Tesseract.Worker> {
    if (!this.workerPromise) {
      this.workerPromise = createConfiguredWorker(this.language);
    }

    return this.workerPromise;
  }
}

async function createConfiguredWorker(language: string): Promise<Tesseract.Worker> {
  const worker = await Tesseract.createWorker(language, Tesseract.OEM.LSTM_ONLY, {
    workerPath: getExtensionAssetUrl(`${TESSERACT_ASSET_ROOT}/worker.min.js`),
    corePath: getExtensionAssetUrl(`${TESSERACT_ASSET_ROOT}/core`),
    langPath: getExtensionAssetUrl(`${TESSERACT_ASSET_ROOT}/lang`),
    cacheMethod: "none",
    workerBlobURL: false,
    gzip: true
  });

  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    user_defined_dpi: "300"
  });

  return worker;
}

function getTokensFromBlocks(blocks: Tesseract.Block[] | null): OcrToken[] | null {
  const words = blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) => line.words)
    )
  ) ?? [];

  const tokens = words
    .filter((word) => Boolean(word.text.trim()))
    .map((word) => ({
      text: word.text.trim(),
      x: word.bbox.x0,
      y: word.bbox.y0,
      width: Math.max(1, word.bbox.x1 - word.bbox.x0),
      height: Math.max(1, word.bbox.y1 - word.bbox.y0),
      confidence: normalizeConfidence(word.confidence)
    }));

  return tokens.length > 0 ? tokens : null;
}

function getTokensFromTsv(tsv: string | null): OcrToken[] | null {
  if (!tsv?.trim()) {
    return null;
  }

  const [, ...rows] = tsv.split(/\r?\n/);
  const tokens = rows
    .map((row) => {
      const columns = row.split("\t");
      if (columns.length < 12 || columns[0] !== "5") {
        return null;
      }

      const text = columns.slice(11).join("\t").trim();
      if (!text) {
        return null;
      }

      return {
        text,
        x: Number(columns[6]) || 0,
        y: Number(columns[7]) || 0,
        width: Math.max(1, Number(columns[8]) || text.length * 8),
        height: Math.max(1, Number(columns[9]) || 16),
        confidence: normalizeConfidence(Number(columns[10]))
      };
    })
    .filter((token): token is OcrToken => token !== null);

  return tokens.length > 0 ? tokens : null;
}

function getTokensFromText(text: string | null, image: RenderedPageImage): OcrToken[] {
  if (!text?.trim()) {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lineHeight = 22;
  return lines.map((line, index) => ({
    text: line,
    x: 0,
    y: image.height - index * lineHeight,
    width: Math.max(1, Math.min(image.width, line.length * 8)),
    height: lineHeight,
    confidence: 0.6
  }));
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, value / 100));
}

function getExtensionAssetUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }

  return `/${path}`;
}
