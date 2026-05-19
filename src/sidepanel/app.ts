import "../styles/base.css";

import { renderMonthStatusCard } from "../components/month-status-card";
import type { StatementExtractionResult } from "../core/types/extraction";
import type {
  AppState,
  BankStatementMonthItem,
  CategorizationRule,
  Category,
  DocumentSectionKey,
  ExtractionDebugInfo,
  MonthlyDocumentSectionKey,
  SupplementalDocumentItem,
  SupplementalDocumentSectionKey,
  StoredPdfFile,
  ThemeMode
} from "../domain/models";
import { analyzeLayout } from "../modules/layout-analysis/layout-analyzer";
import { TesseractOcrEngine } from "../modules/ocr/tesseract-ocr-engine";
import { extractTextTokensFromPdf } from "../modules/pdf-inspection/pdf-text-extractor";
import { runExtractionPipeline } from "../pipeline/extractionPipeline";
import { buildMergedBankStatementsPreview, generateMergedBankStatementsPdf } from "../pdf/pdf-merge-service";
import { extractPdfData } from "../pdf/pdf-service";
import { renderProgressSummary } from "../components/progress-summary";
import { applyTheme } from "../services/theme-service";
import {
  addSupplementalPdfFile,
  clearMonthMissing,
  clearMonthlySectionMissing,
  getAppState,
  markMonthMissing,
  markMonthlySectionMissing,
  removePdfForMonthlySection,
  removePdfForMonth,
  removeSupplementalPdfFile,
  resetAppState,
  savePdfForMonth,
  savePdfForMonthlySection,
  updateCategorizationSettings,
  updateCompanyProfile,
  updatePeriod,
  updateUiSettings
} from "../storage/app-storage";

type SidePanelTab = "documents" | "configuration";
type CategoryFilter = "active" | "hidden" | "all";
type CategoryEditorState =
  | { mode: "add"; label: string; color: string }
  | { mode: "edit"; categoryId: string; label: string; color: string }
  | null;
type RuleEditorState =
  | { mode: "add"; pattern: string; categoryId: string; note: string }
  | { mode: "edit"; ruleId: string; pattern: string; categoryId: string; note: string }
  | null;

