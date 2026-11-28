/**
 * Épreuves par équipes dans la formule v2 par le moteur (docs/adr/0044, étape G0) : rang
 * d'entrée (registerTeam, updateTeam, carton noir P), poules d'équipes et tableau lus dans la
 * formule, règle de rencontre par phase, contrôle des remplaçants, classement final dans
 * getCompetitionState. Base SQLite réelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseManager } from '../../../database';
import { hasNodeSqlite } from '../../../database/testing/nodeSqliteDatabase';
import { Category, FencerStatus, Gender, Weapon } from '../../../shared/types';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { compareWithState, stateView } from '../../../shared/domain/journal/compareWithState';
import {
  phaseSettings,
  type FormulaV2,
  type TeamMatchRule,
} from '../../../shared/domain/formula/formulaV2';
import { CONTRACT_MCP_TOOLS } from '../api/mcpAdapter';
import type { CommandContext } from './context';
import { teamStateView } from './teams';
import { matchRelayRule } from './teamRelays';
import { invoke } from '../api/engine';
import {
  computeTeamFinalRanking,
  generateTeamRankingHTML,
  generateTeamTableauHTML,
} from '../../../shared/utils/pdfExport/teamPdf';

vi.mock('better-sqlite3-multiple-ciphers', async () => ({
  default: (await import('../../../database/testing/nodeSqliteDatabase')).NodeSqliteDatabase,
}));

// Lecture des phases par phaseSettings (ADR-0036 : une seule entrée pour les lecteurs) : espion
vi.mock('../../../shared/domain/formula/formulaV2', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../shared/domain/formula/formulaV2')>();
  return { ...actual, phaseSettings: vi.fn(actual.phaseSettings) };
});

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
const reject = (op: string, input: Record<string, unknown>) => expect(call(op, input)).rejects;
const events = (id: string) => db.eventLog.getSince(id);
const revision = (id: string) => db.eventLog.getRevision(id);
const stateOf = async (id: string) =>
  (await call('getCompetitionState', { competitionId: id })).state;
const match = (id: string) => db.teams.getTeamMatch(id)!;

const RULE: TeamMatchRule = { starters: 3, reserves: 1, relayStep: 5, relayOrder: 'fie' };

function competition(weapon = Weapon.EPEE, settings: Record<string, unknown> = {}) {
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

/** Formule d'équipe : un tour de poules (facultatif) puis un tableau */
function teamFormula(
  opts: {
    pool?: Record<string, unknown> | null;
    tableau?: Record<string, unknown>;
    rule?: Partial<TeamMatchRule>;
  } = {}
): FormulaV2 {
  const phases: FormulaV2['phases'] = [];
  if (opts.pool !== null)
    phases.push({
      kind: 'pool',
      id: 'pool-1',
      sizeMin: 3,
      sizeMax: 4,
      // Bornes du tour de poules (1 à 15) ; la cible d'une rencontre vient de la règle
      maxScore: 15,
      timerSeconds: 180,
      qualification: { mode: 'all' },
      seeding: 'previous_round',
      boutOrder: 'fie',
      ...(opts.pool ?? {}),
    } as never);
  phases.push({
    kind: 'tableau',
    id: 'tableau',
    maxScore: 45,
    timerSeconds: 180,
    thirdPlace: false,
    allPlaces: false,
    ...(opts.tableau ?? {}),
  } as never);
  return { version: 2, phases, general: { teamMatch: { ...RULE, ...opts.rule } } };
}

let fencerSeq = 0;
const fencer = (competitionId: string, name: string, ranking?: number) =>
  db.addFencer(competitionId, {
    lastName: name,
    firstName: `P${fencerSeq++}`,
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
    ...(ranking !== undefined ? { ranking } : {}),
  } as never).id;

/** Équipes inscrites : `titulars` titulaires et `reserves` remplaçant(s) chacune */
async function teamsRegistered(
  competitionId: string,
  teams: Array<string | { name: string; ranking?: number; club?: string; fencerRanks?: number[] }>,
  titulars = 3,
  reserves = 1
) {
  const ids: string[] = [];
  for (const t of teams) {
    const spec = typeof t === 'string' ? { name: t } : t;
    const { team } = await call('registerTeam', {
      competitionId,
      name: spec.name,
      ...(spec.club ? { club: spec.club } : {}),
      ...(spec.ranking ? { ranking: spec.ranking } : {}),
    });
    ids.push(team.id);
    for (let k = 1; k <= titulars + reserves; k++) {
      await call('assignTeamFencer', {
        competitionId,
        teamId: team.id,
        fencerId: fencer(competitionId, `${spec.name}${k}`, spec.fencerRanks?.[k - 1]),
        teamOrder: k,
        isReserve: k > titulars,
      });
    }
  }
  return ids;
}

/** Journal rejoué comparé aux tables des équipes */
function divergences(competitionId: string) {
  const facts = projectCompetition(events(competitionId));
  const comp = db.getCompetition(competitionId)!;
  const statuses = Object.fromEntries(
    db.getFencersByCompetition(competitionId).map(f => [f.id, f.status as string])
  );
  return compareWithState(
    facts,
    { ...stateView({}, comp.settings), teams: teamStateView(ctx, comp) },
    statuses
  );
}

/** Rencontre jouée en entier : l'équipe A gagne chaque relais de `marginA` touches */
async function playMatch(competitionId: string, matchId: string, winner: 'A' | 'B' = 'A') {
  const n = match(matchId).bouts.length;
  for (let relay = 1; relay <= n; relay++)
    await call('recordRelayScore', {
      competitionId,
      matchId,
      relay,
      scoreA: winner === 'A' && relay === 1 ? 5 : 0,
      scoreB: winner === 'B' && relay === 1 ? 5 : 0,
    });
}

d('Rang d’entrée d’une équipe (docs/adr/0044, G0b)', () => {
  it('registerTeam : rang facultatif, rendu par la commande et le bloc « teams »', async () => {
    const comp = competition();
    const a = await call('registerTeam', { competitionId: comp.id, name: 'Alpha', ranking: 4 });
    const b = await call('registerTeam', { competitionId: comp.id, name: 'Bravo' });
    expect(a.team).toMatchObject({ name: 'Alpha', ranking: 4 });
    expect(b.team.ranking).toBeNull();
    const teams = (await stateOf(comp.id)).teams.teams;
    expect(teams.map((t: { ranking: number | null }) => t.ranking)).toEqual([4, null]);
    await reject('registerTeam', { competitionId: comp.id, name: 'X', ranking: 0 }).toMatchObject({
      code: 'invalid_input',
    });
  });

  it('updateTeam : nom, club, rang (null le retire), sans journal ; refus après le tirage', async () => {
    const comp = competition();
    const [a, b] = await teamsRegistered(comp.id, ['Alpha', 'Bravo']);
    const dry = await call('updateTeam', {
      competitionId: comp.id,
      teamId: a,
      ranking: 2,
      dryRun: true,
    });
    expect(dry).toEqual({ dryRun: true, team: null });
    expect(db.getTeamsByCompetition(comp.id)[0].ranking).toBeNull();

    const out = await call('updateTeam', {
      competitionId: comp.id,
      teamId: a,
      name: 'Alpha 1',
      club: 'CE Paris',
      ranking: 2,
    });
    expect(out.team).toEqual({ id: a, name: 'Alpha 1', club: 'CE Paris', ranking: 2 });
    await call('updateTeam', { competitionId: comp.id, teamId: a, ranking: null });
    expect(db.getTeamsByCompetition(comp.id).find(t => t.id === a)).toMatchObject({
      name: 'Alpha 1',
      club: 'CE Paris',
      ranking: null,
    });
    expect(revision(comp.id)).toBe(0);

    const other = competition();
    const [c] = await teamsRegistered(other.id, ['C']);
    await reject('updateTeam', { competitionId: comp.id, teamId: c, name: 'Z' }).toMatchObject({
      code: 'team_not_found',
    });
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('updateTeam', { competitionId: comp.id, teamId: b, ranking: 1 }).toMatchObject({
      code: 'draw_done',
    });
  });

  it('outil MCP update_team (inscription)', () => {
    const tool = CONTRACT_MCP_TOOLS.write.find(t => t.name === 'update_team');
    expect(tool?.inputSchema.required).toEqual(['competitionId', 'teamId']);
  });

  it('noir P à égalité de score en poule : rang d’entrée (rang saisi), pas le nom', async () => {
    const comp = competition(Weapon.EPEE);
    // Alpha passe devant au nom ; Bravo a le meilleur rang d'entrée
    const [a, b] = await teamsRegistered(comp.id, [
      { name: 'Alpha', ranking: 2 },
      { name: 'Bravo', ranking: 1 },
    ]);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    expect(match(id)).toMatchObject({ teamAId: a, teamBId: b });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 3,
      scoreB: 3,
    });
    for (let k = 0; k < 2; k++)
      await call('givePassivityCard', { competitionId: comp.id, matchId: id });
    const black = await call('givePassivityCard', { competitionId: comp.id, matchId: id });
    expect(black.winnerTeamId).toBe(b);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('noir P en poule sans rang saisi : somme des classements des titulaires', async () => {
    const comp = competition(Weapon.SABRE);
    const [a, b] = await teamsRegistered(comp.id, [
      { name: 'Alpha', fencerRanks: [10, 11, 12] },
      { name: 'Bravo', fencerRanks: [1, 2, 3] },
    ]);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    expect(match(id)).toMatchObject({ teamAId: a, teamBId: b });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: id,
      relay: 1,
      scoreA: 2,
      scoreB: 2,
    });
    for (let k = 0; k < 3; k++)
      await call('givePassivityCard', { competitionId: comp.id, matchId: id });
    expect(match(id)).toMatchObject({ status: 'finished', winnerId: b });
  });
});

