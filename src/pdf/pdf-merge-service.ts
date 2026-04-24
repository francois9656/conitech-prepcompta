import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import type {
  AppState,
  BankStatementMonthItem,
  MonthlyDocumentSectionKey,
  SupplementalDocumentItem,
  SupplementalDocumentSectionKey,
  StoredPdfAnnotation,
  StoredPdfFile
} from "../domain/models";
import type { BankTransaction } from "../core/types/extraction";

export interface MergedBankStatementsOptions {
  includeJustifiedMissingComments?: boolean;
}

export interface MergedBankStatementsPreview {
  fileName: string;
  estimatedPageCount: number;
  introductionPages: number;
  annotationAppendixPages: number;
  includesCompanyPresentation: boolean;
  includesMissingComments: boolean;
  providedMonths: Array<{
    monthKey: string;
    label: string;
    pageCount?: number;
  }>;
  justifiedMissingMonths: Array<{
    monthKey: string;
    label: string;
    reason: string;
  }>;
  sectionSummaries: Array<{
    key: string;
    label: string;
    documentCount: number;
  }>;
}

interface MergeResult {
  fileName: string;
  bytes: Uint8Array;
}

interface NormalizedOptions {
  includeJustifiedMissingComments: boolean;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN_X = 56;
const PAGE_MARGIN_TOP = 120;
const PAGE_MARGIN_BOTTOM = 72;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN_X * 2;
const COMMENT_LINE_HEIGHT = 18;
const IMPORTED_PDF_MARGIN = 24;
const TRANSACTION_SUMMARY_ROW_PADDING = 6;
const TRANSACTION_SUMMARY_HEADER_HEIGHT = 22;
const TRANSACTION_SUMMARY_COLUMNS = {
  date: 58,
  description: 168,
  debit: 58,
  credit: 58,
  category: 92,
  note: CONTENT_WIDTH - 58 - 168 - 58 - 58 - 92
};

export async function generateMergedBankStatementsPdf(
  state: AppState,
  options?: MergedBankStatementsOptions
): Promise<MergeResult> {
  const normalizedOptions = normalizeOptions(options);
  const providedBankMonths = getProvidedMonths(state, "bankStatements");
  const providedCreditCardMonths = getProvidedMonths(state, "creditCardStatements");
  const invoiceItems = getSupplementalItems(state, "invoices");
  const communicationItems = getSupplementalItems(state, "otherCommunications");
  const totalDocumentCount =
    providedBankMonths.length + providedCreditCardMonths.length + invoiceItems.length + communicationItems.length;
  if (totalDocumentCount === 0) {
    throw new Error("Aucun document fourni a fusionner.");
  }

  const justifiedMissingMonths = getJustifiedMissingMonths(state);
  const mergedDocument = await PDFDocument.create();
  const fontRegular = await mergedDocument.embedFont(StandardFonts.Helvetica);
  const fontBold = await mergedDocument.embedFont(StandardFonts.HelveticaBold);

  if (hasCompanyPresentation(state)) {
    await addCompanyPresentationPage(mergedDocument, fontRegular, fontBold, state);
  }

  if (providedBankMonths.length > 0) {
    addSectionPresentationPage(
      mergedDocument,
      fontRegular,
      fontBold,
      "Releves bancaires",
      state.bankStatements.periodStart,
      state.bankStatements.periodEnd,
      providedBankMonths.length
    );
  }

  if (normalizedOptions.includeJustifiedMissingComments && justifiedMissingMonths.length > 0) {
    addMissingCommentsPages(mergedDocument, fontRegular, fontBold, justifiedMissingMonths);
  }

  for (const month of providedBankMonths) {
    const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
    if (!file) {
      continue;
    }

    await appendPdfFileToMergedDocument(mergedDocument, fontRegular, fontBold, state, month.label, file, true);
  }

  if (providedCreditCardMonths.length > 0) {
    addSectionPresentationPage(
      mergedDocument,
      fontRegular,
      fontBold,
      "Releves de carte de credit",
      state.creditCardStatements.periodStart,
      state.creditCardStatements.periodEnd,
      providedCreditCardMonths.length
    );
  }

  for (const month of providedCreditCardMonths) {
    const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
    if (!file) {
      continue;
    }

    await appendPdfFileToMergedDocument(mergedDocument, fontRegular, fontBold, state, month.label, file, true);
  }

  if (invoiceItems.length > 0) {
    addSimpleSectionPresentationPage(mergedDocument, fontRegular, fontBold, "Factures", invoiceItems.length);
  }
  for (const item of invoiceItems) {
    const file = state.pdfFiles[item.fileId];
    if (!file) {
      continue;
    }
    await appendPdfFileToMergedDocument(mergedDocument, fontRegular, fontBold, state, file.fileName, file, false);
  }

  if (communicationItems.length > 0) {
    addSimpleSectionPresentationPage(mergedDocument, fontRegular, fontBold, "Communication et autre", communicationItems.length);
  }
  for (const item of communicationItems) {
    const file = state.pdfFiles[item.fileId];
    if (!file) {
      continue;
    }
    await appendPdfFileToMergedDocument(mergedDocument, fontRegular, fontBold, state, file.fileName, file, false);
  }

  const bytes = await mergedDocument.save();
  return {
    fileName: buildOutputFileName(state),
    bytes
  };
}

export function buildMergedBankStatementsPreview(
  state: AppState,
  options?: MergedBankStatementsOptions
): MergedBankStatementsPreview {
  const normalizedOptions = normalizeOptions(options);
  const providedMonths = getProvidedMonths(state, "bankStatements");
  const providedCreditCardMonths = getProvidedMonths(state, "creditCardStatements");
  const invoiceItems = getSupplementalItems(state, "invoices");
  const communicationItems = getSupplementalItems(state, "otherCommunications");
  const justifiedMissingMonths = getJustifiedMissingMonths(state);
  const includesCompanyPresentation = hasCompanyPresentation(state);
  const annotationAppendixPages = providedMonths.reduce((total, month) => {
    const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
    return total + estimateAnnotationsAppendixPages(file) + estimateTransactionSummaryPages(file);
  }, 0) + providedCreditCardMonths.reduce((total, month) => {
    const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
    return total + estimateAnnotationsAppendixPages(file) + estimateTransactionSummaryPages(file);
  }, 0);
  const commentPages =
    normalizedOptions.includeJustifiedMissingComments && justifiedMissingMonths.length > 0
      ? estimateMissingCommentPages(justifiedMissingMonths)
      : 0;
  const documentPages = providedMonths.reduce((total, month) => {
    const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
    return total + (month.pageCount ?? 0) + estimateTransactionSummaryPages(file) + estimateAnnotationsAppendixPages(file);
  }, 0)
    + providedCreditCardMonths.reduce((total, month) => {
      const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
      return total + (month.pageCount ?? 0) + estimateTransactionSummaryPages(file) + estimateAnnotationsAppendixPages(file);
    }, 0)
    + invoiceItems.reduce((total, item) => {
      const file = state.pdfFiles[item.fileId];
      return total + (item.pageCount ?? file?.pageCount ?? 0) + estimateTransactionSummaryPages(file);
    }, 0)
    + communicationItems.reduce((total, item) => {
      const file = state.pdfFiles[item.fileId];
      return total + (item.pageCount ?? file?.pageCount ?? 0) + estimateTransactionSummaryPages(file);
    }, 0);
  const sectionIntroPages =
    (providedMonths.length > 0 ? 1 : 0) +
    (providedCreditCardMonths.length > 0 ? 1 : 0) +
    (invoiceItems.length > 0 ? 1 : 0) +
    (communicationItems.length > 0 ? 1 : 0);
  const introductionPages = (includesCompanyPresentation ? 1 : 0) + sectionIntroPages + commentPages;

  return {
    fileName: buildOutputFileName(state),
    estimatedPageCount: introductionPages + documentPages,
    introductionPages,
    annotationAppendixPages,
    includesCompanyPresentation,
    includesMissingComments: commentPages > 0,
    providedMonths: providedMonths.map((month) => ({
      monthKey: month.monthKey,
      label: month.label,
      pageCount: month.pageCount
    })),
    justifiedMissingMonths: justifiedMissingMonths.map((month) => ({
      monthKey: month.monthKey,
      label: month.label,
      reason: month.missingReason ?? ""
    })),
    sectionSummaries: [
      { key: "bankStatements", label: "Relevés bancaires", documentCount: providedMonths.length },
      { key: "creditCardStatements", label: "Relevés de carte de crédit", documentCount: providedCreditCardMonths.length },
      { key: "invoices", label: "Factures", documentCount: invoiceItems.length },
      { key: "otherCommunications", label: "Communication et autre", documentCount: communicationItems.length }
    ]
  };
}

function normalizeOptions(options?: MergedBankStatementsOptions): NormalizedOptions {
  return {
    includeJustifiedMissingComments: options?.includeJustifiedMissingComments ?? false
  };
}

function getProvidedMonths(state: AppState, sectionKey: MonthlyDocumentSectionKey): BankStatementMonthItem[] {
  return state[sectionKey].expectedMonths.filter((item) => Boolean(item.fileId));
}

function getJustifiedMissingMonths(state: AppState): BankStatementMonthItem[] {
  return state.bankStatements.expectedMonths.filter(
    (item) => item.status === "missing_justified" && Boolean(item.missingReason)
  );
}

function getSupplementalItems(state: AppState, sectionKey: SupplementalDocumentSectionKey): SupplementalDocumentItem[] {
  return state[sectionKey].items.filter((item) => Boolean(item.fileId));
}

function hasCompanyPresentation(state: AppState): boolean {
  return Boolean(state.company.name.trim() || state.company.logoDataUrl);
}

async function addCompanyPresentationPage(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  state: AppState
): Promise<void> {
  const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
  drawBackground(page);

  drawCenteredText(page, "Dossier comptable", fontBold, 38, A4_HEIGHT - 170, rgb(0.08, 0.16, 0.22));
  drawCenteredText(page, state.company.name.trim() || "Entreprise", fontBold, 28, A4_HEIGHT - 230, rgb(0.1, 0.3, 0.38));

  if (state.company.logoDataUrl) {
    const logoBytes = dataUrlToBytes(state.company.logoDataUrl);
    const logoImage = await embedImage(document, state.company.logoDataUrl, logoBytes);
    const maxWidth = 280;
    const maxHeight = 140;
    const scale = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height, 1);
    const width = logoImage.width * scale;
    const height = logoImage.height * scale;

    page.drawImage(logoImage, {
      x: (A4_WIDTH - width) / 2,
      y: A4_HEIGHT - 420,
      width,
      height
    });
  }

