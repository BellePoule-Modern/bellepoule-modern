/**
 * BPM - Escrime - PV de tirage du tableau, document HTML imprimable (docs/adr/0045)
 * Mise en page du PV construit par le domaine (`tableauDrawReport`) ; libellés fournis par
 * l'écran (langue de l'interface). Toute donnée passe par escHtml ; imprimé par les services de
 * plateforme (ADR-0021, `usePlatform().print`).
 * Licensed under GPL-3.0
 */
import { BASE_CSS } from './core';
import { escapeHtml as escHtml } from '../escapeHtml';
import type { TableauDrawReport } from '../../domain/tableau/tableauDrawReport';
import type { TableauDrawMode } from '../../domain/tableau/tableauDraw';

export interface TableauDrawReportLabels {
  title: string;
  competition: string;
  date: string;
  tableau: string;
  group: string;
  drawnAt: string;
  printedAt: string;
  mode: string;
  seed: string;
  modes: Record<TableauDrawMode, string>;
  rank: string;
  name: string;
  affiliation: string;
  emplacement: string;
  note: string;
  unranked: string;
  tie: string;
  /** Mise en forme d'une heure ISO (langue de l'interface) */
  formatDateTime: (iso: string) => string;
}

export function generateTableauDrawReportHTML(
  report: TableauDrawReport,
  labels: TableauDrawReportLabels
): string {
  const kv = (label: string, value: string) =>
    `<tr><th>${escHtml(label)}</th><td>${escHtml(value)}</td></tr>`;
  const rows = report.rows
    .map(
      r => `<tr>
        <td class="num">${r.rank}</td>
        <td>${escHtml(r.name)}</td>
        <td>${escHtml(r.affiliation)}</td>
        <td class="num">${r.emplacement ?? ''}</td>
        <td>${escHtml(r.note === 'unranked' ? labels.unranked : r.note === 'tie' ? labels.tie : '')}</td>
      </tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(labels.title)}</title>
<style>${BASE_CSS}
  table.kv th { text-align: left; padding-right: 1rem; }
  table.pv { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  table.pv th, table.pv td { border: 1px solid #999; padding: 4px 6px; }
  td.num { text-align: right; }
</style></head>
<body>
  <h1>${escHtml(labels.title)}</h1>
  <table class="kv">
    ${kv(labels.competition, report.title)}
    ${report.date ? kv(labels.date, report.date) : ''}
    ${kv(labels.tableau, String(report.size))}
    ${report.group ? kv(labels.group, report.group) : ''}
    ${kv(labels.drawnAt, report.drawnAt ? labels.formatDateTime(report.drawnAt) : '')}
    ${kv(labels.mode, labels.modes[report.mode])}
    ${kv(labels.seed, String(report.seed))}
    ${kv(labels.printedAt, labels.formatDateTime(report.printedAt))}
  </table>
  <table class="pv" data-testid="tableau-draw-rows">
    <thead><tr>
      <th>${escHtml(labels.rank)}</th><th>${escHtml(labels.name)}</th>
      <th>${escHtml(labels.affiliation)}</th><th>${escHtml(labels.emplacement)}</th>
      <th>${escHtml(labels.note)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}
