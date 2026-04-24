import { buildBankStatementsState } from "../domain/bank-statements";
import type {
  AppState,
  BankStatementMonthItem,
  CategorizationRule,
  Category,
  CompanyProfile,
  DocumentSectionKey,
  MonthlyDocumentSectionKey,
  Period,
  SupplementalDocumentItem,
  SupplementalDocumentSectionKey,
  StoredPdfFile,
  StoredPdfAnnotation,
  UiSettings
} from "../domain/models";
import { createDefaultAppState, DEFAULT_CATEGORIES } from "./defaults";

function normalizeStoredPdfFile(file: StoredPdfFile & { annotations?: StoredPdfAnnotation[] }): StoredPdfFile {
  return {
    ...file,
    annotations: normalizeStoredAnnotations(file.annotations)
  };
}

function normalizeCategories(categories: Category[] | undefined): Category[] {
  const builtInById = new Map(DEFAULT_CATEGORIES.map((category) => [category.id, category]));
  const existing = (categories ?? []).map((category) => ({
    ...category,
    builtIn: category.builtIn ?? builtInById.has(category.id),
    hidden: category.hidden ?? false
  }));

  const existingById = new Map(existing.map((category) => [category.id, category]));
  const mergedBuiltIns = DEFAULT_CATEGORIES.map((category) => {
    const existingCategory = existingById.get(category.id);
    return existingCategory
      ? {
          ...category,
          ...existingCategory,
          builtIn: true,
          hidden: existingCategory.hidden ?? false
        }
      : category;
  });

  const customCategories = existing.filter((category) => !builtInById.has(category.id));
  return [...mergedBuiltIns, ...customCategories];
}

const STORAGE_KEY = "conitech-prepcompta-state";
const STORAGE_SAFETY_MARGIN_BYTES = 8192;

export async function getAppState(): Promise<AppState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] as AppState | undefined;

  if (!state) {
    const defaultState = createDefaultAppState();
    await persistAppState(defaultState);
    return defaultState;
  }

  return {
    ...createDefaultAppState(),
    ...state,
    ui: {
      ...createDefaultAppState().ui,
      ...state.ui
    },
    company: {
      ...createDefaultAppState().company,
      ...state.company
    },
    pdfFiles: Object.fromEntries(
      Object.entries(state.pdfFiles ?? {}).map(([fileId, file]) => [
        fileId,
        normalizeStoredPdfFile(file as StoredPdfFile & { annotations?: StoredPdfAnnotation[] })
      ])
    ),
    bankStatements: buildBankStatementsState(
      {
        start: state.bankStatements?.periodStart ?? createDefaultAppState().bankStatements.periodStart,
        end: state.bankStatements?.periodEnd ?? createDefaultAppState().bankStatements.periodEnd
      },
      state.bankStatements?.expectedMonths ?? [],
      "bankStatements"
    ),
    creditCardStatements: buildBankStatementsState(
      {
        start: state.creditCardStatements?.periodStart ?? state.bankStatements?.periodStart ?? createDefaultAppState().creditCardStatements.periodStart,
        end: state.creditCardStatements?.periodEnd ?? state.bankStatements?.periodEnd ?? createDefaultAppState().creditCardStatements.periodEnd
      },
      state.creditCardStatements?.expectedMonths ?? [],
      "creditCardStatements"
    ),
    invoices: {
      ...createDefaultAppState().invoices,
      ...state.invoices,
      items: normalizeSupplementalItems(state.invoices?.items)
    },
    otherCommunications: {
      ...createDefaultAppState().otherCommunications,
      ...state.otherCommunications,
      items: normalizeSupplementalItems(state.otherCommunications?.items)
    },
    categories: normalizeCategories(state.categories),
    categorizationRules: state.categorizationRules ?? createDefaultAppState().categorizationRules
  };
}

export async function updatePeriod(period: Period): Promise<AppState> {
  const currentState = await getAppState();
  const nextBankStatements = buildBankStatementsState(period, currentState.bankStatements.expectedMonths);
  const nextState: AppState = {
    ...currentState,
    bankStatements: nextBankStatements,
    creditCardStatements: buildBankStatementsState(period, currentState.creditCardStatements.expectedMonths, "creditCardStatements"),
    pdfFiles: pruneOrphanPdfFiles({
      monthlySections: [nextBankStatements.expectedMonths, currentState.creditCardStatements.expectedMonths],
      supplementalSections: [currentState.invoices.items, currentState.otherCommunications.items]
    }, currentState.pdfFiles)
  };

  await persistAppState(nextState);
  return nextState;
}