  drawCenteredText(page, "Preparation des releves bancaires", fontRegular, 16, 150, rgb(0.35, 0.4, 0.47));
}

function addSectionPresentationPage(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  sectionTitle: string,
  periodStart: string,
  periodEnd: string,
  providedCount: number
): void {
  const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
  drawBackground(page);

  drawCenteredText(page, "Section", fontRegular, 18, A4_HEIGHT - 190, rgb(0.35, 0.4, 0.47));
  drawCenteredText(page, sectionTitle, fontBold, 42, A4_HEIGHT - 250, rgb(0.08, 0.16, 0.22));

  const periodLine = `Periode: ${periodStart} au ${periodEnd}`;
  const docsLine = `${providedCount} document(s) inclus`;
  const generatedLine = `Genere le ${new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" }).format(new Date())}`;

  drawCenteredText(page, periodLine, fontRegular, 15, A4_HEIGHT - 350, rgb(0.25, 0.3, 0.37));
  drawCenteredText(page, docsLine, fontRegular, 15, A4_HEIGHT - 380, rgb(0.25, 0.3, 0.37));
  drawCenteredText(page, generatedLine, fontRegular, 13, 140, rgb(0.35, 0.4, 0.47));
}

function addSimpleSectionPresentationPage(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  sectionTitle: string,
  documentCount: number
): void {
  const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
  drawBackground(page);
  drawCenteredText(page, "Section", fontRegular, 18, A4_HEIGHT - 190, rgb(0.35, 0.4, 0.47));
  drawCenteredText(page, sectionTitle, fontBold, 42, A4_HEIGHT - 250, rgb(0.08, 0.16, 0.22));
  drawCenteredText(page, `${documentCount} document(s) inclus`, fontRegular, 15, A4_HEIGHT - 350, rgb(0.25, 0.3, 0.37));
  drawCenteredText(page, `Genere le ${new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" }).format(new Date())}`, fontRegular, 13, 140, rgb(0.35, 0.4, 0.47));
}

