import "../../styles/base.css";
import type { AppState, ExtractionDebugInfo, StoredPdfAnnotation, StoredPdfFile } from "../../domain/models";
import { getAppState, updatePdfAnnotations, updatePdfExtractionData } from "../../storage/app-storage";
import { analyzeLayout } from "../../modules/layout-analysis/layout-analyzer";
import { extractTextTokensFromPdf } from "../../modules/pdf-inspection/pdf-text-extractor";
import { extractPdfData } from "../../pdf/pdf-service";
import { TesseractOcrEngine } from "../../modules/ocr/tesseract-ocr-engine";
import { runExtractionPipeline } from "../../pipeline/extractionPipeline";

const params = new URLSearchParams(window.location.search);
const monthKey = params.get("monthKey");
const fileId = params.get("fileId");
const parserOverrideStorageKey = `parserOverride-${fileId ?? monthKey ?? "unknown"}`;
const autoCategorizationKey = `autoCategorizationResults-${fileId ?? monthKey}`;
// Persistance des catégories manuelles par mois (clé: "manualCategories-<monthKey>")
let manualCategories: Record<string, string> = {};
const manualCatKey = `manualCategories-${fileId ?? monthKey}`;
try {
  const raw = localStorage.getItem(manualCatKey);
  if (raw) manualCategories = JSON.parse(raw);
} catch {}
let autoCategorizationResults: Record<string, { status: "success" | "warning"; matchedRuleIds: string[]; selectedCategoryId: string }> = {};
try {
  const raw = localStorage.getItem(autoCategorizationKey);
  if (raw) autoCategorizationResults = JSON.parse(raw);
} catch {}

const container = document.querySelector<HTMLElement>("#app");

if (!container) {
  throw new Error("Le conteneur viewer est introuvable.");
}

void initViewer(container);

