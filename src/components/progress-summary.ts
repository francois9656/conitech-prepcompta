import type { BankStatementsSectionState } from "../domain/models";
import { toProgressRatio } from "../utils/formatters";

export function renderProgressSummary(state: BankStatementsSectionState): string {
  const total = state.expectedMonths.length;
  const ratio = toProgressRatio(state.completedCount, total);

  return `
    <section class="panel-card panel-card--accent">
      <div class="panel-header-row">
        <div>
          <p class="eyebrow">Progression</p>
          <h2>Relevés bancaires</h2>
        </div>
        <strong class="progress-value">${ratio}%</strong>
      </div>
      <div class="progress-bar" aria-hidden="true">
        <span style="width: ${ratio}%"></span>
      </div>
      <dl class="stats-grid">
        <div>
          <dt>Mois attendus</dt>
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
    </section>
  `;
}