function addMissingCommentsPages(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  justifiedMissingMonths: BankStatementMonthItem[]
): void {
  const pages = paginateMissingComments(justifiedMissingMonths, fontRegular, fontBold);

  pages.forEach((pageLines, pageIndex) => {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    drawBackground(page);
    drawPageHeader(
      page,
      fontRegular,
      fontBold,
      pageIndex === 0 ? "Commentaires sur les documents manquants" : "Commentaires complementaires"
    );

    let currentY = A4_HEIGHT - PAGE_MARGIN_TOP - 24;
    for (const line of pageLines) {
      page.drawText(line.text, {
        x: PAGE_MARGIN_X + line.indent,
        y: currentY,
        size: line.size,
        font: line.bold ? fontBold : fontRegular,
        color: line.color
      });
      currentY -= line.height;
    }
  });
}

function addAnnotationsAppendixPages(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  monthLabel: string,
  file: StoredPdfFile
): void {
  const pages = paginateAnnotationsAppendix(file.annotations, fontRegular);

  pages.forEach((pageLines, pageIndex) => {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    drawBackground(page);
    drawPageHeader(
      page,
      fontRegular,
      fontBold,
      pageIndex === 0 ? `Annotations - ${monthLabel}` : `Suite annotations - ${monthLabel}`
    );

    let currentY = A4_HEIGHT - PAGE_MARGIN_TOP - 20;
    for (const line of pageLines) {
      page.drawText(line.text, {
        x: PAGE_MARGIN_X + line.indent,
        y: currentY,
        size: line.size,
        font: line.bold ? fontBold : fontRegular,
        color: line.color
      });
      currentY -= line.height;
    }
  });
}

