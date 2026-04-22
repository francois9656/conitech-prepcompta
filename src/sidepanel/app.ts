import "../styles/base.css";

import { renderMonthStatusCard } from "../components/month-status-card";
import type { AppState, StoredPdfFile } from "../domain/models";
import { buildMergedBankStatementsPreview, generateMergedBankStatementsPdf } from "../pdf/pdf-merge-service";
import { extractPdfData } from "../pdf/pdf-service";
import { renderProgressSummary } from "../components/progress-summary";
import { applyTheme } from "../services/theme-service";
import {
  clearMonthMissing,
  getAppState,
  markMonthMissing,
  removePdfForMonth,
  savePdfForMonth,
  updateCompanyProfile,
  updatePeriod,
  updateUiSettings
} from "../storage/app-storage";

export async function initSidePanelApp(container: HTMLElement): Promise<void> {
  let state = await getAppState();
  let pendingUploadMonthKey: string | null = null;
  let processingMonthKey: string | null = null;
  let processingFileName: string | null = null;
  let isGeneratingMergedPdf = false;
  let includeMissingJustifiedComments = true;

  applyTheme(state.ui.themeMode);
  render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);

  const fileInput = ensurePdfInput();
  const logoInput = ensureLogoInput();

  fileInput.addEventListener("change", async () => {
    const selectedFile = fileInput.files?.[0];
    if (!selectedFile || !pendingUploadMonthKey) {
      fileInput.value = "";
      return;
    }

    try {
      processingMonthKey = pendingUploadMonthKey;
      processingFileName = selectedFile.name;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);

      state = await savePdfFromFile(pendingUploadMonthKey, selectedFile);
      processingMonthKey = null;
      processingFileName = null;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
    } catch (error) {
      processingMonthKey = null;
      processingFileName = null;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
      alert(getErrorMessage(error));
    } finally {
      fileInput.value = "";
      pendingUploadMonthKey = null;
    }
  });

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
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
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

    if (target.name === "periodStart" || target.name === "periodEnd") {
      const form = target.closest("form");
      if (!(form instanceof HTMLFormElement)) {
        return;
      }

      const formData = new FormData(form);
      state = await updatePeriod({
        start: String(formData.get("periodStart") ?? ""),
        end: String(formData.get("periodEnd") ?? "")
      });
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
      return;
    }

    if (target.name === "includeMissingJustifiedComments") {
      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      includeMissingJustifiedComments = target.checked;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
      return;
    }

    if (target.name === "companyName") {
      state = await updateCompanyProfile({ name: target.value.trim() });
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
      return;
    }

    if (target.name === "themeMode") {
      state = await updateUiSettings({ themeMode: target.value as typeof state.ui.themeMode });
      applyTheme(state.ui.themeMode);
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
    }
  });

  container.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
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
          render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
          return;
        }

        if (globalAction === "generate-merged-pdf") {
          isGeneratingMergedPdf = true;
          render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);

          const merged = await generateMergedBankStatementsPdf(state, {
            includeJustifiedMissingComments: includeMissingJustifiedComments
          });
          downloadBytesAsPdf(merged.bytes, merged.fileName);

          isGeneratingMergedPdf = false;
          render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
          return;
        }
      } catch (error) {
        isGeneratingMergedPdf = false;
        render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
        alert(getErrorMessage(error));
      }

      return;
    }

    const button = target.closest<HTMLButtonElement>("button[data-action][data-month-key]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const monthKey = button.dataset.monthKey;
    if (!action || !monthKey) {
      return;
    }

    try {
      if (action === "add-pdf") {
        pendingUploadMonthKey = monthKey;
        fileInput.click();
        return;
      }

      if (action === "delete-pdf") {
        state = await removePdfForMonth(monthKey);
        render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
        return;
      }

      if (action === "mark-missing" || action === "edit-missing") {
        const existingReason =
          state.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey)?.missingReason ?? "";
        const reason = prompt("Indiquez la raison du document manquant :", existingReason)?.trim() ?? "";

        if (!reason) {
          alert("La raison est obligatoire pour marquer le document comme manquant.");
          return;
        }

        state = await markMonthMissing(monthKey, reason);
        render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
        return;
      }

      if (action === "clear-missing") {
        state = await clearMonthMissing(monthKey);
        render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
        return;
      }

      if (action === "view") {
        const viewerUrl = chrome.runtime.getURL(`viewer.html?monthKey=${encodeURIComponent(monthKey)}`);
        await chrome.tabs.create({ url: viewerUrl });
      }
    } catch (error) {
      alert(getErrorMessage(error));
    }
  });

  container.addEventListener("dragover", (event) => {
    const monthCard = getMonthCardFromEvent(event);
    if (!monthCard) {
      return;
    }

    if (monthCard.dataset.status === "provided") {
      return;
    }

    event.preventDefault();
    monthCard.classList.add("is-drop-target");
  });

  container.addEventListener("dragleave", (event) => {
    const monthCard = getMonthCardFromEvent(event);
    monthCard?.classList.remove("is-drop-target");
  });

  container.addEventListener("drop", async (event) => {
    const monthCard = getMonthCardFromEvent(event);
    if (!monthCard) {
      return;
    }

    event.preventDefault();
    monthCard.classList.remove("is-drop-target");

    const monthKey = monthCard.dataset.monthKey;
    const droppedFile = event.dataTransfer?.files?.[0];

    if (!monthKey || !droppedFile) {
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
      processingMonthKey = monthKey;
      processingFileName = droppedFile.name;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);

      state = await savePdfFromFile(monthKey, droppedFile);
      processingMonthKey = null;
      processingFileName = null;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
    } catch (error) {
      processingMonthKey = null;
      processingFileName = null;
      render(container, state, processingMonthKey, processingFileName, isGeneratingMergedPdf, includeMissingJustifiedComments);
      alert(getErrorMessage(error));
    }
  });
}

