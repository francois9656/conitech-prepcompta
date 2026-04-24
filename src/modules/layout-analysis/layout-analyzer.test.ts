import { describe, expect, it } from "vitest";

import { analyzeLayout } from "./layout-analyzer";

describe("analyzeLayout", () => {
  it("conserve un ordre de lecture top-to-bottom pour les tokens OCR Tesseract", () => {
    const layout = analyzeLayout({
      textPages: [],
      ocrPages: [
        {
          pageNumber: 1,
          tokens: [
            { text: "Ligne du haut", x: 10, y: 100, width: 50, height: 10, confidence: 1 },
            { text: "Ligne du bas", x: 10, y: 700, width: 50, height: 10, confidence: 1 }
          ]
        }
      ]
    });

    expect(layout.lines.map((line) => line.text)).toEqual(["Ligne du haut", "Ligne du bas"]);
  });
});
