/**
 * Tirage du tableau (docs/adr/0045) : modes, graine, ex aequo et non classés d'un tableau au
 * rang d'entrée, emplacements sur la grille.
 */
import { describe, expect, it } from 'vitest';
import {
  drawBlocks,
  drawTableau,
  isTableauDrawSeed,
  mulberry32,
  tableauDrawModeOf,
  tableauDrawNotes,
  tableauDrawStateOf,
  type TableauDrawEntry,
} from './tableauDraw';
import { planTableau, tableauEmplacements } from './tableauCalculations';
import { FencerStatus, type Fencer, type PoolRanking } from '../../types';

const entries = (n: number): TableauDrawEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, entryRank: i + 1 }));
const ids = (n: number) => entries(n).map(e => e.id);
const SEED = 20261128;

describe('mulberry32 (générateur du domaine, sans état global)', () => {
  it('même graine, même suite ; graines différentes, suites différentes', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
    for (const x of sa) expect(x >= 0 && x < 1).toBe(true);
  });

  it('graine : entier de 0 à 2³² − 1', () => {
    expect(isTableauDrawSeed(0)).toBe(true);
    expect(isTableauDrawSeed(4294967295)).toBe(true);
    expect(isTableauDrawSeed(4294967296)).toBe(false);
    expect(isTableauDrawSeed(-1)).toBe(false);
    expect(isTableauDrawSeed(1.5)).toBe(false);
  });
});