async function appendPdfFileToMergedDocument(
  mergedDocument: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  state: AppState,
  label: string,
  file: StoredPdfFile,
  includeAnnotations: boolean
): Promise<void> {
  const sourceBytes = base64ToBytes(file.dataBase64);

  try {
    if ((file.extractionResult?.transactions?.length ?? 0) > 0) {
      addTransactionSummaryPages(mergedDocument, fontRegular, fontBold, state, label, file);
    }
    await appendNormalizedPdfPages(mergedDocument, sourceBytes);

    if (includeAnnotations && file.annotations.length > 0) {
      addAnnotationsAppendixPages(mergedDocument, fontRegular, fontBold, label, file);
    }
  } catch (error) {
    console.error(`Erreur fusion ${label}:`, error);
    addPdfImportFailurePage(
      mergedDocument,
      fontRegular,
      fontBold,
      label,
      "Le document original n'a pas pu etre fusionne. Une normalisation ou reconstruction est requise."
    );
    throw new Error(`Le document ${label} ne peut pas etre fusionne. Consulte la console pour le detail technique.`);
  }
}

async function appendNormalizedPdfPages(mergedDocument: PDFDocument, sourceBytes: Uint8Array): Promise<void> {
  const sourcePdf = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true
  });

  const pageIndices = sourcePdf.getPageIndices();
  const embeddedPages = await mergedDocument.embedPdf(sourceBytes, pageIndices);
  const maxWidth = A4_WIDTH - IMPORTED_PDF_MARGIN * 2;
  const maxHeight = A4_HEIGHT - IMPORTED_PDF_MARGIN * 2;

  embeddedPages.forEach((embeddedPage) => {
    const widthScale = maxWidth / embeddedPage.width;
    const heightScale = maxHeight / embeddedPage.height;
    const scale = Math.min(widthScale, heightScale);
    const drawWidth = embeddedPage.width * scale;
    const drawHeight = embeddedPage.height * scale;
    const page = mergedDocument.addPage([A4_WIDTH, A4_HEIGHT]);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: A4_WIDTH,
      height: A4_HEIGHT,
      color: rgb(1, 1, 1)
    });

    page.drawPage(embeddedPage, {
      x: (A4_WIDTH - drawWidth) / 2,
      y: (A4_HEIGHT - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight
    });
  });
}