async function initViewer(root: HTMLElement): Promise<void> {
  let ocrDebugText: string | null = null;
  let parserOverride = localStorage.getItem(parserOverrideStorageKey) ?? "auto";

  const ocrInput = document.createElement("input");
  ocrInput.type = "file";
  ocrInput.accept = "application/pdf";
  ocrInput.style.display = "none";
  document.body.appendChild(ocrInput);

  ocrInput.addEventListener("change", async () => {
    const file = ocrInput.files?.[0];
    if (!file) {
      return;
    }

    ocrDebugText = "Traitement en cours...";
    renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, ocrDebugText, undefined, fileId ?? undefined, parserOverride);

    try {
      const ocrEngine = new TesseractOcrEngine({ language: "fra+eng" });
      await extractPdfData(file, async () => null);
      const { inspectPdf } = await import("../../modules/pdf-inspection/pdf-inspector");
      const inspection = await inspectPdf(file);
      const { renderPdfToImages } = await import("../../modules/pdf-rendering/pdf-renderer");
      const renderedPages = await renderPdfToImages(file, {
        includePageNumbers: inspection.pages.map((page: any) => page.pageNumber)
      });
      const { runOcrOnRenderedPages } = await import("../../modules/ocr/ocr-service");
      const ocrResults = await runOcrOnRenderedPages(renderedPages, ocrEngine);
      ocrDebugText = ocrResults
        .map((page) => `Page ${page.pageNumber}:\n${page.tokens.map((token) => token.text).join(" ")}`)
        .join("\n\n");
      await ocrEngine.terminate();
    } catch (err) {
      ocrDebugText = `Erreur OCR: ${err instanceof Error ? err.message : String(err)}`;
    }

    renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, ocrDebugText, undefined, fileId ?? undefined, parserOverride);
  });

  let state = await getAppState();
  let isSaving = false;

  if (!monthKey && !fileId) {
    renderMessage(root, "Aucun document sélectionné.");
    return;
  }

  const context = getViewerContext(state, monthKey, fileId);
  if (!context) {
    renderMessage(root, "Aucun document disponible.");
    return;
  }

  const pdfUrl = createPdfObjectUrl(context.file.dataBase64);
  let draftAnnotations = context.file.annotations.map((annotation) => ({ ...annotation }));

  window.addEventListener(
    "beforeunload",
    () => {
      URL.revokeObjectURL(pdfUrl);
    },
    { once: true }
  );

  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const addButton = target.closest<HTMLButtonElement>("button[data-action='add-annotation']");
    if (addButton) {
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      draftAnnotations = [
        ...draftAnnotations,
        {
          id: crypto.randomUUID(),
          transactionDate: today,
          annotation: "",
          createdAt: now,
          updatedAt: now
        }
      ];
      renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, undefined, undefined, fileId ?? undefined, parserOverride);
      return;
    }

    const removeButton = target.closest<HTMLButtonElement>("button[data-action='remove-annotation']");
    if (removeButton) {
      const annotationId = removeButton.dataset.annotationId;
      if (!annotationId) {
        return;
      }

      draftAnnotations = draftAnnotations.filter((item) => item.id !== annotationId);
      renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, undefined, undefined, fileId ?? undefined, parserOverride);
      return;
    }

    const openPdfButton = target.closest<HTMLButtonElement>("button[data-action='open-pdf']");
    if (openPdfButton) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const autoCategorizeButton = target.closest<HTMLButtonElement>("button[data-action='apply-auto-categorization']");
    if (autoCategorizeButton) {
      const currentContext = getViewerContext(state, monthKey, fileId);
      const currentTransactions = currentContext?.file.extractionResult?.transactions ?? [];
      const autoCategorization = applyAutoCategorization(currentTransactions, state, manualCategories);
      manualCategories = autoCategorization.manualCategories;
      autoCategorizationResults = autoCategorization.results;
      persistManualCategories();
      persistAutoCategorizationResults();
      renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, undefined, undefined, fileId ?? undefined, parserOverride);
      return;
    }

    const saveButton = target.closest<HTMLButtonElement>("button[data-action='save-annotations']");
    if (saveButton) {
      const currentContext = getViewerContext(state, monthKey, fileId);
      if (!currentContext) {
        return;
      }

      const now = new Date().toISOString();
      const cleaned = draftAnnotations
        .map((item) => ({
          ...item,
          transactionDate: item.transactionDate.trim(),
          annotation: (item.annotation ?? "").trim(),
          updatedAt: now
        }))
        .filter((item) => item.transactionDate || item.annotation);

      isSaving = true;
      renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, undefined, undefined, fileId ?? undefined, parserOverride);

      try {
        state = await updatePdfAnnotations(currentContext.file.id, cleaned);
        const refreshedContext = getViewerContext(state, monthKey, fileId);
        draftAnnotations = refreshedContext ? refreshedContext.file.annotations.map((annotation) => ({ ...annotation })) : [];
      } finally {
        isSaving = false;
        renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, undefined, undefined, fileId ?? undefined, parserOverride);
      }
      return;
    }

    const rerunButton = target.closest<HTMLButtonElement>("button[data-action='rerun-extraction']");
    if (!rerunButton) {
      return;
    }

    const currentContext = getViewerContext(state, monthKey, fileId);
    if (!currentContext) {
      return;
    }

    isSaving = true;
    renderViewer(
      root,
      state,
      monthKey ?? "",
      pdfUrl ?? "",
      draftAnnotations,
      isSaving,
      `Actualisation avec le parseur ${parserOverride} en cours...`,
      undefined,
      fileId ?? undefined,
      parserOverride
    );

    try {
      const rerunFile = createFileFromStoredPdf(currentContext.file);
      const { extractionResult, extractionDebug } = await runExtractionWithDiagnostics(
        rerunFile,
        Boolean(currentContext.file.passwordProtected),
        parserOverride === "auto" ? null : parserOverride
      );
      state = await updatePdfExtractionData(currentContext.file.id, extractionResult, extractionDebug);
      const refreshedContext = getViewerContext(state, monthKey, fileId);
      draftAnnotations = refreshedContext ? refreshedContext.file.annotations.map((annotation) => ({ ...annotation })) : draftAnnotations;
    } finally {
      isSaving = false;
      renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, undefined, undefined, fileId ?? undefined, parserOverride);
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const annotationId = target.dataset.annotationId;
    const field = target.dataset.field;
    if (!annotationId || !field) {
      return;
    }

    draftAnnotations = draftAnnotations.map((item) => {
      if (item.id !== annotationId) {
        return item;
      }

      return {
        ...item,
        transactionDate: field === "date" ? target.value : item.transactionDate,
        annotation: field === "annotation" ? target.value : item.annotation,
        updatedAt: new Date().toISOString()
      };
    });
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.name === "parserOverride") {
      parserOverride = target.value;
      localStorage.setItem(parserOverrideStorageKey, parserOverride);
      return;
    }

    if (!target.classList.contains("transaction-category")) {
      return;
    }

    const transactionIndex = Number(target.dataset.transactionIdx);
    if (!Number.isFinite(transactionIndex)) {
      return;
    }

    if (target.value) {
      manualCategories[String(transactionIndex)] = target.value;
    } else {
      delete manualCategories[String(transactionIndex)];
    }
    delete autoCategorizationResults[String(transactionIndex)];
    persistManualCategories();
    persistAutoCategorizationResults();
  });

  renderViewer(root, state, monthKey ?? "", pdfUrl ?? "", draftAnnotations, isSaving, ocrDebugText, ocrInput, fileId ?? undefined, parserOverride);
}

