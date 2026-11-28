/**
 * Tirage du tableau individuel par le moteur (docs/adr/0045) : mode de la formule, graine tirée
 * ou reçue, aperçu rejouable, refus de la composition de l'écran, tableau au rang d'entrée
 * (skipPools : ex aequo et non classés tirés), état `tableauDraw`, journal et projection, verrou
 * S6. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import {
  planTableau,
  tableauEmplacements,
} from '../../../shared/domain/tableau/tableauCalculations';
import { tableauComposition } from '../../../shared/domain/tableau/tableauComposition';
import type { PoolRanking } from '../../../shared/types';
import type { CommandContext } from './context';
import { listMatches } from './sport';
import { invoke } from '../api/engine';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

const d = hasNodeSqlite ? describe : describe.skip;

let db: DatabaseManager;
let ctx: CommandContext;

beforeEach(async () => {
  db = new DatabaseManager(':memory:');
  await db.open(':memory:');
  ctx = { db, emitChange: () => {} };
});
afterEach(() => db.close());

type Session = Record<string, any>;
const session = (id: string) => (db.getSessionState(id) ?? {}) as Session;
const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;
const events = (id: string) => db.eventLog.getSince(id);
const lastOf = (id: string, type: string) =>
  events(id)
    .filter(e => e.type === type)
    .slice(-1)[0] as any;

function setup(
  count: number,
  ranking: (i: number) => number | undefined = i => i + 1,
  split = false
) {
  const weapon = Weapon.EPEE;
  const comp = db.createCompetition({
    title: 'Tirage',
    date: new Date('2026-12-06'),
    weapon,
    gender: split ? Gender.MIXED : Gender.MALE,
    category: Category.SENIOR,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }),
      ...(split ? { postPoolSplitCriteria: 'gender' } : {}),
    } as never,
  });
  for (let i = 0; i < count; i++) {
    const r = ranking(i);
    db.addFencer(comp.id, {
      lastName: `NOM${String(i).padStart(2, '0')}`,
      firstName: `P${i}`,
      gender: split ? (i % 2 === 0 ? Gender.FEMALE : Gender.MALE) : Gender.MALE,
      club: ['Paris', 'Lyon', 'Nice', 'Lille'][i % 4],
      ...(r !== undefined ? { ranking: r } : {}),
      status: FencerStatus.CHECKED_IN,
    });
  }
  return comp;
}

async function setDraw(competitionId: string, draw: string | null) {
  await call('updateCompetitionFormula', {
    competitionId,
    operations: [{ op: 'setPhase', phase: 'tableau', settings: { draw } }],
  });
}

async function playPools(competitionId: string) {
  for (let guard = 0; guard < 200; guard++) {
    const ready = listMatches(ctx, competitionId, { state: 'ready' }).filter(
      m => m.kind === 'pool'
    );
    if (ready.length === 0) return;
    for (const [i, m] of ready.entries())
      await call('recordScore', { competitionId, matchId: m.matchId, scoreA: 5, scoreB: i % 4 });
  }
}

async function poolsPlayed(count: number, split = false) {
  const comp = setup(count, i => i + 1, split);
  await call('generatePools', { competitionId: comp.id, poolCount: 2 });
  await playPools(comp.id);
  return comp;
}

function divergences(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return { facts, gaps: compareWithState(facts, stateView(session(competitionId)), statuses) };
}

/** Rang d'entrée par tireur, lu sur le premier tour (seedA, seedB) */
const seedsOf = (matches: any[], size: number) =>
  new Map<string, number>(
    matches
      .filter(m => m.round === size || m.round === size * 2)
      .flatMap((m): Array<[string, number]> => [
        [m.fencerA?.id, m.seedA],
        [m.fencerB?.id, m.seedB],
      ])
      .filter(([id]) => !!id)
  );