export async function initSidePanelApp(container: HTMLElement): Promise<void> {
  const currentView = new URLSearchParams(window.location.search).get("view");
  const isStandaloneConfigurationPage = currentView === "configuration";
  let state = await getAppState();
  let pendingUploadTarget:
    | { sectionKey: MonthlyDocumentSectionKey; monthKey: string }
    | { sectionKey: SupplementalDocumentSectionKey }
    | null = null;
  let processingSectionKey: DocumentSectionKey | null = null;
  let processingMonthKey: string | null = null;
  let processingFileName: string | null = null;
  let isGeneratingMergedPdf = false;
  let includeMissingJustifiedComments = true;
  let inlineViewerMonthKey: string | null = null;
  let mergedPdfDebug: { success?: { fileName: string; size: number }; error?: string } | null = null;
  let activeTab: SidePanelTab = isStandaloneConfigurationPage ? "configuration" : "documents";
  let activeCategoryFilter: CategoryFilter = "active";
  let categorySearchQuery = "";
  let ruleSearchQuery = "";
  let collapsedMonthlySections: Record<MonthlyDocumentSectionKey, boolean> = {
    bankStatements: false,
    creditCardStatements: false
  };
  let categoryEditor: CategoryEditorState = null;
  let ruleEditor: RuleEditorState = null;

  const rerender = () => {
    render(
      container,
      state,
      processingSectionKey,
      processingMonthKey,
      processingFileName,
      isGeneratingMergedPdf,
      includeMissingJustifiedComments,
      inlineViewerMonthKey,
      mergedPdfDebug,
      activeTab,
      isStandaloneConfigurationPage,
      activeCategoryFilter,
      categorySearchQuery,
      ruleSearchQuery,
      collapsedMonthlySections,
      categoryEditor,
      ruleEditor
    );
  };

  applyTheme(state.ui.themeMode);
  rerender();


  // Crée les inputs une seule fois et les réutilise
  let fileInput = document.getElementById("pdf-upload-input") as HTMLInputElement | null;
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/pdf";
    fileInput.style.display = "none";
    fileInput.setAttribute("aria-hidden", "true");
    fileInput.id = "pdf-upload-input";
    document.body.appendChild(fileInput);
  }

  let logoInput = document.getElementById("logo-upload-input") as HTMLInputElement | null;
  if (!logoInput) {
    logoInput = document.createElement("input");
    logoInput.type = "file";
    logoInput.accept = "image/png,image/jpeg,image/jpg";
    logoInput.style.display = "none";
    logoInput.setAttribute("aria-hidden", "true");
    logoInput.id = "logo-upload-input";
    document.body.appendChild(logoInput);
  }

  // Pour éviter d'empiler les listeners, on les retire avant de les remettre
  fileInput.replaceWith(fileInput.cloneNode(true));
  fileInput = document.getElementById("pdf-upload-input") as HTMLInputElement;
  fileInput.addEventListener("change", async () => {
    const selectedFile = fileInput.files?.[0];
    if (!selectedFile || !pendingUploadTarget) {
      fileInput.value = "";
      return;
    }

    try {
      processingSectionKey = pendingUploadTarget.sectionKey;
      processingMonthKey = "monthKey" in pendingUploadTarget ? pendingUploadTarget.monthKey : null;
      processingFileName = selectedFile.name;
      rerender();

      state = await savePdfFromFile(pendingUploadTarget, selectedFile);
      processingSectionKey = null;
      processingMonthKey = null;
      processingFileName = null;
      rerender();
    } catch (error) {
      processingSectionKey = null;
      processingMonthKey = null;
      processingFileName = null;
      rerender();
          // Suppression de l'alerte pour laisser la section debug afficher l'erreur
    } finally {
      fileInput.value = "";
      pendingUploadTarget = null;
    }
  });

  logoInput.replaceWith(logoInput.cloneNode(true));
  logoInput = document.getElementById("logo-upload-input") as HTMLInputElement;
  logoInput.addEventListener("change", async () => {
    const selectedLogoFile = logoInput.files?.[0];
    if (!selectedLogoFile) {
      logoInput.value = "";
      return;
    }

    try {
      const logoDataUrl = await convertImageToDataUrl(selectedLogoFile);
      state = await updateCompanyProfile({
        logoDataUrl,
        logoUpdatedAt: new Date().toISOString()
      });
      rerender();
    } catch (error) {
      alert(getErrorMessage(error));
    } finally {
      logoInput.value = "";
    }
  });

  container.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
      return;
    }

    try {
      if (target.name === "themeMode") {
        state = await updateUiSettings({ themeMode: target.value as ThemeMode });
        applyTheme(state.ui.themeMode);
        rerender();
        return;
      }

      if (target.name === "periodStart" || target.name === "periodEnd") {
        state = await updatePeriod({
          start:
            target.name === "periodStart"
              ? target.value
              : state.bankStatements.periodStart,
          end:
            target.name === "periodEnd"
              ? target.value
              : state.bankStatements.periodEnd
        });
        rerender();
        return;
      }

      if (target.name === "companyName") {
        state = await updateCompanyProfile({ name: target.value.trim() });
        rerender();
        return;
      }

      if (target.name === "includeMissingJustifiedComments" && target instanceof HTMLInputElement) {
        includeMissingJustifiedComments = target.checked;
        rerender();
      }
    } catch (error) {
      rerender();
      alert(getErrorMessage(error));
    }
  });

  container.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    event.preventDefault();

    try {
      if (form.dataset.form === "category-editor") {
        const formData = new FormData(form);
        const label = String(formData.get("label") ?? "").trim();
        const color = normalizeColorInput(String(formData.get("color") ?? "#2f80ed"));
        if (!label) {
          alert("Le nom de la catégorie est obligatoire.");
          return;
        }

        const currentCategoryEditor = categoryEditor;
        if (currentCategoryEditor?.mode === "edit") {
          state = await updateCategorizationSettings({
            categories: state.categories.map((item) =>
              item.id === currentCategoryEditor.categoryId ? { ...item, label, color } : item
            )
          });
        } else {
          const id = createSlugId(label, "category");
          state = await updateCategorizationSettings({
            categories: [...state.categories, { id, label, color, hidden: false, builtIn: false }]
          });
        }

        categoryEditor = null;
        rerender();
        return;
      }

      if (form.dataset.form === "rule-editor") {
        const formData = new FormData(form);
        const pattern = String(formData.get("pattern") ?? "").trim();
        const categoryInput = String(formData.get("categoryId") ?? "").trim();
        const categoryId = categoryInput ? resolveCategoryIdFromInput(categoryInput, state.categories) : undefined;
        const note = String(formData.get("note") ?? "").trim() || undefined;
        if (!pattern) {
          alert("Le mot-clé est obligatoire.");
          return;
        }
        if (categoryInput && !categoryId) {
          alert("Choisissez une catégorie dans la liste.");
          return;
        }
        if (!categoryId && !note) {
          alert("La règle doit définir au moins une catégorie ou une note.");
          return;
        }

        const currentRuleEditor = ruleEditor;
        if (currentRuleEditor?.mode === "edit") {
          state = await updateCategorizationSettings({
            categorizationRules: state.categorizationRules.map((item) =>
              item.id === currentRuleEditor.ruleId ? { ...item, pattern, categoryId, note } : item
            )
          });
        } else {
          state = await updateCategorizationSettings({
            categorizationRules: [
              ...state.categorizationRules,
              { id: `rule_${crypto.randomUUID()}`, pattern, categoryId, note }
            ]
          });
        }

        ruleEditor = null;
        rerender();
      }
    } catch (error) {
      rerender();
      alert(getErrorMessage(error));
    }
  });

  container.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.settingsFilter === "categories") {
      categorySearchQuery = target.value;
      rerender();
      focusSettingsFilter(container, "categories", categorySearchQuery.length);
      return;
    }

    if (target.dataset.settingsFilter === "rules") {
      ruleSearchQuery = target.value;
      rerender();
      focusSettingsFilter(container, "rules", ruleSearchQuery.length);
    }
  });

  container.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const tabButton = target.closest<HTMLButtonElement>("button[data-tab]");
    if (tabButton) {
      const nextTab: SidePanelTab = tabButton.dataset.tab === "configuration" ? "configuration" : "documents";
      if (nextTab === "configuration" && !isStandaloneConfigurationPage) {
        const configurationUrl = chrome.runtime.getURL("sidepanel.html?view=configuration");
        await chrome.tabs.create({ url: configurationUrl });
        return;
      }

      if (nextTab === "documents" && isStandaloneConfigurationPage) {
        window.location.href = chrome.runtime.getURL("sidepanel.html");
        return;
      }

      activeTab = nextTab;
      rerender();
      return;
    }

    const globalActionButton = target.closest<HTMLButtonElement>("button[data-global-action]");
    if (globalActionButton) {
      const globalAction = globalActionButton.dataset.globalAction;

      try {
        if (globalAction === "upload-company-logo") {
          logoInput.click();
          return;
        }

        if (globalAction === "remove-company-logo") {
          state = await updateCompanyProfile({
            logoDataUrl: undefined,
            logoUpdatedAt: new Date().toISOString()
          });
          rerender();
          return;
        }

        if (globalAction === "reset-all-fields") {
          const confirmed = confirm(
            "Reinitialiser tous les champs, documents importes, annotations et la periode ?"
          );
          if (!confirmed) {
            return;
          }

          state = await resetAppState();
          processingMonthKey = null;
          processingFileName = null;
          isGeneratingMergedPdf = false;
          includeMissingJustifiedComments = true;
          inlineViewerMonthKey = null;
          activeTab = isStandaloneConfigurationPage ? "configuration" : "documents";
          fileInput.value = "";
          logoInput.value = "";
          applyTheme(state.ui.themeMode);
          rerender();
          return;
        }

        if (globalAction === "generate-merged-pdf") {
          isGeneratingMergedPdf = true;
          rerender();
          try {
            const merged = await generateMergedBankStatementsPdf(state, {
              includeJustifiedMissingComments: includeMissingJustifiedComments
            });
            downloadBytesAsPdf(merged.bytes, merged.fileName);
            mergedPdfDebug = { success: { fileName: merged.fileName, size: merged.bytes.length } };
          } catch (err) {
            mergedPdfDebug = { error: getErrorMessage(err) };
          }
          isGeneratingMergedPdf = false;
          rerender();
          return;
        }
      } catch (error) {
        isGeneratingMergedPdf = false;
        rerender();
        alert(getErrorMessage(error));
      }

      return;
    }

    const categoryActionButton = target.closest<HTMLButtonElement>("button[data-category-action]");
    if (categoryActionButton) {
      const action = categoryActionButton.dataset.categoryAction;
      const categoryId = categoryActionButton.dataset.categoryId;

      try {
        if (action === "add-category") {
          categoryEditor = { mode: "add", label: "", color: "#2f80ed" };
          ruleEditor = null;
          rerender();
          return;
        }

        if (action === "edit-category" && categoryId) {
          const category = state.categories.find((item) => item.id === categoryId);
          if (!category) {
            return;
          }
          categoryEditor = {
            mode: "edit",
            categoryId,
            label: category.label,
            color: normalizeColorInput(category.color ?? "#2f80ed")
          };
          ruleEditor = null;
          rerender();
          return;
        }

        if (action === "cancel-category-editor") {
          categoryEditor = null;
          rerender();
          return;
        }

        if (action === "delete-category" && categoryId) {
          const confirmed = confirm("Supprimer cette catégorie et ses règles associées ?");
          if (!confirmed) {
            return;
          }
          const category = state.categories.find((item) => item.id === categoryId);
          if (category?.builtIn) {
            alert("Les catégories de base ne peuvent pas être supprimées.");
            return;
          }
          state = await updateCategorizationSettings({
            categories: state.categories.filter((item) => item.id !== categoryId),
            categorizationRules: state.categorizationRules.filter((rule) => rule.categoryId !== categoryId)
          });
          rerender();
          return;
        }

        if (action === "toggle-category-hidden" && categoryId) {
          state = await updateCategorizationSettings({
            categories: state.categories.map((item) =>
              item.id === categoryId ? { ...item, hidden: !item.hidden } : item
            )
          });
          rerender();
          return;
        }
      } catch (error) {
        rerender();
        alert(getErrorMessage(error));
      }

      return;
    }

    const categoryFilterButton = target.closest<HTMLButtonElement>("button[data-category-filter]");
    if (categoryFilterButton) {
      const nextFilter = categoryFilterButton.dataset.categoryFilter;
      if (nextFilter === "active" || nextFilter === "hidden" || nextFilter === "all") {
        activeCategoryFilter = nextFilter;
        rerender();
      }
      return;
    }

    const monthlySectionToggle = target.closest<HTMLElement>("[data-toggle-monthly-section]");
    if (monthlySectionToggle) {
      event.preventDefault();
      const sectionKey = monthlySectionToggle.dataset.toggleMonthlySection;
      if (sectionKey === "bankStatements" || sectionKey === "creditCardStatements") {
        collapsedMonthlySections = {
          ...collapsedMonthlySections,
          [sectionKey]: !collapsedMonthlySections[sectionKey]
        };
        rerender();
      }
      return;
    }

    const ruleActionButton = target.closest<HTMLButtonElement>("button[data-rule-action]");
    if (ruleActionButton) {
      const action = ruleActionButton.dataset.ruleAction;
      const ruleId = ruleActionButton.dataset.ruleId;

      try {
        if (action === "add-rule") {
          const firstVisibleCategory = state.categories.find((category) => !category.hidden);
          ruleEditor = { mode: "add", pattern: "", categoryId: firstVisibleCategory?.id ?? "", note: "" };
          categoryEditor = null;
          rerender();
          return;
        }

        if (action === "edit-rule" && ruleId) {
          const rule = state.categorizationRules.find((item) => item.id === ruleId);
          if (!rule) {
            return;
          }
          ruleEditor = {
            mode: "edit",
            ruleId,
            pattern: rule.pattern,
            categoryId: rule.categoryId ?? "",
            note: rule.note ?? ""
          };
          categoryEditor = null;
          rerender();
          return;
        }

        if (action === "cancel-rule-editor") {
          ruleEditor = null;
          rerender();
          return;
        }

        if (action === "delete-rule" && ruleId) {
          const confirmed = confirm("Supprimer cette règle ?");
          if (!confirmed) {
            return;
          }
          state = await updateCategorizationSettings({
            categorizationRules: state.categorizationRules.filter((item) => item.id !== ruleId)
          });
          rerender();
          return;
        }
      } catch (error) {
        rerender();
        alert(getErrorMessage(error));
      }

      return;
    }

    const supplementalButton = target.closest<HTMLButtonElement>("button[data-action][data-item-id]");
    if (supplementalButton) {
      const action = supplementalButton.dataset.action;
      const sectionKey = supplementalButton.dataset.sectionKey as SupplementalDocumentSectionKey | undefined;
      const itemId = supplementalButton.dataset.itemId;

      if (!action || !sectionKey || !itemId) {
        return;
      }

      try {
        if (action === "delete-pdf") {
          state = await removeSupplementalPdfFile(sectionKey, itemId);
          rerender();
          return;
        }

        if (action === "view") {
          const fileId = supplementalButton.dataset.fileId;
          if (!fileId) {
            return;
          }
          const viewerUrl = chrome.runtime.getURL(`viewer.html?fileId=${encodeURIComponent(fileId)}`);
          await chrome.tabs.create({ url: viewerUrl });
          return;
        }
      } catch (error) {
        rerender();
        alert(getErrorMessage(error));
      }

      return;
    }

    const addSupplementalButton = target.closest<HTMLButtonElement>("button[data-action='add-supplemental-pdf'][data-section-key]");
    if (addSupplementalButton) {
      const sectionKey = addSupplementalButton.dataset.sectionKey as SupplementalDocumentSectionKey | undefined;
      if (!sectionKey) {
        return;
      }
      pendingUploadTarget = { sectionKey };
      fileInput.click();
      return;
    }

    const button = target.closest<HTMLButtonElement>("button[data-action][data-month-key]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const monthKey = button.dataset.monthKey;
    const sectionKey = (button.dataset.sectionKey as MonthlyDocumentSectionKey | undefined) ?? "bankStatements";
    if (!action || !monthKey) {
      return;
    }

    try {
      if (action === "add-pdf") {
        pendingUploadTarget = { sectionKey, monthKey };
        fileInput.click();
        return;
      }

      if (action === "delete-pdf") {
        state = await removePdfForMonthlySection(sectionKey, monthKey);
        if (inlineViewerMonthKey === monthKey) {
          inlineViewerMonthKey = null;
        }
        rerender();
        return;
      }

      if (action === "mark-missing" || action === "edit-missing") {
        const existingReason =
          state[sectionKey].expectedMonths.find((item) => item.monthKey === monthKey)?.missingReason ?? "";
        const reason = prompt("Indiquez la raison du document manquant :", existingReason)?.trim() ?? "";

        if (!reason) {
          alert("La raison est obligatoire pour marquer le document comme manquant.");
          return;
        }

        state = await markMonthlySectionMissing(sectionKey, monthKey, reason);
        if (inlineViewerMonthKey === monthKey) {
          inlineViewerMonthKey = null;
        }
        rerender();
        return;
      }

      if (action === "clear-missing") {
        state = await clearMonthlySectionMissing(sectionKey, monthKey);
        if (inlineViewerMonthKey === monthKey) {
          inlineViewerMonthKey = null;
        }
        rerender();
        return;
      }

      if (action === "view") {
        const fileId = button.closest<HTMLElement>(".month-card")?.dataset.fileId;
        const viewerUrl = fileId
          ? chrome.runtime.getURL(`viewer.html?fileId=${encodeURIComponent(fileId)}`)
          : chrome.runtime.getURL(`viewer.html?monthKey=${encodeURIComponent(monthKey)}`);
        await chrome.tabs.create({ url: viewerUrl });
        return;
      }

      if (action === "refresh-extraction") {
        processingSectionKey = sectionKey;
        processingMonthKey = monthKey;
        processingFileName = "actualisation des donnees extraites";
        rerender();

        state = await refreshExtractionForMonth(state, sectionKey, monthKey);
        processingSectionKey = null;
        processingMonthKey = null;
        processingFileName = null;
        rerender();
        return;
      }
    } catch (error) {
      processingSectionKey = null;
      processingMonthKey = null;
      processingFileName = null;
      rerender();
      alert(getErrorMessage(error));
    }
  });

  container.addEventListener("dragover", (event) => {
    const monthCard = getMonthCardFromEvent(event);
    if (monthCard) {
      if (monthCard.dataset.status === "provided") {
        return;
      }

      event.preventDefault();
      monthCard.classList.add("is-drop-target");
      return;
    }

    const supplementalCard = getSupplementalDropTargetFromEvent(event);
    if (!supplementalCard) {
      return;
    }

    event.preventDefault();
    supplementalCard.classList.add("is-drop-target");
  });

  container.addEventListener("dragleave", (event) => {
    const monthCard = getMonthCardFromEvent(event);
    monthCard?.classList.remove("is-drop-target");
    const supplementalCard = getSupplementalDropTargetFromEvent(event);
    supplementalCard?.classList.remove("is-drop-target");
  });

  container.addEventListener("drop", async (event) => {
    const monthCard = getMonthCardFromEvent(event);
    const supplementalCard = getSupplementalDropTargetFromEvent(event);
    if (!monthCard && !supplementalCard) {
      return;
    }

    const droppedFile = event.dataTransfer?.files?.[0];
    if (!droppedFile) {
      return;
    }

    if (monthCard) {
      event.preventDefault();
      monthCard.classList.remove("is-drop-target");

      const monthKey = monthCard.dataset.monthKey;
      const sectionKey = monthCard.dataset.sectionKey as MonthlyDocumentSectionKey | undefined;

      if (!monthKey || !sectionKey) {
        return;
      }

      if (monthCard.dataset.status === "provided") {
        alert("Supprimez d'abord le document actuel avant d'en ajouter un nouveau.");
        return;
      }

      if (!isAcceptedPdfInput(droppedFile)) {
        alert("Seuls les fichiers PDF sont acceptés.");
        return;
      }

      try {
        processingSectionKey = sectionKey;
        processingMonthKey = monthKey;
        processingFileName = droppedFile.name;
        rerender();

        state = await savePdfFromFile({ sectionKey, monthKey }, droppedFile);
        processingSectionKey = null;
        processingMonthKey = null;
        processingFileName = null;
        rerender();
      } catch (error) {
        processingSectionKey = null;
        processingMonthKey = null;
        processingFileName = null;
        rerender();
        alert(getErrorMessage(error));
      }
      return;
    }

    if (supplementalCard) {
      event.preventDefault();
      supplementalCard.classList.remove("is-drop-target");

      const sectionKey = supplementalCard.dataset.supplementalSectionKey as SupplementalDocumentSectionKey | undefined;
      if (!sectionKey) {
        return;
      }

      if (!isAcceptedPdfInput(droppedFile)) {
        alert("Seuls les fichiers PDF sont acceptés.");
        return;
      }

      try {
        processingSectionKey = sectionKey;
        processingMonthKey = null;
        processingFileName = droppedFile.name;
        rerender();

        state = await savePdfFromFile({ sectionKey }, droppedFile);
        processingSectionKey = null;
        processingMonthKey = null;
        processingFileName = null;
        rerender();
      } catch (error) {
        processingSectionKey = null;
        processingMonthKey = null;
        processingFileName = null;
        rerender();
        alert(getErrorMessage(error));
      }
    }
  });
}