function addTransactionSummaryPages(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  state: AppState,
  label: string,
  file: StoredPdfFile
): void {
  const transactions = file.extractionResult?.transactions ?? [];
  if (transactions.length === 0) {
    return;
  }

  const rows = buildTransactionSummaryRows(transactions, file.annotations, state);
  const pageHeightLimit = A4_HEIGHT - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM - 40;
  const pages: typeof rows[] = [];
  let currentPage: typeof rows = [];
  let usedHeight = 0;

  for (const row of rows) {
    const rowHeight = estimateTransactionSummaryRowHeight(row, fontRegular);
    const nextHeight = currentPage.length === 0 ? rowHeight + TRANSACTION_SUMMARY_HEADER_HEIGHT : rowHeight;
    if (usedHeight + nextHeight > pageHeightLimit && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }

    currentPage.push(row);
    usedHeight += currentPage.length === 1 ? rowHeight + TRANSACTION_SUMMARY_HEADER_HEIGHT : rowHeight;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  pages.forEach((pageRows, index) => {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    drawBackground(page);
    drawPageHeader(
      page,
      fontRegular,
      fontBold,
      index === 0 ? `Transactions - ${label}` : `Suite transactions - ${label}`
    );

    let currentY = A4_HEIGHT - PAGE_MARGIN_TOP - 18;
    currentY = drawTransactionSummaryTableHeader(page, fontRegular, fontBold, currentY);

    for (const row of pageRows) {
      currentY = drawTransactionSummaryRow(page, fontRegular, currentY, row);
    }
  });
}

function buildTransactionSummaryRows(
  transactions: BankTransaction[],
  annotations: StoredPdfAnnotation[],
  state: AppState
): Array<{ date: string; description: string; debit: string; credit: string; category: string; note: string }> {
  const annotationBuckets = new Map<string, StoredPdfAnnotation[]>();
  for (const annotation of annotations) {
    const key = annotation.transactionDate || "__empty__";
    const bucket = annotationBuckets.get(key) ?? [];
    bucket.push(annotation);
    annotationBuckets.set(key, bucket);
  }

  return transactions.map((transaction, index) => {
    const match = findFirstMatchingCategory(transaction, state);
    const categoryLabel = state.categories.find((item) => item.id === match?.categoryId)?.label ?? "";
    const note = consumeAnnotationForTransaction(transaction, annotations[index], annotationBuckets);

    return {
      date: transaction.date ?? "",
      description: transaction.description ?? "",
      debit: formatTransactionAmount(transaction.debit),
      credit: formatTransactionAmount(transaction.credit),
      category: categoryLabel,
      note
    };
  });
}

function findFirstMatchingCategory(
  transaction: Pick<BankTransaction, "description" | "debit" | "credit">,
  state: AppState
): { categoryId: string } | null {
  const searchableText = [
    transaction.description ?? "",
    stringifyAmountForMatching(transaction.debit),
    stringifyAmountForMatching(transaction.credit)
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (!searchableText) {
    return null;
  }

  const matchedRule = state.categorizationRules.find((rule) => {
    if (!rule.pattern?.trim()) {
      return false;
    }
    const category = state.categories.find((item) => item.id === rule.categoryId);
    if (!category || category.hidden) {
      return false;
    }
    return searchableText.includes(rule.pattern.toLowerCase());
  });

  return matchedRule ? { categoryId: matchedRule.categoryId } : null;
}

function consumeAnnotationForTransaction(
  transaction: BankTransaction,
  fallbackAnnotation: StoredPdfAnnotation | undefined,
  annotationBuckets: Map<string, StoredPdfAnnotation[]>
): string {
  const datedBucket = transaction.date ? annotationBuckets.get(transaction.date) : undefined;
  if (datedBucket && datedBucket.length > 0) {
    const annotation = datedBucket.shift();
    return annotation?.annotation?.trim() ?? "";
  }

  return fallbackAnnotation?.annotation?.trim() ?? "";
}

function estimateTransactionSummaryRowHeight(
  row: { description: string; category: string; note: string },
  fontRegular: PDFFont
): number {
  const descriptionLines = wrapTextOrEmpty(row.description, fontRegular, 9.5, TRANSACTION_SUMMARY_COLUMNS.description - 8);
  const categoryLines = wrapTextOrEmpty(row.category, fontRegular, 9.5, TRANSACTION_SUMMARY_COLUMNS.category - 8);
  const noteLines = wrapTextOrEmpty(row.note, fontRegular, 9.5, TRANSACTION_SUMMARY_COLUMNS.note - 8);
  const lineCount = Math.max(descriptionLines.length, categoryLines.length, noteLines.length, 1);
  return lineCount * 12 + TRANSACTION_SUMMARY_ROW_PADDING * 2;
}

function drawTransactionSummaryTableHeader(page: PDFPage, fontRegular: PDFFont, fontBold: PDFFont, y: number): number {
  let x = PAGE_MARGIN_X;
  const columns: Array<[string, number]> = [
    ["Date", TRANSACTION_SUMMARY_COLUMNS.date],
    ["Description", TRANSACTION_SUMMARY_COLUMNS.description],
    ["Débit", TRANSACTION_SUMMARY_COLUMNS.debit],
    ["Crédit", TRANSACTION_SUMMARY_COLUMNS.credit],
    ["Catégorie", TRANSACTION_SUMMARY_COLUMNS.category],
    ["Note", TRANSACTION_SUMMARY_COLUMNS.note]
  ];

  page.drawRectangle({
    x: PAGE_MARGIN_X,
    y: y - TRANSACTION_SUMMARY_HEADER_HEIGHT + 4,
    width: CONTENT_WIDTH,
    height: TRANSACTION_SUMMARY_HEADER_HEIGHT,
    color: rgb(0.89, 0.94, 0.96)
  });

  for (const [label, width] of columns) {
    page.drawRectangle({
      x,
      y: y - TRANSACTION_SUMMARY_HEADER_HEIGHT + 4,
      width,
      height: TRANSACTION_SUMMARY_HEADER_HEIGHT,
      borderWidth: 0.6,
      borderColor: rgb(0.72, 0.8, 0.84)
    });
    page.drawText(label, {
      x: x + 4,
      y: y - 14,
      size: 10,
      font: fontBold,
      color: rgb(0.08, 0.16, 0.22)
    });
    x += width;
  }

  return y - TRANSACTION_SUMMARY_HEADER_HEIGHT;
}

function drawTransactionSummaryRow(
  page: PDFPage,
  fontRegular: PDFFont,
  y: number,
  row: { date: string; description: string; debit: string; credit: string; category: string; note: string }
): number {
  const descriptionLines = wrapTextOrEmpty(row.description, fontRegular, 9.5, TRANSACTION_SUMMARY_COLUMNS.description - 8);
  const categoryLines = wrapTextOrEmpty(row.category, fontRegular, 9.5, TRANSACTION_SUMMARY_COLUMNS.category - 8);
  const noteLines = wrapTextOrEmpty(row.note, fontRegular, 9.5, TRANSACTION_SUMMARY_COLUMNS.note - 8);
  const lineCount = Math.max(descriptionLines.length, categoryLines.length, noteLines.length, 1);
  const rowHeight = lineCount * 12 + TRANSACTION_SUMMARY_ROW_PADDING * 2;
  const topY = y;
  const baseY = topY - TRANSACTION_SUMMARY_ROW_PADDING - 10;

  let x = PAGE_MARGIN_X;
  const cells = [
    { width: TRANSACTION_SUMMARY_COLUMNS.date, lines: [row.date], alignRight: false },
    { width: TRANSACTION_SUMMARY_COLUMNS.description, lines: descriptionLines, alignRight: false },
    { width: TRANSACTION_SUMMARY_COLUMNS.debit, lines: [row.debit], alignRight: true },
    { width: TRANSACTION_SUMMARY_COLUMNS.credit, lines: [row.credit], alignRight: true },
    { width: TRANSACTION_SUMMARY_COLUMNS.category, lines: categoryLines, alignRight: false },
    { width: TRANSACTION_SUMMARY_COLUMNS.note, lines: noteLines, alignRight: false }
  ];

  for (const cell of cells) {
    page.drawRectangle({
      x,
      y: topY - rowHeight,
      width: cell.width,
      height: rowHeight,
      borderWidth: 0.6,
      borderColor: rgb(0.78, 0.84, 0.88)
    });

    cell.lines.forEach((line, index) => {
      const textWidth = fontRegular.widthOfTextAtSize(line, 9.5);
      page.drawText(line, {
        x: cell.alignRight ? x + cell.width - textWidth - 4 : x + 4,
        y: baseY - index * 12,
        size: 9.5,
        font: fontRegular,
        color: rgb(0.18, 0.23, 0.29)
      });
    });

    x += cell.width;
  }

  return topY - rowHeight;
}

function wrapTextOrEmpty(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["-"];
  }
  return wrapText(normalized, font, fontSize, maxWidth);
}

function formatTransactionAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return value.toLocaleString("fr-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function stringifyAmountForMatching(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const fixed = value.toFixed(2);
  const fr = value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fixed} ${fixed.replace(".", ",")} ${fr}`;
}

function addPdfImportFailurePage(
  document: PDFDocument,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  monthLabel: string,
  message: string
): void {
  const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
  drawBackground(page);

  drawPageHeader(
    page,
    fontRegular,
    fontBold,
    `Document non fusionne - ${monthLabel}`
  );
  let currentY = A4_HEIGHT - PAGE_MARGIN_TOP - 40;

  page.drawText("Impossible de fusionner ce document", {
    x: PAGE_MARGIN_X,
    y: currentY,
    size: 18,
    font: fontBold,
    color: rgb(0.75, 0.2, 0.2)
  });

  currentY -= 30;

  const wrappedMessage = wrapText(message, fontRegular, 12, CONTENT_WIDTH);

  for (const line of wrappedMessage) {
    page.drawText(line, {
      x: PAGE_MARGIN_X,
      y: currentY,
      size: 12,
      font: fontRegular,
      color: rgb(0.25, 0.3, 0.37)
    });
    currentY -= COMMENT_LINE_HEIGHT;
  }

  currentY -= 20;

  const helpLines = [
    "Causes possibles :",
    "- PDF protege ou restreint",
    "- Document corrompu ou mal forme",
    "- Format incompatible avec le moteur de fusion",
    "",
    "Actions recommandees :",
    "- Ouvrir le document et 'Imprimer en PDF'",
    "- Exporter en PDF/A",
    "- Reimporter une version non protegee"
  ];

  for (const line of helpLines) {
    page.drawText(line, {
      x: PAGE_MARGIN_X,
      y: currentY,
      size: 11,
      font: line.endsWith(":") ? fontBold : fontRegular,
      color: rgb(0.35, 0.4, 0.47)
    });
    currentY -= 16;
  }
}

function paginateMissingComments(months: BankStatementMonthItem[], fontRegular: PDFFont, fontBold: PDFFont) {
  const lines = months.flatMap((month) => buildMissingMonthLines(month, fontRegular, fontBold));
  const pageHeightLimit = A4_HEIGHT - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM - 40;
  const pages: Array<Array<{ text: string; size: number; height: number; bold: boolean; indent: number; color: ReturnType<typeof rgb> }>> = [];
  let currentPage: Array<{ text: string; size: number; height: number; bold: boolean; indent: number; color: ReturnType<typeof rgb> }> = [];
  let usedHeight = 0;

  for (const line of lines) {
    if (usedHeight + line.height > pageHeightLimit && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }

    currentPage.push(line);
    usedHeight += line.height;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

function buildMissingMonthLines(month: BankStatementMonthItem, fontRegular: PDFFont, fontBold: PDFFont) {
  const heading = `- ${month.label}`;
  const reasonPrefix = "Motif: ";
  const wrappedReasonLines = wrapText(month.missingReason ?? "", fontRegular, 12, CONTENT_WIDTH - 28 - 42);

  return [
    {
      text: heading,
      size: 13,
      height: 24,
      bold: true,
      indent: 0,
      color: rgb(0.08, 0.16, 0.22)
    },
    ...wrappedReasonLines.map((line, index) => ({
      text: `${index === 0 ? reasonPrefix : ""}${line}`,
      size: 12,
      height: COMMENT_LINE_HEIGHT,
      bold: false,
      indent: 22,
      color: rgb(0.25, 0.3, 0.37)
    })),
    {
      text: "",
      size: 12,
      height: 10,
      bold: false,
      indent: 0,
      color: rgb(0.25, 0.3, 0.37)
    }
  ];
}

function estimateMissingCommentPages(months: BankStatementMonthItem[]): number {
  const estimatedLineCount = months.reduce((total, month) => {
    const reasonLength = (month.missingReason ?? "").length;
    const estimatedReasonLines = Math.max(1, Math.ceil(reasonLength / 75));
    return total + 2 + estimatedReasonLines;
  }, 0);
  const linesPerPage = 28;
  return Math.max(1, Math.ceil(estimatedLineCount / linesPerPage));
}

function paginateAnnotationsAppendix(annotations: StoredPdfAnnotation[], fontRegular: PDFFont) {
  const lines = annotations.flatMap((annotation) => buildAnnotationAppendixLines(annotation, fontRegular));
  const pageHeightLimit = A4_HEIGHT - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM - 40;
  const pages: Array<Array<{ text: string; size: number; height: number; bold: boolean; indent: number; color: ReturnType<typeof rgb> }>> = [];
  let currentPage: Array<{ text: string; size: number; height: number; bold: boolean; indent: number; color: ReturnType<typeof rgb> }> = [];
  let usedHeight = 0;

  for (const line of lines) {
    if (usedHeight + line.height > pageHeightLimit && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }

    currentPage.push(line);
    usedHeight += line.height;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

function buildAnnotationAppendixLines(annotation: StoredPdfAnnotation, fontRegular: PDFFont) {
  const heading = `${annotation.transactionDate || "Date non renseignee"}`;
  const wrappedAnnotation = wrapText(annotation.annotation?.trim() || "Aucune annotation", fontRegular, 11, CONTENT_WIDTH - 42);

  return [
    {
      text: heading,
      size: 12,
      height: 22,
      bold: true,
      indent: 0,
      color: rgb(0.08, 0.16, 0.22)
    },
    ...wrappedAnnotation.map((line, index) => ({
      text: `${index === 0 ? "Annotation: " : ""}${line}`,
      size: 11,
      height: 16,
      bold: false,
      indent: 28,
      color: rgb(0.35, 0.4, 0.47)
    })),
    {
      text: "",
      size: 11,
      height: 10,
      bold: false,
      indent: 0,
      color: rgb(0.35, 0.4, 0.47)
    }
  ];
}

function estimateAnnotationsAppendixPages(file: StoredPdfFile | undefined): number {
  if (!file || file.annotations.length === 0) {
    return 0;
  }

  const estimatedLineCount = file.annotations.reduce((total, annotation) => {
    const annotationLines = Math.max(1, Math.ceil((annotation.annotation?.length ?? 18) / 75));
    return total + 2 + annotationLines;
  }, 0);
  const linesPerPage = 26;
  return Math.max(1, Math.ceil(estimatedLineCount / linesPerPage));
}

function estimateTransactionSummaryPages(file: StoredPdfFile | undefined): number {
  const transactions = file?.extractionResult?.transactions ?? [];
  if (transactions.length === 0) {
    return 0;
  }

  const linesPerPage = 19;
  return Math.max(1, Math.ceil(transactions.length / linesPerPage));
}

function drawBackground(page: PDFPage): void {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    color: rgb(0.97, 0.985, 0.99)
  });

  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 64,
    width: A4_WIDTH,
    height: 64,
    color: rgb(0.86, 0.93, 0.95)
  });
}

function drawPageHeader(page: PDFPage, fontRegular: PDFFont, fontBold: PDFFont, title: string): void {
  page.drawText("Section Releves bancaires", {
    x: PAGE_MARGIN_X,
    y: A4_HEIGHT - 86,
    size: 12,
    font: fontRegular,
    color: rgb(0.35, 0.4, 0.47)
  });

  page.drawText(title, {
    x: PAGE_MARGIN_X,
    y: A4_HEIGHT - PAGE_MARGIN_TOP + 20,
    size: 24,
    font: fontBold,
    color: rgb(0.08, 0.16, 0.22)
  });
}

function drawCenteredText(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color: ReturnType<typeof rgb>): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (A4_WIDTH - width) / 2,
    y,
    size,
    font,
    color
  });
}

async function embedImage(document: PDFDocument, dataUrl: string, bytes: Uint8Array): Promise<PDFImage> {
  if (dataUrl.startsWith("data:image/png")) {
    return document.embedPng(bytes);
  }

  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) {
    return document.embedJpg(bytes);
  }

  throw new Error("Le logo doit etre une image PNG ou JPEG.");
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["Aucun commentaire fourni."];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(nextLine, fontSize) <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    lines.push(word);
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Format de logo invalide.");
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  return base64ToBytes(base64);
}

function base64ToBytes(base64Data: string): Uint8Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildOutputFileName(state: AppState): string {
  const start = state.bankStatements.periodStart.replaceAll("-", "");
  const end = state.bankStatements.periodEnd.replaceAll("-", "");
  return `releves-bancaires-${start}-${end}.pdf`;
}
