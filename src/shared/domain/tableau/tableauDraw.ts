/**
 * BPM - Escrime - Tirage du tableau (#1948, lot 1, docs/adr/0045)
 * Fonction pure : qualifiés dans l'ordre d'entrée, mode de tirage, graine (0 à 2³² − 1) →
 * ordre d'entrée retenu et emplacements de la grille. Le générateur (mulberry32) vit ici, sans
 * état global : à graine, mode et qualifiés égaux, le tirage est identique. Le tirage attribue
 * des emplacements, pas des rangs ; la grille reste `generateSeedingChart` (le tirage ne fait que
 * permuter les entrées sur ses emplacements 1 à N, byes et taille inchangés). Domaine pur : ni
 * heure ni hasard global.
 * Licensed under GPL-3.0
 */

/** Mode de tirage d'un tableau (formule, `TableauPhase.draw`) ; absent : strict */
export type TableauDrawMode = 'strict' | 'pairs' | 'groups' | 'random';

/** Modes de tirage, dans l'ordre de l'éditeur */
export const TABLEAU_DRAW_MODES: readonly TableauDrawMode[] = [
  'strict',
  'pairs',
  'groups',
  'random',
] as const;

/** Plus grande graine admise (2³² − 1) */
export const MAX_TABLEAU_DRAW_SEED = 0xffffffff;

/** Graine valide : entier de 0 à 2³² − 1 */
export const isTableauDrawSeed = (seed: unknown): seed is number =>
  typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= MAX_TABLEAU_DRAW_SEED;

/**
 * Tirage d'un tableau tel qu'il est enregistré (état de session `tableauDraw`, journal) :
 * `order` est la liste des identifiants dans l'ordre d'entrée tiré ; `at` : heure du tirage
 */
export interface TableauDrawState {
  mode: TableauDrawMode;
  seed: number;
  at: string;
  order: string[];
}

/** Générateur mulberry32 : suite déterministe de nombres dans [0, 1[ pour une graine */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange de Fisher-Yates, sur une copie */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Qualifié à tirer : identifiant, rang d'entrée (null : non classé). `tier` sépare deux
 * échelles qui ne se comparent pas (équipes : rang saisi, puis rang calculé, ADR-0044) ; deux
 * qualifiés sont ex aequo à rang d'entrée et échelle égaux.
 */
export interface TableauDrawEntry {
  id: string;
  entryRank: number | null;
  tier?: number;
}

/** Mention du PV : non classé tiré au sort, ou ex aequo départagé par tirage */
export type TableauDrawNote = 'unranked' | 'tie';

export interface TableauDrawResult {
  /** Identifiants dans l'ordre d'entrée retenu (rang d'entrée 1 d'abord) */
  order: string[];
  /** Identifiant par emplacement : `slots[k - 1]` occupe l'emplacement k de la grille */
  slots: string[];
  /** Emplacement de chaque qualifié */
  emplacements: Record<string, number>;
  /** Qualifiés dont l'ordre doit tout au tirage (tableau au rang d'entrée seulement) */
  notes: Record<string, TableauDrawNote>;
}

const ranked = (e: TableauDrawEntry): boolean =>
  typeof e.entryRank === 'number' && Number.isFinite(e.entryRank) && e.entryRank > 0;

const sameStanding = (a: TableauDrawEntry, b: TableauDrawEntry): boolean =>
  (a.tier ?? 0) === (b.tier ?? 0) && a.entryRank === b.entryRank;

/**
 * Mentions du PV d'un tableau au rang d'entrée (ADR-0045) : non classé (tiré au sort à la
 * suite des classés) ; ex aequo d'entrée (départagé par tirage). Vide après des poules.
 */
export function tableauDrawNotes(
  entries: readonly TableauDrawEntry[],
  byEntryRank: boolean
): Record<string, TableauDrawNote> {
  const notes: Record<string, TableauDrawNote> = {};
  if (!byEntryRank) return notes;
  const classed = entries.filter(ranked);
  for (const e of entries) {
    if (!ranked(e)) notes[e.id] = 'unranked';
    else if (classed.some(o => o.id !== e.id && sameStanding(o, e))) notes[e.id] = 'tie';
  }
  return notes;
}

/**
 * Ordre d'entrée d'un tableau au rang d'entrée (sans poule, ADR-0045) : classés par échelle puis
 * rang d'entrée, ex aequo départagés par tirage ; non classés ensuite, dans un ordre tiré.
 */
