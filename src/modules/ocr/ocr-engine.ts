import type { OcrPageResult, RenderedPageImage } from "../../core/types/extraction";

export interface OcrEngine {
  recognizePage(image: RenderedPageImage): Promise<OcrPageResult>;
}

export class NoopOcrEngine implements OcrEngine {
  async recognizePage(image: RenderedPageImage): Promise<OcrPageResult> {
    return {
      pageNumber: image.pageNumber,
      tokens: []
    };
  }
}
