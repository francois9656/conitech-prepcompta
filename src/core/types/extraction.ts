export type BankTransaction = {
  date: string | null;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  rawText?: string;
  confidence?: number;
};

export type StatementExtractionResult = {
  bank: string | null;
  accountLabel?: string | null;
  periodEnd?: string | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  totalDebits?: number | null;
  totalCredits?: number | null;
  transactions: BankTransaction[];
  warnings: string[];
  metadata: {
    usedOCR: boolean;
    detectedTemplate?: string | null;
    detectedTemplateReason?: string | null;
    parserInputText?: string | null;
    confidence?: number | null;
  };
};

export type PdfExtractionMode = "text" | "ocr" | "hybrid";

export interface PageInspection {
  pageNumber: number;
  extractedTextLength: number;
  hasAnyText: boolean;
}

export interface PdfInspectionResult {
  pageCount: number;
  extractionMode: PdfExtractionMode;
  textCoverageRatio: number;
  pages: PageInspection[];
}

export interface RenderedPageImage {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface OcrToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OcrPageResult {
  pageNumber: number;
  tokens: OcrToken[];
}

export interface TextToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface LayoutLine {
  pageNumber: number;
  y: number;
  tokens: TextToken[];
  text: string;
}

export interface LayoutAnalysisResult {
  lines: LayoutLine[];
}

export interface ReconstructedTableRow {
  pageNumber: number;
  sourceLine: string;
  dateText: string | null;
  descriptionText: string;
  debitText: string | null;
  creditText: string | null;
  balanceText: string | null;
  confidence: number;
}

export interface ReconstructedStatementTable {
  rows: ReconstructedTableRow[];
}