export async function updateMonthItem(
  monthKey: string,
  updater: (item: BankStatementMonthItem) => BankStatementMonthItem
): Promise<AppState> {
  const currentState = await getAppState();
  const updatedMonths = currentState.bankStatements.expectedMonths.map((item) =>
    item.monthKey === monthKey ? updater(item) : item
  );

  const nextState: AppState = {
    ...currentState,
    bankStatements: buildBankStatementsState(
      {
        start: currentState.bankStatements.periodStart,
        end: currentState.bankStatements.periodEnd
      },
      updatedMonths
    )
  };

  await persistAppState(nextState);
  return nextState;
}

export async function savePdfForMonth(monthKey: string, file: StoredPdfFile): Promise<AppState> {
  return savePdfForMonthlySection("bankStatements", monthKey, file);
}

export async function savePdfForMonthlySection(
  sectionKey: MonthlyDocumentSectionKey,
  monthKey: string,
  file: StoredPdfFile
): Promise<AppState> {
  const currentState = await getAppState();
  const section = currentState[sectionKey];
  const targetMonth = section.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const previousFileId = targetMonth.fileId;

  const updatedMonths = section.expectedMonths.map((item) => {
    if (item.monthKey !== monthKey) {
      return item;
    }

    return {
      ...item,
      status: "provided" as const,
      fileId: file.id,
      fileName: file.fileName,
      pageCount: file.pageCount,
      passwordProtected: file.passwordProtected,
      missingReason: undefined
    };
  });

  const nextPdfFiles = { ...currentState.pdfFiles };
  nextPdfFiles[file.id] = normalizeStoredPdfFile(file);

  if (previousFileId && previousFileId !== file.id) {
    delete nextPdfFiles[previousFileId];
  }

  const nextState: AppState = {
    ...currentState,
    pdfFiles: nextPdfFiles,
    [sectionKey]: buildBankStatementsState(
      {
        start: section.periodStart,
        end: section.periodEnd
      },
      updatedMonths,
      sectionKey
    )
  };

  await persistAppState(nextState);
  return nextState;
}

export async function markMonthMissing(monthKey: string, reason: string): Promise<AppState> {
  return markMonthlySectionMissing("bankStatements", monthKey, reason);
}

export async function markMonthlySectionMissing(
  sectionKey: MonthlyDocumentSectionKey,
  monthKey: string,
  reason: string
): Promise<AppState> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error("La raison est obligatoire pour marquer un document manquant.");
  }

  const currentState = await getAppState();
  const section = currentState[sectionKey];
  const targetMonth = section.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const previousFileId = targetMonth.fileId;
  const updatedMonths = section.expectedMonths.map((item) => {
    if (item.monthKey !== monthKey) {
      return item;
    }

    return {
      ...item,
      status: "missing_justified" as const,
      fileId: undefined,
      fileName: undefined,
      pageCount: undefined,
      passwordProtected: undefined,
      missingReason: normalizedReason
    };
  });

  const nextPdfFiles = { ...currentState.pdfFiles };
  if (previousFileId) {
    delete nextPdfFiles[previousFileId];
  }

  const nextState: AppState = {
    ...currentState,
    pdfFiles: nextPdfFiles,
    [sectionKey]: buildBankStatementsState(
      {
        start: section.periodStart,
        end: section.periodEnd
      },
      updatedMonths,
      sectionKey
    )
  };

  await persistAppState(nextState);
  return nextState;
}

export async function clearMonthMissing(monthKey: string): Promise<AppState> {
  return clearMonthlySectionMissing("bankStatements", monthKey);
}