function render(
  container: HTMLElement,
  state: AppState,
  processingSectionKey: DocumentSectionKey | null,
  processingMonthKey: string | null,
  processingFileName: string | null,
  isGeneratingMergedPdf: boolean,
  includeMissingJustifiedComments: boolean,
  inlineViewerMonthKey: string | null,
  mergedPdfDebug?: { success?: { fileName: string; size: number }; error?: string } | null,
  activeTab: SidePanelTab = "documents",
  isStandaloneConfigurationPage = false,
  activeCategoryFilter: CategoryFilter = "active",
  categorySearchQuery = "",
  ruleSearchQuery = "",
  collapsedMonthlySections: Record<MonthlyDocumentSectionKey, boolean> = {
    bankStatements: false,
    creditCardStatements: false
  },
  categoryEditor: CategoryEditorState = null,
  ruleEditor: RuleEditorState = null
): void {
  const preview = buildMergedBankStatementsPreview(state, {
    includeJustifiedMissingComments: includeMissingJustifiedComments
  });
  const providedDocumentsCount = preview.sectionSummaries.reduce((total, section) => total + section.documentCount, 0);

  container.innerHTML = `
    <main class="${isStandaloneConfigurationPage ? "viewer-shell configuration-page-shell" : "sidepanel-shell"}">
      <div class="${isStandaloneConfigurationPage ? "configuration-page-layout" : "sidepanel-layout"}">
        <section class="${isStandaloneConfigurationPage ? "viewer-toolbar configuration-page-toolbar" : "app-header"}">
          <div class="panel-header-row">
            <div>
              <p class="eyebrow">Conitech PrepCompta</p>
              <h1>${isStandaloneConfigurationPage ? "Configuration" : "Préparation comptable"}</h1>
            </div>
            <div class="tab-list" role="tablist" aria-label="Navigation principale">
              <button class="tab-button ${activeTab === "documents" ? "is-active" : ""}" type="button" data-tab="documents" role="tab" aria-selected="${activeTab === "documents"}">
                Relevés
              </button>
              <button class="tab-button ${activeTab === "configuration" ? "is-active" : ""}" type="button" data-tab="configuration" role="tab" aria-selected="${activeTab === "configuration"}">
                Configuration
              </button>
            </div>
          </div>
          <p class="helper-text">${
            isStandaloneConfigurationPage
              ? "Paramétrage de l'entreprise, des catégories et du PDF final."
              : "Centralisation des relevés, génération du PDF final et paramétrage des catégories."
          }</p>
          ${
            processingSectionKey && processingFileName
              ? `<div class="upload-banner" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Import en cours pour ${escapeHtml(getSectionLabel(processingSectionKey))}${processingMonthKey ? ` - ${escapeHtml(processingMonthKey)}` : ""}: ${escapeHtml(processingFileName)}</span></div>`
              : ""
          }
          ${
            isGeneratingMergedPdf
              ? `<div class="upload-banner" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Generation du PDF fusionne en cours...</span></div>`
              : ""
          }
        </section>

        ${
          activeTab === "configuration"
            ? renderConfigurationTab(
                state,
                includeMissingJustifiedComments,
                preview,
                providedDocumentsCount,
                isGeneratingMergedPdf,
                mergedPdfDebug,
                activeCategoryFilter,
                categorySearchQuery,
                ruleSearchQuery
              )
                .replace(
                  "__CATEGORY_EDITOR__",
                  renderCategoryEditor(categoryEditor)
                )
                .replace(
                  "__RULE_EDITOR__",
                  renderRuleEditor(ruleEditor, state.categories)
                )
            : renderDocumentsTab(
                state,
                inlineViewerMonthKey,
                processingSectionKey,
                processingMonthKey,
                processingFileName,
                collapsedMonthlySections,
                preview,
                providedDocumentsCount,
                isGeneratingMergedPdf
              )
        }
      </div>
    </main>
  `;

  if (processingMonthKey && processingSectionKey) {
    const processingCard = container.querySelector<HTMLElement>(`.month-card[data-section-key="${processingSectionKey}"][data-month-key="${processingMonthKey}"]`);
    processingCard?.classList.add("is-processing");
  }
}

