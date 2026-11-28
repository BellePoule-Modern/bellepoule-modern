/**
 * BPM - Escrime - Relais et tableau d'équipes par le moteur (docs/adr/0024, lot E2)
 * generateTeamTableau, recordRelayScore, reopenRelay, substituteTeamFencer : écritures de
 * team_matches et team_bouts dans la transaction de la commande (runCommand), heure fournie,
 * journal RelayScoreRecorded, RelayReopened, TeamMatchDecided, TeamFencerSubstituted,
 * TeamTableauGenerated, TeamMatchScheduled. Le score de la rencontre est le cumul des relais
 * terminés, calculé ici (pas de recalcul par la base). Règles : shared/domain/teams.
 * Mêmes commandes pour l'écran (TeamManagerView, lot E3), la tablette `/equipe{N}` et les
 * appareils de piste (`teamArena`, `teamRelayDevice`, lot E4).
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { Competition } from '../../../shared/types';
import type { teamRelayOperations } from '../../../shared/api/contractTeams';
import type { TeamMatchRow, TeamRow } from '../../../shared/domain/teams/team.types';
import {
  canRecordRelay,
  planSubstitution,
  relayMaxScore,
  relayRuleOf,
  relayScoreAboveMax,
  relayWinner,
  reserves,
  teamFormatOf,
  teamMatchOutcome,
  teamSizeOf,
  titulars,
  type RelayScore,
} from '../../../shared/domain/teams/relay';
import {
  isThirdPlaceSlot,
  nextTableauSlot,
  planTeamTableau,
  planTeamTableauMatches,
  tableauSeedIds,
  THIRD_PLACE_SLOT,
  type TeamTableauMatchPlan,
  type TeamTableauMatchState,
  type TeamTableauOptions,
} from '../../../shared/domain/teams/teamTableau';
import {
  relayPairsOf,
  teamFormulaOf,
  teamPoolRoundOf,
  teamTableauOf,
} from '../../../shared/domain/teams/teamMatchRule';
import {
  phaseSettings,
  tableauDrawOf,
  type PhaseRef,
} from '../../../shared/domain/formula/formulaV2';
import { randomInt } from 'crypto';
import { drawTableau, type TableauDrawMode } from '../../../shared/domain/tableau/tableauDraw';
import { teamDrawEntries } from '../../../shared/domain/teams/teamEntryRanking';
import { readSession } from './sessionView';
import { relayPenaltyTouches } from '../../../shared/domain/teams/teamCards';
import { involvesWithdrawn } from '../../../shared/domain/teams/teamWithdrawal';
import type { NewJournalEvent } from '../../../database/repos/eventLogRepo';
import { CommandError, type CommandContext } from './context';
import { EVENT, recordEvents } from './eventLog';
import {
  changed,
  fencerRankingOf,
  rankable,
  tableauEntryOf,
  tableauOf,
  teamCompetitionOrThrow,
  teamRuleOf,
  withdrawnTeams,
} from './teams';

type Ops = typeof teamRelayOperations;
type Handler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']>;

export type MatchRow = NonNullable<ReturnType<CommandContext['db']['teams']['getTeamMatch']>>;

const iso = (now: Date, offsetMs = 0) => new Date(now.getTime() + offsetMs).toISOString();

export function matchOrThrow(
  ctx: CommandContext,
  competitionId: string,
  matchId: string
): MatchRow {
  const m = ctx.db.teams.getTeamMatch(matchId);
  if (!m || m.competitionId !== competitionId) {
    throw new CommandError('match_not_found', `Rencontre introuvable : ${matchId}`);
  }
  return m;
}

const relayScores = (m: MatchRow): RelayScore[] =>
  m.bouts.map(b => ({
    order: b.boutOrder,
    scoreA: b.scoreA,
    scoreB: b.scoreB,
    finished: b.status === 'finished',
  }));

/** Rencontre de tableau (tableau d'équipes : table_id posé, tour et position) */
const isTableau = (m: MatchRow) => m.tableId !== null && m.round !== null && m.position !== null;

/** Phase d'une rencontre : tableau ou tour de poules (docs/adr/0044) */
const phaseOfMatch = (m: MatchRow): PhaseRef =>
  isTableau(m) ? { kind: 'tableau' } : { kind: 'pool', round: 0 };

