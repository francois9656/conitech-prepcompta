import { buildBankStatementsState } from "../domain/bank-statements";
import type {
  AppState,
  BankStatementMonthItem,
  CompanyProfile,
  Period,
  StoredPdfFile,
  UiSettings
} from "../domain/models";
import { createDefaultAppState } from "./defaults";

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
    bankStatements: buildBankStatementsState(
      {
        start: state.bankStatements?.periodStart ?? createDefaultAppState().bankStatements.periodStart,
        end: state.bankStatements?.periodEnd ?? createDefaultAppState().bankStatements.periodEnd
      },
      state.bankStatements?.expectedMonths ?? []
    )
  };
}

export async function updatePeriod(period: Period): Promise<AppState> {
  const currentState = await getAppState();
  const nextBankStatements = buildBankStatementsState(period, currentState.bankStatements.expectedMonths);
  const nextState: AppState = {
    ...currentState,
    bankStatements: nextBankStatements,
    pdfFiles: pruneOrphanPdfFiles(nextBankStatements.expectedMonths, currentState.pdfFiles)
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
  const currentState = await getAppState();
  const targetMonth = currentState.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const previousFileId = targetMonth.fileId;

  const updatedMonths = currentState.bankStatements.expectedMonths.map((item) => {
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
  nextPdfFiles[file.id] = file;

  if (previousFileId && previousFileId !== file.id) {
    delete nextPdfFiles[previousFileId];
  }

  const nextState: AppState = {
    ...currentState,
    pdfFiles: nextPdfFiles,
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

export async function markMonthMissing(monthKey: string, reason: string): Promise<AppState> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error("La raison est obligatoire pour marquer un document manquant.");
  }

  const currentState = await getAppState();
  const targetMonth = currentState.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const previousFileId = targetMonth.fileId;
  const updatedMonths = currentState.bankStatements.expectedMonths.map((item) => {
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

export async function clearMonthMissing(monthKey: string): Promise<AppState> {
  const currentState = await getAppState();
  const targetMonth = currentState.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const updatedMonths = currentState.bankStatements.expectedMonths.map((item) => {
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

export async function removePdfForMonth(monthKey: string): Promise<AppState> {
  const currentState = await getAppState();
  const targetMonth = currentState.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!targetMonth) {
    throw new Error("Le mois sélectionné est introuvable dans la période active.");
  }

  const updatedMonths = currentState.bankStatements.expectedMonths.map((item) => {
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

export async function getPdfFile(fileId: string): Promise<StoredPdfFile | undefined> {
  const state = await getAppState();
  return state.pdfFiles[fileId];
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
  months: BankStatementMonthItem[],
  pdfFiles: Record<string, StoredPdfFile>
): Record<string, StoredPdfFile> {
  const keptFileIds = new Set(months.map((item) => item.fileId).filter((value): value is string => Boolean(value)));
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