function renderViewer(
  root: HTMLElement,
  state: AppState,
  monthKey: string,
  pdfUrl: string,
  annotations: StoredPdfAnnotation[],
  isSaving: boolean,
  ocrDebugText?: string | null,
  ocrInput?: HTMLInputElement,
  fileId?: string,
  parserOverride = "auto"
): void {
  const context = getViewerContext(state, monthKey, fileId);
  if (!context) {
    renderMessage(root, "Le document n'existe plus dans le stockage local.");
    return;
  }

  // Vignette PDF (previewPageDataUrl ou fallback sur embed)
  const previewUrl = context.file.previewPageDataUrl || null;

  const extractionResult = context.file.extractionResult;
  const transactions = extractionResult?.transactions ?? [];
  const visibleCategories = state.categories.filter((category) => !category.hidden);

  // Appliquer l’auto-catégorisation ET la sélection manuelle
  const categorizedTransactions = transactions.map((t, idx) => {
    const manualCat = manualCategories[idx];
    const autoResult = autoCategorizationResults[String(idx)] ?? null;
    const detectedCategoryId = autoResult?.selectedCategoryId ?? null;
    return { ...t, _autoCategoryId: detectedCategoryId, _manualCategoryId: manualCat, _autoResult: autoResult };
  });

  root.innerHTML = `
    <main class="viewer-shell">
      <div class="viewer-toolbar">
        <div>
          <p class="eyebrow">Vue détaillée V1</p>
          <h1>${escapeHtml(context.month.label)}</h1>
        </div>
        <p class="helper-text">${escapeHtml(context.file.fileName)} · ${context.file.pageCount ?? "?"} page(s)</p>
      </div>
      <div class="viewer-stack">
        <div class="pdf-preview-row pdf-preview-row--small">
          ${previewUrl
            ? `<img class="pdf-preview-img pdf-preview-img--small" src="${previewUrl}" alt="Vignette PDF" />`
            : `<embed class="pdf-frame pdf-frame--small" src="${pdfUrl}#view=FitH" type="application/pdf" />`
          }
          <button class="ghost-button" type="button" data-action="open-pdf">Ouvrir le PDF dans un nouvel onglet</button>
        </div>
        <section class="panel-card transaction-table-panel">
          <div class="panel-header-row">
            <div>
              <p class="eyebrow">Transactions détectées</p>
              <div class="transaction-panel-heading">
                <h2>${transactions.length} transaction(s)</h2>
                ${renderExtractionTimestamp(context.file)}
              </div>
            </div>
            <button
              class="ghost-button compact-button"
              type="button"
              data-action="apply-auto-categorization"
              ${transactions.length === 0 || state.categorizationRules.length === 0 || visibleCategories.length === 0 ? "disabled" : ""}
            >
              Auto-catégoriser
            </button>
          </div>
          ${renderTransactionTable(categorizedTransactions, state.categories)}
        </section>
        <details class="panel-card debug-panel debug-panel-collapsible">
          <summary class="debug-panel-summary">
            <span>
              <span class="eyebrow">Actualisation extraction</span>
              <span class="debug-panel-title">Erreurs et debug</span>
            </span>
          </summary>
          ${renderExtractionDebug(context.file, parserOverride, isSaving)}
        </details>
      </div>
    </main>
  `;

}

function renderExtractionTimestamp(file: StoredPdfFile): string {
  const rawValue = file.extractionDebug?.lastRunAt;
  if (!rawValue) {
    return "";
  }

  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatted = new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);

  return `<span class="transaction-extraction-timestamp">Extrait le ${escapeHtml(formatted)}</span>`;
}