/**
 * Règle de rencontre du tableau (docs/adr/0044) : titulaires, ordre des relais et palier de la
 * phase, petite finale de la formule d'équipe ; épreuve sans formule d'équipe : réglages
 * d'épreuve, sans petite finale (inchangé). Petite finale d'un tableau tiré : celle du tirage,
 * la formule ne pouvant plus la changer (verrou S6, docs/adr/0041 : storedProgress lit les
 * rencontres d'équipe, teamFormulaProgress).
 */
export function tableauSetup(comp: Competition): {
  teamSize: number;
  maxScore: number;
  options: TeamTableauOptions;
} {
  const rule = teamRuleOf(comp, { kind: 'tableau' });
  const formula = teamFormulaOf(comp);
  const arena = teamFormatOf(comp.settings) === 'laser-arena';
  return {
    teamSize: arena ? teamSizeOf(comp.settings) : rule.starters,
    maxScore: arena ? relayMaxScore(comp.weapon, comp.settings) : rule.relayStep,
    options: {
      ...(arena ? {} : { pairs: relayPairsOf(rule) }),
      thirdPlace: !!(formula && phaseSettings(formula, { kind: 'tableau' })?.thirdPlace),
    },
  };
}

/**
 * Règle de relais d'une rencontre (palier, cible) : figée à sa création avec la règle de sa
 * phase (docs/adr/0044) ; formule d'équipe : palier et titulaires lus dans ses relais (une
 * formule changée ensuite ne la change pas) ; sinon réglages d'épreuve (inchangé)
 */
export function matchRelayRule(comp: Competition, m: MatchRow) {
  const base = relayRuleOf(comp.weapon, comp.settings);
  if (!teamFormulaOf(comp) || m.bouts.length === 0) return base;
  const starters = Math.round(Math.sqrt(m.bouts.length));
  const stepSize = m.bouts[0].maxScore;
  return { ...base, stepSize, target: stepSize * starters * starters };
}

/** Rencontre jouée : un relais au moins commencé ou terminé */
export const played = (m: { status: string; bouts: Array<{ status: string }> }) =>
  m.status !== 'not_started' || m.bouts.some(b => b.status !== 'not_started');

const teamsOf = (ctx: CommandContext, comp: Competition) =>
  ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[];

const tableauMatchesOf = (ctx: CommandContext, comp: Competition) =>
  ctx.db.teams.getTeamTableauMatches(comp.id, comp.id) as Array<
    TeamMatchRow & TeamTableauMatchState
  >;

/** Équipes du tableau tiré, dans l'ordre d'entrée (têtes de série, fait du journal) */
export function tableauSeeds(ctx: CommandContext, comp: Competition): TeamRow[] {
  const byId = new Map(teamsOf(ctx, comp).map(t => [t.id, t]));
  return tableauSeedIds(tableauOf(ctx, comp)).flatMap(id => byId.get(id) ?? []);
}

/** Rencontre d'une équipe retirée ou exclue : plus de relais (docs/adr/0028 § 4) */
export function assertNoWithdrawnTeam(ctx: CommandContext, comp: Competition, m: MatchRow) {
  const withdrawn = withdrawnTeams(ctx, comp.id);
  if (involvesWithdrawn(m, new Set(withdrawn.keys()))) {
    throw new CommandError('team_withdrawn', 'Équipe retirée ou exclue : rencontre close');
  }
}

/** Rencontres de tableau et leurs relais écrites, événements TeamMatchScheduled rendus */
function insertTableauMatches(
  ctx: CommandContext,
  comp: Competition,
  plans: TeamTableauMatchPlan[],
  now: Date
): NewJournalEvent[] {
  const { maxScore, teamSize } = tableauSetup(comp);
  return plans.map((m, k) => {
    if (!m.relays) {
      throw new CommandError(
        'team_incomplete',
        `Titulaires manquants (${teamSize} par équipe) : rencontre ${m.matchId}`
      );
    }
    // Une milliseconde par rencontre : ordre stable de création
    const createdAt = iso(now, k);
    ctx.db.teams.insertTeamTableauMatch({
      id: m.matchId,
      competitionId: comp.id,
      round: m.round,
      position: m.position,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      createdAt,
    });
    for (const r of m.relays) {
      ctx.db.teams.insertTeamBout({ ...r, id: r.relayId, matchId: m.matchId, maxScore, createdAt });
    }
    return {
      type: EVENT.teamMatchScheduled,
      payload: {
        matchId: m.matchId,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        pool: null,
        round: m.round,
        position: m.position,
        relays: m.relays,
      },
    };
  });
}