d('generateTableau : tirage du mode de la formule (ADR-0045)', () => {
  it('paires : graine tirée, emplacements par paire, seedA/seedB = rang d’entrée, état et journal', async () => {
    const comp = await poolsPlayed(12);
    await setDraw(comp.id, 'pairs');
    const out = await call('generateTableau', { competitionId: comp.id });
    expect(out.draw.mode).toBe('pairs');
    expect(Number.isInteger(out.draw.seed)).toBe(true);
    expect(out.draw.seed).toBeGreaterThanOrEqual(0);
    expect(out.draw.seed).toBeLessThanOrEqual(0xffffffff);
    const s = session(comp.id);
    const ranking = s.overallRanking as PoolRanking[];
    const rankOf = new Map(ranking.map(r => [r.fencer.id, r.rank]));
    // Rang d'entrée gardé : seedA / seedB = rang du classement
    const seeds = seedsOf(s.tableauMatches, out.size);
    for (const [id, seed] of seeds) expect(seed).toBe(rankOf.get(id));
    // Chaque paire de rangs 1-2, 3-4… sur ses deux emplacements
    const at = tableauEmplacements(s.tableauMatches);
    for (const [id, k] of Object.entries(at)) {
      const r = rankOf.get(id)!;
      expect(Math.ceil(k / 2)).toBe(Math.ceil(r / 2));
    }
    // État de session et journal : { mode, seed, at, order }
    expect(s.tableauDraw).toMatchObject({ mode: 'pairs', seed: out.draw.seed });
    expect(typeof s.tableauDraw.at).toBe('string');
    expect(s.tableauDraw.order).toEqual(ranking.map(r => r.fencer.id));
    const ev = lastOf(comp.id, 'TableauGenerated');
    expect(ev.payload.draw).toEqual({
      mode: 'pairs',
      seed: out.draw.seed,
      order: s.tableauDraw.order,
    });
    // Projection : le tirage est rejoué, sans écart
    const { facts, gaps } = divergences(comp.id);
    expect(facts.tableau?.draw).toEqual(ev.payload.draw);
    expect(gaps).toEqual([]);
    // État : getCompetitionState expose le tirage
    const state = (await call('getCompetitionState', { competitionId: comp.id })).state;
    expect(state.tableauDraw).toMatchObject({ mode: 'pairs', seed: out.draw.seed });
  });

  it('aperçu puis tirage avec la graine de l’aperçu : même tableau ; même graine, même tirage', async () => {
    const comp = await poolsPlayed(12);
    await setDraw(comp.id, 'random');
    const preview = await call('generateTableau', { competitionId: comp.id, dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.draw.mode).toBe('random');
    expect(session(comp.id).tableauMatches ?? []).toEqual([]);
    const real = await call('generateTableau', {
      competitionId: comp.id,
      seed: preview.draw.seed,
    });
    expect(real.draw).toEqual(preview.draw);
    expect(real.firstRound).toEqual(preview.firstRound);
    const again = await call('generateTableau', {
      competitionId: comp.id,
      seed: preview.draw.seed,
      replace: true,
      dryRun: true,
    });
    expect(again.firstRound).toEqual(real.firstRound);
  });

  it('graine hors bornes refusée par le contrat', async () => {
    const comp = await poolsPlayed(8);
    await expect(
      call('generateTableau', { competitionId: comp.id, seed: 2 ** 32 })
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refus de la composition de l’écran : mode autre que strict (invalid_composition)', async () => {
    const comp = await poolsPlayed(8);
    const ranking = session(comp.id).overallRanking as PoolRanking[];
    const plan = planTableau(ranking, { playAllPositions: false, thirdPlaceMatch: false });
    const composition = tableauComposition(plan.matches);
    // Strict après des poules : le chemin de l'écran reste
    const ok = await call('generateTableau', { competitionId: comp.id, composition });
    expect(ok.draw.mode).toBe('strict');
    expect(session(comp.id).tableauDraw.order).toEqual(plan.qualified.map(r => r.fencer.id));
    await setDraw(comp.id, null);
    await call('clearTableau', { competitionId: comp.id });
    await setDraw(comp.id, 'groups');
    await expect(
      call('generateTableau', { competitionId: comp.id, composition, replace: true })
    ).rejects.toMatchObject({ code: 'invalid_composition' });
  });

  it('strict sans formule : tableau identique au placement strict (épreuve existante)', async () => {
    const comp = await poolsPlayed(12);
    const ranking = session(comp.id).overallRanking as PoolRanking[];
    const out = await call('generateTableau', { competitionId: comp.id });
    expect(out.draw.mode).toBe('strict');
    const plan = planTableau(ranking, { playAllPositions: false, thirdPlaceMatch: false });
    expect(tableauComposition(session(comp.id).tableauMatches)).toEqual(
      tableauComposition(plan.matches)
    );
  });

  it('clearTableau efface le tirage ; un nouveau tirage tire une nouvelle graine', async () => {
    const comp = await poolsPlayed(8);
    await setDraw(comp.id, 'random');
    await call('generateTableau', { competitionId: comp.id, seed: 7 });
    expect(session(comp.id).tableauDraw.seed).toBe(7);
    await call('clearTableau', { competitionId: comp.id });
    expect(session(comp.id)).not.toHaveProperty('tableauDraw');
    expect(divergences(comp.id).gaps).toEqual([]);
    const next = await call('generateTableau', { competitionId: comp.id });
    expect(session(comp.id).tableauDraw.seed).toBe(next.draw.seed);
  });

  it('tableaux séparés : tirage rangé avec le tableau du groupe', async () => {
    const comp = await poolsPlayed(10, true);
    await setDraw(comp.id, 'pairs');
    const f = await call('generateTableau', { competitionId: comp.id, group: 'F', seed: 11 });
    expect(f.draw).toEqual({ mode: 'pairs', seed: 11 });
    const s = session(comp.id);
    expect(s.groupTableaux.F.tableauDraw).toMatchObject({ mode: 'pairs', seed: 11 });
    expect(s).not.toHaveProperty('tableauDraw');
    expect(lastOf(comp.id, 'TableauGenerated').payload).toMatchObject({
      group: 'F',
      draw: { mode: 'pairs', seed: 11 },
    });
    const state = (await call('getCompetitionState', { competitionId: comp.id })).state;
    expect(state.groupTableaux.F.tableauDraw).toMatchObject({ seed: 11 });
    expect(divergences(comp.id).gaps).toEqual([]);
    await call('clearTableau', { competitionId: comp.id, group: 'F' });
    expect(session(comp.id).groupTableaux.F).not.toHaveProperty('tableauDraw');
  });

  it('journal : un tirage différent de l’état est un écart (tableau_draw)', async () => {
    const comp = await poolsPlayed(8);
    await call('generateTableau', { competitionId: comp.id, seed: 3 });
    const s = session(comp.id);
    db.saveSessionState(comp.id, { ...s, tableauDraw: { ...s.tableauDraw, seed: 4 } });
    expect(divergences(comp.id).gaps.map(g => g.kind)).toEqual(['tableau_draw']);
  });

  it('S6 : draw verrouillé une fois le tableau tiré', async () => {
    const comp = await poolsPlayed(8);
    await setDraw(comp.id, 'pairs');
    await setDraw(comp.id, 'groups');
    await call('generateTableau', { competitionId: comp.id });
    await expect(setDraw(comp.id, 'random')).rejects.toMatchObject({ code: 'invalid_settings' });
    await expect(setDraw(comp.id, null)).rejects.toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('mode de tirage'),
    });
  });
});

