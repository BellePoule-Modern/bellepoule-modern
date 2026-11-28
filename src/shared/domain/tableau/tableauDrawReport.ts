/**
 * BPM - Escrime - PV de tirage du tableau (#1948, lot 1, docs/adr/0045)
 * Construit à partir de l'état (tirage enregistré `tableauDraw`, emplacements du tableau tiré)
 * et des inscrits (tireurs ou équipes). Porte l'épreuve, le tableau et son groupe, la date et
 * l'heure du tirage, le mode et la graine, puis pour chaque qualifié : rang d'entrée, nom, club
 * (ou nation), emplacement et mention « non classé · tiré au sort » ou « départagé par tirage ».
 * Domaine pur : l'heure d'édition est injectée.
 * Licensed under GPL-3.0
 */
import {
  tableauDrawNotes,
  type TableauDrawMode,
  type TableauDrawNote,
  type TableauDrawState,
} from './tableauDraw';

/** Inscrit du tableau : tireur ou équipe */
export interface TableauDrawEntrant {
  id: string;
  name: string;
  /** Club, ou nation */
  affiliation?: string | null;
  /** Rang d'entrée saisi (tableau au rang d'entrée) ; null : non classé */
  entryRank?: number | null;
  /** Échelle du rang (équipes : saisi 0, calculé 1) */
  tier?: number;
}

export interface TableauDrawReportInput {
  competition: { title: string; date?: string | null; weapon?: string; category?: string };
  /** Taille du tableau (tableau de 16…) */
  size: number;
  /** Groupe d'un tableau séparé ; null : tableau unique */
  group: string | null;
  draw: TableauDrawState;
  entrants: readonly TableauDrawEntrant[];
  /** Emplacement de chaque qualifié dans la grille du tableau tiré */
  emplacements: Readonly<Record<string, number>>;
  /** Tableau au rang d'entrée (sans poule) : mentions des non classés et des ex aequo */
  byEntryRank: boolean;
}

export interface TableauDrawReportRow {
  /** Rang d'entrée dans l'ordre tiré */
  rank: number;
  id: string;
  name: string;
  affiliation: string;
  /** null : emplacement inconnu (tireur retiré du tableau depuis) */
  emplacement: number | null;
  note: TableauDrawNote | null;
}

export interface TableauDrawReport {
  title: string;
  date: string | null;
  weapon: string | null;
  category: string | null;
  size: number;
  group: string | null;
  mode: TableauDrawMode;
  seed: number;
  /** Heure du tirage (ISO) */
  drawnAt: string;
  /** Heure d'édition du PV (ISO, injectée) */
  printedAt: string;
  rows: TableauDrawReportRow[];
}

/** PV de tirage (ADR-0045) : une ligne par qualifié, dans l'ordre d'entrée tiré */
export function tableauDrawReport(input: TableauDrawReportInput, now: Date): TableauDrawReport {
  const byId = new Map(input.entrants.map(e => [e.id, e]));
  const inDraw = input.draw.order.flatMap(id => byId.get(id) ?? []);
  const notes = tableauDrawNotes(
    inDraw.map(e => ({ id: e.id, entryRank: e.entryRank ?? null, tier: e.tier })),
    input.byEntryRank
  );
  return {
    title: input.competition.title,
    date: input.competition.date ?? null,
    weapon: input.competition.weapon ?? null,
    category: input.competition.category ?? null,
    size: input.size,
    group: input.group,
    mode: input.draw.mode,
    seed: input.draw.seed,
    drawnAt: input.draw.at,
    printedAt: now.toISOString(),
    rows: input.draw.order.map((id, i) => {
      const e = byId.get(id);
      return {
        rank: i + 1,
        id,
        name: e?.name ?? id,
        affiliation: e?.affiliation ?? '',
        emplacement: input.emplacements[id] ?? null,
        note: notes[id] ?? null,
      };
    }),
  };
}