export async function clearMonthlySectionMissing(
  sectionKey: MonthlyDocumentSectionKey,
  monthKey: string
): Promise<AppState> {
  const currentState = await getAppState();
  const section = currentState[sectionKey];
  const targetMonth = section.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const updatedMonths = section.expectedMonths.map((item) => {
    if (item.monthKey !== monthKey) {
      return item;
    }

    return {
      ...item,
      status: "missing_unresolved" as const,
      missingReason: undefined
    };
  });

  const nextState: AppState = {
    ...currentState,
    [sectionKey]: buildBankStatementsState(
      {
        start: section.periodStart,
        end: section.periodEnd
      },
      updatedMonths,
      sectionKey
    )
  };

  await persistAppState(nextState);
  return nextState;
}

export async function removePdfForMonth(monthKey: string): Promise<AppState> {
  return removePdfForMonthlySection("bankStatements", monthKey);
}

export async function removePdfForMonthlySection(
  sectionKey: MonthlyDocumentSectionKey,
  monthKey: string
): Promise<AppState> {
  const currentState = await getAppState();
  const section = currentState[sectionKey];
  const targetMonth = section.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const updatedMonths = section.expectedMonths.map((item) => {
    if (item.monthKey !== monthKey) {
      return item;
    }

    return {
      ...item,
      status: "missing_unresolved" as const,
      fileId: undefined,
      fileName: undefined,
      pageCount: undefined,
      passwordProtected: undefined,
      missingReason: undefined
    };
  });

  const nextPdfFiles = { ...currentState.pdfFiles };
  if (targetMonth.fileId) {
    delete nextPdfFiles[targetMonth.fileId];
  }

  const nextState: AppState = {
    ...currentState,
    pdfFiles: nextPdfFiles,
    [sectionKey]: buildBankStatementsState(
      {
        start: section.periodStart,
        end: section.periodEnd
      },
      updatedMonths,
      sectionKey
    )
  };

  await persistAppState(nextState);
  return nextState;
}

export async function addSupplementalPdfFile(
  sectionKey: SupplementalDocumentSectionKey,
  file: StoredPdfFile
): Promise<AppState> {
  const currentState = await getAppState();
  const section = currentState[sectionKey];
  const normalizedFile = normalizeStoredPdfFile(file);
  const item: SupplementalDocumentItem = {
    id: crypto.randomUUID(),
    fileId: file.id,
    fileName: file.fileName,
    pageCount: file.pageCount,
    passwordProtected: file.passwordProtected,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt
  };

  const nextState: AppState = {
    ...currentState,
    [sectionKey]: {
      ...section,
      items: [...section.items, item]
    },
    pdfFiles: {
      ...currentState.pdfFiles,
      [file.id]: normalizedFile
    }
  };

  await persistAppState(nextState);
  return nextState;
}

export async function removeSupplementalPdfFile(
  sectionKey: SupplementalDocumentSectionKey,
  itemId: string
): Promise<AppState> {
  const currentState = await getAppState();
  const section = currentState[sectionKey];
  const item = section.items.find((entry) => entry.id === itemId);
  if (!item) {
    throw new Error("Le document sélectionné est introuvable.");
  }

  const nextItems = section.items.filter((entry) => entry.id !== itemId);
  const nextPdfFiles = { ...currentState.pdfFiles };
  delete nextPdfFiles[item.fileId];

  const nextState: AppState = {
    ...currentState,
    [sectionKey]: {
      ...section,
      items: nextItems
    },
    pdfFiles: nextPdfFiles
  };

  await persistAppState(nextState);
  return nextState;
}

export async function getPdfFile(fileId: string): Promise<StoredPdfFile | undefined> {
  const state = await getAppState();
  return state.pdfFiles[fileId];
}

export async function updatePdfAnnotations(
  fileId: string,
  annotations: StoredPdfAnnotation[]
): Promise<AppState> {
  const currentState = await getAppState();
  const file = currentState.pdfFiles[fileId];
  if (!file) {
    throw new Error("Le document est introuvable dans le stockage local.");
  }

  const now = new Date().toISOString();
  const normalized = normalizeStoredAnnotations(annotations).map((item) => ({
    ...item,
    transactionDate: item.transactionDate,
    annotation: (item.annotation ?? "").trim(),
    createdAt: item.createdAt || now,
    updatedAt: now
  }));

  const nextState: AppState = {
    ...currentState,
    pdfFiles: {
      ...currentState.pdfFiles,
      [fileId]: {
        ...file,
        annotations: normalized,
        updatedAt: now
      }
    }
  };

  await persistAppState(nextState);
  return nextState;
}

