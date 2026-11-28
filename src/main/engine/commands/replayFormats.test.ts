/**
 * Critère d'acceptation de #2100 (docs/adr/0024, lot N) : un test de rejeu par format.
 * Chaque épreuve est jouée de bout en bout par les seules commandes du moteur (aucune écriture
 * de l'écran), puis compareWithState(projectCompetition(journal), état) ne rend aucun écart :
 * tableaux séparés (deux groupes), épreuve séparée (splitOffGroup), relais FIE, arène Sabre
 * Laser. Retraits compris (withdrawFencer, tous formats). Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon, type Competition } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import type { CommandContext } from './context';
import { listMatches } from './sport';
import { teamStateView } from './teams';
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

const call = (op: string, input: Record<string, unknown>) =>
  invoke(ctx, op as never, input as never) as Promise<any>;

/** Journal rejoué comparé à l'état : bloc de session, tables des équipes, statuts des tireurs */
function divergences(competitionId: string) {
  const comp = db.getCompetition(competitionId)!;
  const facts = projectCompetition(db.eventLog.getSince(competitionId));
  const session = (db.getSessionState(competitionId) ?? {}) as Record<string, unknown>;
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  const state = {
    ...stateView(session, comp.settings),
    ...(comp.isTeamEvent ? { teams: teamStateView(ctx, comp) } : {}),
  };
  return { complete: facts.complete, divergences: compareWithState(facts, state, statuses) };
}

/**
 * L'écran n'écrit plus rien : le bloc de session d'une épreuve par équipes ne porte que le
 * tirage du tableau, écrit par le moteur (docs/adr/0045)
 */
const noScreenSession = (competitionId: string) => {
  const session = db.getSessionState(competitionId) as Record<string, unknown> | null;
  expect(session === null ? [] : Object.keys(session)).toEqual(
    session === null ? [] : ['tableauDraw']
  );
};

// ─── Épreuves individuelles ─────────────────────────────────────────────────

/** Épreuve mixte à tableaux séparés : n tireuses et n tireurs, poules communes */
function splitCompetition(perGroup: number): Competition {
  const comp = db.createCompetition({
    title: 'Tableaux séparés',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon: Weapon.EPEE,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
      postPoolSplitCriteria: 'gender',
    } as never,
  });
  for (let i = 0; i < perGroup * 2; i++) {
    db.addFencer(comp.id, {
      lastName: `NOM${i}`,
      firstName: `P${i}`,
      gender: i % 2 === 0 ? Gender.FEMALE : Gender.MALE,
      club: ['Paris', 'Lyon', 'Nice', 'Lille'][i % 4],
      ranking: i + 1,
      status: FencerStatus.CHECKED_IN,
    });
  }
  return comp;
}

/** Joue tous les matchs prêts d'un type (A gagne), jusqu'à épuisement */
async function playAll(competitionId: string, kind: 'pool' | 'bracket') {
  for (let guard = 0; guard < 200; guard++) {
    const ready = listMatches(ctx, competitionId, { state: 'ready' }).filter(
      m => m.kind === kind && m.fencerA && m.fencerB
    );
    if (ready.length === 0) return;
    for (const [i, m] of ready.entries()) {
      await call('recordScore', {
        competitionId,
        matchId: m.matchId,
        scoreA: kind === 'pool' ? 5 : 15,
        scoreB: i % 4,
      });
    }
  }
}

async function poolsPlayed(perGroup: number) {
  const comp = splitCompetition(perGroup);
  await call('generatePools', { competitionId: comp.id, poolCount: 2 });
  await playAll(comp.id, 'pool');
  return comp;
}

/** Premier match de tableau prêt d'un groupe (identifiant préfixé par le groupe) */
const readyBracketMatch = (competitionId: string, group?: string) =>
  listMatches(ctx, competitionId, { state: 'ready' }).find(
    m => m.kind === 'bracket' && m.fencerA && m.fencerB && (!group || m.matchId.startsWith(group))
  )!;

// ─── Épreuves par équipes ───────────────────────────────────────────────────