function renderDocumentsTab(
  state: AppState,
  inlineViewerMonthKey: string | null,
  processingSectionKey: DocumentSectionKey | null,
  processingMonthKey: string | null,
  processingFileName: string | null,
  collapsedMonthlySections: Record<MonthlyDocumentSectionKey, boolean>,
  preview: ReturnType<typeof buildMergedBankStatementsPreview>,
  providedDocumentsCount: number,
  isGeneratingMergedPdf: boolean
): string {
  const transactionStats = buildTransactionStats(state);
  return `
    ${renderProgressSummary(buildMonthlyProgressSummary(state, "bankStatements"), "Relevés bancaires")}
    ${renderProgressSummary(buildMonthlyProgressSummary(state, "creditCardStatements"), "Relevés de carte de crédit")}
    ${renderTransactionStats(transactionStats)}

    <section class="panel-card">
      ${renderMergePreview(preview)}
      <div class="actions-row merge-actions">
        <button
          class="primary-button"
          type="button"
          data-global-action="generate-merged-pdf"
          ${providedDocumentsCount === 0 || isGeneratingMergedPdf ? "disabled" : ""}
        >
          Générer PDF fusionné
        </button>
        <p class="helper-text">Le fichier inclut les pages d'introduction, les commentaires optionnels, puis chaque section de documents dans son propre bloc.</p>
      </div>
    </section>

    <section class="panel-card">
      <div class="panel-header-row">
        <div>
          <p class="eyebrow">Période</p>
          <h2>Mois attendus</h2>
        </div>
      </div>
      <form class="period-grid">
        <div class="field">
          <label for="periodStart">Date de début</label>
          <input id="periodStart" type="date" name="periodStart" value="${state.bankStatements.periodStart}" />
        </div>
        <div class="field">
          <label for="periodEnd">Date de fin</label>
          <input id="periodEnd" type="date" name="periodEnd" value="${state.bankStatements.periodEnd}" />
        </div>
      </form>
      <p class="helper-text">La liste s'ajuste automatiquement à la période sélectionnée, avec un relevé bancaire et un relevé de carte de crédit par mois, jusqu'à 12 mois.</p>
    </section>

    <section class="section-list">
      ${renderMonthlySection(
        "Relevés bancaires",
        state,
        "bankStatements",
        inlineViewerMonthKey,
        processingSectionKey,
        processingMonthKey,
        processingFileName,
        collapsedMonthlySections.bankStatements
      )}
      ${renderMonthlySection(
        "Relevés de carte de crédit",
        state,
        "creditCardStatements",
        inlineViewerMonthKey,
        processingSectionKey,
        processingMonthKey,
        processingFileName,
        collapsedMonthlySections.creditCardStatements
      )}
      ${renderSupplementalSection("Factures", "invoices", state, processingSectionKey, processingFileName)}
      ${renderSupplementalSection("Communication et autre", "otherCommunications", state, processingSectionKey, processingFileName)}
    </section>
  `;
}

function renderMonthlySection(
  title: string,
  state: AppState,
  sectionKey: MonthlyDocumentSectionKey,
  inlineViewerMonthKey: string | null,
  processingSectionKey: DocumentSectionKey | null,
  processingMonthKey: string | null,
  processingFileName: string | null,
  isCollapsed: boolean
): string {
  return `
    <details class="document-section-group document-section-collapsible" ${isCollapsed ? "" : "open"}>
      <summary
        class="document-section-summary"
          data-toggle-monthly-section="${sectionKey}"
        aria-expanded="${isCollapsed ? "false" : "true"}"
      >
        <span>
          <span class="eyebrow">Documents mensuels</span>
          <span class="document-section-title">${title}</span>
        </span>
      </summary>
      <div class="section-list">
        ${state[sectionKey].expectedMonths
          .map((item) => {
            const isInlineViewerOpen = inlineViewerMonthKey === item.monthKey && Boolean(item.fileId);
            const inlineViewerUrl = isInlineViewerOpen && item.fileId
              ? chrome.runtime.getURL(`viewer.html?fileId=${encodeURIComponent(item.fileId)}`)
              : undefined;
            const file = item.fileId ? state.pdfFiles[item.fileId] : undefined;

            return renderMonthStatusCard(item, {
              sectionKey,
              isInlineViewerOpen,
              inlineViewerUrl,
              categorizationSummary: file ? buildCategorizationSummary(file, state) : undefined,
              isBusy:
                processingSectionKey === sectionKey &&
                processingMonthKey === item.monthKey &&
                processingFileName !== null,
              busyLabel:
                processingSectionKey === sectionKey &&
                processingMonthKey === item.monthKey &&
                processingFileName !== null
                  ? processingFileName === "actualisation des donnees extraites"
                    ? "Actualisation en cours"
                    : "Ajout en cours"
                  : undefined,
              isRefreshingExtraction:
                processingSectionKey === sectionKey &&
                processingMonthKey === item.monthKey &&
                processingFileName !== null
            });
          })
          .join("")}
      </div>
    </details>
  `;
}

function buildCategorizationSummary(file: StoredPdfFile, state: AppState): string | undefined {
  const transactions = file.extractionResult?.transactions ?? [];
  if (transactions.length === 0) {
    return undefined;
  }

  const categorizedCount = countCategorizedTransactions(file, state);
  if (categorizedCount === 0) {
    return undefined;
  }

  return categorizedCount === 1
    ? "1 transaction catégorisée"
    : `${categorizedCount} transactions catégorisées`;
}

