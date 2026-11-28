/**
 * projectCompetition (docs/adr/0017, étape 5) : règles du rejeu, sans base.
 */
import { describe, it, expect } from 'vitest';
import type { JournalEventBody } from '../../api/events';
import { FencerStatus } from '../../types';
import { projectCompetition } from './projectCompetition';

const ev = <T extends JournalEventBody['type']>(
  type: T,
  payload: Extract<JournalEventBody, { type: T }>['payload']
) => ({ type, schemaVersion: 1, payload }) as JournalEventBody;

const drawn = (round: number, poolId = `p${round}`) =>
  ev('PoolsGenerated', {
    round,
    pools: [
      {
        poolId,
        number: 1,
        strip: null,
        fencerIds: ['a', 'b', 'c'],
        matches: [
          { matchId: `${poolId}-1`, fencerAId: 'a', fencerBId: 'b' },
          { matchId: `${poolId}-2`, fencerAId: 'b', fencerBId: 'c' },
        ],
      },
    ],
  });
const tableau = ev('TableauGenerated', {
  size: 2,
  thirdPlaceMatch: false,
  playAllPositions: false,
  matches: [
    {
      matchId: '2-0',
      round: 2,
      position: 0,
      fencerAId: 'a',
      fencerBId: 'b',
      isBye: false,
      seedA: 1,
      seedB: 2,
    },
  ],
});

describe('projectCompetition', () => {
  it('journal complet seulement s’il commence (après l’appel) par un tirage', () => {
    expect(projectCompetition([]).complete).toBe(false);
    expect(projectCompetition([ev('FencerCheckedIn', { fencerId: 'a' }), drawn(1)]).complete).toBe(
      true
    );
    expect(projectCompetition([ev('ScoreRecorded', score('x', 5, 1)), drawn(1)]).complete).toBe(
      false
    );
  });

  it('tableau arrêté clos (ADR-0037) : éliminés sortis, tableau archivé', () => {
    const facts = projectCompetition([
      drawn(1),
      tableau,
      ev('TableauStageClosed', { stopAt: 1, qualifiedIds: ['a'], eliminatedIds: ['b'] }),
    ]);
    expect(facts.tableau).toBeNull();
    expect(facts.fencerStatus.b).toBe(FencerStatus.ELIMINATED);
    expect(facts.fencerStatus.a).toBeUndefined();
  });

  it('tirage refait sur le même tour : il remplace le précédent', () => {
    const facts = projectCompetition([drawn(1, 'old'), drawn(1, 'new')]);
    expect(facts.rounds.map(r => r.pools[0].poolId)).toEqual(['new']);
  });

  it('score, annulation ; statut spécial : perdant seulement', () => {
    const facts = projectCompetition([
      drawn(1),
      ev('ScoreRecorded', score('p1-1', 5, 2)),
      ev('ScoreRecorded', {
        matchId: 'p1-2',
        poolId: 'p1',
        scoreA: 1,
        scoreB: 0,
        winnerId: 'b',
        specialStatus: 'abandon',
        fencerId: 'c',
      }),
      ev('ScoreCleared', { matchId: 'p1-1', poolId: 'p1' }),
    ]);
    expect(facts.rounds[0].pools[0].matches.map(m => m.result)).toEqual([null, { loserId: 'c' }]);
  });

  it('correction avec tableau à refaire : tableau retiré', () => {
    const facts = projectCompetition([
      drawn(1),
      tableau,
      ev('ScoreRecorded', {
        ...score('p1-1', 5, 4),
        correction: { reason: 'erreur', rebuildTableau: true },
      }),
    ]);
    expect(facts.tableau).toBeNull();
    expect(facts.rounds[0].pools[0].matches[0].result).toMatchObject({ scoreA: 5, scoreB: 4 });
  });

  it('tableau : décision, retrait puis réintégration (match rouvert)', () => {
    const decided = projectCompetition([
      drawn(1),
      tableau,
      ev('FencerWithdrawn', {
        fencerId: 'b',
        reason: 'forfait',
        blackCard: false,
        matchId: '2-0',
        forfeitedMatchIds: ['2-0'],
      }),
      ev('TableauMatchDecided', { matchId: '2-0', winnerId: 'a' }),
    ]);
    expect(decided.bracketResults['2-0']).toEqual({ loserId: 'b', winnerId: 'a' });
    expect(decided.fencerStatus.b).toBe('F');
    const reopened = projectCompetition([
      drawn(1),
      tableau,
      ev('FencerWithdrawn', {
        fencerId: 'b',
        reason: 'forfait',
        blackCard: false,
        matchId: '2-0',
        forfeitedMatchIds: ['2-0'],
      }),
      ev('FencerReinstated', { fencerId: 'b', restoredStatus: 'Q', restoredMatchIds: ['2-0'] }),
    ]);
    expect(reopened.bracketResults).toEqual({});
    expect(reopened.fencerStatus.b).toBe('Q');
  });

  it('tour en vagues : vague, arrêt, remise à zéro au tirage suivant (anciens et nouveaux noms)', () => {
    const facts = projectCompetition([
      drawn(1),
      ev('PoolWaveLaunched', { wave: 2, matchIds: [] }),
      ev('PoolWavesEnded', { ended: true }),
    ]);
    expect(facts.waves).toEqual({ wave: 2, ended: true });
    expect(
      projectCompetition([drawn(1), ev('PoolWaveLaunched', { wave: 2, matchIds: [] }), drawn(2)])
        .waves
    ).toEqual({ wave: 0, ended: false });
    // Journal d'avant F4a : événements Rapieres*, puis nouveaux, rejoués sans divergence
    const mixed = projectCompetition([
      drawn(1),
      ev('RapieresWaveLaunched', { wave: 2, matchIds: [] }),
      ev('RapieresWavesEnded', { ended: true }),
      ev('RapieresWavesEnded', { ended: false }),
      ev('PoolWaveLaunched', { wave: 3, matchIds: [] }),
    ]);
    expect(mixed.waves).toEqual({ wave: 3, ended: false });
  });
});