describe('drawTableau : modes (ADR-0045, Décision « Modes de tirage »)', () => {
  it('strict : placement au rang, emplacement k = rang k', () => {
    const r = drawTableau(entries(8), { mode: 'strict', seed: SEED });
    expect(r.order).toEqual(ids(8));
    expect(r.slots).toEqual(ids(8));
    expect(r.emplacements).toEqual({ f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8 });
  });

  it('paires : chaque paire 1-2, 3-4… reste sur ses deux emplacements ; emplacements attendus', () => {
    const r = drawTableau(entries(8), { mode: 'pairs', seed: SEED });
    for (let k = 0; k < 8; k += 2)
      expect(new Set([r.slots[k], r.slots[k + 1]])).toEqual(new Set([`f${k + 1}`, `f${k + 2}`]));
    expect(r.slots).toEqual(PAIRS_8);
    // Ordre d'entrée inchangé : le tirage attribue des emplacements, pas des rangs
    expect(r.order).toEqual(ids(8));
  });

  it('groupes : 1 et 2 placés, puis 3-4, 5-8, 9-16 sur les emplacements de leur groupe', () => {
    const r = drawTableau(entries(16), { mode: 'groups', seed: SEED });
    expect(r.slots.slice(0, 2)).toEqual(['f1', 'f2']);
    expect(new Set(r.slots.slice(2, 4))).toEqual(new Set(['f3', 'f4']));
    expect(new Set(r.slots.slice(4, 8))).toEqual(new Set(['f5', 'f6', 'f7', 'f8']));
    expect(new Set(r.slots.slice(8, 16))).toEqual(new Set(ids(16).slice(8)));
    expect(r.slots).toEqual(GROUPS_16);
  });

  it('intégral : tous les qualifiés tirés sur les emplacements 1 à N', () => {
    const r = drawTableau(entries(8), { mode: 'random', seed: SEED });
    expect([...r.slots].sort()).toEqual([...ids(8)].sort());
    expect(r.slots).toEqual(RANDOM_8);
  });

  it('byes jamais tirés : seuls les emplacements 1 à N, groupe tronqué et paire seule laissée', () => {
    expect(drawBlocks('pairs', 7)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(drawBlocks('groups', 6)).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(drawBlocks('random', 5)).toEqual([[0, 1, 2, 3, 4]]);
    expect(drawBlocks('strict', 8)).toEqual([]);
    const r = drawTableau(entries(7), { mode: 'pairs', seed: SEED });
    expect(r.slots[6]).toBe('f7');
  });

  it('même graine, même tirage ; autre graine, autre tirage', () => {
    for (const mode of ['pairs', 'groups', 'random'] as const) {
      const a = drawTableau(entries(16), { mode, seed: 7 });
      const b = drawTableau(entries(16), { mode, seed: 7 });
      expect(b).toEqual(a);
    }
    const seeds = new Set(
      [1, 2, 3, 4, 5].map(seed => drawTableau(entries(16), { mode: 'random', seed }).slots.join())
    );
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe('drawTableau : tableau au rang d’entrée (non classés et ex aequo tirés)', () => {
  const field: TableauDrawEntry[] = [
    { id: 'a', entryRank: 1 },
    { id: 'b', entryRank: 2 },
    { id: 'c', entryRank: 2 },
    { id: 'd', entryRank: 2 },
    { id: 'e', entryRank: 5 },
    { id: 'u1', entryRank: null },
    { id: 'u2', entryRank: null },
    { id: 'u3', entryRank: null },
  ];

  it('classés par rang, ex aequo départagés par tirage, non classés ensuite dans un ordre tiré', () => {
    const r = drawTableau(field, { mode: 'strict', seed: SEED, byEntryRank: true });
    expect(r.order[0]).toBe('a');
    expect(new Set(r.order.slice(1, 4))).toEqual(new Set(['b', 'c', 'd']));
    expect(r.order[4]).toBe('e');
    expect(new Set(r.order.slice(5))).toEqual(new Set(['u1', 'u2', 'u3']));
    // Mode strict compris : emplacements = ordre tiré
    expect(r.slots).toEqual(r.order);
    expect(r.order).toEqual(ENTRY_ORDER);
    expect(r.notes).toEqual({
      b: 'tie',
      c: 'tie',
      d: 'tie',
      u1: 'unranked',
      u2: 'unranked',
      u3: 'unranked',
    });
  });

  it('le tirage de l’ordre dépend de la graine', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map(seed =>
        drawTableau(field, { mode: 'strict', seed, byEntryRank: true }).order.join()
      )
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('échelles distinctes (équipes) : rangs égaux de deux échelles non ex aequo', () => {
    const teams: TableauDrawEntry[] = [
      { id: 't1', entryRank: 3, tier: 0 },
      { id: 't2', entryRank: 3, tier: 1 },
    ];
    expect(tableauDrawNotes(teams, true)).toEqual({});
    expect(drawTableau(teams, { mode: 'strict', seed: 1, byEntryRank: true }).order).toEqual([
      't1',
      't2',
    ]);
  });

  it('après des poules : ordre d’entrée inchangé, aucune mention', () => {
    const r = drawTableau(field, { mode: 'strict', seed: SEED });
    expect(r.order).toEqual(field.map(e => e.id));
    expect(r.notes).toEqual({});
  });
});

describe('lecture du mode et du tirage enregistré', () => {
  it('mode inconnu ou absent : strict', () => {
    expect(tableauDrawModeOf(undefined)).toBe('strict');
    expect(tableauDrawModeOf('nope')).toBe('strict');
    expect(tableauDrawModeOf('pairs')).toBe('pairs');
  });
  it('état illisible : null', () => {
    expect(tableauDrawStateOf(null)).toBeNull();
    expect(tableauDrawStateOf({ mode: 'pairs', seed: -1, order: [] })).toBeNull();
    expect(tableauDrawStateOf({ mode: 'pairs', seed: 3, at: 'x', order: ['a'] })).toEqual({
      mode: 'pairs',
      seed: 3,
      at: 'x',
      order: ['a'],
    });
  });
});

const fencer = (i: number, ranking?: number): Fencer =>
  ({
    id: `f${i}`,
    firstName: `P${i}`,
    lastName: `N${i}`,
    status: FencerStatus.CHECKED_IN,
    ...(ranking !== undefined ? { ranking } : {}),
  }) as unknown as Fencer;
const rankingOf = (n: number): PoolRanking[] =>
  Array.from({ length: n }, (_, i) => ({
    fencer: fencer(i + 1),
    rank: i + 1,
    victories: 0,
    defeats: 0,
    matchesPlayed: 0,
    touchesScored: 0,
    touchesReceived: 0,
    index: 0,
    ratio: 0,
  })) as PoolRanking[];

describe('planTableau avec tirage : grille unique, rang d’entrée gardé (seedA, seedB)', () => {
  it('sans tirage et en strict : même tableau', () => {
    const opts = { playAllPositions: false, thirdPlaceMatch: false };
    const plain = planTableau(rankingOf(12), opts);
    const strict = planTableau(rankingOf(12), opts, { mode: 'strict', seed: SEED });
    expect(strict.matches).toEqual(plain.matches);
  });

  it('paires : emplacements permutés, seedA / seedB = rang d’entrée du tireur', () => {
    const plan = planTableau(
      rankingOf(16),
      { playAllPositions: false, thirdPlaceMatch: false },
      { mode: 'pairs', seed: SEED }
    );
    const first = plan.matches.filter(m => m.round === 16);
    for (const m of first) {
      expect(m.seedA).toBe(Number(m.fencerA!.id.slice(1)));
      expect(m.seedB).toBe(Number(m.fencerB!.id.slice(1)));
    }
    // Emplacements relus sur la grille = ceux du tirage
    expect(tableauEmplacements(plan.matches)).toEqual(plan.draw!.emplacements);
  });

  it('byes inchangés : avec 12 qualifiés, les emplacements 13 à 16 restent vides', () => {
    const plan = planTableau(
      rankingOf(12),
      { playAllPositions: false, thirdPlaceMatch: false },
      { mode: 'random', seed: SEED }
    );
    expect(plan.size).toBe(16);
    expect(plan.matches.filter(m => m.round === 16 && m.isBye)).toHaveLength(4);
    expect(Object.values(plan.draw!.emplacements).every(k => k <= 12)).toBe(true);
    expect(tableauEmplacements(plan.matches)).toEqual(plan.draw!.emplacements);
  });

  it('« toutes les places » : barrages gardés, emplacements relus barrages compris', () => {
    const plan = planTableau(
      rankingOf(10),
      { playAllPositions: true, thirdPlaceMatch: true },
      { mode: 'random', seed: SEED }
    );
    expect(plan.matches.filter(m => m.round === 16)).toHaveLength(2);
    expect(tableauEmplacements(plan.matches)).toEqual(plan.draw!.emplacements);
  });

  it('au rang d’entrée : non classés tirés, rangs renumérotés dans l’ordre tiré', () => {
    const ranking = rankingOf(6).map((r, i) => ({
      ...r,
      fencer: fencer(i + 1, i < 2 ? i + 1 : undefined),
    }));
    const plan = planTableau(
      ranking,
      { playAllPositions: false, thirdPlaceMatch: false },
      {
        mode: 'strict',
        seed: SEED,
        entryRankOf: r => r.fencer.ranking ?? null,
      }
    );
    expect(plan.qualified.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.qualified.slice(0, 2).map(r => r.fencer.id)).toEqual(['f1', 'f2']);
    expect(Object.values(plan.draw!.notes).filter(n => n === 'unranked')).toHaveLength(4);
    const seeds = new Map(
      plan.matches
        .filter(m => m.round === 8)
        .flatMap(m => [
          [m.fencerA?.id, m.seedA],
          [m.fencerB?.id, m.seedB],
        ])
    );
    plan.qualified.forEach(r => expect(seeds.get(r.fencer.id)).toBe(r.rank));
  });
});

// Emplacements attendus à graine fixe (régression : le générateur ne doit pas changer)
const PAIRS_8 = ['f1', 'f2', 'f4', 'f3', 'f6', 'f5', 'f8', 'f7'];
const GROUPS_16 = [
  'f1',
  'f2',
  'f3',
  'f4',
  'f7',
  'f8',
  'f6',
  'f5',
  'f14',
  'f13',
  'f9',
  'f10',
  'f15',
  'f11',
  'f12',
  'f16',
];
const RANDOM_8 = ['f6', 'f5', 'f7', 'f4', 'f1', 'f3', 'f2', 'f8'];
const ENTRY_ORDER = ['a', 'c', 'b', 'd', 'e', 'u3', 'u1', 'u2'];