function buildMonthlyProgressSummary(
  state: AppState,
  sectionKey: MonthlyDocumentSectionKey
): { expectedMonths: BankStatementMonthItem[]; completedCount: number; unresolvedCount: number } {
  const expectedMonths = state[sectionKey].expectedMonths;
  const completedCount = expectedMonths.filter((item) => isMonthlyDocumentComplete(item, state)).length;
  const unresolvedCount = expectedMonths.length - completedCount;

  return {
    expectedMonths,
    completedCount,
    unresolvedCount
  };
}

function isMonthlyDocumentComplete(item: BankStatementMonthItem, state: AppState): boolean {
  if (item.status === "missing_justified") {
    return true;
  }

  if (!item.fileId) {
    return false;
  }

  const file = state.pdfFiles[item.fileId];
  if (!file) {
    return false;
  }

  const transactions = file.extractionResult?.transactions ?? [];
  if (transactions.length === 0) {
    return true;
  }

  return countCategorizedTransactions(file, state) > 0 || countDocumentNotes(file) > 0;
}

function countCategorizedTransactions(file: StoredPdfFile, state: AppState): number {
  const transactions = file.extractionResult?.transactions ?? [];
  return transactions.filter((transaction) => hasMatchingVisibleCategory(transaction, state)).length;
}

function countDocumentNotes(file: StoredPdfFile): number {
  return file.annotations.filter((annotation) => Boolean(annotation.annotation?.trim())).length;
}