export async function updatePdfExtractionData(
  fileId: string,
  extractionResult: StoredPdfFile["extractionResult"],
  extractionDebug: StoredPdfFile["extractionDebug"]
): Promise<AppState> {
  const currentState = await getAppState();
  const file = currentState.pdfFiles[fileId];
  if (!file) {
    throw new Error("Le document est introuvable dans le stockage local.");
  }

  const nextState: AppState = {
    ...currentState,
    pdfFiles: {
      ...currentState.pdfFiles,
      [fileId]: {
        ...file,
        extractionResult,
        extractionDebug,
        updatedAt: new Date().toISOString()
      }
    }
  };

  await persistAppState(nextState);
  return nextState;
}

export async function updateUiSettings(settings: Partial<UiSettings>): Promise<AppState> {
  const currentState = await getAppState();
  const nextState: AppState = {
    ...currentState,
    ui: {
      ...currentState.ui,
      ...settings
    }
  };

  await persistAppState(nextState);
  return nextState;
}

export async function updateCompanyProfile(profile: Partial<CompanyProfile>): Promise<AppState> {
  const currentState = await getAppState();
  const nextState: AppState = {
    ...currentState,
    company: {
      ...currentState.company,
      ...profile
    }
  };

  await persistAppState(nextState);
  return nextState;
}

export async function updateCategorizationSettings(settings: {
  categories?: Category[];
  categorizationRules?: CategorizationRule[];
}): Promise<AppState> {
  const currentState = await getAppState();
  const nextState: AppState = {
    ...currentState,
    categories: normalizeCategories(settings.categories ?? currentState.categories),
    categorizationRules: settings.categorizationRules ?? currentState.categorizationRules
  };

  await persistAppState(nextState);
  return nextState;
}

export async function resetAppState(): Promise<AppState> {
  const defaultState = createDefaultAppState();
  await persistAppState(defaultState);
  return defaultState;
}

async function persistAppState(state: AppState): Promise<void> {
  await assertStorageCapacity(state);

  await chrome.storage.local.set({
    [STORAGE_KEY]: state
  });
}

async function assertStorageCapacity(state: AppState): Promise<void> {
  const quota = chrome.storage.local.QUOTA_BYTES;
  if (typeof quota !== "number") {
    return;
  }

  const usedBytes = await chrome.storage.local.getBytesInUse(null);
  const existingState = await chrome.storage.local.get(STORAGE_KEY);
  const previousStateBytes = existingState[STORAGE_KEY]
    ? estimateJsonBytes(existingState[STORAGE_KEY])
    : 0;
  const nextStateBytes = estimateJsonBytes(state);
  const projectedUsedBytes = usedBytes - previousStateBytes + nextStateBytes;

  if (projectedUsedBytes + STORAGE_SAFETY_MARGIN_BYTES > quota) {
    throw new Error(
      "Stockage local insuffisant pour importer ce document. Réduisez la période ou remplacez un document existant."
    );
  }
}

function pruneOrphanPdfFiles(
  sections: {
    monthlySections: BankStatementMonthItem[][];
    supplementalSections: SupplementalDocumentItem[][];
  },
  pdfFiles: Record<string, StoredPdfFile>
): Record<string, StoredPdfFile> {
  const keptFileIds = new Set(
    [
      ...sections.monthlySections.flatMap((months) => months.map((item) => item.fileId)),
      ...sections.supplementalSections.flatMap((items) => items.map((item) => item.fileId))
    ].filter((value): value is string => Boolean(value))
  );
  const nextPdfFiles: Record<string, StoredPdfFile> = {};

  for (const [fileId, file] of Object.entries(pdfFiles)) {
    if (keptFileIds.has(fileId)) {
      nextPdfFiles[fileId] = file;
    }
  }

  return nextPdfFiles;
}

function estimateJsonBytes(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

function normalizeStoredAnnotations(annotations: StoredPdfAnnotation[] | undefined): StoredPdfAnnotation[] {
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations.map((annotation) => ({
    ...annotation,
    transactionDate: annotation.transactionDate ?? "",
    annotation: annotation.annotation ?? ""
  }));
}

function normalizeSupplementalItems(items: SupplementalDocumentItem[] | undefined): SupplementalDocumentItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items;
}