function applyAutoCategorization(
  transactions: Array<{ description?: string | null; debit?: number | null; credit?: number | null }>,
  state: AppState,
  existingManualCategories: Record<string, string>
): {
  manualCategories: Record<string, string>;
  results: Record<string, { status: "success" | "warning"; matchedRuleIds: string[]; selectedCategoryId: string }>;
} {
  const nextManualCategories = { ...existingManualCategories };
  const results: Record<string, { status: "success" | "warning"; matchedRuleIds: string[]; selectedCategoryId: string }> = {};

  transactions.forEach((transaction, index) => {
    const matches = findAutoCategorizationMatches(transaction, state);
    if (matches.length > 0) {
      nextManualCategories[String(index)] = matches[0].categoryId;
      results[String(index)] = {
        status: matches.length > 1 ? "warning" : "success",
        matchedRuleIds: matches.map((match) => match.ruleId),
        selectedCategoryId: matches[0].categoryId
      };
    }
  });

  return {
    manualCategories: nextManualCategories,
    results
  };
}

function persistManualCategories(): void {
  try {
    localStorage.setItem(manualCatKey, JSON.stringify(manualCategories));
  } catch {}
}

function persistAutoCategorizationResults(): void {
  try {
    localStorage.setItem(autoCategorizationKey, JSON.stringify(autoCategorizationResults));
  } catch {}
}

function findAutoCategorizationMatches(
  transaction: { description?: string | null; debit?: number | null; credit?: number | null },
  state: AppState
): Array<{ ruleId: string; categoryId: string }> {
  const searchableText = buildTransactionSearchableText(transaction);
  if (!searchableText) {
    return [];
  }

  return state.categorizationRules
    .filter((rule) => {
      if (!rule.pattern?.trim()) {
        return false;
      }
      const category = state.categories.find((item) => item.id === rule.categoryId);
      if (!category || category.hidden) {
        return false;
      }
      return searchableText.includes(rule.pattern.toLowerCase());
    })
    .map((rule) => ({ ruleId: rule.id, categoryId: rule.categoryId }));
}