const tableauOf = (id: string) => db.getTeamTableauMatches(id, id);

/** Rang (ordre) d'un titulaire dans son équipe */
const orderOf = (competitionId: string, fencerId: string) =>
  db
    .getTeamsByCompetition(competitionId)
    .flatMap(t => t.fencers)
    .find(f => f.fencerId === fencerId)?.teamOrder;

d('Poules d’équipes lues dans la formule (docs/adr/0044, G0c)', () => {
  it('formule d’équipe : poules de la taille du tour, serpentin au rang d’entrée, journal, rejeu', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    // Rang d'entrée : 1 … 7 dans l'ordre inverse des noms
    const names = ['G', 'F', 'E', 'D', 'C', 'B', 'A'];
    const t = await teamsRegistered(
      comp.id,
      names.map((name, i) => ({ name, ranking: i + 1 }))
    );
    const out = await call('generateTeamPools', { competitionId: comp.id, commandId: 'tp' });
    // 7 équipes, poules de 3 à 4 : 2 poules ; serpentin 1-4-5 / 2-3-6-7
    expect(out.pools.map((p: { teamIds: string[] }) => [...p.teamIds].sort())).toEqual([
      [t[0], t[3], t[4]].sort(),
      [t[1], t[2], t[5], t[6]].sort(),
    ]);
    expect(out.matchIds).toHaveLength(3 + 6);
    expect(out.relayCount).toBe(9 * 9);
    expect(events(comp.id).map(e => e.type)).toEqual([
      'TeamPoolsGenerated',
      ...Array(9).fill('TeamMatchScheduled'),
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('generateTeamPools et generateTeamTableau lisent leurs phases par phaseSettings (ADR-0036)', async () => {
    const comp = competition(Weapon.EPEE, {
      formula: teamFormula({ pool: { sizeMin: 3, sizeMax: 3 } }),
    });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D', 'E', 'F']);
    vi.mocked(phaseSettings).mockClear();
    const pools = await call('generateTeamPools', { competitionId: comp.id });
    expect(vi.mocked(phaseSettings)).toHaveBeenCalledWith(expect.anything(), {
      kind: 'pool',
      round: 0,
    });
    // Taille du tour lue : 2 poules de 3
    expect(pools.pools.map((p: { teamIds: string[] }) => p.teamIds.length)).toEqual([3, 3]);
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    vi.mocked(phaseSettings).mockClear();
    await call('generateTeamTableau', { competitionId: comp.id });
    expect(vi.mocked(phaseSettings)).toHaveBeenCalledWith(expect.anything(), { kind: 'tableau' });
    // Aucune lecture directe des phases dans les commandes d'équipe
    for (const file of ['teams.ts', 'teamRelays.ts', 'teamCards.ts'])
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(
        /phases\.(find|some|filter)\(/
      );
    // Domaine de la règle de rencontre : surcharge de phase lue par phaseSettings seulement
    const rule = readFileSync(
      join(__dirname, '../../../shared/domain/teams/teamMatchRule.ts'),
      'utf8'
    );
    expect(rule).not.toMatch(/playedTableauOf\(|phases\.find\(/);
  });

  it('formule « individuelle » enregistrée (sans general.teamMatch) : poule unique par nom, à l’identique', async () => {
    const individual = { ...teamFormula(), general: {} };
    const comp = competition(Weapon.EPEE, { formula: individual });
    const t = await teamsRegistered(comp.id, ['F', 'E', 'D', 'C', 'B', 'A']);
    const out = await call('generateTeamPools', { competitionId: comp.id });
    const byName = [...t].reverse();
    expect(out.pools).toEqual([{ number: 1, teamIds: byName }]);
    // Tous contre tous i < j, dans l'ordre des noms
    expect(match(`${comp.id}-p1-1`)).toMatchObject({ teamAId: byName[0], teamBId: byName[1] });
    expect(out.matchIds).toHaveLength(15);
  });

  it('poolCount : nombre de poules demandé (formule d’équipe) ; trop de poules refusé ; sans formule d’équipe, poule unique gardée', async () => {
    const legacy = competition(Weapon.FOIL);
    await teamsRegistered(legacy.id, ['A', 'B', 'C', 'D']);
    await reject('generateTeamPools', { competitionId: legacy.id, poolCount: 2 }).toMatchObject({
      code: 'invalid_pool_count',
    });
    const comp = competition(Weapon.FOIL, { formula: teamFormula() });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await reject('generateTeamPools', { competitionId: comp.id, poolCount: 3 }).toMatchObject({
      code: 'invalid_pool_count',
    });
    const out = await call('generateTeamPools', { competitionId: comp.id, poolCount: 2 });
    expect(out.pools.map((p: { teamIds: string[] }) => p.teamIds.length)).toEqual([2, 2]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('tableau seul : pas de poules (no_pools) ; tableau placé au rang d’entrée', async () => {
    const comp = competition(Weapon.SABRE, { formula: teamFormula({ pool: null }) });
    const [a, b, c, dd] = await teamsRegistered(comp.id, [
      { name: 'A', ranking: 4 },
      { name: 'B', ranking: 3 },
      { name: 'C', ranking: 2 },
      { name: 'D', ranking: 1 },
    ]);
    await reject('generateTeamPools', { competitionId: comp.id }).toMatchObject({
      code: 'no_pools',
    });
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    // Têtes de série D, C, B, A : 1-4 (D-A), 3-2 (B-C)
    expect(out.slots).toEqual([
      { round: 2, position: 0, teamAId: dd, teamBId: a, isBye: false },
      { round: 2, position: 1, teamAId: b, teamBId: c, isBye: false },
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('qualification du tour vers le tableau : nombre, coupe à la barre (ADR-0040)', async () => {
    const comp = competition(Weapon.EPEE, {
      formula: teamFormula({ pool: { qualification: { mode: 'fixed_count', count: 2 } } }),
    });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('generateTeamTableau', { competitionId: comp.id }).toMatchObject({
      code: 'pools_not_complete',
    });
    // L'équipe A de chaque rencontre gagne
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    const ranking = (await stateOf(comp.id)).teams.poolRanking as Array<{ teamId: string }>;
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.size).toBe(2);
    expect(out.slots).toEqual([
      {
        round: 1,
        position: 0,
        teamAId: ranking[0].teamId,
        teamBId: ranking[1].teamId,
        isBye: false,
      },
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('formule avec tour de poules : tableau refusé avant le tirage des poules', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await reject('generateTeamTableau', { competitionId: comp.id }).toMatchObject({
      code: 'pools_not_complete',
    });
  });
});

d('Règle de rencontre de la phase (docs/adr/0044, G0c)', () => {
  it('relais créés avec la règle de leur phase ; rencontre figée si la formule change', async () => {
    // Arme « Autre » : rotation admise à 3 titulaires (ordre FIE imposé en épée, fleuret,
    // sabre seulement, o.99.3, ADR-0044 amendée)
    const formula = teamFormula({
      pool: { teamMatch: { relayOrder: 'rotation' } },
      tableau: { teamMatch: { relayStep: 3 } },
    });
    const comp = competition(Weapon.CUSTOM, { formula });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    // Poule : rotation (1-1 d'abord), palier 5 de la règle générale
    const first = match(`${comp.id}-p1-1`);
    expect(first.bouts.every(r => r.maxScore === 5)).toBe(true);
    expect(orderOf(comp.id, first.bouts[0].fencerAId)).toBe(1);
    expect(orderOf(comp.id, first.bouts[0].fencerBId)).toBe(1);
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    const [semi] = tableauOf(comp.id);
    const t = match(semi.id);
    // Tableau : palier 3, ordre FIE o.99.3 (3-6 d'abord)
    expect(t.bouts.every(r => r.maxScore === 3)).toBe(true);
    expect(orderOf(comp.id, t.bouts[0].fencerAId)).toBe(3);
    // La formule change : la rencontre créée garde son palier (cumul 4 au relais 1 refusé)
    const changed = teamFormula({ tableau: { teamMatch: { relayStep: 6 } } });
    db.updateCompetition(comp.id, {
      settings: { ...db.getCompetition(comp.id)!.settings, formula: changed },
    } as never);
    await reject('recordRelayScore', {
      competitionId: comp.id,
      matchId: semi.id,
      relay: 1,
      scoreA: 4,
      scoreB: 0,
    }).toMatchObject({ code: 'score_above_max' });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: semi.id,
      relay: 1,
      scoreA: 3,
      scoreB: 1,
    });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('épée à 3 titulaires : palier par phase, ordre FIE dans chaque phase', async () => {
    const formula = teamFormula({ tableau: { teamMatch: { relayStep: 3 } } });
    const comp = competition(Weapon.EPEE, { formula });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    const first = match(`${comp.id}-p1-1`);
    // Poule : palier 5 de la règle générale, ordre FIE o.99.3 (3-6 d'abord)
    expect(first.bouts.every(r => r.maxScore === 5)).toBe(true);
    expect(orderOf(comp.id, first.bouts[0].fencerAId)).toBe(3);
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    const t = match(tableauOf(comp.id)[0].id);
    expect(t.bouts.every(r => r.maxScore === 3)).toBe(true);
    expect(orderOf(comp.id, t.bouts[0].fencerAId)).toBe(3);
    expect(divergences(comp.id)).toEqual([]);
  });

  it('ordre FIE imposé à 3 titulaires en épée, fleuret, sabre : rotation refusée (invalid_team_match)', async () => {
    // Touches de poule dans les bornes (1 à 15) : seule la règle de rencontre est jugée
    const valid = () => teamFormula({ pool: { maxScore: 15 } });
    for (const weapon of [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE]) {
      const comp = competition(weapon, { formula: valid() });
      // Sur la phase concernée
      await reject('updateCompetitionFormula', {
        competitionId: comp.id,
        operations: [
          { op: 'setPhase', phase: 'pool-0', settings: { teamMatch: { relayOrder: 'rotation' } } },
        ],
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringMatching(/\[pool-0\].*ordre FIE des relais imposé/),
      });
      // Sur la formule entière
      await reject('updateCompetitionFormula', {
        competitionId: comp.id,
        operations: [
          { op: 'setGeneral', settings: { teamMatch: { ...RULE, relayOrder: 'rotation' } } },
        ],
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringMatching(/\[formule\].*ordre FIE des relais imposé/),
      });
    }
    // Rotation admise : arme « Autre », équipes de 4 (Sabre Laser : teamMatchRule.test.ts)
    const custom = competition(Weapon.CUSTOM, { formula: valid() });
    await call('updateCompetitionFormula', {
      competitionId: custom.id,
      operations: [
        { op: 'setPhase', phase: 'pool-0', settings: { teamMatch: { relayOrder: 'rotation' } } },
      ],
      dryRun: true,
    });
    const four = competition(Weapon.EPEE, { formula: valid() });
    await call('updateCompetitionFormula', {
      competitionId: four.id,
      operations: [
        {
          op: 'setGeneral',
          settings: { teamMatch: { ...RULE, starters: 4, relayOrder: 'rotation' } },
        },
      ],
      dryRun: true,
    });
  });

  it('tableau sans poule tiré : composition et inscription figées (ADR-0024 amendée, ADR-0044)', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ pool: null }) });
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamTableau', { competitionId: comp.id });
    await reject('assignTeamFencer', {
      competitionId: comp.id,
      teamId: a,
      fencerId: fencer(comp.id, 'A9'),
      teamOrder: 5,
      isReserve: true,
    }).toMatchObject({ code: 'draw_done' });
    const member = db.getTeamsByCompetition(comp.id).find(t => t.id === a)!.fencers[0].fencerId;
    await reject('unassignTeamFencer', {
      competitionId: comp.id,
      teamId: a,
      fencerId: member,
    }).toMatchObject({ code: 'draw_done' });
    await reject('unregisterTeam', { competitionId: comp.id, teamId: b }).toMatchObject({
      code: 'draw_done',
    });
    await reject('updateTeam', { competitionId: comp.id, teamId: b, ranking: 1 }).toMatchObject({
      code: 'draw_done',
    });
  });

  it('remplaçants contrôlés par le moteur à l’inscription (assignTeamFencer)', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 2 } }) });
    const [a] = await teamsRegistered(comp.id, ['A'], 3, 2);
    await reject('assignTeamFencer', {
      competitionId: comp.id,
      teamId: a,
      fencerId: fencer(comp.id, 'A6'),
      teamOrder: 6,
      isReserve: true,
    }).toMatchObject({ code: 'invalid_composition' });
    // Sans remplaçant dans la règle
    const none = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 0 } }) });
    const [n] = await teamsRegistered(none.id, ['N'], 3, 0);
    await reject('assignTeamFencer', {
      competitionId: none.id,
      teamId: n,
      fencerId: fencer(none.id, 'N4'),
      teamOrder: 4,
      isReserve: true,
    }).toMatchObject({ code: 'invalid_composition' });
    // Épreuve sans formule : teamReserveCount (1 par défaut)
    const legacy = competition(Weapon.EPEE);
    const [l] = await teamsRegistered(legacy.id, ['L'], 3, 1);
    await reject('assignTeamFencer', {
      competitionId: legacy.id,
      teamId: l,
      fencerId: fencer(legacy.id, 'L5'),
      teamOrder: 5,
      isReserve: true,
    }).toMatchObject({ code: 'invalid_composition' });
  });

  it('remplaçants contrôlés au remplacement (substituteTeamFencer) : règle de la phase', async () => {
    const formula = teamFormula({ pool: { teamMatch: { reserves: 0 } } });
    const comp = competition(Weapon.EPEE, { formula });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const m = match(id);
    await reject('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: id,
      teamId: m.teamAId,
      outFencerId: m.bouts[0].fencerAId,
    }).toMatchObject({ code: 'no_reserve' });
  });
});

