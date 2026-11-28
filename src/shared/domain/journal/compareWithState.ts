/**
 * BPM - Escrime - Écarts entre le journal rejoué et l'état de l'épreuve (#1980, docs/adr/0017)
 * Compare les faits de projectCompetition à la projection tenue par le moteur (session_state)
 * et aux statuts des tables. Écarts en identifiants et nombres seulement (RGPD).
 * Licensed under GPL-3.0
 */
import { MatchStatus, type Match, type Pool, type PoolRanking } from '../../types';
import type { ConsolationBracket, TableauMatch } from '../tableau/tableauTypes';
import type {
  CompetitionFacts,
  MatchFact,
  PoolFact,
  TableauDrawFact,
  TableauFact,
  TeamsFact,
} from './projectCompetition';
import { sessionGroupTableaux } from '../ranking/splitGroups';
import { tableauDrawStateOf, type TableauDrawState } from '../tableau/tableauDraw';
import { poolWavesOf } from '../pools/waves';

export type DivergenceKind =
  | 'fencer_status'
  | 'pool_round'
  | 'pool_missing'
  | 'pool_fencers'
  | 'pool_matches'
  | 'pool_result'
  | 'pools_skipped'
  | 'tableau_missing'
  | 'tableau_unexpected'
  | 'tableau_slot'
  | 'tableau_draw'
  | 'bracket_result'
  | 'bracket_result_unknown'
  | 'waves'
  | 'split_off'
  | 'imported_ranking'
  | 'team_pool'
  | 'team_match_missing'
  | 'team_match'
  | 'team_match_unexpected'
  | 'team_relay'
  | 'team_match_result'
  | 'team_cards'
  | 'strip_plan'
  | 'split_history';