function buildTransactionSearchableText(transaction: {
  description?: string | null;
  debit?: number | null;
  credit?: number | null;
}): string {
  const parts = [
    transaction.description ?? "",
    stringifyAmountForMatching(transaction.debit),
    stringifyAmountForMatching(transaction.credit)
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return parts.join(" ");
}

function stringifyAmountForMatching(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const fixed = value.toFixed(2);
  const fr = value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fixed} ${fixed.replace(".", ",")} ${fr}`;
}

function renderTransactionTable(transactions: any[], categories: any[]): string {
  if (!transactions.length) {
    return `<p class="helper-text">Aucune transaction détectée.</p>`;
  }
  return `
    <table class="transaction-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Débit</th>
          <th>Crédit</th>
          <th>Solde</th>
          <th>Catégorie</th>
          <th>Commentaire</th>
        </tr>
      </thead>
      <tbody>
        ${transactions
          .map(
            (t: any, idx: number) => {
              const autoCat = categories.find((c: any) => c.id === t._autoCategoryId);
              const manualCat = categories.find((c: any) => c.id === t._manualCategoryId);
              const availableCategories = categories.filter((cat: any) => !cat.hidden || cat.id === manualCat?.id);
              const selectedCategoryId = manualCat?.id ?? autoCat?.id ?? "";
              const autoIndicator = renderAutoCategorizationIndicator(t._autoResult, categories);
              return `<tr>
                <td>${escapeHtml(t.date ?? "")}</td>
                <td>${escapeHtml(t.description ?? "")}</td>
                <td>${t.debit != null ? t.debit.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : ""}</td>
                <td>${t.credit != null ? t.credit.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : ""}</td>
                <td>${t.balance != null ? t.balance.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : ""}</td>
                <td>
                  <div class="transaction-category-cell">
                    <select data-transaction-idx="${idx}" class="transaction-category">
                      <option value="">${autoCat ? `Auto: ${escapeHtml(autoCat.label)}` : 'Non catégorisé'}</option>
                      ${availableCategories.map((cat: any) => `<option value="${cat.id}"${cat.id === selectedCategoryId ? ' selected' : ''}>${escapeHtml(cat.label)}</option>`).join("")}
                    </select>
                    ${autoIndicator}
                  </div>
                </td>
                <td>
                  <input type="text" data-transaction-idx="${idx}" class="transaction-comment" placeholder="Ajouter un commentaire..." />
                </td>
              </tr>`;
            }
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAutoCategorizationIndicator(
  autoResult: { status: "success" | "warning"; matchedRuleIds: string[]; selectedCategoryId: string } | null,
  categories: any[]
): string {
  if (!autoResult) {
    return "";
  }

  const category = categories.find((item: any) => item.id === autoResult.selectedCategoryId);
  if (autoResult.status === "warning") {
    return `<span class="auto-cat-indicator auto-cat-indicator--warning" title="Plusieurs règles ont correspondu. La première a été sélectionnée.">!</span>`;
  }

  return `<span class="auto-cat-indicator auto-cat-indicator--success" title="Auto-catégorisation appliquée${category ? `: ${escapeHtml(category.label)}` : ""}">✓</span>`;
}
function renderAnnotationsRows(
  annotations: StoredPdfAnnotation[],
  state: AppState,
  categorizedTransactions: any[],
  manualCategories: Record<string, string>
): string {
  if (annotations.length === 0) {
    return `
      <tr>
        <td colspan="3" class="viewer-empty">Aucune annotation pour le moment.</td>
      </tr>
    `;
  }

  // Afficher la catégorie (auto ou manuelle) dans l’annotation si possible
  return `
    ${annotations
      .map(
        (annotation, idx) => {
          // Chercher la catégorie manuelle ou auto pour cette annotation/transaction
          const manualCatId = manualCategories[idx];
          let catLabel = "";
          if (manualCatId) {
            const cat = state.categories.find((c: any) => c.id === manualCatId);
            catLabel = cat ? cat.label : manualCatId;
          } else {
            // fallback: auto
            const t = categorizedTransactions[idx];
            if (t && t._autoCategoryId) {
              const cat = state.categories.find((c: any) => c.id === t._autoCategoryId);
              catLabel = cat ? cat.label : t._autoCategoryId;
            }
          }
          return `
          <tr>
            <td>
              <input
                type="date"
                value="${escapeHtml(annotation.transactionDate)}"
                data-annotation-id="${annotation.id}"
                data-field="date"
              />
            </td>
            <td>
              <textarea
                rows="2"
                data-annotation-id="${annotation.id}"
                data-field="annotation"
                placeholder="Ex: Reglement facture client X"
              >${escapeHtml(annotation.annotation ?? "")}</textarea>
              <div class="annotation-category-label">Catégorie : <strong>${escapeHtml(catLabel)}</strong></div>
            </td>
            <td class="annotation-actions-col">
              <button type="button" class="ghost-button" data-action="remove-annotation" data-annotation-id="${annotation.id}">
                Supprimer
              </button>
            </td>
          </tr>
          `;
        }
      )
      .join("")}
  `;
}

function renderExtractionDebug(file: StoredPdfFile, parserOverride: string, isBusy: boolean): string {
  const extractionDebug = file.extractionDebug;
  const extractionResult = file.extractionResult;

  if (!extractionDebug && !extractionResult) {
    return '<p class="helper-text">Aucune tentative d\'actualisation enregistree.</p>';
  }

  const statusLabel = extractionDebug?.lastRunStatus ?? "inconnu";
  const statusClass = `debug-status debug-status--${statusLabel}`;
  const errorBlock = extractionDebug?.lastErrorMessage
    ? `<pre class="debug-error-block">${escapeHtml(extractionDebug.lastErrorMessage)}</pre>`
    : '<p class="helper-text">Aucune erreur sur la derniere actualisation.</p>';
  const stackBlock = extractionDebug?.lastErrorStack
    ? `<details><summary>Stack trace</summary><pre class="debug-stack-block">${escapeHtml(extractionDebug.lastErrorStack)}</pre></details>`
    : "";

  let ocrBlock = "";
  if (extractionDebug?.ocrPages && extractionDebug.ocrPages.length > 0) {
    ocrBlock = `
      <details class="debug-ocr-block">
        <summary>Texte OCR brut par page</summary>
        <ul class="ocr-page-list">
          ${extractionDebug.ocrPages
            .map(
              (page) => `
                <li><strong>Page ${page.pageNumber} :</strong><pre class="ocr-raw-text">${escapeHtml(page.text)}</pre></li>
              `
            )
            .join("")}
        </ul>
      </details>
    `;
  }

  let candidateBlock = "";
  if (extractionDebug?.candidateLines && extractionDebug.candidateLines.length > 0) {
    candidateBlock = `
      <details class="debug-candidates-block">
        <summary>Lignes candidates reconstruites</summary>
        <ul class="candidate-line-list">
          ${extractionDebug.candidateLines
            .map(
              (line) => `
                <li><strong>Page ${line.pageNumber} :</strong> <span class="candidate-line-text">${escapeHtml(line.text)}</span></li>
              `
            )
            .join("")}
        </ul>
      </details>
    `;
  }

  const parserInputBlock = extractionDebug?.parserInputText
    ? `
      <details class="debug-parser-input-block">
        <summary>Texte exact envoye au parseur</summary>
        <pre class="ocr-raw-text">${escapeHtml(extractionDebug.parserInputText)}</pre>
      </details>
    `
    : "";

  return `
    <div class="debug-content">
      <p class="${statusClass}">Statut: ${escapeHtml(statusLabel)}</p>
      ${errorBlock}
      ${stackBlock}
      <div class="debug-override-row">
        <div class="field">
          <label for="parserOverride">Parseur forcé temporaire</label>
          <select id="parserOverride" name="parserOverride">
            ${renderParserOverrideOptions(parserOverride)}
          </select>
        </div>
        <button class="ghost-button" type="button" data-action="rerun-extraction" ${isBusy ? "disabled" : ""}>
          ${isBusy ? "Actualisation..." : "Relancer l'extraction"}
        </button>
      </div>
      <dl class="debug-metadata-grid">
        <div>
          <dt>Derniere execution</dt>
          <dd>${escapeHtml(extractionDebug?.lastRunAt ?? "-")}</dd>
        </div>
        <div>
          <dt>Duree</dt>
          <dd>${extractionDebug?.lastRunDurationMs ?? 0} ms</dd>
        </div>
        <div>
          <dt>Banque detectee</dt>
          <dd>${escapeHtml(extractionDebug?.lastBankDetected ?? extractionResult?.bank ?? "-")}</dd>
        </div>
        <div>
          <dt>Parseur utilise</dt>
          <dd>${escapeHtml(extractionDebug?.lastParserDetected ?? extractionResult?.metadata.detectedTemplate ?? "-")}</dd>
        </div>
        <div>
          <dt>Raison</dt>
          <dd>${escapeHtml(extractionDebug?.lastParserReason ?? extractionResult?.metadata.detectedTemplateReason ?? "-")}</dd>
        </div>
        <div>
          <dt>Transactions</dt>
          <dd>${extractionDebug?.lastTransactionsCount ?? extractionResult?.transactions.length ?? 0}</dd>
        </div>
        <div>
          <dt>Avertissements</dt>
          <dd>${(extractionDebug?.lastWarnings ?? extractionResult?.warnings ?? []).length}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>${extractionDebug?.lastUsedOCR || extractionResult?.metadata.usedOCR ? "OCR" : "Texte"}</dd>
        </div>
      </dl>
      ${renderWarnings(extractionDebug, extractionResult)}
      ${ocrBlock}
      ${candidateBlock}
      ${parserInputBlock}
    </div>
  `;
}

function renderWarnings(extractionDebug: ExtractionDebugInfo | undefined, extractionResult: StoredPdfFile["extractionResult"]): string {
  const warnings = extractionDebug?.lastWarnings ?? extractionResult?.warnings ?? [];
  if (warnings.length === 0) {
    return '<p class="helper-text">Aucun avertissement.</p>';
  }

  return `<ul class="debug-warning-list">${warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("")}</ul>`;
}

function renderParserOverrideOptions(currentValue: string): string {
  return [
    ["auto", "Auto"],
    ["bmo-mastercard-ocr", "BMO Mastercard OCR"],
    ["bmo-ocr", "BMO OCR"],
    ["bmo-standard", "BMO Standard"]
  ]
    .map(([value, label]) => `<option value="${value}" ${currentValue === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function getViewerContext(
  state: AppState,
  monthKey?: string | null,
  fileId?: string | null
): { month: { label: string }; file: StoredPdfFile } | null {
  if (fileId) {
    const file = state.pdfFiles[fileId];
    if (!file) {
      return null;
    }

    const monthlyItem =
      state.bankStatements.expectedMonths.find((item) => item.fileId === fileId) ??
      state.creditCardStatements.expectedMonths.find((item) => item.fileId === fileId);
    const supplementalItem =
      state.invoices.items.find((item) => item.fileId === fileId) ??
      state.otherCommunications.items.find((item) => item.fileId === fileId);
    const month = monthlyItem
      ? { label: monthlyItem.label }
      : { label: supplementalItem?.fileName ?? file.fileName };

    return { month, file };
  }

  if (!monthKey) {
    return null;
  }

  const month = state.bankStatements.expectedMonths.find((item) => item.monthKey === monthKey);
  if (!month || !month.fileId) {
    const creditCardMonth = state.creditCardStatements.expectedMonths.find((item) => item.monthKey === monthKey);
    if (!creditCardMonth?.fileId) {
      return null;
    }
    const file = state.pdfFiles[creditCardMonth.fileId];
    return file ? { month: creditCardMonth, file } : null;
  }

  const file = state.pdfFiles[month.fileId];
  if (!file) {
    return null;
  }

  return { month, file };
}

async function runExtractionWithDiagnostics(
  file: File,
  isProtectedPdf: boolean,
  parserTemplateOverride: string | null
): Promise<{ extractionResult: StoredPdfFile["extractionResult"]; extractionDebug: StoredPdfFile["extractionDebug"] }> {
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
        lastParserDetected: parserTemplateOverride,
        lastParserReason: parserTemplateOverride ? "Selection manuelle temporaire du parseur." : null,
        lastUsedOCR: false
      }
    };
  }

  const ocrEngine = new TesseractOcrEngine({ language: "fra+eng" });

  try {
    const extractionResult = await runExtractionPipeline(file, {
      ocrEngine,
      parserTemplateOverride
    });

    let ocrPages: Array<{ pageNumber: number; text: string }> = [];
    if (extractionResult && extractionResult.metadata.usedOCR) {
      const { inspectPdf } = await import("../../modules/pdf-inspection/pdf-inspector");
      const inspection = await inspectPdf(file);
      const { renderPdfToImages } = await import("../../modules/pdf-rendering/pdf-renderer");
      const renderedPages = await renderPdfToImages(file, {
        includePageNumbers: inspection.pages.map((page: { pageNumber: number }) => page.pageNumber)
      });
      const { runOcrOnRenderedPages } = await import("../../modules/ocr/ocr-service");
      const ocrResults = await runOcrOnRenderedPages(renderedPages, ocrEngine);
      ocrPages = ocrResults.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.tokens.map((token) => token.text).join(" ").replace(/\s+/g, " ").trim()
      }));
    }

    let candidateLines: Array<{ pageNumber: number; text: string }> = [];
    try {
      const textPages = await extractTextTokensFromPdf(file);
      const syntheticOcrPages =
        ocrPages.length > 0
          ? ocrPages.map((page) => ({
              pageNumber: page.pageNumber,
              tokens: [{ text: page.text, x: 0, y: 0, width: 0, height: 0, confidence: 1 }]
            }))
          : [];
      const layout = analyzeLayout({ textPages, ocrPages: syntheticOcrPages });
      candidateLines = layout.lines.map((line) => ({ pageNumber: line.pageNumber, text: line.text }));
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
        lastErrorMessage: error instanceof Error ? error.message : String(error),
        lastErrorStack: error instanceof Error ? error.stack : undefined,
        lastWarnings: ["L'actualisation de l'extraction a echoue."],
        lastTransactionsCount: 0,
        lastBankDetected: null,
        lastParserDetected: parserTemplateOverride,
        lastParserReason: parserTemplateOverride ? "Selection manuelle temporaire du parseur." : null,
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

function renderMessage(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <main class="viewer-shell">
      <div class="viewer-stage">
        <div class="viewer-toolbar">
          <div>
            <p class="eyebrow">Vue détaillée</p>
            <h1>Document bancaire</h1>
          </div>
        </div>
        <p class="viewer-empty">${escapeHtml(message)}</p>
      </div>
    </main>
  `;
}

function createPdfObjectUrl(base64Data: string): string {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
