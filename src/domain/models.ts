// Catégorie de transaction
export interface Category {
  id: string;
  label: string;
  color?: string;
  builtIn?: boolean;
  hidden?: boolean;
}

// Règle d’auto-catégorisation
export interface CategorizationRule {
  id: string;
  pattern: string; // texte ou regex
  categoryId?: string; // optionnel : la règle peut ne définir qu'une note
  note?: string;       // optionnel : texte ajouté en note sur la transaction (cumulatif)
}
import type { StatementExtractionResult } from "../core/types/extraction";

export type ThemeMode = "light" | "dark" | "system";
export type MonthlyDocumentSectionKey = "bankStatements" | "creditCardStatements";
export type SupplementalDocumentSectionKey = "invoices" | "otherCommunications";
export type DocumentSectionKey = MonthlyDocumentSectionKey | SupplementalDocumentSectionKey;

export type MonthDocumentStatus =
  | "provided"
  | "missing_justified"
  | "missing_unresolved";

export interface Period {
  start: string;
  end: string;
}

export interface PdfDocumentInfo {
  fileId: string;
  fileName: string;
  mimeType: "application/pdf";
  pageCount?: number;
  passwordProtected?: boolean;
  passwordRequired?: boolean;
  previewPageDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankStatementMonthItem {
  monthKey: string;
  label: string;
  status: MonthDocumentStatus;
  fileId?: string;
  fileName?: string;
  pageCount?: number;
  passwordProtected?: boolean;
  missingReason?: string;
  notes?: string;
}

export interface MonthlyDocumentSectionState {
  sectionKey: MonthlyDocumentSectionKey;
  periodStart: string;
  periodEnd: string;
  expectedMonths: BankStatementMonthItem[];
  completedCount: number;
  unresolvedCount: number;
}

export interface SupplementalDocumentItem {
  id: string;
  fileId: string;
  fileName: string;
  pageCount?: number;
  passwordProtected?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplementalDocumentsSectionState {
  sectionKey: SupplementalDocumentSectionKey;
  items: SupplementalDocumentItem[];
}

export interface UiSettings {
  themeMode: ThemeMode;
}

export interface StoredPdfAnnotation {
  id: string;
  transactionDate: string;
  annotation?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfile {
  name: string;
  logoDataUrl?: string;
  logoUpdatedAt?: string;
}

export interface ExtractionDebugInfo {
  lastRunAt?: string;
  lastRunDurationMs?: number;
  lastRunStatus?: "success" | "error" | "skipped";
  lastErrorMessage?: string;
  lastErrorStack?: string;
  lastWarnings?: string[];
  lastTransactionsCount?: number;
  lastBankDetected?: string | null;
  lastParserDetected?: string | null;
  lastParserReason?: string | null;
  lastUsedOCR?: boolean;
  ocrPages?: Array<{
    pageNumber: number;
    text: string;
  }>;
  candidateLines?: Array<{
    pageNumber: number;
    text: string;
  }>;
  parserInputText?: string;
}

export interface StoredPdfFile {
  id: string;
  fileName: string;
  mimeType: "application/pdf";
  size: number;
  dataBase64: string;
  pageCount?: number;
  passwordProtected?: boolean;
  passwordRequired?: boolean;
  previewPageDataUrl?: string;
  annotations: StoredPdfAnnotation[];
  extractionResult?: StatementExtractionResult;
  extractionDebug?: ExtractionDebugInfo;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  ui: UiSettings;
  company: CompanyProfile;
  bankStatements: MonthlyDocumentSectionState;
  creditCardStatements: MonthlyDocumentSectionState;
  invoices: SupplementalDocumentsSectionState;
  otherCommunications: SupplementalDocumentsSectionState;
  pdfFiles: Record<string, StoredPdfFile>;
  categories: Category[];
  categorizationRules: CategorizationRule[];
}