function score(matchId: string, scoreA: number, scoreB: number) {
  return { matchId, poolId: 'p1', scoreA, scoreB, winnerId: scoreA > scoreB ? 'a' : 'b' };
}

describe('tableaux séparés après les poules (docs/adr/0024)', () => {
  const groupTableau = (group: string) =>
    ev('TableauGenerated', {
      group,
      size: 2,
      thirdPlaceMatch: false,
      playAllPositions: false,
      matches: [
        {
          matchId: `${group}:2-0`,
          round: 2,
          position: 0,
          fencerAId: `${group}a`,
          fencerBId: `${group}b`,
          isBye: false,
          seedA: 1,
          seedB: 2,
        },
      ],
    });
  const decided = (group: string) =>
    ev('TableauMatchDecided', { matchId: `${group}:2-0`, winnerId: `${group}a` });

  it('un tableau par groupe ; décisions rangées dans leur tableau', () => {
    const facts = projectCompetition([
      drawn(1),
      groupTableau('F'),
      groupTableau('M'),
      decided('F'),
      decided('M'),
      ev('TableauCleared', { group: 'M' }),
    ]);
    expect(facts.tableau).toBeNull();
    expect(Object.keys(facts.groupTableaux)).toEqual(['F']);
    expect(Object.keys(facts.bracketResults)).toEqual(['F:2-0']);
  });

  it('nouveau tirage d’un groupe : ses décisions seules sont retirées', () => {
    const facts = projectCompetition([
      drawn(1),
      groupTableau('F'),
      groupTableau('M'),
      decided('F'),
      decided('M'),
      groupTableau('F'),
    ]);
    expect(Object.keys(facts.bracketResults)).toEqual(['M:2-0']);
  });

  it('nouveau tirage des poules : tous les tableaux retirés', () => {
    const facts = projectCompetition([drawn(1), groupTableau('F'), decided('F'), drawn(1)]);
    expect(facts.groupTableaux).toEqual({});
    expect(facts.bracketResults).toEqual({});
  });

  it('groupe extrait (lot A3) : noté, plus de tableau pour lui ici', () => {
    const facts = projectCompetition([
      drawn(1),
      groupTableau('M'),
      ev('GroupSplitOff', { group: 'F', targetCompetitionId: 'c2', fencerIds: ['a', 'c'] }),
    ]);
    expect(facts.splitOffGroups).toEqual({
      F: { targetCompetitionId: 'c2', fencerIds: ['a', 'c'] },
    });
    expect(Object.keys(facts.groupTableaux)).toEqual(['M']);
  });

  it('épreuve séparée : journal complet dès le classement importé', () => {
    const ranking = [{ fencerId: 'x', sourceFencerId: 'a', rank: 1 }];
    const facts = projectCompetition([
      ev('SplitRankingImported', { sourceCompetitionId: 'c1', group: 'F', ranking }),
    ]);
    expect(facts.complete).toBe(true);
    expect(facts.importedRanking).toEqual({ sourceCompetitionId: 'c1', group: 'F', ranking });
  });
});