// ─── Tableau d'équipes ──────────────────────────────────────────────────────

export function generateTeamTableau(
  ctx: CommandContext,
  input: { competitionId: string; replace?: boolean; dryRun?: boolean; seed?: number },
  now: Date = new Date(),
  /** Hasard injecté : ex aequo à la barre tirés au sort (ADR-0040) */
  random: () => number = Math.random
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const formula = teamFormulaOf(comp);
  if (formula && !teamTableauOf(formula)) {
    throw new CommandError('no_direct_elimination', 'Formule de l’épreuve sans tableau');
  }
  const teams = teamsOf(ctx, comp);
  if (teams.length < 2) {
    throw new CommandError(
      'invalid_composition',
      `Au moins 2 équipes (${teams.length} inscrite(s))`
    );
  }
  const setup = tableauSetup(comp);
  const teamSize = setup.teamSize;
  const incomplete = teams.filter(t => titulars(t, teamSize).length < teamSize).map(t => t.id);
  if (incomplete.length > 0) {
    throw new CommandError(
      'team_incomplete',
      `Titulaires manquants (${teamSize} par équipe) : ${incomplete.join(', ')}`
    );
  }
  // o.99.8 : les rencontres d'une équipe retirée ne comptent plus, l'équipe n'est pas classée
  const ranked = rankable(ctx, comp);
  if (ranked.matches.some(m => m.status !== 'finished')) {
    throw new CommandError('pools_not_complete', 'Rencontres de poule non terminées');
  }
  // Formule d'équipe avec un tour de poules : poules tirées et jouées d'abord
  if (formula && teamPoolRoundOf(formula) && ranked.matches.length === 0) {
    throw new CommandError('pools_not_complete', 'Poules d’équipes pas encore tirées');
  }
  const existing = tableauMatchesOf(ctx, comp);
  if (existing.length > 0) {
    if (!input.replace) {
      throw new CommandError(
        'bracket_exists',
        'Tableau d’équipes déjà créé (« replace » pour refaire)'
      );
    }
    if (existing.some(played)) {
      throw new CommandError('bracket_has_scores', 'Relais du tableau d’équipes déjà joués');
    }
  }
  const qualified = tableauEntryOf(ctx, comp, random).qualified;
  if (qualified.length < 2) {
    throw new CommandError('not_enough_qualifiers', 'Moins de 2 équipes qualifiées');
  }
  // Tirage (docs/adr/0045) : mode de la formule (arène Sabre Laser : strict, évitement de
  // revanche) ; tableau sans poule : rang effectif égal et sans rang tirés (ADR-0044 amendée)
  const mode: TableauDrawMode =
    teamFormatOf(comp.settings) === 'laser-arena' ? 'strict' : tableauDrawOf(comp.settings);
  const byEntryRank = !!formula && !teamPoolRoundOf(formula);
  const seed = input.seed ?? randomInt(0, 2 ** 32);
  const drawn = drawTableau(
    byEntryRank
      ? teamDrawEntries(qualified, teamRuleOf(comp).starters, fencerRankingOf(ctx, comp.id))
      : qualified.map((t, i) => ({ id: t.id, entryRank: i + 1 })),
    { mode, seed, byEntryRank }
  );
  const byId = new Map(qualified.map(t => [t.id, t]));
  const tableau = planTeamTableau(drawn.slots.map(id => byId.get(id)!));
  const plans = planTeamTableauMatches(
    comp.id,
    tableau,
    [],
    teams,
    teamSize,
    comp.weapon,
    setup.options
  );
  const out = {
    size: tableau.size,
    slots: tableau.slots,
    matchIds: plans.map(m => m.matchId),
    // Rejouer la commande avec cette graine donne ce tableau (docs/adr/0045)
    draw: { mode, seed },
  };
  if (input.dryRun) return { dryRun: true, ...out };

  ctx.db.teams.deleteTeamMatches(comp.id);
  const scheduled = insertTableauMatches(ctx, comp, plans, now);
  recordEvents(ctx, comp.id, [
    {
      type: EVENT.teamTableauGenerated,
      payload: {
        size: tableau.size,
        slots: tableau.slots,
        draw: { mode, seed, order: drawn.order },
      },
    },
    ...scheduled,
  ]);
  // État de session : tirage du tableau d'équipes seul (docs/adr/0045), remplacé au prochain
  // tirage ; la phase et l'onglet restent lus dans les tables des équipes (competitionState)
  ctx.db.saveSessionState(comp.id, {
    ...readSession(ctx, comp.id),
    tableauDraw: { mode, seed, at: now.toISOString(), order: drawn.order },
  } as never);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Rencontre décidée hors score (docs/adr/0028 § 4) ───────────────────────

/**
 * Rencontre décidée pour `winnerTeamId` sans relais (exclusion, abandon) : cumul des relais
 * terminés gardé, relais non tirés laissés à jouer ; au tableau, rencontre suivante créée.
 * Rend les événements TeamMatchDecided puis TeamMatchScheduled.
 */
export function decideTeamMatch(
  ctx: CommandContext,
  comp: Competition,
  m: MatchRow,
  winnerTeamId: string,
  now: Date,
  dryRun = false
): { events: NewJournalEvent[]; scheduledMatchIds: string[] } {
  let plans: TeamTableauMatchPlan[] = [];
  if (isTableau(m)) {
    const existing = tableauMatchesOf(ctx, comp).map(x =>
      x.id === m.id ? { ...x, status: 'finished', winnerId: winnerTeamId } : x
    );
    const setup = tableauSetup(comp);
    plans = planTeamTableauMatches(
      comp.id,
      tableauOf(ctx, comp),
      existing,
      teamsOf(ctx, comp),
      setup.teamSize,
      comp.weapon,
      setup.options
    );
  }
  const scheduledMatchIds = plans.map(p => p.matchId);
  if (dryRun) return { events: [], scheduledMatchIds };
  const scores = relayScores(m);
  const { scoreA, scoreB } = teamMatchOutcome(scores);
  ctx.db.teams.setTeamMatchResult(m.id, {
    scoreA,
    scoreB,
    status: 'finished',
    winnerId: winnerTeamId,
    currentBoutIndex: scores.filter(r => r.finished).length,
    at: iso(now),
  });
  return {
    events: [
      { type: EVENT.teamMatchDecided, payload: { matchId: m.id, winnerTeamId } },
      ...insertTableauMatches(ctx, comp, plans, now),
    ],
    scheduledMatchIds,
  };
}

// ─── Relais ─────────────────────────────────────────────────────────────────

export function recordRelayScore(
  ctx: CommandContext,
  input: {
    competitionId: string;
    matchId: string;
    relay: number;
    scoreA: number;
    scoreB: number;
    winner?: 'A' | 'B';
    dryRun?: boolean;
  },
  now: Date = new Date()
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  const bout = m.bouts.find(b => b.boutOrder === input.relay);
  if (!bout) {
    throw new CommandError('match_not_found', `Relais ${input.relay} absent de la rencontre`);
  }
  assertNoWithdrawnTeam(ctx, comp, m);
  const before = relayScores(m);
  if (bout.status === 'finished') {
    throw new CommandError(
      'relay_out_of_order',
      `Relais ${input.relay} déjà terminé : le rouvrir d’abord (reopenRelay)`
    );
  }
  if (!canRecordRelay(before, input.relay)) {
    throw new CommandError(
      'relay_out_of_order',
      `Relais précédents du relais ${input.relay} non terminés`
    );
  }
  const format = teamFormatOf(comp.settings);
  const rule = matchRelayRule(comp, m);
  // t.41.1 : palier dépassé d'autant de touches que de cartons rouges adverses du relais
  const penalties = relayPenaltyTouches(
    bout,
    ctx.db.teams.getTeamBoutCards(m.id).flatMap(c => (c.boutId === bout.id ? [c.card] : []))
  );
  if (
    relayScoreAboveMax(before, input.relay, input.scoreA, input.scoreB, format, rule, penalties)
  ) {
    throw new CommandError(
      'score_above_max',
      format === 'laser-arena'
        ? 'Assaut d’arène : 5 touches au plus par équipe'
        : `Relais ${input.relay} : cumul au-delà du palier du relais`
    );
  }
  const after = before.map(r =>
    r.order === input.relay
      ? { ...r, scoreA: input.scoreA, scoreB: input.scoreB, finished: true }
      : r
  );
  const outcome = teamMatchOutcome(after, input.winner);
  const tableau = isTableau(m);
  if (outcome.finished && outcome.scoreA === outcome.scoreB && !input.winner && tableau) {
    throw new CommandError(
      'draw_needs_winner',
      'Égalité au tableau : vainqueur requis (minute avec priorité)'
    );
  }
  if (outcome.finished && input.winner && outcome.scoreA !== outcome.scoreB) {
    const leader = outcome.scoreA > outcome.scoreB ? 'A' : 'B';
    if (input.winner !== leader) {
      throw new CommandError(
        'winner_contradicts_score',
        'Vainqueur contraire au score de la rencontre'
      );
    }
  }
  const winnerTeamId =
    outcome.winner === 'A' ? m.teamAId : outcome.winner === 'B' ? m.teamBId : null;

  // Tableau : rencontres formées par ce vainqueur (avancement, dérivé du tableau tiré)
  let plans: TeamTableauMatchPlan[] = [];
  if (outcome.finished && tableau && winnerTeamId) {
    const existing = tableauMatchesOf(ctx, comp).map(x =>
      x.id === m.id ? { ...x, status: 'finished', winnerId: winnerTeamId } : x
    );
    const setup = tableauSetup(comp);
    plans = planTeamTableauMatches(
      comp.id,
      tableauOf(ctx, comp),
      existing,
      teamsOf(ctx, comp),
      setup.teamSize,
      comp.weapon,
      setup.options
    );
  }
  const out = {
    matchId: m.id,
    relayId: bout.id,
    scoreA: outcome.scoreA,
    scoreB: outcome.scoreB,
    matchFinished: outcome.finished,
    winnerTeamId,
    scheduledMatchIds: plans.map(p => p.matchId),
  };
  if (input.dryRun) return { dryRun: true, ...out };

  const at = iso(now);
  const side = relayWinner(after, input.relay, format);
  ctx.db.teams.setTeamBoutResult(bout.id, {
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    status: 'finished',
    winnerId: side === 'A' ? bout.fencerAId : side === 'B' ? bout.fencerBId : null,
    at,
  });
  ctx.db.teams.setTeamMatchResult(m.id, {
    scoreA: outcome.scoreA,
    scoreB: outcome.scoreB,
    status: outcome.finished ? 'finished' : 'in_progress',
    winnerId: winnerTeamId,
    currentBoutIndex: after.filter(r => r.finished).length,
    at,
  });
  const scheduled = insertTableauMatches(ctx, comp, plans, now);
  recordEvents(ctx, comp.id, [
    {
      type: EVENT.relayScoreRecorded,
      payload: { matchId: m.id, relayId: bout.id, scoreA: input.scoreA, scoreB: input.scoreB },
    },
    ...(outcome.finished
      ? [{ type: EVENT.teamMatchDecided, payload: { matchId: m.id, winnerTeamId } }]
      : []),
    ...scheduled,
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

export function reopenRelay(
  ctx: CommandContext,
  input: { competitionId: string; matchId: string; dryRun?: boolean },
  now: Date = new Date()
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  assertNoWithdrawnTeam(ctx, comp, m);
  const last = [...m.bouts].reverse().find(b => b.status === 'finished');
  if (!last) {
    throw new CommandError('relay_out_of_order', 'Aucun relais terminé à rouvrir');
  }
  // Tableau : la rencontre suivante, formée avec le vainqueur, ne doit pas avoir commencé
  const removed: string[] = [];
  const next =
    isTableau(m) && m.status === 'finished' && !isThirdPlaceSlot(m)
      ? nextTableauSlot(m.round!, m.position!)
      : null;
  // Demi-finale : la petite finale, formée avec son perdant, suit aussi (docs/adr/0044)
  const slots = next ? [next, ...(m.round === 2 ? [THIRD_PLACE_SLOT] : [])] : [];
  for (const slot of slots) {
    const following = tableauMatchesOf(ctx, comp).find(
      x => x.round === slot.round && x.position === slot.position
    );
    if (following && played(following)) {
      throw new CommandError(
        'next_match_played',
        `Rencontre suivante déjà commencée : ${following.id}`
      );
    }
    if (following) removed.push(following.id);
  }
  const out = {
    matchId: m.id,
    relayId: last.id,
    relay: last.boutOrder,
    scoreA: last.scoreA,
    scoreB: last.scoreB,
    removedMatchIds: removed,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  const at = iso(now);
  // Score du relais gardé : l'arène le reprend comme score en cours
  ctx.db.teams.setTeamBoutResult(last.id, {
    scoreA: last.scoreA,
    scoreB: last.scoreB,
    status: 'in_progress',
    winnerId: null,
    at,
  });
  const after = relayScores(m).map(r =>
    r.order === last.boutOrder ? { ...r, finished: false } : r
  );
  const outcome = teamMatchOutcome(after);
  ctx.db.teams.setTeamMatchResult(m.id, {
    scoreA: outcome.scoreA,
    scoreB: outcome.scoreB,
    status: 'in_progress',
    winnerId: null,
    currentBoutIndex: after.filter(r => r.finished).length,
    at,
  });
  for (const id of removed) ctx.db.teams.deleteTeamMatches(comp.id, id);
  recordEvents(ctx, comp.id, [
    { type: EVENT.relayReopened, payload: { matchId: m.id, relayId: last.id } },
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Remplaçant ─────────────────────────────────────────────────────────────

const SUBSTITUTION_REFUSAL = {
  no_reserve: ['no_reserve', 'Équipe sans remplaçant'],
  reserve_used: ['reserve_used', 'Remplaçant déjà entré dans la rencontre'],
  no_later_relay: ['no_later_relay', 'Plus aucun relais à tirer pour ce tireur'],
  not_in_match: ['fencer_not_found', 'Tireur absent de la rencontre pour cette équipe'],
} as const;

export function substituteTeamFencer(
  ctx: CommandContext,
  input: {
    competitionId: string;
    matchId: string;
    teamId: string;
    outFencerId: string;
    /** Remplaçant choisi (docs/adr/0044) ; absent : le premier remplaçant */
    inFencerId?: string;
    dryRun?: boolean;
  },
  now: Date = new Date()
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const m = matchOrThrow(ctx, comp.id, input.matchId);
  const side = input.teamId === m.teamAId ? 'A' : input.teamId === m.teamBId ? 'B' : null;
  if (!side) {
    throw new CommandError('team_not_found', `Équipe absente de la rencontre : ${input.teamId}`);
  }
  const team = teamsOf(ctx, comp).find(t => t.id === input.teamId);
  // Remplaçants de la règle de rencontre de la phase (docs/adr/0044)
  const allowed = teamRuleOf(comp, phaseOfMatch(m)).reserves;
  const pool = team ? reserves(team).slice(0, allowed) : [];
  const key = side === 'A' ? 'fencerAId' : 'fencerBId';
  const reserveUsed = pool.some(id => m.bouts.some(b => b[key] === id));
  // Remplaçant choisi : un remplaçant de l'équipe admis par la règle de la phase
  if (input.inFencerId !== undefined && !reserveUsed && !pool.includes(input.inFencerId)) {
    throw new CommandError(
      'invalid_composition',
      `Pas un remplaçant de l’équipe pour cette rencontre : ${input.inFencerId}`
    );
  }
  const chosen = input.inFencerId ?? pool[0] ?? null;
  const plan = planSubstitution(
    m.bouts.map(b => ({
      relayId: b.id,
      order: b.boutOrder,
      fencerAId: b.fencerAId,
      fencerBId: b.fencerBId,
      finished: b.status === 'finished',
    })),
    side,
    input.outFencerId,
    chosen,
    reserveUsed
  );
  if (!plan.ok) {
    const [code, message] = SUBSTITUTION_REFUSAL[plan.reason];
    throw new CommandError(code, message);
  }
  const inFencerId = chosen!;
  const out = {
    matchId: m.id,
    teamId: input.teamId,
    outFencerId: input.outFencerId,
    inFencerId,
    relayIds: plan.relayIds,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  const at = iso(now);
  for (const id of plan.relayIds) ctx.db.teams.setTeamBoutFencer(id, side, inFencerId, at);
  recordEvents(ctx, comp.id, [{ type: EVENT.teamFencerSubstituted, payload: out }]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Branchement au contrat ─────────────────────────────────────────────────

export const teamRelayHandlers: { [N in keyof Ops]: Handler<N> } = {
  generateTeamTableau: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    generateTeamTableau(ctx, input),
  recordRelayScore: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    recordRelayScore(ctx, input),
  reopenRelay: (ctx, { expectedRevision: _r, commandId: _c, ...input }) => reopenRelay(ctx, input),
  substituteTeamFencer: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    substituteTeamFencer(ctx, input),
};
