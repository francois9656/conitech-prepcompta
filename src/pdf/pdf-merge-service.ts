import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import type { AppState, BankStatementMonthItem } from "../domain/models";

export interface MergedBankStatementsOptions {
  includeJustifiedMissingComments?: boolean;
}

export interface MergedBankStatementsPreview {
  fileName: string;
  estimatedPageCount: number;
  introductionPages: number;
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

export async function generateMergedBankStatementsPdf(
  state: AppState,
  options?: MergedBankStatementsOptions
): Promise<MergeResult> {
  const normalizedOptions = normalizeOptions(options);
  const providedMonths = getProvidedMonths(state);
  if (providedMonths.length === 0) {
    throw new Error("Aucun releve bancaire fourni a fusionner.");
  }

  const justifiedMissingMonths = getJustifiedMissingMonths(state);
  const mergedDocument = await PDFDocument.create();
  const fontRegular = await mergedDocument.embedFont(StandardFonts.Helvetica);
  const fontBold = await mergedDocument.embedFont(StandardFonts.HelveticaBold);

  if (hasCompanyPresentation(state)) {
    await addCompanyPresentationPage(mergedDocument, fontRegular, fontBold, state);
  }

  addSectionPresentationPage(mergedDocument, fontRegular, fontBold, state, providedMonths.length);

  if (normalizedOptions.includeJustifiedMissingComments && justifiedMissingMonths.length > 0) {
    addMissingCommentsPages(mergedDocument, fontRegular, fontBold, justifiedMissingMonths);
  }

  for (const month of providedMonths) {
    const file = month.fileId ? state.pdfFiles[month.fileId] : undefined;
    if (!file) {
      continue;
    }

    const sourceBytes = base64ToBytes(file.dataBase64);

    try {
      const sourcePdf = await PDFDocument.load(sourceBytes, {
        ignoreEncryption: false
      });

      const copiedPages = await mergedDocument.copyPages(sourcePdf, sourcePdf.getPageIndices());
      for (const copiedPage of copiedPages) {
        mergedDocument.addPage(copiedPage);
      }
    } catch {
      throw new Error(`Le document ${month.label} ne peut pas etre fusionne (PDF protege ou invalide).`);
    }
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
  const providedMonths = getProvidedMonths(state);
  const justifiedMissingMonths = getJustifiedMissingMonths(state);
  const includesCompanyPresentation = hasCompanyPresentation(state);
  const commentPages =
    normalizedOptions.includeJustifiedMissingComments && justifiedMissingMonths.length > 0
      ? estimateMissingCommentPages(justifiedMissingMonths)
      : 0;
  const documentPages = providedMonths.reduce((total, month) => total + (month.pageCount ?? 0), 0);
  const introductionPages = (includesCompanyPresentation ? 1 : 0) + 1 + commentPages;

  return {
    fileName: buildOutputFileName(state),
    estimatedPageCount: introductionPages + documentPages,
    introductionPages,
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
    }))
  };
}

function normalizeOptions(options?: MergedBankStatementsOptions): NormalizedOptions {
  return {
    includeJustifiedMissingComments: options?.includeJustifiedMissingComments ?? false
  };
}

function getProvidedMonths(state: AppState): BankStatementMonthItem[] {
  return state.bankStatements.expectedMonths.filter((item) => Boolean(item.fileId));
}

function getJustifiedMissingMonths(state: AppState): BankStatementMonthItem[] {
  return state.bankStatements.expectedMonths.filter(
    (item) => item.status === "missing_justified" && Boolean(item.missingReason)
  );
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
  state: AppState,
  providedCount: number
): void {
  const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
  drawBackground(page);

  drawCenteredText(page, "Section", fontRegular, 18, A4_HEIGHT - 190, rgb(0.35, 0.4, 0.47));
  drawCenteredText(page, "Releves bancaires", fontBold, 42, A4_HEIGHT - 250, rgb(0.08, 0.16, 0.22));

  const periodLine = `Periode: ${state.bankStatements.periodStart} au ${state.bankStatements.periodEnd}`;
  const docsLine = `${providedCount} document(s) inclus`;
  const generatedLine = `Genere le ${new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" }).format(new Date())}`;

  drawCenteredText(page, periodLine, fontRegular, 15, A4_HEIGHT - 350, rgb(0.25, 0.3, 0.37));
  drawCenteredText(page, docsLine, fontRegular, 15, A4_HEIGHT - 380, rgb(0.25, 0.3, 0.37));
  drawCenteredText(page, generatedLine, fontRegular, 13, 140, rgb(0.35, 0.4, 0.47));
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
