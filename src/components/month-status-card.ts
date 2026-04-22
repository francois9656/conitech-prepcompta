import type { BankStatementMonthItem } from "../domain/models";
import { formatStatus, pluralizePages } from "../utils/formatters";

export function renderMonthStatusCard(item: BankStatementMonthItem): string {
  const metadata = item.fileName
    ? `<p class="month-meta">${item.fileName} · ${pluralizePages(item.pageCount)}</p>`
    : item.missingReason
      ? `<p class="month-meta">Raison : ${item.missingReason}</p>`
      : '<p class="month-meta">Aucun document importé</p>';

  const actions = item.fileId
    ? `
      <button class="ghost-button" data-action="view" data-month-key="${item.monthKey}">Voir</button>
      <button class="ghost-button" data-action="delete-pdf" data-month-key="${item.monthKey}">Supprimer</button>
    `
    : item.status === "missing_justified"
      ? `
        <button class="ghost-button" data-action="edit-missing" data-month-key="${item.monthKey}">Modifier</button>
        <button class="ghost-button" data-action="clear-missing" data-month-key="${item.monthKey}">Retirer</button>
      `
      : `
        <button class="primary-button" data-action="add-pdf" data-month-key="${item.monthKey}">Ajouter PDF</button>
        <button class="ghost-button" data-action="mark-missing" data-month-key="${item.monthKey}">Document manquant</button>
      `;

  const dropZoneLabel = item.fileId ? "Document deja associe" : "Déposer un PDF ici pour ajouter";
  const dropZoneHelp = item.fileId
    ? "Supprimez d'abord le document actuel avant d'en ajouter un nouveau."
    : "Format accepté: PDF. Import rapide sans quitter le side panel.";

  return `
    <article class="panel-card month-card" data-status="${item.status}" data-month-key="${item.monthKey}">
      <div class="panel-header-row">
        <div>
          <h3>${item.label}</h3>
          <p class="status-pill" data-status="${item.status}">${formatStatus(item.status)}</p>
        </div>
      </div>
      ${metadata}
      <div class="drop-zone" data-month-key="${item.monthKey}">
        <p class="drop-zone-title">${dropZoneLabel}</p>
        <p class="helper-text">${dropZoneHelp}</p>
      </div>
      <div class="actions-row">
        ${actions}
      </div>
    </article>
  `;
}
