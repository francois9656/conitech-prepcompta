import type { BankStatementMonthItem, MonthlyDocumentSectionKey } from "../domain/models";
import { formatStatus, pluralizePages } from "../utils/formatters";

interface MonthStatusCardOptions {
  sectionKey: MonthlyDocumentSectionKey;
  isInlineViewerOpen?: boolean;
  inlineViewerUrl?: string;
  isRefreshingExtraction?: boolean;
  isBusy?: boolean;
  busyLabel?: string;
  categorizationSummary?: string;
}

export function renderMonthStatusCard(item: BankStatementMonthItem, options?: MonthStatusCardOptions): string {
  const metadata = item.fileName
    ? `<p class="month-meta">${item.fileName} · ${pluralizePages(item.pageCount)}</p>`
    : item.missingReason
      ? `<p class="month-meta">Raison : ${item.missingReason}</p>`
      : '<p class="month-meta">Aucun document importé</p>';

  const actions = item.fileId
    ? `
      <button class="ghost-button" data-action="view" data-month-key="${item.monthKey}">Voir</button>
      <button class="ghost-button" data-action="refresh-extraction" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}" ${options?.isBusy ? "disabled" : ""}>Actualisé</button>
      <button class="ghost-button" data-action="delete-pdf" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}">Supprimer</button>
    `
    : item.status === "missing_justified"
      ? `
        <button class="ghost-button" data-action="edit-missing" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}">Modifier</button>
        <button class="ghost-button" data-action="clear-missing" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}">Retirer</button>
      `
      : `
        <button class="primary-button" data-action="add-pdf" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}">Ajouter PDF</button>
        <button class="ghost-button" data-action="mark-missing" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}">Document manquant</button>
      `;

  const dropZone = item.fileId
    ? ""
    : `
      <div class="drop-zone" data-section-key="${options?.sectionKey}" data-month-key="${item.monthKey}">
        <p class="drop-zone-title">Déposer un PDF ici pour ajouter</p>
        <p class="helper-text">Format accepté: PDF. Import rapide sans quitter le side panel.</p>
      </div>
    `;

  const inlineViewer =
    item.fileId && options?.isInlineViewerOpen && options.inlineViewerUrl
      ? `
      <div class="month-inline-viewer-wrap">
        <iframe class="month-inline-viewer" src="${options.inlineViewerUrl}" title="Apercu PDF ${item.label}"></iframe>
      </div>
    `
      : "";

  return `
    <article class="panel-card month-card" data-section-key="${options?.sectionKey}" data-status="${item.status}" data-month-key="${item.monthKey}" data-file-id="${item.fileId ?? ""}">
      <div class="panel-header-row">
        <div class="month-heading-group">
          <div class="month-title-row">
            <h3>${item.label}</h3>
            <p class="status-pill ${options?.isBusy ? "status-pill--busy" : ""}" data-status="${item.status}">${escapeHtml(
              options?.isBusy ? options.busyLabel ?? "Traitement en cours" : formatStatus(item.status)
            )}</p>
            ${
              options?.categorizationSummary
                ? `<span class="categorization-indicator" title="${escapeHtml(options.categorizationSummary)}" aria-label="${escapeHtml(options.categorizationSummary)}">
                    <svg class="categorization-indicator-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M7 3.75h7.5l4.75 4.75v11a1.75 1.75 0 0 1-1.75 1.75h-10A1.75 1.75 0 0 1 5.75 19.5v-14A1.75 1.75 0 0 1 7.5 3.75Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                      <path d="M14.5 3.75V8.5h4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                      <path d="M8.75 12h6.5M8.75 15.5h6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    </svg>
                  </span>`
                : ""
            }
          </div>
        </div>
      </div>
      ${metadata}
      ${dropZone}
      <div class="actions-row">
        ${actions.replaceAll('data-action="view" data-month-key', `data-action="view" data-section-key="${options?.sectionKey}" data-month-key`)}
      </div>
      ${inlineViewer}
    </article>
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