function teamCompetition(weapon: Weapon, settings: Record<string, unknown> = {}): Competition {
  return db.createCompetition({
    title: 'Coupe par équipes',
    date: new Date('2026-12-06'),
    location: 'Gymnase',
    weapon,
    gender: Gender.MIXED,
    category: Category.SENIOR,
    isTeamEvent: true,
    settings: {
      ...buildDefaultCompetitionSettings({ weapon: Weapon.EPEE, category: Category.SENIOR }),
      minTeamSize: 3,
      ...settings,
    } as never,
  });
}

/** Équipes inscrites et composées par les commandes : 3 titulaires et un remplaçant */
async function teamsRegistered(competitionId: string, count: number) {
  const ids: string[] = [];
  for (let t = 0; t < count; t++) {
    const { team } = await call('registerTeam', { competitionId, name: `Équipe ${t + 1}` });
    ids.push(team.id);
    for (let k = 1; k <= 4; k++) {
      const fencerId = db.addFencer(competitionId, {
        lastName: `T${t}F${k}`,
        firstName: 'P',
        status: FencerStatus.CHECKED_IN,
      }).id;
      await call('assignTeamFencer', {
        competitionId,
        teamId: team.id,
        fencerId,
        teamOrder: k,
        isReserve: k === 4,
      });
    }
  }
  return ids;
}

const allTeamMatches = (competitionId: string) => [
  ...db.getTeamMatchesByCompetition(competitionId),
  ...db.getTeamTableauMatches(competitionId, competitionId),
];

/**
 * Joue les rencontres prêtes, relais par relais (3-1 pour l'équipe A : jamais d'égalité),
 * jusqu'à ce que toutes soient terminées ; au tableau, le moteur crée les suivantes.
 */
async function playTeamMatches(competitionId: string) {
  for (let guard = 0; guard < 500; guard++) {
    const open = allTeamMatches(competitionId).filter(
      m => m.status !== 'finished' && m.teamAId && m.teamBId && m.bouts.length > 0
    );
    if (open.length === 0) return;
    const m = open[0];
    const relay = m.bouts.filter(b => b.status === 'finished').length + 1;
    await call('recordRelayScore', { competitionId, matchId: m.id, relay, scoreA: 3, scoreB: 1 });
  }
  throw new Error('rencontres sans fin');
}