function entryOrder(entries: readonly TableauDrawEntry[], rng: () => number): TableauDrawEntry[] {
  const classed = entries
    .map((e, i) => ({ e, i }))
    .filter(x => ranked(x.e))
    .sort(
      (a, b) =>
        (a.e.tier ?? 0) - (b.e.tier ?? 0) ||
        (a.e.entryRank as number) - (b.e.entryRank as number) ||
        a.i - b.i
    )
    .map(x => x.e);
  const out: TableauDrawEntry[] = [];
  for (let i = 0; i < classed.length;) {
    let j = i + 1;
    while (j < classed.length && sameStanding(classed[i], classed[j])) j++;
    const group = classed.slice(i, j);
    out.push(...(group.length > 1 ? shuffled(group, rng) : group));
    i = j;
  }
  out.push(
    ...shuffled(
      entries.filter(e => !ranked(e)),
      rng
    )
  );
  return out;
}

/**
 * Groupes d'emplacements tirés ensemble (indices 0 à n − 1), selon le mode :
 * strict, aucun ; paires 1-2, 3-4… ; groupes 3-4, 5-8, 9-16… (1 et 2 placés) ; intégral, tous.
 * Les emplacements au-delà de n (byes) ne sont jamais tirés.
 */
export function drawBlocks(mode: TableauDrawMode, n: number): number[][] {
  const range = (from: number, to: number) =>
    Array.from({ length: Math.max(0, Math.min(to, n) - from) }, (_, k) => from + k);
  const blocks: number[][] = [];
  if (mode === 'pairs') for (let k = 0; k < n; k += 2) blocks.push(range(k, k + 2));
  else if (mode === 'groups') for (let lo = 2; lo < n; lo *= 2) blocks.push(range(lo, lo * 2));
  else if (mode === 'random') blocks.push(range(0, n));
  return blocks.filter(b => b.length > 1);
}

/**
 * Tirage du tableau (ADR-0045). `entries` : qualifiés dans l'ordre d'entrée ; `byEntryRank` :
 * tableau au rang d'entrée (sans poule) : ex aequo et non classés tirés d'abord, avec la même
 * graine, quel que soit le mode (`'strict'` compris). Puis les emplacements selon le mode.
 */
export function drawTableau(
  entries: readonly TableauDrawEntry[],
  options: { mode: TableauDrawMode; seed: number; byEntryRank?: boolean }
): TableauDrawResult {
  const rng = mulberry32(options.seed);
  const ordered = options.byEntryRank ? entryOrder(entries, rng) : [...entries];
  const order = ordered.map(e => e.id);
  const slots = [...order];
  for (const block of drawBlocks(options.mode, order.length)) {
    const drawn = shuffled(
      block.map(k => order[k]),
      rng
    );
    block.forEach((k, i) => {
      slots[k] = drawn[i];
    });
  }
  const emplacements: Record<string, number> = {};
  slots.forEach((id, k) => {
    emplacements[id] = k + 1;
  });
  return {
    order,
    slots,
    emplacements,
    notes: tableauDrawNotes(entries, !!options.byEntryRank),
  };
}

/**
 * Le moteur tire le tableau, l'écran n'envoie plus de placement (docs/adr/0045) : mode autre
 * que strict, ou tableau au rang d'entrée (sans poule). Règle unique de l'écran et du moteur.
 */
export const engineDrawRequired = (mode: TableauDrawMode, byEntryRank: boolean): boolean =>
  mode !== 'strict' || byEntryRank;

/** Mode de tirage lu (formule, journal, état) : valeur inconnue ou absente → strict */
export function tableauDrawModeOf(value: unknown): TableauDrawMode {
  return TABLEAU_DRAW_MODES.includes(value as TableauDrawMode)
    ? (value as TableauDrawMode)
    : 'strict';
}

/** Tirage enregistré lu dans l'état de session ; null : absent ou illisible */
export function tableauDrawStateOf(value: unknown): TableauDrawState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<TableauDrawState>;
  if (!isTableauDrawSeed(v.seed) || !Array.isArray(v.order)) return null;
  return {
    mode: tableauDrawModeOf(v.mode),
    seed: v.seed,
    at: typeof v.at === 'string' ? v.at : '',
    order: v.order.filter((id): id is string => typeof id === 'string'),
  };
}

/** Tireur rangé au rang d'entrée : classement saisi (absent ou ≤ 0 : non classé), nom */
export interface EntryRankedFencer {
  id: string;
  ranking?: number | null;
  lastName?: string;
  firstName?: string;
}

/**
 * Classement initial d'une épreuve sans poules (`skipPools`, ADR-0045) : par rang d'entrée, puis
 * par nom ; non classés à la suite, au nom. Le départage des ex aequo et l'ordre des non classés
 * reviennent au tirage du tableau (`drawTableau`, `byEntryRank`).
 */
export function sortByEntryRank<T extends EntryRankedFencer>(fencers: readonly T[]): T[] {
  const rank = (f: T) =>
    typeof f.ranking === 'number' && Number.isFinite(f.ranking) && f.ranking > 0
      ? f.ranking
      : Infinity;
  const name = (f: T) => `${f.lastName ?? ''} ${f.firstName ?? ''}`.trim();
  return [...fencers].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return name(a).localeCompare(name(b), 'fr') || a.id.localeCompare(b.id);
  });
}