describe('projectCompetition : épreuves par équipes (docs/adr/0024, lot E1)', () => {
  const scheduled = (matchId: string, teamAId: string, teamBId: string) =>
    ev('TeamMatchScheduled', {
      matchId,
      teamAId,
      teamBId,
      pool: 1,
      round: null,
      position: null,
      relays: [
        { relayId: `${matchId}-r1`, order: 1, fencerAId: `${teamAId}1`, fencerBId: `${teamBId}1` },
      ],
    });

  it('poules d’équipes et rencontres ; journal complet ; nouveau tirage remplace les rencontres de poule', () => {
    const first = [
      ev('FencerCheckedIn', { fencerId: 'A1' }),
      ev('TeamPoolsGenerated', { pools: [{ number: 1, teamIds: ['A', 'B'] }] }),
      scheduled('c-p1-1', 'A', 'B'),
    ];
    const facts = projectCompetition(first);
    expect(facts.complete).toBe(true);
    expect(facts.teams).toEqual({
      pools: [{ number: 1, teamIds: ['A', 'B'] }],
      matches: [
        {
          matchId: 'c-p1-1',
          teamAId: 'A',
          teamBId: 'B',
          pool: 1,
          round: null,
          position: null,
          relays: [{ relayId: 'c-p1-1-r1', order: 1, fencerAId: 'A1', fencerBId: 'B1' }],
        },
      ],
      tableau: null,
      relayResults: {},
      decisions: {},
      cards: [],
      cardMatchIds: [],
      cardsJournaled: false,
      withdrawn: {},
    });
    const redrawn = projectCompetition([
      ...first,
      ev('RelayScoreRecorded', { matchId: 'c-p1-1', relayId: 'c-p1-1-r1', scoreA: 5, scoreB: 2 }),
      ev('TeamMatchDecided', { matchId: 'c-p1-1', winnerTeamId: 'A' }),
      ev('TeamPoolsGenerated', { pools: [{ number: 1, teamIds: ['A', 'C'] }] }),
      scheduled('c-p1-1', 'A', 'C'),
    ]);
    expect(redrawn.teams?.matches.map(m => [m.matchId, m.teamBId])).toEqual([['c-p1-1', 'C']]);
    // Rencontre retirée par le nouveau tirage : ses résultats aussi
    expect(redrawn.teams?.relayResults).toEqual({});
    expect(redrawn.teams?.decisions).toEqual({});
    expect(projectCompetition([]).teams).toBeNull();
  });
});