d('rejeu par format (docs/adr/0024, critère d’acceptation de #2100)', () => {
  it('tableaux séparés, deux groupes : poules, tableau de chaque groupe, retrait, sans écart', async () => {
    const comp = await poolsPlayed(8);
    await call('generateTableau', { competitionId: comp.id, group: 'F' });
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    // Retrait au tableau d'un groupe : l'adversaire passe (docs/adr/0016, 0024)
    const m = readyBracketMatch(comp.id, 'M');
    await call('withdrawFencer', {
      competitionId: comp.id,
      fencerId: m.fencerA!.id,
      reason: 'abandon',
      matchId: m.matchId,
    });
    await playAll(comp.id, 'bracket');

    const session = db.getSessionState(comp.id) as Record<string, any>;
    expect(Object.keys(session.groupTableaux).sort()).toEqual(['F', 'M']);
    expect(session.tableauMatches).toEqual([]);
    const types = db.eventLog.getSince(comp.id).map(e => e.type);
    expect(types.filter(t => t === 'TableauCompleted')).toHaveLength(2);
    expect(types).toContain('FencerWithdrawn');
    expect(divergences(comp.id)).toEqual({ complete: true, divergences: [] });
  });

  it('épreuve séparée : groupe extrait, tableau joué dans chaque épreuve, sans écart', async () => {
    const comp = await poolsPlayed(8);
    const { competitionId: targetId } = await call('splitOffGroup', {
      competitionId: comp.id,
      group: 'F',
      title: 'Coupe – Dames',
    });
    // Épreuve séparée : un seul tableau, sans groupe
    await call('generateTableau', { competitionId: targetId });
    await playAll(targetId, 'bracket');
    // Épreuve d'origine : le groupe restant
    await call('generateTableau', { competitionId: comp.id, group: 'M' });
    await playAll(comp.id, 'bracket');

    expect(db.eventLog.getSince(targetId)[0].type).toBe('SplitRankingImported');
    expect(divergences(targetId)).toEqual({ complete: true, divergences: [] });
    expect(divergences(comp.id)).toEqual({ complete: true, divergences: [] });
  });

  it('relais FIE : poule, retrait et réintégration, remplaçant, tableau jusqu’à la finale, sans écart', async () => {
    const comp = teamCompetition(Weapon.SABRE);
    const ids = await teamsRegistered(comp.id, 4);
    noScreenSession(comp.id);
    await call('generateTeamPools', { competitionId: comp.id });
    // Retrait d'un tireur d'équipe : statut seul, rencontres inchangées, réintégré (§3). Après
    // le tirage : un retrait journalisé avant le premier fait (TeamPoolsGenerated) rendrait le
    // journal incomplet, comme un retrait à l'appel d'une épreuve individuelle
    const reserve = db.getTeamsByCompetition(comp.id)[0].fencers.find(f => f.isReserve)!;
    const relaysBefore = allTeamMatches(comp.id);
    await call('withdrawFencer', {
      competitionId: comp.id,
      fencerId: reserve.fencerId,
      reason: 'forfait',
    });
    expect(allTeamMatches(comp.id)).toEqual(relaysBefore);
    expect(divergences(comp.id)).toEqual({ complete: true, divergences: [] });
    await call('reinstateFencer', { competitionId: comp.id, fencerId: reserve.fencerId });

    const [first] = db.getTeamMatchesByCompetition(comp.id);
    // Relais 1 joué, rouvert, rejoué ; remplaçant entré
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: first.id,
      relay: 1,
      scoreA: 3,
      scoreB: 1,
    });
    await call('reopenRelay', { competitionId: comp.id, matchId: first.id });
    const teamId = ids.includes(first.teamAId) ? first.teamAId : first.teamBId;
    const out = db.teams
      .getTeamMatch(first.id)!
      .bouts.find(b => b.status !== 'finished' && b.boutOrder > 1)!;
    await call('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: first.id,
      teamId,
      outFencerId: teamId === first.teamAId ? out.fencerAId : out.fencerBId,
    });
    await playTeamMatches(comp.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    await playTeamMatches(comp.id);

    const tableau = db.getTeamTableauMatches(comp.id, comp.id);
    expect(tableau.map(m => m.round).sort()).toEqual([1, 2, 2]);
    expect(tableau.every(m => m.status === 'finished')).toBe(true);
    const types = new Set(db.eventLog.getSince(comp.id).map(e => e.type));
    for (const type of [
      'FencerWithdrawn',
      'FencerReinstated',
      'TeamPoolsGenerated',
      'RelayReopened',
      'TeamFencerSubstituted',
      'TeamTableauGenerated',
      'TeamMatchDecided',
    ]) {
      expect(types, type).toContain(type);
    }
    noScreenSession(comp.id);
    expect(divergences(comp.id)).toEqual({ complete: true, divergences: [] });
  });

  it('arène Sabre Laser : calendrier de 8 équipes, tableau jusqu’à la finale, sans écart', async () => {
    const comp = teamCompetition(Weapon.LASER, { teamFormat: 'laser-arena' });
    await teamsRegistered(comp.id, 8);
    await call('generateTeamPools', { competitionId: comp.id });
    expect(db.getTeamMatchesByCompetition(comp.id)).toHaveLength(12);
    await playTeamMatches(comp.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    await playTeamMatches(comp.id);

    const tableau = db.getTeamTableauMatches(comp.id, comp.id);
    expect(tableau.length).toBeGreaterThan(0);
    expect(tableau.every(m => m.status === 'finished')).toBe(true);
    expect(tableau.some(m => m.round === 1)).toBe(true);
    noScreenSession(comp.id);
    expect(divergences(comp.id)).toEqual({ complete: true, divergences: [] });
  });
});