d('Petite finale (docs/adr/0044, G0c)', () => {
  it('perdants des demi-finales en petite finale ; rouvrir une demi-finale la retire', async () => {
    const comp = competition(Weapon.FOIL, {
      formula: teamFormula({ pool: null, tableau: { thirdPlace: true } }),
    });
    await teamsRegistered(comp.id, [
      { name: 'A', ranking: 1 },
      { name: 'B', ranking: 2 },
      { name: 'C', ranking: 3 },
      { name: 'D', ranking: 4 },
    ]);
    await call('generateTeamTableau', { competitionId: comp.id });
    const [s1, s2] = tableauOf(comp.id);
    await playMatch(comp.id, s1.id, 'A');
    expect(tableauOf(comp.id)).toHaveLength(2);
    await playMatch(comp.id, s2.id, 'A');
    expect(tableauOf(comp.id).map(m => [m.round, m.position])).toEqual(
      expect.arrayContaining([
        [1, 0],
        [1, 1],
      ])
    );
    const third = match(`${comp.id}-t1-1`);
    expect([third.teamAId, third.teamBId]).toEqual([s1.teamBId, s2.teamBId]);
    expect(divergences(comp.id)).toEqual([]);

    // Rouvrir la 2e demi-finale : finale et petite finale non commencées retirées
    const reopened = await call('reopenRelay', { competitionId: comp.id, matchId: s2.id });
    expect([...reopened.removedMatchIds].sort()).toEqual(
      [`${comp.id}-t1-0`, `${comp.id}-t1-1`].sort()
    );
    expect(tableauOf(comp.id)).toHaveLength(2);
  });
});