function render(
  container: HTMLElement,
  state: AppState,
  processingMonthKey: string | null,
  processingFileName: string | null,
  isGeneratingMergedPdf: boolean,
  includeMissingJustifiedComments: boolean
): void {
  const preview = buildMergedBankStatementsPreview(state, {
    includeJustifiedMissingComments: includeMissingJustifiedComments
  });
  const providedDocumentsCount = preview.providedMonths.length;

  container.innerHTML = `
    <main class="sidepanel-shell">
      <div class="sidepanel-layout">
        <section class="panel-card">
          <div class="panel-header-row">
            <div>
              <p class="eyebrow">Conitech PrepCompta</p>
              <h1>Préparation comptable</h1>
            </div>
            <div class="field">
              <label for="themeMode">Thème</label>
              <select id="themeMode" name="themeMode">
                ${renderThemeOptions(state.ui.themeMode)}
              </select>
            </div>
          </div>
          <p class="helper-text">Le side panel pilote la section Relevés bancaires et centralise le suivi d’avancement.</p>
          ${
            processingMonthKey && processingFileName
              ? `<div class="upload-banner" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Import en cours pour ${processingMonthKey}: ${processingFileName}</span></div>`
              : ""
          }
          ${
            isGeneratingMergedPdf
              ? `<div class="upload-banner" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Generation du PDF fusionne en cours...</span></div>`
              : ""
          }
        </section>

        <section class="panel-card">
          <div class="panel-header-row">
            <div>
              <p class="eyebrow">Presentation</p>
              <h2>Entreprise et dossier PDF</h2>
            </div>
          </div>
          <div class="field">
            <label for="companyName">Nom de l'entreprise</label>
            <input id="companyName" name="companyName" type="text" value="${escapeHtml(state.company.name)}" placeholder="Ex: Conitech SARL" />
          </div>
          <div class="company-logo-row">
            ${
              state.company.logoDataUrl
                ? `<img class="company-logo-preview" src="${state.company.logoDataUrl}" alt="Logo de l'entreprise" />`
                : `<p class="helper-text">Aucun logo defini. Ajoutez un PNG ou JPEG pour enrichir la page de presentation.</p>`
            }
            <div class="actions-row">
              <button class="ghost-button" type="button" data-global-action="upload-company-logo">Ajouter/Remplacer logo</button>
              ${
                state.company.logoDataUrl
                  ? `<button class="ghost-button" type="button" data-global-action="remove-company-logo">Retirer logo</button>`
                  : ""
              }
            </div>
          </div>
          <label class="check-row">
            <input type="checkbox" name="includeMissingJustifiedComments" ${includeMissingJustifiedComments ? "checked" : ""} />
            <span>Ajouter une page de commentaire pour les mois marques manquants justifies</span>
          </label>
          ${renderMergePreview(preview)}
          <div class="actions-row merge-actions">
            <button
              class="primary-button"
              type="button"
              data-global-action="generate-merged-pdf"
              ${providedDocumentsCount === 0 || isGeneratingMergedPdf ? "disabled" : ""}
            >
              Generer PDF fusionne
            </button>
            <p class="helper-text">Le fichier inclut les pages d'introduction, les commentaires optionnels, puis les PDF des mois fournis.</p>
          </div>
        </section>

        ${renderProgressSummary(state.bankStatements)}

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
        </section>

        <section class="section-list">
          ${state.bankStatements.expectedMonths.map((item) => renderMonthStatusCard(item)).join("")}
        </section>
      </div>
    </main>
  `;

  if (processingMonthKey) {
    const processingCard = container.querySelector<HTMLElement>(`.month-card[data-month-key="${processingMonthKey}"]`);
    processingCard?.classList.add("is-processing");
  }
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

async function savePdfFromFile(monthKey: string, file: File): Promise<AppState> {
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
    createdAt: now,
    updatedAt: now
  };

  return savePdfForMonth(monthKey, storedFile);
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
      </dl>
      <div class="merge-preview-columns">
        <div>
          <p class="fieldset-label">Mois inclus</p>
          <ul class="merge-preview-list">${providedMonths}</ul>
        </div>
        <div>
          <p class="fieldset-label">Commentaires ajoutes</p>
          <ul class="merge-preview-list">${justifiedMissingMonths}</ul>
        </div>
      </div>
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

function getMonthCardFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
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