function hasMatchingVisibleCategory(
  transaction: { description?: string | null; debit?: number | null; credit?: number | null },
  state: AppState
): boolean {
  const searchableText = [
    transaction.description ?? "",
    stringifyAmountForMatching(transaction.debit),
    stringifyAmountForMatching(transaction.credit)
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (!searchableText) {
    return false;
  }

  return state.categorizationRules.some((rule) => {
    if (!rule.pattern?.trim()) {
      return false;
    }

    if (!rule.categoryId) {
      return false;
    }

    const category = state.categories.find((item) => item.id === rule.categoryId);
    if (!category || category.hidden) {
      return false;
    }

    return searchableText.includes(rule.pattern.toLowerCase());
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

function buildTransactionStats(state: AppState): {
  totalTransactions: number;
  uncategorizedCount: number;
  periodStart: string | null;
  periodEnd: string | null;
} {
  let totalTransactions = 0;
  let uncategorizedCount = 0;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  for (const file of Object.values(state.pdfFiles)) {
    const transactions = file.extractionResult?.transactions ?? [];
    for (const transaction of transactions) {
      totalTransactions++;
      if (!hasMatchingVisibleCategory(transaction, state)) {
        uncategorizedCount++;
      }
      if (transaction.date) {
        const d = transaction.date.slice(0, 10);
        if (!periodStart || d < periodStart) periodStart = d;
        if (!periodEnd || d > periodEnd) periodEnd = d;
      }
    }
  }

  return { totalTransactions, uncategorizedCount, periodStart, periodEnd };
}

function renderTransactionStats(stats: ReturnType<typeof buildTransactionStats>): string {
  if (stats.totalTransactions === 0) {
    return "";
  }

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "—";
    const date = new Date(dateStr + "T12:00:00");
    return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" }).format(date);
  };

  const periodLabel =
    stats.periodStart && stats.periodEnd
      ? stats.periodStart === stats.periodEnd
        ? formatDate(stats.periodStart)
        : `${formatDate(stats.periodStart)} — ${formatDate(stats.periodEnd)}`
      : "—";

  const uncategorizedClass = stats.uncategorizedCount > 0 ? "stat-item--warning" : "stat-item--success";

  return `
    <section class="panel-card stats-card">
      <p class="eyebrow">À traiter</p>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">${stats.totalTransactions}</span>
          <span class="stat-label">Transactions</span>
        </div>
        <div class="stat-item ${uncategorizedClass}">
          <span class="stat-value">${stats.uncategorizedCount}</span>
          <span class="stat-label">Non catégorisées</span>
        </div>
        <div class="stat-item">
          <span class="stat-value stat-value--period">${escapeHtml(periodLabel)}</span>
          <span class="stat-label">Période couverte</span>
        </div>
      </div>
    </section>
  `;
}

function renderSupplementalSection(
  title: string,
  sectionKey: SupplementalDocumentSectionKey,
  state: AppState,
  processingSectionKey: DocumentSectionKey | null,
  processingFileName: string | null
): string {
  const items = state[sectionKey].items;
  const isBusy = processingSectionKey === sectionKey && processingFileName !== null;

  return `
    <section class="document-section-group">
      <div class="panel-card supplemental-drop-zone ${isBusy ? "is-processing" : ""}" data-supplemental-section-key="${sectionKey}">
        <div class="panel-header-row">
          <div>
            <p class="eyebrow">Documents libres</p>
            <h2>${title}</h2>
          </div>
          <button class="primary-button" type="button" data-action="add-supplemental-pdf" data-section-key="${sectionKey}" ${isBusy ? "disabled" : ""}>Ajouter PDF</button>
        </div>
        ${isBusy ? `<p class="status-pill status-pill--busy">Ajout en cours</p>` : ""}
        <p class="helper-text">${
          sectionKey === "invoices"
            ? "Ajoutez un nombre illimité de factures. Elles seront fusionnées dans leur propre section sans traitement OCR."
            : "Ajoutez un nombre illimité de communications ou autres pièces. Elles seront fusionnées dans leur propre section sans traitement OCR."
        }</p>
        <div class="drop-zone supplemental-drop-hint">
          <p class="drop-zone-title">Déposer un PDF ici pour ajouter</p>
        </div>
        ${
          items.length > 0
            ? `<ul class="settings-list">
                ${items
                  .map(
                    (item) => `
                      <li class="settings-list-item">
                        <div>
                          <strong>${escapeHtml(item.fileName)}</strong>
                          <p class="helper-text">${item.pageCount ?? "?"} page(s)</p>
                        </div>
                        <div class="item-actions">
                          <button class="ghost-button compact-button" type="button" data-action="view" data-section-key="${sectionKey}" data-item-id="${item.id}" data-file-id="${item.fileId}">Voir</button>
                          <button class="ghost-button compact-button" type="button" data-action="delete-pdf" data-section-key="${sectionKey}" data-item-id="${item.id}">Supprimer</button>
                        </div>
                      </li>
                    `
                  )
                  .join("")}
              </ul>`
            : '<p class="helper-text supplemental-empty">Aucun document ajouté pour le moment.</p>'
        }
      </div>
    </section>
  `;
}

function renderConfigurationTab(
  state: AppState,
  includeMissingJustifiedComments: boolean,
  preview: ReturnType<typeof buildMergedBankStatementsPreview>,
  providedDocumentsCount: number,
  isGeneratingMergedPdf: boolean,
  mergedPdfDebug?: { success?: { fileName: string; size: number }; error?: string } | null,
  activeCategoryFilter: CategoryFilter = "active",
  categorySearchQuery = "",
  ruleSearchQuery = ""
): string {
  return `
    <div class="configuration-tab" id="configuration-section" role="tabpanel">
      <section class="panel-card config-section">
        <div class="panel-header-row">
          <div>
            <p class="eyebrow">Configuration</p>
            <h2>Entreprise et dossier PDF</h2>
          </div>
        </div>
        <div class="config-grid">
          <div class="field">
            <label for="companyName">Nom de l'entreprise</label>
            <input id="companyName" name="companyName" type="text" value="${escapeHtml(state.company.name)}" placeholder="Ex: Conitech SARL" />
          </div>
          <div class="field">
            <label for="themeMode">Thème</label>
            <select id="themeMode" name="themeMode">
              ${renderThemeOptions(state.ui.themeMode)}
            </select>
          </div>
        </div>
        <div class="company-logo-row">
          ${
            state.company.logoDataUrl
              ? `<img class="company-logo-preview" src="${state.company.logoDataUrl}" alt="Logo de l'entreprise" />`
              : `<p class="helper-text">Aucun logo défini. Ajoutez un PNG ou JPEG pour enrichir la page de présentation.</p>`
          }
          <div class="actions-row">
            <button class="ghost-button" type="button" data-global-action="upload-company-logo">Ajouter ou remplacer</button>
            ${
              state.company.logoDataUrl
                ? `<button class="ghost-button" type="button" data-global-action="remove-company-logo">Retirer</button>`
                : ""
            }
          </div>
        </div>
        <label class="check-row">
          <input type="checkbox" name="includeMissingJustifiedComments" ${includeMissingJustifiedComments ? "checked" : ""} />
          <span>Ajouter une page de commentaire pour les mois marqués manquants justifiés</span>
        </label>
        <div class="actions-row utility-actions">
          <button class="ghost-button" type="button" data-global-action="reset-all-fields">Réinitialiser tous les champs</button>
        </div>
      </section>

      <section class="panel-card">
        <div class="panel-header-row">
          <div>
            <p class="eyebrow">Catégorisation</p>
            <h2>Catégories</h2>
          </div>
          <button class="primary-button" type="button" data-category-action="add-category">Ajouter</button>
        </div>
        __CATEGORY_EDITOR__
        ${renderCategoryManager(state.categories, activeCategoryFilter, categorySearchQuery)}
      </section>

      <section class="panel-card">
        <div class="panel-header-row">
          <div>
            <p class="eyebrow">Automatisation</p>
            <h2>Règles d'auto-catégorisation</h2>
          </div>
          <button class="primary-button" type="button" data-rule-action="add-rule" ${state.categories.filter((category) => !category.hidden).length === 0 ? "disabled" : ""}>Ajouter</button>
        </div>
        __RULE_EDITOR__
        ${renderRuleManager(state.categorizationRules, state.categories, ruleSearchQuery)}
      </section>

      <section class="panel-card debug-result-card">
        <div class="panel-header-row">
          <div>
            <p class="eyebrow">Génération PDF</p>
            <h2>Dernier résultat</h2>
          </div>
        </div>
        <div class="debug-result">
          ${mergedPdfDebug?.success ? `<p class="debug-status debug-status--success">Succès: ${escapeHtml(mergedPdfDebug.success.fileName)} (${mergedPdfDebug.success.size} octets)</p>` : ""}
          ${mergedPdfDebug?.error ? `<p class="debug-status debug-status--error">Erreur: ${escapeHtml(mergedPdfDebug.error)}</p>` : ""}
          ${!mergedPdfDebug ? `<p class="helper-text">Aucune génération récente.</p>` : ""}
        </div>
      </section>
    </div>
  `;
}

function renderCategoryManager(categories: Category[], activeFilter: CategoryFilter, searchQuery = ""): string {
  if (categories.length === 0) {
    return '<p class="helper-text">Aucune catégorie configurée.</p>';
  }

  const normalizedSearch = normalizeSearchText(searchQuery);
  const filteredByStatus = categories.filter((category) => {
    if (activeFilter === "active") {
      return !category.hidden;
    }
    if (activeFilter === "hidden") {
      return category.hidden;
    }
    return true;
  });
  const filteredCategories = filteredByStatus.filter((category) => {
    if (!normalizedSearch) {
      return true;
    }
    return normalizeSearchText(`${category.label} ${category.id}`).includes(normalizedSearch);
  });

  return `
    <div class="field settings-filter-field">
      <label for="categorySearch">Filtrer les catégories</label>
      <input
        id="categorySearch"
        type="search"
        value="${escapeHtml(searchQuery)}"
        placeholder="Nom ou identifiant"
        data-settings-filter="categories"
        autocomplete="off"
      />
    </div>
    <div class="segmented-control" role="tablist" aria-label="Filtre des catégories">
      ${renderCategoryFilterButton("active", "Actives", activeFilter, categories.filter((category) => !category.hidden).length)}
      ${renderCategoryFilterButton("hidden", "Masquées", activeFilter, categories.filter((category) => category.hidden).length)}
      ${renderCategoryFilterButton("all", "Toutes", activeFilter, categories.length)}
    </div>
    ${
      filteredCategories.length === 0
        ? `<p class="helper-text settings-empty-state">${normalizedSearch ? "Aucune catégorie ne correspond à ce filtre." : "Aucune catégorie dans ce filtre."}</p>`
        : `
    <ul class="settings-list">
      ${filteredCategories
        .map(
          (category) => `
            <li class="settings-list-item">
              <span class="category-swatch" style="--swatch:${escapeHtml(normalizeColorInput(category.color ?? "#6b7280"))}"></span>
              <div>
                <strong>${escapeHtml(category.label)}</strong>
                <p class="helper-text">${escapeHtml(category.id)}${category.hidden ? " · masquée" : ""}${category.builtIn ? " · de base" : ""}</p>
              </div>
              <div class="item-actions">
                <button class="ghost-button compact-button" type="button" data-category-action="edit-category" data-category-id="${escapeHtml(category.id)}">Modifier</button>
                ${
                  category.builtIn
                    ? `<button class="ghost-button compact-button icon-only-button" type="button" title="${category.hidden ? "Afficher la catégorie" : "Masquer la catégorie"}" aria-label="${category.hidden ? "Afficher la catégorie" : "Masquer la catégorie"}" data-category-action="toggle-category-hidden" data-category-id="${escapeHtml(category.id)}">${renderVisibilityIcon(category.hidden === true)}</button>`
                    : `<button class="ghost-button compact-button" type="button" data-category-action="delete-category" data-category-id="${escapeHtml(category.id)}">Supprimer</button>`
                }
              </div>
            </li>
          `
        )
        .join("")}
    </ul>
    `
    }
  `;
}

function renderCategoryFilterButton(
  filter: CategoryFilter,
  label: string,
  activeFilter: CategoryFilter,
  count: number
): string {
  return `
    <button
      class="segmented-button ${activeFilter === filter ? "is-active" : ""}"
      type="button"
      role="tab"
      aria-selected="${activeFilter === filter ? "true" : "false"}"
      data-category-filter="${filter}"
    >
      ${label}
      <span class="segmented-count">${count}</span>
    </button>
  `;
}

function renderRuleManager(rules: CategorizationRule[], categories: Category[], searchQuery = ""): string {
  if (rules.length === 0) {
    return '<p class="helper-text">Aucune règle configurée.</p>';
  }

  const normalizedSearch = normalizeSearchText(searchQuery);
  const filteredRules = rules.filter((rule) => {
    if (!normalizedSearch) {
      return true;
    }
    const category = rule.categoryId ? categories.find((item) => item.id === rule.categoryId) : null;
    return normalizeSearchText(
      `${rule.pattern} ${rule.categoryId ?? ""} ${category?.label ?? ""} ${rule.note ?? ""}`
    ).includes(normalizedSearch);
  });

  return `
    <div class="field settings-filter-field">
      <label for="ruleSearch">Filtrer les règles</label>
      <input
        id="ruleSearch"
        type="search"
        value="${escapeHtml(searchQuery)}"
        placeholder="Mot-clé, catégorie ou note"
        data-settings-filter="rules"
        autocomplete="off"
      />
    </div>
    ${
      filteredRules.length === 0
        ? '<p class="helper-text settings-empty-state">Aucune règle ne correspond à ce filtre.</p>'
        : `
    <ul class="settings-list">
      ${filteredRules
        .map((rule) => {
          const category = rule.categoryId ? categories.find((item) => item.id === rule.categoryId) : null;
          const color = normalizeColorInput(category?.color ?? "#6b7280");
          const details = [
            category ? `Catégorie : ${escapeHtml(category.label)}` : null,
            rule.note ? `Note : ${escapeHtml(rule.note)}` : null
          ]
            .filter(Boolean)
            .join(" — ");

          return `
            <li class="settings-list-item">
              <span class="category-swatch" style="--swatch:${escapeHtml(color)}"></span>
              <div>
                <strong>${escapeHtml(rule.pattern)}</strong>
                <p class="helper-text">${details}</p>
              </div>
              <div class="item-actions">
                <button class="ghost-button compact-button" type="button" data-rule-action="edit-rule" data-rule-id="${escapeHtml(rule.id)}">Modifier</button>
                <button class="ghost-button compact-button" type="button" data-rule-action="delete-rule" data-rule-id="${escapeHtml(rule.id)}">Supprimer</button>
              </div>
            </li>
          `;
        })
        .join("")}
    </ul>
    `
    }
  `;
}

function renderCategoryEditor(editor: CategoryEditorState): string {
  if (!editor) {
    return "";
  }

  return `
    <form class="inline-editor-card" data-form="category-editor">
      <div class="inline-editor-grid">
        <div class="field">
          <label for="categoryLabel">${editor.mode === "edit" ? "Nom de la catégorie" : "Nouvelle catégorie"}</label>
          <input id="categoryLabel" name="label" type="text" value="${escapeHtml(editor.label)}" placeholder="Ex: Logiciels et abonnements" />
        </div>
        <div class="field inline-color-field">
          <label for="categoryColor">Couleur</label>
          <input id="categoryColor" name="color" type="color" value="${escapeHtml(normalizeColorInput(editor.color))}" />
        </div>
      </div>
      <div class="actions-row">
        <button class="primary-button" type="submit">${editor.mode === "edit" ? "Enregistrer" : "Ajouter"}</button>
        <button class="ghost-button" type="button" data-category-action="cancel-category-editor">Annuler</button>
      </div>
    </form>
  `;
}

function renderRuleEditor(editor: RuleEditorState, categories: Category[]): string {
  if (!editor) {
    return "";
  }

  const availableCategories = categories.filter((category) => !category.hidden || category.id === editor.categoryId);
  const selectedCategory = editor.categoryId ? categories.find((category) => category.id === editor.categoryId) : null;
  return `
    <form class="inline-editor-card" data-form="rule-editor">
      <div class="inline-editor-grid">
        <div class="field">
          <label for="rulePattern">${editor.mode === "edit" ? "Mot-clé ou texte" : "Nouvelle règle"}</label>
          <input id="rulePattern" name="pattern" type="text" value="${escapeHtml(editor.pattern)}" placeholder="Ex: openai" />
        </div>
        <div class="field">
          <label for="ruleCategory">Catégorie <span class="field-hint">(optionnel)</span></label>
          <input
            id="ruleCategory"
            name="categoryId"
            type="text"
            list="ruleCategoryOptions"
            value="${escapeHtml(selectedCategory?.label ?? "")}"
            placeholder="Aucune"
            autocomplete="off"
          />
          <datalist id="ruleCategoryOptions">
            ${availableCategories
              .map(
                (category) =>
                  `<option value="${escapeHtml(category.label)}" label="${escapeHtml(category.id)}"></option>`
              )
              .join("")}
          </datalist>
        </div>
        <div class="field field--full">
          <label for="ruleNote">Note <span class="field-hint">(optionnel — ajoutée en commentaire sur la transaction)</span></label>
          <input id="ruleNote" name="note" type="text" value="${escapeHtml(editor.note)}" placeholder="Ex: à vérifier avec la facture" />
        </div>
      </div>
      <div class="actions-row">
        <button class="primary-button" type="submit">${editor.mode === "edit" ? "Enregistrer" : "Ajouter"}</button>
        <button class="ghost-button" type="button" data-rule-action="cancel-rule-editor">Annuler</button>
      </div>
    </form>
  `;
}

function renderVisibilityIcon(isHidden: boolean): string {
  if (isHidden) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="small-action-icon">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="small-action-icon">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M4 20 20 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;
}

function ensurePdfInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf";
  input.style.display = "none";
  input.setAttribute("aria-hidden", "true");
  document.body.appendChild(input);
  return input;
}

function ensureLogoInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/jpg";
  input.style.display = "none";
  input.setAttribute("aria-hidden", "true");
  document.body.appendChild(input);
  return input;
}

async function savePdfFromFile(
  target:
    | { sectionKey: MonthlyDocumentSectionKey; monthKey: string }
    | { sectionKey: SupplementalDocumentSectionKey },
  file: File
): Promise<AppState> {
  if (!isAcceptedPdfInput(file)) {
    throw new Error("Le fichier sélectionné n'est pas un PDF valide.");
  }

  const extracted = await extractPdfData(file, async (isRetry) => {
    const message = isRetry
      ? "Mot de passe incorrect. Veuillez saisir le mot de passe du PDF :"
      : "Ce PDF est protégé. Veuillez saisir le mot de passe :";
    const value = prompt(message);
    return value?.trim() ? value.trim() : null;
  });

  if (extracted.passwordRequired) {
    throw new Error("Import annulé : mot de passe PDF requis.");
  }

  const supportsExtraction = target.sectionKey === "bankStatements" || target.sectionKey === "creditCardStatements";
  const { extractionResult, extractionDebug } = supportsExtraction
    ? await runExtractionWithDiagnostics(file, Boolean(extracted.passwordProtected))
    : { extractionResult: undefined, extractionDebug: undefined };

  const now = new Date().toISOString();
  const storedFile: StoredPdfFile = {
    id: crypto.randomUUID(),
    fileName: file.name,
    mimeType: "application/pdf",
    size: file.size,
    dataBase64: extracted.dataBase64,
    pageCount: extracted.pageCount,
    passwordProtected: extracted.passwordProtected,
    passwordRequired: extracted.passwordRequired,
    previewPageDataUrl: extracted.previewPageDataUrl,
    annotations: [],
    extractionResult,
    extractionDebug,
    createdAt: now,
    updatedAt: now
  };

  if ("monthKey" in target) {
    return savePdfForMonthlySection(target.sectionKey, target.monthKey, storedFile);
  }

  return addSupplementalPdfFile(target.sectionKey, storedFile);
}

async function refreshExtractionForMonth(
  currentState: AppState,
  sectionKey: MonthlyDocumentSectionKey,
  monthKey: string
): Promise<AppState> {
  const month = currentState[sectionKey].expectedMonths.find((item) => item.monthKey === monthKey);
  if (!month?.fileId) {
    throw new Error("Aucun document n'est associe a ce mois.");
  }

  const existingFile = currentState.pdfFiles[month.fileId];
  if (!existingFile) {
    throw new Error("Le document source est introuvable dans le stockage local.");
  }

  const file = createFileFromStoredPdf(existingFile);
  const { extractionResult, extractionDebug } = await runExtractionWithDiagnostics(file, Boolean(existingFile.passwordProtected));

  const nextFile: StoredPdfFile = {
    ...existingFile,
    extractionResult: extractionResult ?? existingFile.extractionResult,
    extractionDebug,
    updatedAt: new Date().toISOString()
  };

  return savePdfForMonthlySection(sectionKey, monthKey, nextFile);
}

async function runExtractionWithDiagnostics(
  file: File,
  isProtectedPdf: boolean
): Promise<{ extractionResult: StatementExtractionResult | undefined; extractionDebug: ExtractionDebugInfo }> {
  const startedAt = Date.now();
  const now = new Date().toISOString();

  if (isProtectedPdf) {
    return {
      extractionResult: undefined,
      extractionDebug: {
        lastRunAt: now,
        lastRunDurationMs: 0,
        lastRunStatus: "skipped",
        lastErrorMessage: "Extraction ignoree: PDF protege par mot de passe.",
        lastWarnings: ["PDF protege: impossible de relancer l'analyse sans mot de passe."],
        lastTransactionsCount: 0,
        lastBankDetected: null,
        lastParserDetected: null,
        lastParserReason: null,
        lastUsedOCR: false
      }
    };
  }

  const ocrEngine = new TesseractOcrEngine({ language: "fra+eng" });

  try {
    // Extraction principale
    const extractionResult = await runExtractionPipeline(file, { ocrEngine });

    // OCR pages (texte brut)
    let ocrPages: Array<{ pageNumber: number; text: string }> = [];
    if (extractionResult && extractionResult.metadata.usedOCR) {
      // On relance l'OCR pour obtenir le texte brut par page (léger surcoût, mais debug maximal)
      const inspection = await import("../modules/pdf-inspection/pdf-inspector").then(m => m.inspectPdf(file));
      const ocrPageNumbers = inspection.pages.map((p: any) => p.pageNumber);
      const renderedPages = await import("../modules/pdf-rendering/pdf-renderer").then(m => m.renderPdfToImages(file, { includePageNumbers: ocrPageNumbers }));
      const ocrResults = await import("../modules/ocr/ocr-service").then(m => m.runOcrOnRenderedPages(renderedPages, ocrEngine));
      ocrPages = ocrResults.map(page => ({
        pageNumber: page.pageNumber,
        text: page.tokens.map(t => t.text).join(" ").replace(/\s+/g, " ").trim()
      }));
    }

    // Lignes candidates (toutes lignes du layout)
    let candidateLines: Array<{ pageNumber: number; text: string }> = [];
    try {
      const textPages = await extractTextTokensFromPdf(file);
      let ocrResults: any[] = [];
      if (ocrPages.length > 0) {
        ocrResults = ocrPages.map(p => ({ pageNumber: p.pageNumber, tokens: [{ text: p.text, x: 0, y: 0, width: 0, height: 0, confidence: 1 }] }));
      }
      const layout = analyzeLayout({ textPages, ocrPages: ocrResults });
      candidateLines = layout.lines.map(line => ({ pageNumber: line.pageNumber, text: line.text }));
    } catch {}

    const parserInputText =
      extractionResult.metadata.parserInputText ??
      buildParserInputDebugText(extractionResult.metadata.detectedTemplate ?? null, ocrPages, candidateLines);

    return {
      extractionResult,
      extractionDebug: {
        lastRunAt: now,
        lastRunDurationMs: Date.now() - startedAt,
        lastRunStatus: "success",
        lastWarnings: extractionResult.warnings,
        lastTransactionsCount: extractionResult.transactions.length,
        lastBankDetected: extractionResult.bank,
        lastParserDetected: extractionResult.metadata.detectedTemplate ?? null,
        lastParserReason: extractionResult.metadata.detectedTemplateReason ?? null,
        lastUsedOCR: extractionResult.metadata.usedOCR,
        ocrPages,
        candidateLines,
        parserInputText
      }
    };
  } catch (error) {
    return {
      extractionResult: undefined,
      extractionDebug: {
        lastRunAt: now,
        lastRunDurationMs: Date.now() - startedAt,
        lastRunStatus: "error",
        lastErrorMessage: getErrorMessage(error),
        lastErrorStack: error instanceof Error ? error.stack : undefined,
        lastWarnings: ["L'actualisation de l'extraction a echoue."],
        lastTransactionsCount: 0,
        lastBankDetected: null,
        lastParserDetected: null,
        lastParserReason: null,
        lastUsedOCR: false
      }
    };
  } finally {
    await ocrEngine.terminate();
  }
}

function buildParserInputDebugText(
  detectedTemplate: string | null,
  ocrPages: Array<{ pageNumber: number; text: string }>,
  candidateLines: Array<{ pageNumber: number; text: string }>
): string {
  if ((detectedTemplate === "bmo-mastercard-ocr" || detectedTemplate === "bmo-ocr") && ocrPages.length > 0) {
    return ocrPages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page) => `Page ${page.pageNumber}:\n${page.text}`)
      .join("\n\n");
  }

  if (candidateLines.length > 0) {
    return candidateLines.map((line) => `Page ${line.pageNumber}: ${line.text}`).join("\n");
  }

  return "";
}