d('Classement final dans getCompetitionState (docs/adr/0044, G0d)', () => {
  it('épreuve sans formule d’équipe : même résultat que l’écran (computeTeamFinalRanking)', async () => {
    const comp = competition(Weapon.EPEE);
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    expect((await stateOf(comp.id)).teams.finalRanking.provisional).toBe(true);
    await call('generateTeamTableau', { competitionId: comp.id });
    for (const m of tableauOf(comp.id)) await playMatch(comp.id, m.id);
    for (const m of tableauOf(comp.id).filter(x => x.status !== 'finished'))
      await playMatch(comp.id, m.id);
    const teams = (await stateOf(comp.id)).teams;
    const byId = new Map(db.getTeamsByCompetition(comp.id).map(t => [t.id, t]));
    const screen = computeTeamFinalRanking(
      teams.poolRanking.map((r: { teamId: string }) => byId.get(r.teamId)!),
      db.getTeamTableauMatches(comp.id, comp.id)
    );
    expect(teams.finalRanking).toEqual({
      rows: screen.rows.map(r => ({ teamId: r.team.id, rank: r.rank })),
      provisional: false,
    });
    expect(teams.finalRanking.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 3]);
  });

  it('formule d’équipe : petite finale, puis équipes éliminées à l’issue des poules', async () => {
    const comp = competition(Weapon.FOIL, {
      formula: teamFormula({
        pool: {
          sizeMin: 3,
          sizeMax: 6,
          // Ex aequo à la barre départagés au rang d'entrée : 4 qualifiés exactement
          qualification: { mode: 'fixed_count', count: 4, ties: 'initial_ranking' },
        },
        tableau: { thirdPlace: true },
      }),
    });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D', 'E']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.size).toBe(4);
    const inTableau = out.slots.flatMap((s: { teamAId: string; teamBId: string }) => [
      s.teamAId,
      s.teamBId,
    ]);
    const cut = db.getTeamsByCompetition(comp.id).find(t => !inTableau.includes(t.id))!;
    const [s1, s2] = tableauOf(comp.id);
    await playMatch(comp.id, s1.id, 'A');
    await playMatch(comp.id, s2.id, 'B');
    await playMatch(comp.id, `${comp.id}-t1-0`, 'A');
    await playMatch(comp.id, `${comp.id}-t1-1`, 'B');
    const final = match(`${comp.id}-t1-0`);
    const third = match(`${comp.id}-t1-1`);
    const { rows, provisional } = (await stateOf(comp.id)).teams.finalRanking;
    expect(provisional).toBe(false);
    expect(rows).toEqual([
      { teamId: final.teamAId, rank: 1 },
      { teamId: final.teamBId, rank: 2 },
      { teamId: third.teamBId, rank: 3 },
      { teamId: third.teamAId, rank: 4 },
      // Équipe coupée à l'issue des poules, hors tableau
      { teamId: cut.id, rank: 5 },
    ]);
    expect(divergences(comp.id)).toEqual([]);
  });
});

d('Formule d’une épreuve par équipes écrite par le moteur (docs/adr/0044, G0a)', () => {
  it('updateCompetitionFormula : règle de rencontre posée depuis les réglages, réglages plats écrits', async () => {
    const comp = competition(Weapon.EPEE, { teamReserveCount: 2, teamRelayStepSize: 4 });
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
    });
    const settings = db.getCompetition(comp.id)!.settings!;
    expect(settings.formula?.general.teamMatch).toEqual({
      starters: 3,
      reserves: 2,
      relayStep: 4,
      relayOrder: 'fie',
    });
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [
        {
          op: 'setGeneral',
          settings: { teamMatch: { ...RULE, starters: 4, relayOrder: 'rotation' } },
        },
      ],
    });
    expect(db.getCompetition(comp.id)!.settings).toMatchObject({
      minTeamSize: 4,
      teamReserveCount: 1,
      teamRelayStepSize: 5,
    });
  });

  it('refus : brique non admise (team_brick_unsupported), effectif d’équipes (S3)', async () => {
    const comp = competition(Weapon.EPEE);
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'insertPhase', brick: 'pool', at: 1 }],
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('un seul tour de poules'),
    });
    await teamsRegistered(comp.id, ['A', 'B']);
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'pool-0', settings: { sizeMin: 3, sizeMax: 6 } }],
    }).toMatchObject({ code: 'invalid_settings', message: expect.stringContaining('2 équipe(s)') });
  });

  it('arène Sabre Laser : formule d’un modèle fixe, non modifiable (unsupported_format)', async () => {
    const arena = competition(Weapon.LASER, { teamFormat: 'laser-arena' });
    const before = db.getCompetition(arena.id)!.settings!.formula;
    await reject('updateCompetitionFormula', {
      competitionId: arena.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
      dryRun: true,
    }).toMatchObject({ code: 'unsupported_format' });
    await reject('updateCompetitionFormula', {
      competitionId: arena.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
    }).toMatchObject({ code: 'unsupported_format' });
    await reject('applyFormulaTemplate', {
      competitionId: arena.id,
      templateId: 'bpm/L/sen',
    }).toMatchObject({ code: 'unsupported_format' });
    await reject('updateCompetitionSettings', {
      competitionId: arena.id,
      settings: { formula: teamFormula({ pool: null }) },
    }).toMatchObject({ code: 'unsupported_format' });
    expect(db.getCompetition(arena.id)!.settings!.formula).toEqual(before);
    // Réglage plat : écrit, sans report dans une formule figée
    await call('updateCompetitionSettings', {
      competitionId: arena.id,
      settings: { minTeamSize: 4 },
    });
    expect(db.getCompetition(arena.id)!.settings).toMatchObject({ minTeamSize: 4 });
    expect(db.getCompetition(arena.id)!.settings!.formula).toEqual(before);
  });

  it('arène Sabre Laser : un réglage de structure ne retire pas la formule figée (ADR-0036 amendée, ADR-0044)', async () => {
    const fixed = teamFormula();
    const arena = competition(Weapon.LASER, { teamFormat: 'laser-arena', formula: fixed });
    const before = db.getCompetition(arena.id)!.settings!.formula;
    expect(before).toBeDefined();
    await call('updateCompetitionSettings', {
      competitionId: arena.id,
      settings: { hasDirectElimination: false },
    });
    expect(db.getCompetition(arena.id)!.settings!.formula).toEqual(before);
  });

  it('épreuve individuelle : teamMatch (général et de phase) retiré à l’écriture, aucun réglage d’équipe dérivé', async () => {
    const solo = db.createCompetition({
      title: 'Individuel',
      date: new Date('2026-12-06'),
      location: 'Gymnase',
      weapon: Weapon.EPEE,
      gender: Gender.MIXED,
      category: Category.SENIOR,
      settings: buildDefaultCompetitionSettings({
        weapon: Weapon.EPEE,
        category: Category.SENIOR,
      }) as never,
    });
    const flatBefore = db.getCompetition(solo.id)!.settings!;
    await call('updateCompetitionFormula', {
      competitionId: solo.id,
      operations: [
        { op: 'setGeneral', settings: { teamMatch: { ...RULE, starters: 4, reserves: 2 } } },
        { op: 'setPhase', phase: 'tableau', settings: { teamMatch: { relayStep: 3 } } },
      ],
    });
    const after = db.getCompetition(solo.id)!.settings!;
    expect(after.formula?.general.teamMatch).toBeUndefined();
    expect(after.formula?.phases.some(p => 'teamMatch' in p)).toBe(false);
    expect(after.minTeamSize).toBe(flatBefore.minTeamSize);
    expect(after.teamReserveCount).toBe(flatBefore.teamReserveCount);
    expect(after.teamRelayStepSize).toBe(flatBefore.teamRelayStepSize);
    // Même chose par updateCompetitionSettings avec settings.formula
    await call('updateCompetitionSettings', {
      competitionId: solo.id,
      settings: { formula: teamFormula() },
    });
    const written = db.getCompetition(solo.id)!.settings!.formula!;
    expect(written.general.teamMatch).toBeUndefined();
  });

  it('épreuve devenue individuelle : règle de rencontre retirée de la formule enregistrée', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    await call('updateCompetitionSettings', { competitionId: comp.id, isTeamEvent: false });
    expect(db.getCompetition(comp.id)!.settings!.formula!.general.teamMatch).toBeUndefined();
  });
});