describe('projectCompetition : relais et tableau d’équipes (docs/adr/0024, lot E2)', () => {
  const tableauMatch = (matchId: string, round: number, position: number, a: string, b: string) =>
    ev('TeamMatchScheduled', {
      matchId,
      teamAId: a,
      teamBId: b,
      pool: null,
      round,
      position,
      relays: [
        { relayId: `${matchId}-r1`, order: 1, fencerAId: `${a}1`, fencerBId: `${b}1` },
        { relayId: `${matchId}-r2`, order: 2, fencerAId: `${a}2`, fencerBId: `${b}2` },
      ],
    });
  const slots = [
    { round: 2, position: 0, teamAId: 'A', teamBId: 'D', isBye: false },
    { round: 2, position: 1, teamAId: 'B', teamBId: 'C', isBye: false },
  ];
  const start = [
    ev('TeamTableauGenerated', { size: 4, slots }),
    tableauMatch('t2-0', 2, 0, 'A', 'D'),
    tableauMatch('t2-1', 2, 1, 'B', 'C'),
  ];
  const decideFirst = [
    ev('RelayScoreRecorded', { matchId: 't2-0', relayId: 't2-0-r1', scoreA: 5, scoreB: 1 }),
    ev('RelayScoreRecorded', { matchId: 't2-0', relayId: 't2-0-r2', scoreA: 5, scoreB: 4 }),
    ev('TeamMatchDecided', { matchId: 't2-0', winnerTeamId: 'A' }),
    ev('RelayScoreRecorded', { matchId: 't2-1', relayId: 't2-1-r1', scoreA: 0, scoreB: 5 }),
    ev('RelayScoreRecorded', { matchId: 't2-1', relayId: 't2-1-r2', scoreA: 5, scoreB: 5 }),
    ev('TeamMatchDecided', { matchId: 't2-1', winnerTeamId: 'C' }),
    tableauMatch('t1-0', 1, 0, 'A', 'C'),
  ];

  it('tableau tiré : journal complet ; scores des relais, rencontres décidées, finale formée', () => {
    const facts = projectCompetition([...start, ...decideFirst]);
    expect(facts.complete).toBe(true);
    expect(facts.teams?.tableau).toEqual({ size: 4, slots });
    expect(facts.teams?.relayResults['t2-0-r2']).toEqual({ matchId: 't2-0', scoreA: 5, scoreB: 4 });
    expect(facts.teams?.decisions).toEqual({ 't2-0': 'A', 't2-1': 'C' });
    expect(facts.teams?.matches.map(m => m.matchId)).toEqual(['t2-0', 't2-1', 't1-0']);
  });

  it('relais rouvert : résultat et décision retirés, rencontre suivante retirée', () => {
    const facts = projectCompetition([
      ...start,
      ...decideFirst,
      ev('RelayReopened', { matchId: 't2-1', relayId: 't2-1-r2' }),
    ]);
    expect(facts.teams?.relayResults['t2-1-r2']).toBeUndefined();
    expect(facts.teams?.relayResults['t2-1-r1']).toBeDefined();
    expect(facts.teams?.decisions).toEqual({ 't2-0': 'A' });
    expect(facts.teams?.matches.map(m => m.matchId)).toEqual(['t2-0', 't2-1']);
    // Relais rouvert d'une rencontre non décidée : rien d'autre ne bouge
    const again = projectCompetition([
      ...start,
      ev('RelayScoreRecorded', { matchId: 't2-0', relayId: 't2-0-r1', scoreA: 5, scoreB: 1 }),
      ev('RelayReopened', { matchId: 't2-0', relayId: 't2-0-r1' }),
    ]);
    expect(again.teams?.relayResults).toEqual({});
    expect(again.teams?.matches).toHaveLength(2);
  });

  it('remplaçant : tireur changé dans les relais nommés ; nouveau tableau remplace le précédent', () => {
    const facts = projectCompetition([
      ...start,
      ev('TeamFencerSubstituted', {
        matchId: 't2-1',
        teamId: 'C',
        outFencerId: 'C2',
        inFencerId: 'C4',
        relayIds: ['t2-1-r2'],
      }),
    ]);
    const m = facts.teams?.matches.find(x => x.matchId === 't2-1');
    expect(m?.relays.map(r => r.fencerBId)).toEqual(['C1', 'C4']);
    const redrawn = projectCompetition([
      ...start,
      ...decideFirst,
      ev('TeamTableauGenerated', { size: 2, slots: [{ ...slots[0], round: 1 }] }),
    ]);
    expect(redrawn.teams?.matches).toEqual([]);
    expect(redrawn.teams?.relayResults).toEqual({});
    expect(redrawn.teams?.decisions).toEqual({});
  });

  it('tirage du tableau (ADR-0045) : rejoué ; événement antérieur sans draw lisible', () => {
    const draw = { mode: 'pairs' as const, seed: 42, order: ['a', 'b'] };
    const withDraw = ev('TableauGenerated', {
      ...(tableau.payload as Extract<JournalEventBody, { type: 'TableauGenerated' }>['payload']),
      draw,
    });
    expect(projectCompetition([drawn(1), withDraw]).tableau?.draw).toEqual(draw);
    const old = projectCompetition([drawn(1), tableau]).tableau;
    expect(old?.slots).toHaveLength(1);
    expect(old).not.toHaveProperty('draw');
    const team = ev('TeamTableauGenerated', {
      size: 2,
      slots: [{ round: 1, position: 0, teamAId: 'a', teamBId: 'b', isBye: false }],
      draw: { mode: 'random', seed: 7, order: ['b', 'a'] },
    });
    expect(projectCompetition([team]).teams?.tableau?.draw).toEqual({
      mode: 'random',
      seed: 7,
      order: ['b', 'a'],
    });
  });
});
