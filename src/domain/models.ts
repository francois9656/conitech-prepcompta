export type ThemeMode = "light" | "dark" | "system";

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

export interface BankStatementsSectionState {
  sectionKey: "bankStatements";
  periodStart: string;
  periodEnd: string;
  expectedMonths: BankStatementMonthItem[];
  completedCount: number;
  unresolvedCount: number;
}

export interface UiSettings {
  themeMode: ThemeMode;
}

export interface CompanyProfile {
  name: string;
  logoDataUrl?: string;
  logoUpdatedAt?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  ui: UiSettings;
  company: CompanyProfile;
  bankStatements: BankStatementsSectionState;
  pdfFiles: Record<string, StoredPdfFile>;
}