d('updateCompetitionSettings avec settings.formula (docs/adr/0044, Formule d’équipe)', () => {
  it('pose general.teamMatch depuis les réglages ; garde celle de la formule écrite', async () => {
    const comp = competition(Weapon.EPEE, { teamReserveCount: 2, teamRelayStepSize: 4 });
    await call('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: { formula: { ...teamFormula(), general: {} } },
    });
    expect(db.getCompetition(comp.id)!.settings!.formula!.general.teamMatch).toEqual({
      starters: 3,
      reserves: 2,
      relayStep: 4,
      relayOrder: 'fie',
    });
    await call('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: { formula: teamFormula({ rule: { relayStep: 6 } }) },
    });
    expect(db.getCompetition(comp.id)!.settings!.formula!.general.teamMatch).toEqual({
      ...RULE,
      relayStep: 6,
    });
  });
});

d(
  'updateCompetitionSettings avec settings.formula : même jugement que updateCompetitionFormula (docs/adr/0041, ADR-0044)',
  () => {
    it('rotation à 3 titulaires en épée refusée (invalid_team_match), rien d’écrit', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      const before = db.getCompetition(comp.id)!.settings!;
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { formula: teamFormula({ rule: { relayOrder: 'rotation' } }) },
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringContaining('ordre FIE des relais imposé'),
      });
      expect(db.getCompetition(comp.id)!.settings).toEqual(before);
    });

    it('brique Tour Quest refusée pour une épreuve par équipes (team_brick_unsupported)', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      const quest = teamFormula();
      quest.phases.splice(1, 0, { kind: 'quest', id: 'quest', config: { enabled: true } } as never);
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { formula: quest },
        dryRun: true,
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringContaining('Tour Quest refusé'),
      });
    });

    it('formule valide acceptée ; effectif d’équipes jugé (S3) comme par updateCompetitionFormula', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      await call('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { formula: teamFormula({ tableau: { thirdPlace: true } }) },
      });
      expect(db.getCompetition(comp.id)!.settings!.formula!.phases[1]).toMatchObject({
        kind: 'tableau',
        thirdPlace: true,
      });
      await teamsRegistered(comp.id, ['A', 'B']);
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { formula: teamFormula({ pool: { sizeMin: 3, sizeMax: 6 } }) },
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringContaining('2 équipe(s)'),
      });
    });
  }
);

d(
  'Réglages plats d’une épreuve par équipes à formule d’équipe (ADR-0036 amendée, ADR-0044)',
  () => {
    it('réglage de structure (poolRounds, hasDirectElimination) : refusé, la formule d’équipe reste', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      const before = db.getCompetition(comp.id)!.settings!;
      for (const settings of [{ poolRounds: 2 }, { hasDirectElimination: false }])
        await reject('updateCompetitionSettings', {
          competitionId: comp.id,
          settings,
        }).toMatchObject({
          code: 'invalid_settings',
          message: expect.stringContaining('updateCompetitionFormula'),
        });
      expect(db.getCompetition(comp.id)!.settings).toEqual(before);
    });

    it('réglage reporté : formule gardée avec sa règle de rencontre, jugée par les contrôles d’équipe', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      await call('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { thirdPlaceMatch: true },
      });
      const kept = db.getCompetition(comp.id)!.settings!.formula!;
      expect(kept.general.teamMatch).toEqual(RULE);
      expect(kept.phases[1]).toMatchObject({ kind: 'tableau', thirdPlace: true });
      // Règle de rencontre : 4 titulaires en ordre FIE (o.99.3 : 3 seulement)
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { minTeamSize: 4 },
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringContaining('3 titulaires seulement'),
      });
      // S3 sur l'effectif d'équipes
      await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { poolSizeMin: 5, poolSizeMax: 6 },
      }).toMatchObject({
        code: 'invalid_settings',
        message: expect.stringContaining('4 équipe(s) pour des poules de 5'),
      });
      expect(db.getCompetition(comp.id)!.settings!.formula).toEqual(kept);
    });

    it('remarque déjà présente dans la formule enregistrée : un autre réglage plat reste écrit', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      await teamsRegistered(comp.id, ['A', 'B']);
      // 2 équipes pour des poules de 3 au moins : formule enregistrée déjà hors effectif
      await call('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { defaultTableMaxScore: 40 },
      });
      expect(db.getCompetition(comp.id)!.settings!.formula!.phases[1]).toMatchObject({
        maxScore: 40,
      });
    });

    it('changement d’arme avant le tirage : la formule d’équipe est retirée (ADR-0044, ADR-0036)', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      expect(db.getCompetition(comp.id)!.settings!.formula!.general.teamMatch).toBeDefined();
      await call('updateCompetitionSettings', { competitionId: comp.id, weapon: 'F' });
      expect(db.getCompetition(comp.id)!.settings!.formula).toBeUndefined();
    });

    it('formule « individuelle » à 2 tours qui deviendrait formule d’équipe au report : contrôles d’équipe, refus', async () => {
      const legacy = teamFormula();
      delete (legacy.general as { teamMatch?: unknown }).teamMatch;
      const twoRounds = {
        ...legacy,
        phases: [legacy.phases[0], { ...legacy.phases[0], id: 'p2' }, ...legacy.phases.slice(1)],
      };
      const comp = competition(Weapon.EPEE, { formula: twoRounds });
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { defaultTableMaxScore: 40 },
      }).toMatchObject({ code: 'invalid_settings' });
      expect(db.getCompetition(comp.id)!.settings!.formula!.general.teamMatch).toBeUndefined();
    });

    it('formule sans règle de rencontre (épreuve existante) : un réglage plat reporté pose la règle (ADR-0044)', async () => {
      const legacy = teamFormula();
      delete (legacy.general as { teamMatch?: unknown }).teamMatch;
      const comp = competition(Weapon.EPEE, { formula: legacy });
      await call('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { defaultTableMaxScore: 40 },
      });
      const formula = db.getCompetition(comp.id)!.settings!.formula!;
      expect(formula.general.teamMatch).toBeDefined();
      expect(formula.phases.find(p => p.kind === 'tableau')).toMatchObject({ maxScore: 40 });
    });

    it('formule sans règle de rencontre (épreuve existante) : réglage de structure écrit, formule relue', async () => {
      const legacy = teamFormula();
      delete (legacy.general as { teamMatch?: unknown }).teamMatch;
      const comp = competition(Weapon.EPEE, { formula: legacy });
      await call('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { poolRounds: 2 },
      });
      expect(db.getCompetition(comp.id)!.settings!.formula).toBeUndefined();
    });
  }
);