export interface Divergence {
  kind: DivergenceKind;
  /** Tireur, poule, match ou tour concerné */
  id: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Épreuve par équipes : rencontres et relais lus dans les tables (team_matches, team_bouts),
 * projection écrite par le seul moteur (docs/adr/0024)
 */
export interface TeamStateView {
  matches: Array<{
    id: string;
    teamAId: string;
    teamBId: string;
    /** Poule ; null au tableau */
    pool: number | null;
    round: number | null;
    position: number | null;
    /** Rencontre terminée et son vainqueur (lot E2) */
    finished: boolean;
    winnerId: string | null;
    relays: Array<{
      id: string;
      order: number;
      fencerAId: string;
      fencerBId: string;
      /** Score du relais (le fait) ; comparé quand le relais est terminé */
      scoreA: number;
      scoreB: number;
      finished: boolean;
    }>;
    /**
     * Cartons des tables (team_match_cards, team_bout_cards), docs/adr/0028 ; undefined : non
     * comparés
     */
    cards?: Array<{
      id: string;
      type: string;
      teamId?: string;
      relayId?: string;
      fencerId?: string;
    }>;
  }>;
}

/** Projection du moteur utile à la comparaison (session_state) */
export interface CompetitionStateView {
  pools: Pool[];
  poolHistory: Pool[][];
  currentPoolRound: number;
  skipPoolPhase?: boolean;
  tableauMatches: TableauMatch[];
  consolationBrackets: ConsolationBracket[];
  /** Tirage du tableau unique ou du tableau d'équipes (docs/adr/0045) ; absent : non comparé */
  tableauDraw?: TableauDrawState | null;
  /** Tableaux séparés après les poules : tableau de chaque groupe (docs/adr/0024) */
  groupTableaux?: Record<
    string,
    {
      tableauMatches: TableauMatch[];
      consolationBrackets: ConsolationBracket[];
      tableauDraw?: TableauDrawState;
    }
  >;
  /** Vagues du tour courant (clé `waves`) */
  waves?: { launched?: number; ended?: boolean };
  /** Ancienne clé des rapières, lue comme alias de `waves` pour les épreuves enregistrées (docs/adr/0043, F4e) */
  rapieres?: { launchedWave?: number; wavesEnded?: boolean };
  /** Classement après poules (épreuve séparée : classement importé) */
  overallRanking?: PoolRanking[];
  /**
   * Groupes extraits (réglage splitOffCompetitionIds de l'épreuve) ; undefined : non comparés
   */
  splitOffCompetitionIds?: Partial<Record<string, string>>;
  /**
   * Scission de la formule (docs/adr/0039) : `splitHistory` de l'état de session ; undefined :
   * épreuve jamais scindée par splitCompetition, non comparée (tableaux séparés : splitOff)
   */
  splitHistory?: Array<{ label: string; competitionId: string; fencerIds: string[] }>;
  /** Épreuve par équipes : tables des rencontres ; undefined : non comparées */
  teams?: TeamStateView;
  /** Plan des pistes en base (docs/adr/0015) ; undefined : non comparé */
  strips?: { start: number; unavailable: number[] };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Écart entre un résultat du journal et un match de poule ; null : conforme */
function poolResultGap(
  fact: MatchFact | null,
  m: Match
): { expected: unknown; actual: unknown } | null {
  const played = m.status === MatchStatus.FINISHED;
  const actual = played
    ? {
        scoreA: m.scoreA?.value ?? null,
        scoreB: m.scoreB?.value ?? null,
        winnerId: (m.scoreA?.isVictory ? m.fencerA : m.fencerB)?.id ?? null,
      }
    : null;
  if (!fact) return played ? { expected: null, actual } : null;
  if (!played) return { expected: fact, actual: null };
  if (fact.scoreA !== undefined && fact.scoreA !== actual!.scoreA)
    return { expected: fact, actual };
  if (fact.scoreB !== undefined && fact.scoreB !== actual!.scoreB)
    return { expected: fact, actual };
  if (fact.winnerId !== undefined && fact.winnerId !== actual!.winnerId) {
    return { expected: fact, actual };
  }
  if (fact.loserId) {
    const lost = m.fencerA?.id === fact.loserId ? !m.scoreA?.isVictory : !m.scoreB?.isVictory;
    if (!lost) return { expected: fact, actual };
  }
  return null;
}

function comparePool(fact: PoolFact, pool: Pool | undefined, out: Divergence[]): void {
  if (!pool) {
    out.push({ kind: 'pool_missing', id: fact.poolId });
    return;
  }
  const fencerIds = pool.fencers.map(f => f.id);
  if (!same([...fact.fencerIds].sort(), [...fencerIds].sort())) {
    out.push({
      kind: 'pool_fencers',
      id: fact.poolId,
      expected: fact.fencerIds,
      actual: fencerIds,
    });
  }
  const pairs = (pool.matches ?? []).map(m => [m.id, m.fencerA?.id, m.fencerB?.id]);
  const expectedPairs = fact.matches.map(m => [m.matchId, m.fencerAId, m.fencerBId]);
  if (!same(expectedPairs, pairs)) {
    out.push({ kind: 'pool_matches', id: fact.poolId, expected: expectedPairs, actual: pairs });
  }
  for (const mf of fact.matches) {
    const m = pool.matches?.find(x => x.id === mf.matchId);
    if (!m) continue;
    const gap = poolResultGap(mf.result, m);
    if (gap) out.push({ kind: 'pool_result', id: mf.matchId, ...gap });
  }
}

function bracketResultGap(fact: MatchFact, m: TableauMatch): boolean {
  if (!m.winner) return true;
  if (fact.winnerId !== undefined && fact.winnerId !== m.winner.id) return true;
  if (fact.loserId && m.winner.id === fact.loserId) return true;
  if (fact.scoreA !== undefined && fact.scoreA !== m.scoreA) return true;
  if (fact.scoreB !== undefined && fact.scoreB !== m.scoreB) return true;
  return false;
}

/**
 * Écarts entre les faits du journal et l'état de l'épreuve. Seuls les faits rejouables sont
 * comparés ; un journal incomplet (épreuve antérieure) ne couvre que ce qu'il contient.
 */
export function compareWithState(
  facts: CompetitionFacts,
  state: CompetitionStateView,
  fencerStatus: Record<string, string | undefined>
): Divergence[] {
  const out: Divergence[] = [];

  for (const [fencerId, expected] of Object.entries(facts.fencerStatus)) {
    if (fencerStatus[fencerId] !== expected) {
      out.push({ kind: 'fencer_status', id: fencerId, expected, actual: fencerStatus[fencerId] });
    }
  }

  const last = facts.rounds[facts.rounds.length - 1];
  if (last) {
    const expectedRound = last.closed ? last.round + 1 : last.round;
    if (state.currentPoolRound !== expectedRound) {
      out.push({
        kind: 'pool_round',
        id: String(last.round),
        expected: expectedRound,
        actual: state.currentPoolRound,
      });
    }
  }
  for (const round of facts.rounds) {
    const pools =
      round.round === state.currentPoolRound ? state.pools : state.poolHistory[round.round - 1];
    for (const pf of round.pools) {
      comparePool(
        pf,
        (pools ?? []).find(p => p.id === pf.poolId),
        out
      );
    }
  }

  if (facts.skippedPoolsFencerIds && !state.skipPoolPhase) {
    out.push({ kind: 'pools_skipped', id: 'pools', expected: true, actual: false });
  }

  // Tableau unique, puis tableau de chaque groupe (docs/adr/0024)
  const groups = state.groupTableaux ?? {};
  compareTableau(facts.tableau, state.tableauMatches, 'tableau', facts.complete, out);
  for (const group of new Set([...Object.keys(facts.groupTableaux), ...Object.keys(groups)])) {
    compareTableau(
      facts.groupTableaux[group] ?? null,
      groups[group]?.tableauMatches ?? [],
      group,
      facts.complete,
      out
    );
    compareDraw(facts.groupTableaux[group]?.draw, groups[group]?.tableauDraw ?? null, group, out);
  }
  // Tirage rejoué (docs/adr/0045) : tableau unique, ou tableau d'équipes
  if (state.tableauDraw !== undefined)
    compareDraw(
      facts.tableau?.draw ?? facts.teams?.tableau?.draw,
      state.tableauDraw,
      'tableau',
      out
    );
  const matchesOf = (t: {
    tableauMatches: TableauMatch[];
    consolationBrackets: ConsolationBracket[];
  }) => [...t.tableauMatches, ...t.consolationBrackets.flatMap(b => b.matches)];
  // Matchs des tableaux que le journal connaît (tirage journalisé)
  const known = [
    ...(facts.tableau ? matchesOf(state) : []),
    ...Object.keys(facts.groupTableaux).flatMap(g => (groups[g] ? matchesOf(groups[g]) : [])),
  ];
  const allBracket = [matchesOf(state), ...Object.values(groups).map(matchesOf)].flat();

  for (const [matchId, fact] of Object.entries(facts.bracketResults)) {
    const m = allBracket.find(x => x.id === matchId);
    if (!m || bracketResultGap(fact, m)) {
      out.push({
        kind: 'bracket_result',
        id: matchId,
        expected: fact,
        actual: m ? { scoreA: m.scoreA, scoreB: m.scoreB, winnerId: m.winner?.id ?? null } : null,
      });
    }
  }
  // Décision de l'état absente du journal (exemptions mises à part : elles se déduisent),
  // dans les tableaux que le journal connaît
  for (const m of known) {
    if (m.winner && !m.isBye && m.fencerA && m.fencerB && !(m.id in facts.bracketResults)) {
      out.push({ kind: 'bracket_result_unknown', id: m.id, actual: m.winner.id });
    }
  }

  // Tableaux séparés (docs/adr/0024, lot A3) : groupe extrait noté sur l'épreuve d'origine
  if (state.splitOffCompetitionIds) {
    for (const [group, fact] of Object.entries(facts.splitOffGroups)) {
      const actual = state.splitOffCompetitionIds[group] ?? null;
      if (actual !== fact.targetCompetitionId) {
        out.push({ kind: 'split_off', id: group, expected: fact.targetCompetitionId, actual });
      }
    }
  }
  // Scission de la formule (docs/adr/0039) : historique rejoué depuis GroupSplitOff
  if (state.splitHistory) {
    const key = (h: { label: string; competitionId: string; fencerIds: string[] }) => ({
      label: h.label,
      competitionId: h.competitionId,
      fencerIds: [...h.fencerIds].sort(),
    });
    const expected = facts.splitHistory.map(key);
    const actual = state.splitHistory.map(key);
    if (!same(expected, actual)) {
      out.push({ kind: 'split_history', id: 'splitHistory', expected, actual });
    }
  }
  // Épreuve séparée : tireurs du classement importé (les rangs peuvent être ajustés ensuite)
  if (facts.importedRanking) {
    const expected = facts.importedRanking.ranking.map(r => r.fencerId).sort();
    const actual = (state.overallRanking ?? []).map(r => r.fencer.id).sort();
    if (!same(expected, actual)) {
      out.push({ kind: 'imported_ranking', id: facts.importedRanking.group, expected, actual });
    }
  }

  if (state.teams) compareTeams(facts.teams, state.teams, facts.complete, out);
  if (state.strips && facts.strips) compareStrips(facts.strips, state.strips, out);

  if (facts.waves) {
    const now = poolWavesOf(state);
    const actual = { wave: now.launched, ended: now.ended };
    if (!same(facts.waves, actual)) {
      out.push({ kind: 'waves', id: 'waves', expected: facts.waves, actual });
    }
  }
  return out;
}

/** Rencontres d'équipes et leurs relais comparés au journal (docs/adr/0024) */
function compareTeams(
  fact: TeamsFact | null,
  state: TeamStateView,
  complete: boolean,
  out: Divergence[]
): void {
  for (const pool of fact?.pools ?? []) {
    const actual = [
      ...new Set(
        state.matches.filter(m => m.pool === pool.number).flatMap(m => [m.teamAId, m.teamBId])
      ),
    ].sort();
    if (!same([...pool.teamIds].sort(), actual)) {
      out.push({ kind: 'team_pool', id: String(pool.number), expected: pool.teamIds, actual });
    }
  }
  const shape = (
    m: {
      teamAId: string;
      teamBId: string;
      pool: number | null;
      round: number | null;
      position: number | null;
      relays: Array<{ order: number; fencerAId: string; fencerBId: string }>;
    },
    ids: string[]
  ) => ({
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    pool: m.pool,
    round: m.round,
    position: m.position,
    relays: m.relays.map((r, i) => [ids[i], r.order, r.fencerAId, r.fencerBId]),
  });
  for (const mf of fact?.matches ?? []) {
    const m = state.matches.find(x => x.id === mf.matchId);
    if (!m) {
      out.push({ kind: 'team_match_missing', id: mf.matchId });
      continue;
    }
    const expected = shape(
      mf,
      mf.relays.map(r => r.relayId)
    );
    const actual = shape(
      m,
      m.relays.map(r => r.id)
    );
    if (!same(expected, actual)) out.push({ kind: 'team_match', id: mf.matchId, expected, actual });
    compareTeamResults(fact!, mf.matchId, m, out);
    compareTeamCards(fact!, mf, m, out);
  }
  // Journal complet : toute rencontre des tables vient du journal
  if (complete) {
    const known = new Set((fact?.matches ?? []).map(m => m.matchId));
    for (const m of state.matches) {
      if (!known.has(m.id)) out.push({ kind: 'team_match_unexpected', id: m.id });
    }
  }
}

/**
 * Résultats d'une rencontre du journal (lot E2) : relais terminés et leur score, rencontre
 * terminée et son vainqueur. Un relais en cours (touches de l'arène ou de l'écran) n'est pas un
 * fait : seul son statut « non terminé » est comparé.
 */
function compareTeamResults(
  fact: TeamsFact,
  matchId: string,
  m: TeamStateView['matches'][number],
  out: Divergence[]
): void {
  for (const r of m.relays) {
    const result = fact.relayResults[r.id];
    const expected = result
      ? { finished: true, scoreA: result.scoreA, scoreB: result.scoreB }
      : { finished: false };
    const actual = r.finished
      ? { finished: true, scoreA: r.scoreA, scoreB: r.scoreB }
      : { finished: false };
    if (!same(expected, actual)) out.push({ kind: 'team_relay', id: r.id, expected, actual });
  }
  const expected =
    matchId in fact.decisions
      ? { finished: true, winnerId: fact.decisions[matchId] }
      : { finished: false, winnerId: null };
  const actual = { finished: m.finished, winnerId: m.finished ? m.winnerId : null };
  if (!same(expected, actual)) {
    out.push({ kind: 'team_match_result', id: matchId, expected, actual });
  }
}

/**
 * Cartons d'une rencontre (docs/adr/0028 § 10) : identifiant, type, équipe ou relais et tireur.
 * Épreuve antérieure au lot C1 : une rencontre sans carton au journal, créée avant le premier
 * carton du journal, garde ses cartons des tables sans écart (repris tels quels).
 */
function compareTeamCards(
  fact: TeamsFact,
  mf: TeamsFact['matches'][number],
  m: TeamStateView['matches'][number],
  out: Divergence[]
): void {
  if (!m.cards) return;
  const journaled = (fact.cardMatchIds ?? []).includes(mf.matchId) || !!mf.afterCards;
  if (!journaled && m.cards.length > 0) return;
  const key = (c: { type: string; teamId?: string; relayId?: string; fencerId?: string }) => [
    c.type,
    c.teamId ?? null,
    c.relayId ?? null,
    c.fencerId ?? null,
  ];
  const expected = (fact.cards ?? [])
    .filter(c => c.matchId === mf.matchId)
    .map(c => [c.cardId, ...key(c)])
    .sort();
  const actual = m.cards.map(c => [c.id, ...key(c)]).sort();
  if (!same(expected, actual)) out.push({ kind: 'team_cards', id: mf.matchId, expected, actual });
}

/**
 * Tirage du tableau (docs/adr/0045) comparé à celui du journal : mode, graine et ordre d'entrée
 * tiré ; un tableau du journal sans tirage (événement antérieur) n'est pas comparé
 */
function compareDraw(
  fact: TableauDrawFact | undefined,
  state: TableauDrawState | null,
  id: string,
  out: Divergence[]
): void {
  if (!fact) return;
  const actual = state ? { mode: state.mode, seed: state.seed, order: state.order } : null;
  const expected = { mode: fact.mode, seed: fact.seed, order: fact.order };
  if (!same(expected, actual)) out.push({ kind: 'tableau_draw', id, expected, actual });
}

/** Placement du tableau (unique ou d'un groupe) comparé au tirage du journal */
function compareTableau(
  fact: TableauFact | null,
  matches: TableauMatch[],
  id: string,
  complete: boolean,
  out: Divergence[]
): void {
  if (!fact) {
    if (complete && matches.length > 0) {
      out.push({ kind: 'tableau_unexpected', id, actual: matches.length });
    }
    return;
  }
  if (matches.length === 0) {
    out.push({ kind: 'tableau_missing', id, expected: fact.size });
    return;
  }
  for (const slot of fact.slots) {
    const m = matches.find(x => x.id === slot.matchId);
    const gap =
      !m ||
      m.round !== slot.round ||
      m.position !== slot.position ||
      !!m.isBye !== slot.isBye ||
      (slot.fencerAId !== null && m.fencerA?.id !== slot.fencerAId) ||
      (slot.fencerBId !== null && m.fencerB?.id !== slot.fencerBId);
    if (gap) {
      out.push({
        kind: 'tableau_slot',
        id: slot.matchId,
        expected: slot,
        actual: m
          ? {
              round: m.round,
              position: m.position,
              isBye: !!m.isBye,
              fencerAId: m.fencerA?.id ?? null,
              fencerBId: m.fencerB?.id ?? null,
            }
          : null,
      });
    }
  }
}

/**
 * Vue de comparaison lue dans l'état de session du moteur ; réglages de l'épreuve fournis :
 * groupes extraits comparés au journal (docs/adr/0024)
 */
export function stateView(
  session: Record<string, unknown>,
  settings?: { splitOffCompetitionIds?: Partial<Record<string, string>> } | null
): CompetitionStateView {
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    overallRanking: list<PoolRanking>(session.overallRanking),
    ...(settings ? { splitOffCompetitionIds: settings.splitOffCompetitionIds ?? {} } : {}),
    pools: list<Pool>(session.pools),
    poolHistory: list<Pool[]>(session.poolHistory),
    currentPoolRound: Number(session.currentPoolRound ?? 1),
    skipPoolPhase: session.skipPoolPhase === true,
    tableauMatches: list<TableauMatch>(session.tableauMatches),
    consolationBrackets: list<ConsolationBracket>(session.consolationBrackets),
    // Tirage comparé dès que l'état porte un tableau unique ou un tirage (docs/adr/0045)
    ...('tableauDraw' in session || list(session.tableauMatches).length > 0
      ? { tableauDraw: tableauDrawStateOf(session.tableauDraw) }
      : {}),
    groupTableaux: sessionGroupTableaux(session),
    waves: session.waves as CompetitionStateView['waves'],
    rapieres: session.rapieres as CompetitionStateView['rapieres'],
    ...(Array.isArray(session.splitHistory)
      ? { splitHistory: session.splitHistory as CompetitionStateView['splitHistory'] }
      : {}),
  };
}

/**
 * Plan des pistes (docs/adr/0015) : piste de départ et pistes nommées par le journal ; une
 * piste jamais journalisée (reprise de la migration 50) n'est pas comparée
 */
function compareStrips(
  fact: NonNullable<CompetitionFacts['strips']>,
  state: { start: number; unavailable: number[] },
  out: Divergence[]
): void {
  if (fact.start !== null && fact.start !== state.start) {
    out.push({ kind: 'strip_plan', id: 'start', expected: fact.start, actual: state.start });
  }
  for (const [strip, available] of Object.entries(fact.available)) {
    const actual = !state.unavailable.includes(Number(strip));
    if (actual !== available) {
      out.push({ kind: 'strip_plan', id: strip, expected: available, actual });
    }
  }
}