function createFileFromStoredPdf(storedFile: StoredPdfFile): File {
  const binary = atob(storedFile.dataBase64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: storedFile.mimeType });
  return new File([blob], storedFile.fileName, {
    type: storedFile.mimeType,
    lastModified: Date.now()
  });
}

function isAcceptedPdfInput(file: File): boolean {
  const hasPdfMimeType = file.type === "application/pdf";
  const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  return hasPdfMimeType || hasPdfExtension;
}

async function convertImageToDataUrl(file: File): Promise<string> {
  const acceptedMimeType = file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/jpg";
  if (!acceptedMimeType) {
    throw new Error("Le logo doit etre une image PNG ou JPEG.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const maxWidth = 1200;
  const maxHeight = 500;
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Impossible de preparer le logo.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.86);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier image."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Le format du logo est invalide."));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Impossible de charger l'image du logo."));
    image.src = dataUrl;
  });
}

function downloadBytesAsPdf(bytes: Uint8Array, fileName: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderMergePreview(
  preview: ReturnType<typeof buildMergedBankStatementsPreview>
): string {
  const providedMonths = preview.providedMonths.length
    ? preview.providedMonths
        .map(
          (month) =>
            `<li><strong>${escapeHtml(month.label)}</strong><span>${month.pageCount ?? "?"} page(s)</span></li>`
        )
        .join("")
    : '<li><span>Aucun PDF ajoute pour le moment.</span></li>';

  const justifiedMissingMonths = preview.includesMissingComments && preview.justifiedMissingMonths.length
    ? preview.justifiedMissingMonths
        .map(
          (month) =>
            `<li><strong>${escapeHtml(month.label)}</strong><span>${escapeHtml(month.reason)}</span></li>`
        )
        .join("")
    : `<li><span>${
        preview.justifiedMissingMonths.length
          ? "Option des commentaires desactives."
          : "Aucun mois manquant justifie selectionne."
      }</span></li>`;
  const sectionSummaryItems = preview.sectionSummaries
    .filter((section) => section.documentCount > 0)
    .map((section) => `<li><strong>${escapeHtml(section.label)}</strong><span>${section.documentCount} document(s)</span></li>`)
    .join("");

  return `
    <section class="merge-preview-card">
      <div class="panel-header-row merge-preview-header">
        <div>
          <p class="eyebrow">Apercu</p>
          <h3>PDF fusionne</h3>
        </div>
        <strong class="merge-preview-pages">${preview.estimatedPageCount} page(s)</strong>
      </div>
      <dl class="merge-preview-stats">
        <div>
          <dt>Fichier</dt>
          <dd>${escapeHtml(preview.fileName)}</dd>
        </div>
        <div>
          <dt>Pages intro</dt>
          <dd>${preview.introductionPages}</dd>
        </div>
        <div>
          <dt>Annexes annotations</dt>
          <dd>${preview.annotationAppendixPages}</dd>
        </div>
      </dl>
      <details class="document-section-group document-section-collapsible">
        <summary class="document-section-summary merge-preview-collapsible-summary">
          <span>
            <span class="eyebrow">Contenu du PDF</span>
            <span class="document-section-title">Sections incluses et relevés inclus</span>
          </span>
        </summary>
        <div class="merge-preview-columns">
          <div>
            <p class="fieldset-label">Sections incluses</p>
            <ul class="merge-preview-list">${sectionSummaryItems || "<li><span>Aucune section incluse.</span></li>"}</ul>
          </div>
          <div>
            <p class="fieldset-label">Relevés bancaires inclus</p>
            <ul class="merge-preview-list">${providedMonths}</ul>
          </div>
          <div>
            <p class="fieldset-label">Commentaires ajoutes</p>
            <ul class="merge-preview-list">${justifiedMissingMonths}</ul>
          </div>
        </div>
      </details>
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveCategoryIdFromInput(value: string, categories: Category[]): string | undefined {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) {
    return undefined;
  }

  return categories.find((category) => {
    if (category.hidden) {
      return false;
    }

    return (
      normalizeSearchText(category.label) === normalizedValue ||
      normalizeSearchText(category.id) === normalizedValue
    );
  })?.id;
}

function focusSettingsFilter(container: HTMLElement, filterName: "categories" | "rules", caretPosition: number): void {
  requestAnimationFrame(() => {
    const input = container.querySelector<HTMLInputElement>(`input[data-settings-filter="${filterName}"]`);
    if (!input) {
      return;
    }
    input.focus();
    input.setSelectionRange(caretPosition, caretPosition);
  });
}

function getMonthCardFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(".month-card[data-month-key]");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Une erreur inattendue est survenue.";
}


function renderThemeOptions(currentValue: string): string {
  return [
    ["system", "Système"],
    ["light", "Clair"],
    ["dark", "Sombre"]
  ]
    .map(([value, label]) => `<option value="${value}" ${currentValue === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function promptCategoryId(categories: Category[], currentValue?: string): string | null {
  const availableCategories = categories.filter((category) => !category.hidden || category.id === currentValue);

  if (availableCategories.length === 0) {
    alert("Créez au moins une catégorie avant d'ajouter une règle.");
    return null;
  }

  const options = availableCategories.map((category) => `${category.id} (${category.label})`).join("\n");
  const value = prompt(`ID de la catégorie à appliquer:\n${options}`, currentValue ?? availableCategories[0]?.id)?.trim();
  if (!value) {
    return null;
  }

  if (!availableCategories.some((category) => category.id === value)) {
    alert("Catégorie inconnue.");
    return null;
  }

  return value;
}

function createSlugId(label: string, fallbackPrefix: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${slug || fallbackPrefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeColorInput(value: string | undefined): string {
  const color = (value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#6b7280";
}

function getSectionLabel(sectionKey: DocumentSectionKey): string {
  switch (sectionKey) {
    case "bankStatements":
      return "Relevés bancaires";
    case "creditCardStatements":
      return "Relevés de carte de crédit";
    case "invoices":
      return "Factures";
    case "otherCommunications":
      return "Communication et autre";
    default:
      return "Documents";
  }
}

function getSupplementalDropTargetFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>("[data-supplemental-section-key]");
}