d(
  'Tirage d’une épreuve par équipes : réglages et inscription figés (drawDone, docs/adr/0024, ADR-0044)',
  () => {
    it('poules d’équipes tirées : type d’épreuve, formule à la carte, classement d’entrée, désinscription refusés', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula() });
      await teamsRegistered(comp.id, ['A', 'B', 'C']);
      // Avant le tirage : modifiable (essai à blanc)
      await call('updateCompetitionSettings', {
        competitionId: comp.id,
        isTeamEvent: false,
        dryRun: true,
      });
      await call('generateTeamPools', { competitionId: comp.id });
      const fencerId = db.getFencersByCompetition(comp.id)[0].id;
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        isTeamEvent: false,
      }).toMatchObject({ code: 'draw_done', message: expect.stringContaining('isTeamEvent') });
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        settings: { customFormula: { version: 1, phases: [] } },
      }).toMatchObject({ code: 'draw_done', message: expect.stringContaining('customFormula') });
      await reject('setFencerRankings', {
        competitionId: comp.id,
        rankings: [{ fencerId, ranking: 1 }],
      }).toMatchObject({ code: 'draw_done' });
      await reject('unregisterFencers', {
        competitionId: comp.id,
        fencerIds: [fencerId],
      }).toMatchObject({ code: 'draw_done' });
      expect(db.getCompetition(comp.id)!.isTeamEvent).toBe(true);
    });

    it('tableau d’équipes tiré sans poule : arme figée', async () => {
      const comp = competition(Weapon.FOIL, { formula: teamFormula({ pool: null }) });
      await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
      await call('generateTeamTableau', { competitionId: comp.id });
      await reject('updateCompetitionSettings', {
        competitionId: comp.id,
        weapon: Weapon.SABRE,
      }).toMatchObject({ code: 'draw_done', message: expect.stringContaining('weapon') });
      expect(db.getCompetition(comp.id)!.weapon).toBe(Weapon.FOIL);
    });
  }
);

d('Cible d’une rencontre = relayStep × starters² (docs/adr/0044)', () => {
  it('formule d’équipe palier 4, 3 titulaires : cible 36 ; score_above_max au-delà', async () => {
    const comp = competition(Weapon.EPEE, {
      teamRelayStepSize: 5,
      formula: teamFormula({ pool: null, rule: { relayStep: 4 } }),
    });
    await teamsRegistered(comp.id, ['A', 'B']);
    await call('generateTeamTableau', { competitionId: comp.id });
    const [final] = tableauOf(comp.id);
    const m = match(final.id);
    expect(m.bouts).toHaveLength(9);
    expect(matchRelayRule(db.getCompetition(comp.id)!, m)).toMatchObject({
      stepSize: 4,
      target: 36,
    });
    // Relais 1 à 8 : 4 touches chacun pour A (cumul 32)
    for (let relay = 1; relay <= 8; relay++)
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: final.id,
        relay,
        scoreA: 4,
        scoreB: 0,
      });
    // Dernier relais : 37 > 36 refusé, 36 accepté
    await reject('recordRelayScore', {
      competitionId: comp.id,
      matchId: final.id,
      relay: 9,
      scoreA: 5,
      scoreB: 0,
    }).toMatchObject({ code: 'score_above_max' });
    await call('recordRelayScore', {
      competitionId: comp.id,
      matchId: final.id,
      relay: 9,
      scoreA: 4,
      scoreB: 0,
    });
    const done = match(final.id);
    expect(done).toMatchObject({ status: 'finished', winnerId: done.teamAId });
    expect(done.bouts.reduce((s, r) => s + r.scoreA, 0)).toBe(36);
    expect(divergences(comp.id)).toEqual([]);
  });
});

d('Formule d’équipe posée à la création (docs/adr/0044, amendement « Formule d’équipe »)', () => {
  const create = (settings: Record<string, unknown> = {}, weapon = 'E') =>
    call('createCompetition', {
      title: 'Coupe par équipes',
      date: '2026-12-06',
      weapon,
      gender: 'M',
      category: 'SEN',
      isTeamEvent: true,
      settings: { minTeamSize: 3, ...settings },
    });

  it('relais FIE : formule enregistrée avec general.teamMatch, tirée par la formule', async () => {
    const { competitionId } = await create({ teamReserveCount: 2 });
    const settings = db.getCompetition(competitionId)!.settings!;
    expect(settings.formula?.general.teamMatch).toEqual({ ...RULE, reserves: 2 });
    expect(settings.formula?.phases.map(p => p.kind)).toEqual(['pool', 'tableau']);
    await teamsRegistered(competitionId, ['A', 'B', 'C']);
    expect((await call('generateTeamPools', { competitionId })).pools).toHaveLength(1);
  });

  it('formule créée jugée par les contrôles d’équipe : 2 tours de poules refusés ; modèles « équipes » sans 2 tours ni poules seules', async () => {
    await expect(create({ poolRounds: 2, poolRoundQualifiers: [0] })).rejects.toMatchObject({
      code: 'invalid_settings',
    });
    const r = await call('listFormulaTemplates', {
      weapon: 'E',
      category: 'SEN',
      isTeamEvent: true,
    });
    const codes = (r.templates as Array<{ id: string }>)
      .map(t => t.id)
      .filter(id => id.includes('/team/'));
    expect(codes).toContain('bpm/E/SEN/team/standard');
    expect(codes.some(id => id.endsWith('/two_rounds') || id.endsWith('/pools_only'))).toBe(false);
  });

  it('arène Sabre Laser, épreuve individuelle : pas de règle de rencontre posée', async () => {
    const arena = await create({ teamFormat: 'laser-arena' }, 'L');
    expect(
      db.getCompetition(arena.competitionId)!.settings!.formula?.general.teamMatch
    ).toBeUndefined();
    const solo = await call('createCompetition', {
      title: 'Individuel',
      date: '2026-12-06',
      weapon: 'E',
      gender: 'M',
      category: 'SEN',
    });
    expect(db.getCompetition(solo.competitionId)!.settings!.formula).toBeUndefined();
  });
});

d('Remplaçant choisi (substituteTeamFencer, inFencerId ; docs/adr/0044 amendée)', () => {
  it('choix du 2e remplaçant ; non-remplaçant refusé ; un seul remplaçant par rencontre ; rejeu', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 2 } }) });
    const [a, b] = await teamsRegistered(comp.id, ['A', 'B'], 3, 2);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const m = match(id);
    const side = m.teamAId === a ? 'fencerAId' : 'fencerBId';
    const roster = db.getTeamsByCompetition(comp.id).find(t => t.id === a)!.fencers;
    const [r1, r2] = roster.filter(f => f.isReserve).map(f => f.fencerId);
    const out = m.bouts[0][side];
    const other = db.getTeamsByCompetition(comp.id).find(t => t.id === b)!.fencers[3].fencerId;
    const sub = (inFencerId?: string) =>
      call('substituteTeamFencer', {
        competitionId: comp.id,
        matchId: id,
        teamId: a,
        outFencerId: out,
        ...(inFencerId ? { inFencerId } : {}),
      });
    // Remplaçant de l'autre équipe, ou titulaire : refusés
    await expect(sub(other)).rejects.toMatchObject({ code: 'invalid_composition' });
    await expect(sub(roster[0].fencerId)).rejects.toMatchObject({ code: 'invalid_composition' });
    const done = await sub(r2);
    expect(done.inFencerId).toBe(r2);
    expect(
      match(id)
        .bouts.filter(r => r[side] === r2)
        .map(r => r.id)
    ).toEqual(done.relayIds);
    // Déjà entré (un seul remplaçant par équipe et par rencontre)
    await expect(sub(r1)).rejects.toMatchObject({ code: 'reserve_used' });
    expect(divergences(comp.id)).toEqual([]);
  });

  it('sans inFencerId : le premier remplaçant (comme avant)', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula({ rule: { reserves: 2 } }) });
    const [a] = await teamsRegistered(comp.id, ['A', 'B'], 3, 2);
    await call('generateTeamPools', { competitionId: comp.id });
    const id = `${comp.id}-p1-1`;
    const m = match(id);
    const side = m.teamAId === a ? 'fencerAId' : 'fencerBId';
    const r1 = db
      .getTeamsByCompetition(comp.id)
      .find(t => t.id === a)!
      .fencers.filter(f => f.isReserve)[0].fencerId;
    const done = await call('substituteTeamFencer', {
      competitionId: comp.id,
      matchId: id,
      teamId: a,
      outFencerId: m.bouts[0][side],
    });
    expect(done.inFencerId).toBe(r1);
  });
});

