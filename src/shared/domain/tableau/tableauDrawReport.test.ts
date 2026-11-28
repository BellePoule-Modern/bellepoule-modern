/**
 * PV de tirage du tableau (docs/adr/0045) : épreuve, tableau et groupe, heure du tirage, mode et
 * graine, une ligne par qualifié (rang d'entrée, nom, club, emplacement, mention) ; heure
 * d'édition injectée ; document HTML échappé.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { tableauDrawReport } from './tableauDrawReport';
import { generateTableauDrawReportHTML } from '../../utils/pdfExport/tableauDrawPdf';

const input = {
  competition: { title: 'Coupe <test>', date: '2026-12-06', weapon: 'E' },
  size: 8,
  group: 'F',
  draw: {
    mode: 'pairs' as const,
    seed: 123,
    at: '2026-11-28T09:00:00.000Z',
    order: ['a', 'b', 'c', 'u'],
  },
  entrants: [
    { id: 'a', name: 'ALPHA Anne', affiliation: 'Paris', entryRank: 1 },
    { id: 'b', name: 'BRAVO Béa', affiliation: 'Lyon', entryRank: 2 },
    { id: 'c', name: 'CHARLIE Cléa', affiliation: 'FRA', entryRank: 2 },
    { id: 'u', name: 'UNIFORM Ugo', affiliation: null, entryRank: null },
  ],
  emplacements: { a: 1, b: 3, c: 2, u: 4 },
  byEntryRank: true,
};
const NOW = new Date('2026-11-28T10:30:00.000Z');

describe('tableauDrawReport (domaine, heure injectée)', () => {
  it('en-tête : épreuve, tableau, groupe, heure du tirage, mode, graine, heure d’édition', () => {
    const r = tableauDrawReport(input, NOW);
    expect(r).toMatchObject({
      title: 'Coupe <test>',
      size: 8,
      group: 'F',
      mode: 'pairs',
      seed: 123,
      drawnAt: '2026-11-28T09:00:00.000Z',
      printedAt: '2026-11-28T10:30:00.000Z',
    });
  });

  it('lignes : rang d’entrée tiré, nom, club ou nation, emplacement, mentions', () => {
    expect(tableauDrawReport(input, NOW).rows).toEqual([
      { rank: 1, id: 'a', name: 'ALPHA Anne', affiliation: 'Paris', emplacement: 1, note: null },
      { rank: 2, id: 'b', name: 'BRAVO Béa', affiliation: 'Lyon', emplacement: 3, note: 'tie' },
      { rank: 3, id: 'c', name: 'CHARLIE Cléa', affiliation: 'FRA', emplacement: 2, note: 'tie' },
      { rank: 4, id: 'u', name: 'UNIFORM Ugo', affiliation: '', emplacement: 4, note: 'unranked' },
    ]);
  });

  it('après des poules : aucune mention', () => {
    const rows = tableauDrawReport({ ...input, byEntryRank: false }, NOW).rows;
    expect(rows.every(r => r.note === null)).toBe(true);
  });

  it('document HTML : données échappées, mentions et graine présentes', () => {
    const html = generateTableauDrawReportHTML(tableauDrawReport(input, NOW), {
      title: 'PV de tirage',
      competition: 'Épreuve',
      date: 'Date',
      tableau: 'Tableau de',
      group: 'Groupe',
      drawnAt: 'Tirage',
      printedAt: 'Édité',
      mode: 'Mode',
      seed: 'Graine',
      modes: { strict: 'Strict', pairs: 'Par paires', groups: 'Par groupes', random: 'Intégral' },
      rank: 'Rang',
      name: 'Nom',
      affiliation: 'Club',
      emplacement: 'Emplacement',
      note: 'Mention',
      unranked: 'non classé · tiré au sort',
      tie: 'départagé par tirage',
      formatDateTime: iso => iso,
    });
    const doc = new JSDOM(html).window.document;
    expect(doc.body.textContent).toContain('Coupe <test>');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.body.textContent).toContain('Par paires');
    expect(doc.body.textContent).toContain('123');
    const rows = [...doc.querySelectorAll('[data-testid="tableau-draw-rows"] tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent?.trim())
    );
    expect(rows[3]).toEqual(['4', 'UNIFORM Ugo', '', '4', 'non classé · tiré au sort']);
    expect(rows[1][4]).toBe('départagé par tirage');
  });
});
