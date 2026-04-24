import type { MonthlyDocumentSectionState } from "../domain/models";
import { toProgressRatio } from "../utils/formatters";

type ProgressSummaryState = Pick<MonthlyDocumentSectionState, "expectedMonths" | "completedCount" | "unresolvedCount">;

export function renderProgressSummary(state: ProgressSummaryState, title: string): string {
  const total = state.expectedMonths.length;
  const ratio = toProgressRatio(state.completedCount, total);
  const completedLabel = `${state.completedCount} document${state.completedCount > 1 ? "s" : ""} sur ${total} complété${state.completedCount > 1 ? "s" : ""}`;

  return `
    <details class="panel-card panel-card--accent progress-summary-card" open>
      <summary class="progress-summary-header">
        <span>
          <span class="progress-summary-title-row">
            <span class="progress-summary-title">${title}</span>
            <span class="progress-summary-inline">(${completedLabel})</span>
          </span>
        </span>
        <strong class="progress-value">${ratio}%</strong>
      </summary>
      <div class="progress-bar" aria-hidden="true">
        <span style="width: ${ratio}%"></span>
      </div>
      <dl class="stats-grid">
        <div>
          <dt>Attendus</dt>
          <dd>${total}</dd>
        </div>
        <div>
          <dt>Complétés</dt>
          <dd>${state.completedCount}</dd>
        </div>
        <div>
          <dt>En attente</dt>
          <dd>${state.unresolvedCount}</dd>
        </div>
      </dl>
    </details>
  `;
}