d('Têtes de série du tableau dans getCompetitionState (docs/adr/0044, tableauSeeds)', () => {
  it('qualification qui coupe : classement d’entrée coupé avant le tirage, tableau tiré ensuite', async () => {
    const comp = competition(Weapon.FOIL, {
      formula: teamFormula({
        pool: {
          sizeMin: 3,
          sizeMax: 6,
          qualification: { mode: 'fixed_count', count: 4, ties: 'initial_ranking' },
        },
      }),
    });
    await teamsRegistered(comp.id, ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    const before = (await stateOf(comp.id)).teams;
    // 5 équipes au classement de poule, 4 au tableau
    expect(before.poolRanking).toHaveLength(5);
    expect(before.tableauSeeds).toHaveLength(4);
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    const after = (await stateOf(comp.id)).teams;
    expect(after.tableauSeeds).toEqual(before.tableauSeeds);
    const drawn = out.slots.flatMap((s: { teamAId: string; teamBId: string }) => [
      s.teamAId,
      s.teamBId,
    ]);
    expect([...after.tableauSeeds].sort()).toEqual([...drawn].sort());
    // Tête de série 1 en haut du tableau tiré
    expect(out.slots[0].teamAId).toBe(after.tableauSeeds[0]);
    // PDF du tableau sur les têtes de série de l'état : tableau de 4, équipe coupée absente
    const byId = new Map(db.getTeamsByCompetition(comp.id).map(t => [t.id, t]));
    const cut = db.getTeamsByCompetition(comp.id).find(t => !drawn.includes(t.id))!;
    const html = generateTeamTableauHTML(
      { title: 'Coupe', teams: [...byId.values()], fencerName: id => id, isLaserArena: false },
      after.tableauSeeds.map((id: string) => byId.get(id)!),
      tableauOf(comp.id) as never
    );
    expect(html).toContain('4 équipes');
    expect(html).toContain('tableau de 4');
    expect(html).not.toContain(cut.name);
  });

  it('tableau sans poule : rang d’entrée, avant et après le tirage', async () => {
    const comp = competition(Weapon.SABRE, { formula: teamFormula({ pool: null }) });
    const [a, b, c, dd, e] = await teamsRegistered(comp.id, [
      { name: 'A', ranking: 4 },
      { name: 'B', ranking: 3 },
      { name: 'C', ranking: 2 },
      { name: 'D', ranking: 1 },
      { name: 'E', ranking: 5 },
    ]);
    expect((await stateOf(comp.id)).teams.tableauSeeds).toEqual([dd, c, b, a, e]);
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.size).toBe(8);
    expect((await stateOf(comp.id)).teams.tableauSeeds).toEqual([dd, c, b, a, e]);
  });
});

d(
  'Noir P au tableau d’une formule d’équipe : classement d’entrée du tableau (docs/adr/0044, ADR-0028)',
  () => {
    it('tableau sans poule : à égalité, le noir P donne la rencontre à la meilleure tête de série, pas au nom', async () => {
      const comp = competition(Weapon.EPEE, { formula: teamFormula({ pool: null }) });
      // Au nom, Alpha passerait devant ; au rang d'entrée, Delta est tête de série n° 1
      const [alpha, , , delta] = await teamsRegistered(comp.id, [
        { name: 'Alpha', ranking: 4 },
        { name: 'Bravo', ranking: 3 },
        { name: 'Charlie', ranking: 2 },
        { name: 'Delta', ranking: 1 },
      ]);
      await call('generateTeamTableau', { competitionId: comp.id });
      const m = tableauOf(comp.id).find(
        (x: { teamAId?: string; teamBId?: string }) =>
          [x.teamAId, x.teamBId].includes(alpha) && [x.teamAId, x.teamBId].includes(delta)
      ) as { id: string };
      expect(m).toBeDefined();
      await call('recordRelayScore', {
        competitionId: comp.id,
        matchId: m.id,
        relay: 1,
        scoreA: 2,
        scoreB: 2,
      });
      for (let k = 0; k < 3; k++)
        await call('givePassivityCard', { competitionId: comp.id, matchId: m.id });
      expect(match(m.id)).toMatchObject({ status: 'finished', winnerId: delta });
      expect(divergences(comp.id)).toEqual([]);
    });
  }
);

d('PDF du classement des équipes = classement du moteur (docs/adr/0044)', () => {
  /** PDF du classement bâti sur teams.finalRanking de l'état, comme l'écran */
  async function rankingPdf(competitionId: string) {
    const { finalRanking } = (await stateOf(competitionId)).teams;
    const teams = db.getTeamsByCompetition(competitionId);
    const byId = new Map(teams.map(t => [t.id, t]));
    const rows = finalRanking.rows.map((r: { teamId: string; rank: number }) => ({
      rank: r.rank,
      team: byId.get(r.teamId)!,
    }));
    const html = generateTeamRankingHTML(
      { title: 'Coupe', teams, fencerName: id => id, isLaserArena: false },
      { rows, provisional: finalRanking.provisional }
    );
    return { rows, html };
  }
  /** Rangs et équipes lus dans le PDF, dans l'ordre des lignes */
  const pdfRows = (html: string, names: string[]) =>
    names
      .map(name => ({ name, at: html.indexOf(`>${name}</td>`) }))
      .filter(x => x.at > 0)
      .sort((a, b) => a.at - b.at)
      .map(x => x.name);

  it('coupe après les poules : équipe coupée après le tableau, petite finale', async () => {
    const comp = competition(Weapon.FOIL, {
      formula: teamFormula({
        pool: {
          sizeMin: 3,
          sizeMax: 6,
          qualification: { mode: 'fixed_count', count: 4, ties: 'initial_ranking' },
        },
        tableau: { thirdPlace: true },
      }),
    });
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    await teamsRegistered(comp.id, names);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    const [s1, s2] = tableauOf(comp.id);
    await playMatch(comp.id, s1.id, 'B');
    await playMatch(comp.id, s2.id, 'A');
    await playMatch(comp.id, `${comp.id}-t1-0`, 'B');
    await playMatch(comp.id, `${comp.id}-t1-1`, 'A');
    const { rows, html } = await rankingPdf(comp.id);
    expect(rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(pdfRows(html, names)).toEqual(rows.map((r: { team: { name: string } }) => r.team.name));
    expect(html).not.toContain('provisoire');
  });

  it('tableau seul : classement du tableau placé au rang d’entrée', async () => {
    const comp = competition(Weapon.SABRE, { formula: teamFormula({ pool: null }) });
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    await teamsRegistered(
      comp.id,
      names.map((name, i) => ({ name, ranking: 5 - i }))
    );
    await call('generateTeamTableau', { competitionId: comp.id });
    for (let k = 0; k < 3; k++)
      for (const m of tableauOf(comp.id).filter(x => x.status !== 'finished'))
        await playMatch(comp.id, m.id, 'B');
    const { rows, html } = await rankingPdf(comp.id);
    expect(rows).toHaveLength(5);
    expect(pdfRows(html, names)).toEqual(rows.map((r: { team: { name: string } }) => r.team.name));
    expect(html).not.toContain('provisoire');
  });
});

d('Formule d’une épreuve par équipes commencée : verrou S6 (docs/adr/0041, ADR-0044)', () => {
  it('tableau d’équipes tiré : petite finale figée au tirage (updateCompetitionFormula refusé)', async () => {
    const comp = competition(Weapon.FOIL, { formula: teamFormula({ pool: null }) });
    await teamsRegistered(comp.id, [
      { name: 'A', ranking: 1 },
      { name: 'B', ranking: 2 },
      { name: 'C', ranking: 3 },
      { name: 'D', ranking: 4 },
    ]);
    // Avant le tirage : modifiable (essai à blanc)
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
      dryRun: true,
    });
    await call('generateTeamTableau', { competitionId: comp.id });
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { thirdPlace: true } }],
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('tableau déjà tiré'),
    });
    // Le tableau tiré sans petite finale le reste : pas de rencontre t1-1 après les demies
    const [s1, s2] = tableauOf(comp.id);
    await playMatch(comp.id, s1.id);
    await playMatch(comp.id, s2.id);
    expect(tableauOf(comp.id).map(m => [m.round, m.position])).not.toContainEqual([1, 1]);
    // Autres réglages du tableau : soumis aux règles actuelles (Q15)
    await call('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'setPhase', phase: 'tableau', settings: { timerSeconds: 240 } }],
      dryRun: true,
    });
  });

  it('tableau d’équipes tiré : petite finale figée aussi par updateCompetitionSettings (réglage plat, settings.formula)', async () => {
    const comp = competition(Weapon.FOIL, { formula: teamFormula({ pool: null }) });
    await teamsRegistered(comp.id, [
      { name: 'A', ranking: 1 },
      { name: 'B', ranking: 2 },
      { name: 'C', ranking: 3 },
      { name: 'D', ranking: 4 },
    ]);
    // Avant le tirage : modifiable (essai à blanc)
    await call('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: { thirdPlaceMatch: true },
      dryRun: true,
    });
    await call('generateTeamTableau', { competitionId: comp.id });
    const before = db.getCompetition(comp.id)!.settings!;
    // Réglage plat
    await reject('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: { thirdPlaceMatch: true },
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('tableau déjà tiré'),
    });
    // Formule écrite par les réglages
    await reject('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: { formula: teamFormula({ pool: null, tableau: { thirdPlace: true } }) },
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('tableau déjà tiré'),
    });
    expect(db.getCompetition(comp.id)!.settings).toEqual(before);
  });

  it('poules d’équipes tirées : une écriture plate qui retire le tour est refusée (formule à la carte figée, S6)', async () => {
    const comp = competition(Weapon.CUSTOM, { formula: teamFormula({ pool: { maxScore: 15 } }) });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    const before = db.getCompetition(comp.id)!.settings!;
    // Réglage plat : formule à la carte v1 (arme « Autre ») réduite au tableau, figée après le
    // tirage des poules d'équipes (draw_done)
    await reject('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: {
        customFormula: {
          version: 1,
          phases: [{ id: 'de', type: 'direct_elimination', config: {} }],
        },
      },
    }).toMatchObject({ code: 'draw_done' });
    // Formule sans tour de poules écrite par les réglages
    await reject('updateCompetitionSettings', {
      competitionId: comp.id,
      settings: { formula: teamFormula({ pool: null, tableau: { maxScore: 15 } }) },
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('phase déjà commencée'),
    });
    expect(db.getCompetition(comp.id)!.settings).toEqual(before);
  });

  it('poules d’équipes tirées : le tour de poules ne se retire plus', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    await teamsRegistered(comp.id, ['A', 'B', 'C']);
    await call('generateTeamPools', { competitionId: comp.id });
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [{ op: 'removePhase', phase: 'pool-0' }],
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('phase déjà commencée'),
    });
  });

  it('poules jouées et tableau tiré : la qualification du tour ne change plus', async () => {
    const comp = competition(Weapon.EPEE, {
      formula: teamFormula({ pool: { qualification: { mode: 'fixed_count', count: 2 } } }),
    });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    await call('generateTeamTableau', { competitionId: comp.id });
    await reject('updateCompetitionFormula', {
      competitionId: comp.id,
      operations: [
        {
          op: 'setPhase',
          phase: 'pool-0',
          settings: { qualification: { mode: 'fixed_count', count: 3 } },
        },
      ],
    }).toMatchObject({
      code: 'invalid_settings',
      message: expect.stringContaining('elle ne change plus'),
    });
  });
});