d('tableau au rang d’entrée : skipPools puis tirage (ADR-0045)', () => {
  // Rangs : 1, 2, 2, 2, 5, puis 3 non classés
  const RANKS = [2, undefined, 1, 2, 5, undefined, 2, undefined];

  it('skipPools range par rang puis par nom ; fencerIds ne sert qu’à choisir', async () => {
    const comp = setup(8, i => RANKS[i]);
    const all = db.getFencersByCompetition(comp.id);
    await call('skipPools', {
      competitionId: comp.id,
      fencerIds: [...all.map(f => f.id)].reverse(),
    });
    const order = (session(comp.id).overallRanking as PoolRanking[]).map(r => r.fencer.lastName);
    expect(order).toEqual(['NOM02', 'NOM00', 'NOM03', 'NOM06', 'NOM04', 'NOM01', 'NOM05', 'NOM07']);
    expect(lastOf(comp.id, 'PoolsSkipped').payload.fencerIds).toEqual(
      (session(comp.id).overallRanking as PoolRanking[]).map(r => r.fencer.id)
    );
  });

  it('strict compris : ex aequo et non classés tirés avec la graine ; composition refusée', async () => {
    const comp = setup(8, i => RANKS[i]);
    await call('skipPools', { competitionId: comp.id });
    const byName = new Map(db.getFencersByCompetition(comp.id).map(f => [f.lastName, f.id]));
    const ranking = session(comp.id).overallRanking as PoolRanking[];
    const plan = planTableau(ranking, { playAllPositions: false, thirdPlaceMatch: false });
    await expect(
      call('generateTableau', {
        competitionId: comp.id,
        composition: tableauComposition(plan.matches),
      })
    ).rejects.toMatchObject({ code: 'invalid_composition' });

    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const out = await call('generateTableau', { competitionId: comp.id, seed, replace: true });
      expect(out.draw).toEqual({ mode: 'strict', seed });
      const s = session(comp.id);
      const order: string[] = s.tableauDraw.order;
      orders.add(order.join());
      expect(order[0]).toBe(byName.get('NOM02'));
      expect(new Set(order.slice(1, 4))).toEqual(
        new Set(['NOM00', 'NOM03', 'NOM06'].map(n => byName.get(n)))
      );
      expect(order[4]).toBe(byName.get('NOM04'));
      expect(new Set(order.slice(5))).toEqual(
        new Set(['NOM01', 'NOM05', 'NOM07'].map(n => byName.get(n)))
      );
      // seedA / seedB : rang d'entrée dans l'ordre tiré
      const seeds = seedsOf(s.tableauMatches, out.size);
      order.forEach((id, i) => expect(seeds.get(id)).toBe(i + 1));
      expect(divergences(comp.id).gaps).toEqual([]);
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