d('Tirage du tableau d’équipes (docs/adr/0045 ; ADR-0044 amendée le 2026-11-28)', () => {
  /** Rejeu avec l'état de session réel (tirage compris) */
  const divergencesWithDraw = (competitionId: string) => {
    const comp = db.getCompetition(competitionId)!;
    const session = (db.getSessionState(competitionId) ?? {}) as Record<string, unknown>;
    return compareWithState(
      projectCompetition(events(competitionId)),
      { ...stateView(session, comp.settings), teams: teamStateView(ctx, comp) },
      {}
    );
  };

  it('tableau sans poule par paires : graine, emplacements par paire, ordre d’entrée gardé, journal et état', async () => {
    const comp = competition(Weapon.SABRE, {
      formula: teamFormula({ pool: null, tableau: { draw: 'pairs' } }),
    });
    const ids = await teamsRegistered(
      comp.id,
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name, i) => ({ name, ranking: i + 1 }))
    );
    const preview = await call('generateTeamTableau', { competitionId: comp.id, dryRun: true });
    expect(preview.draw.mode).toBe('pairs');
    const out = await call('generateTeamTableau', {
      competitionId: comp.id,
      seed: preview.draw.seed,
    });
    // Aperçu rejoué avec sa graine : même tableau
    expect(out.slots).toEqual(preview.slots);
    expect(out.draw).toEqual(preview.draw);
    const state = await stateOf(comp.id);
    // Têtes de série = ordre d'entrée (rangs 1 à 8), placement = emplacements tirés
    expect(state.teams.tableauSeeds).toEqual(ids);
    const placement: string[] = state.teams.tableauPlacement;
    placement.forEach((id, k) => expect(Math.floor(k / 2)).toBe(Math.floor(ids.indexOf(id) / 2)));
    expect(state.tableauDraw).toMatchObject({ mode: 'pairs', seed: out.draw.seed, order: ids });
    const ev = events(comp.id).find(e => e.type === 'TeamTableauGenerated') as any;
    expect(ev.payload.draw).toEqual({ mode: 'pairs', seed: out.draw.seed, order: ids });
    expect(divergencesWithDraw(comp.id)).toEqual([]);
  });

  it('sans poule : rang effectif égal et sans rang tirés au sort avec la graine, pas au nom', async () => {
    const comp = competition(Weapon.SABRE, { formula: teamFormula({ pool: null }) });
    const [a, b, c, dd, e] = await teamsRegistered(comp.id, [
      { name: 'Alpha', ranking: 1 },
      { name: 'Bravo', ranking: 2 },
      { name: 'Charlie', ranking: 2 },
      { name: 'Delta' },
      { name: 'Echo' },
    ]);
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await call('generateTeamTableau', { competitionId: comp.id, seed, replace: true });
      const order: string[] = (await stateOf(comp.id)).tableauDraw.order;
      expect(order[0]).toBe(a);
      expect(new Set(order.slice(1, 3))).toEqual(new Set([b, c]));
      expect(new Set(order.slice(3))).toEqual(new Set([dd, e]));
      expect((await stateOf(comp.id)).teams.tableauSeeds).toEqual(order);
      orders.add(order.join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('après des poules, strict : placement au classement de poule, inchangé', async () => {
    const comp = competition(Weapon.EPEE, { formula: teamFormula() });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    await call('generateTeamPools', { competitionId: comp.id });
    for (const m of db.getTeamMatchesByCompetition(comp.id)) await playMatch(comp.id, m.id);
    const ranking = (await stateOf(comp.id)).teams.poolRanking as Array<{ teamId: string }>;
    const out = await call('generateTeamTableau', { competitionId: comp.id });
    expect(out.draw.mode).toBe('strict');
    expect(out.slots[0]).toMatchObject({
      teamAId: ranking[0].teamId,
      teamBId: ranking[3].teamId,
    });
    expect(divergencesWithDraw(comp.id)).toEqual([]);
  });

  it('S6 : draw du tableau d’équipes verrouillé une fois tiré', async () => {
    const comp = competition(Weapon.SABRE, { formula: teamFormula({ pool: null }) });
    await teamsRegistered(comp.id, ['A', 'B', 'C', 'D']);
    const set = (draw: string) =>
      call('updateCompetitionFormula', {
        competitionId: comp.id,
        operations: [{ op: 'setPhase', phase: 'tableau', settings: { draw } }],
      });
    await set('random');
    await call('generateTeamTableau', { competitionId: comp.id });
    await expect(set('pairs')).rejects.toMatchObject({ code: 'invalid_settings' });
  });
});
