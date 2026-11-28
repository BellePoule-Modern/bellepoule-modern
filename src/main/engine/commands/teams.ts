/**
 * BPM - Escrime - Épreuves par équipes par le moteur (docs/adr/0024, lot E1)
 * Inscription des équipes et composition (registerTeam, unregisterTeam, assignTeamFencer,
 * unassignTeamFencer) : sans journal, comme l'inscription des tireurs (docs/adr/0018).
 * generateTeamPools : poules d'équipes et rencontres avec leurs relais, identifiants
 * déterministes, journal TeamPoolsGenerated puis un TeamMatchScheduled par rencontre.
 * Les tables teams, team_fencers, team_matches, team_bouts sont la projection des équipes,
 * écrite ici dans la transaction de la commande (runCommand) ; getCompetitionState la rend
 * dans son bloc « teams ».
 * Licensed under GPL-3.0
 */
import type { z } from 'zod';
import type { Competition } from '../../../shared/types';
import type { teamSetupOperations, TeamsStateDTO } from '../../../shared/api/contractTeams';
import type { TeamMatchRow, TeamRow } from '../../../shared/domain/teams/team.types';
import type { TeamStateView } from '../../../shared/domain/journal/compareWithState';
import {
  isTeamPoolsRefusal,
  planTeamPools,
  relayMaxScore,
  teamFormatOf,
  teamSizeOf,
  type TeamPoolsDraw,
} from '../../../shared/domain/teams/relay';
import { calculateTeamOverallRanking } from '../../../shared/domain/teams/teamCalculations';
import { teamEntryRanking } from '../../../shared/domain/teams/teamEntryRanking';
import {
  relayPairsOf,
  teamFormulaOf,
  teamPoolRoundOf,
  teamMatchRuleOf,
} from '../../../shared/domain/teams/teamMatchRule';
import {
  tableauQualificationOf,
  type PhaseRef,
  type TeamMatchRule,
} from '../../../shared/domain/formula/formulaV2';
import { calculateOptimalPoolCount } from '../../../shared/domain/pools/poolDistribution';
import { calculateLaserArenaPoolRanking } from '../../../shared/domain/teams/laserArenaCalculations';
import {
  withoutWithdrawnTeams,
  type TeamWithdrawal,
} from '../../../shared/domain/teams/teamWithdrawal';
import type { Card } from '../../../shared/types';
import { PASSIVITY_TYPE_PREFIX } from '../../../shared/domain/teams/passivityCardTypes';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, readJournal, recordEvents } from './eventLog';
import { projectCompetition } from '../../../shared/domain/journal/projectCompetition';
import { teamFinalRanking } from '../../../shared/domain/teams/teamFinalRanking';
import {
  planTeamTableau,
  rankTeamsForTableau,
  tableauSeedIds,
  type TeamTableauPlan,
  tableauPlacementIds,
} from '../../../shared/domain/teams/teamTableau';
import { teamTableauEntry } from '../../../shared/domain/teams/teamTableauEntry';

type Ops = typeof teamSetupOperations;
export type TeamsHandler<N extends keyof Ops> = (
  ctx: CommandContext,
  input: z.output<Ops[N]['input']>
) => z.output<Ops[N]['output']>;

/** Épreuve par équipes, sinon refus */
export function teamCompetitionOrThrow(ctx: CommandContext, competitionId: string): Competition {
  const comp = getCompetitionOrThrow(ctx, competitionId);
  if (!comp.isTeamEvent) {
    throw new CommandError(
      'unsupported_format',
      'Épreuve individuelle : les commandes d’équipe ne s’appliquent pas'
    );
  }
  return comp;
}

function teamOrThrow(ctx: CommandContext, competitionId: string, teamId: string) {
  const team = ctx.db.teams.getTeam(teamId);
  if (!team || team.competitionId !== competitionId) {
    throw new CommandError('team_not_found', `Équipe introuvable : ${teamId}`);
  }
  return team;
}

/** Composition figée après le tirage : seul le remplacement la change (docs/adr/0024) */
function assertBeforeDraw(ctx: CommandContext, competitionId: string): void {
  if (ctx.db.teams.countTeamMatches(competitionId) > 0) {
    throw new CommandError(
      'draw_done',
      'Rencontres d’équipes déjà créées : composition figée (remplacement seulement)'
    );
  }
}

/**
 * Équipes retirées ou exclues (docs/adr/0028 § 4), par équipe : lues dans le journal
 * (TeamWithdrawn), faute de colonne dans les tables (pas de migration, § 9)
 */
export function withdrawnTeams(ctx: CommandContext, competitionId: string) {
  const out = new Map<string, TeamWithdrawal>();
  for (const e of ctx.db.eventLog?.getByTypes(competitionId, [EVENT.teamWithdrawn]) ?? []) {
    if (e.type === EVENT.teamWithdrawn) out.set(e.payload.teamId, { ...e.payload });
  }
  return out;
}

/** L'écran relit l'état de l'épreuve, dont le bloc « teams » */
export const changed = (ctx: CommandContext, competitionId: string) =>
  ctx.emitChange?.({ scope: 'session', competitionIds: [competitionId] });

// ─── Inscription (sans journal, docs/adr/0018) ──────────────────────────────

export function registerTeam(
  ctx: CommandContext,
  input: {
    competitionId: string;
    name: string;
    club?: string;
    ranking?: number;
    dryRun?: boolean;
  }
) {
  teamCompetitionOrThrow(ctx, input.competitionId);
  const name = input.name.trim();
  const club = input.club?.trim() || name;
  const ranking = input.ranking ?? null;
  if (input.dryRun) return { dryRun: true, team: null };
  const { id } = ctx.db.teams.createTeam(input.competitionId, name, club, ranking);
  changed(ctx, input.competitionId);
  return { dryRun: false, team: { id, name, club, ranking } };
}

/**
 * Nom, club et rang d'entrée d'une équipe (docs/adr/0044) : sans journal (docs/adr/0018),
 * refusée après le tirage. `ranking: null` : rang retiré (rang calculé, teamEntryRanking).
 */
export function updateTeam(
  ctx: CommandContext,
  input: {
    competitionId: string;
    teamId: string;
    name?: string;
    club?: string;
    ranking?: number | null;
    dryRun?: boolean;
  }
) {
  teamCompetitionOrThrow(ctx, input.competitionId);
  teamOrThrow(ctx, input.competitionId, input.teamId);
  assertBeforeDraw(ctx, input.competitionId);
  const patch = {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.club !== undefined ? { club: input.club.trim() } : {}),
    ...(input.ranking !== undefined ? { ranking: input.ranking } : {}),
  };
  if (!input.dryRun && Object.keys(patch).length) {
    ctx.db.teams.updateTeam(input.teamId, patch);
    changed(ctx, input.competitionId);
  }
  const team = input.dryRun
    ? null
    : ctx.db.teams.getTeamsByCompetition(input.competitionId).find(t => t.id === input.teamId);
  return {
    dryRun: !!input.dryRun,
    team: team ? { id: team.id, name: team.name, club: team.club, ranking: team.ranking } : null,
  };
}

/**
 * Règle de rencontre de la phase `ref` (undefined : règle générale) : formule d'équipe, sinon
 * réglages d'épreuve (docs/adr/0044)
 */
export function teamRuleOf(comp: Competition, ref?: PhaseRef): TeamMatchRule {
  return teamMatchRuleOf(teamFormulaOf(comp), ref, comp.settings, comp.weapon);
}

/** Classement d'un tireur de l'épreuve (rang d'entrée individuel) */
export function fencerRankingOf(ctx: CommandContext, competitionId: string) {
  const byId = new Map(
    ctx.db.getFencersByCompetition(competitionId).map(f => [f.id, f.ranking ?? null])
  );
  return (fencerId: string) => byId.get(fencerId) ?? null;
}

/**
 * Équipes de l'épreuve dans l'ordre d'entrée effectif (docs/adr/0044) : rang saisi, somme des
 * classements des `starters` titulaires, puis le nom
 */
export function entryRankedTeams<T extends TeamRow>(
  ctx: CommandContext,
  comp: Competition,
  teams: readonly T[],
  starters: number
): T[] {
  return teamEntryRanking(teams, starters, fencerRankingOf(ctx, comp.id));
}

export function unregisterTeam(
  ctx: CommandContext,
  input: { competitionId: string; teamId: string; dryRun?: boolean }
) {
  teamCompetitionOrThrow(ctx, input.competitionId);
  teamOrThrow(ctx, input.competitionId, input.teamId);
  assertBeforeDraw(ctx, input.competitionId);
  if (!input.dryRun) {
    ctx.db.teams.deleteTeam(input.teamId);
    changed(ctx, input.competitionId);
  }
  return { dryRun: !!input.dryRun, teamId: input.teamId };
}

export function assignTeamFencer(
  ctx: CommandContext,
  input: {
    competitionId: string;
    teamId: string;
    fencerId: string;
    teamOrder: number;
    isReserve?: boolean;
    dryRun?: boolean;
  }
) {
  const { competitionId, teamId, fencerId } = input;
  teamCompetitionOrThrow(ctx, competitionId);
  teamOrThrow(ctx, competitionId, teamId);
  assertBeforeDraw(ctx, competitionId);
  if (!ctx.db.getFencersByCompetition(competitionId).some(f => f.id === fencerId)) {
    throw new CommandError('fencer_not_found', `Tireur absent de l’épreuve : ${fencerId}`);
  }
  const other = ctx.db.teams.teamOfFencer(competitionId, fencerId);
  if (other && other !== teamId) {
    throw new CommandError(
      'invalid_composition',
      `Tireur déjà dans une autre équipe (${other}) : le retirer d’abord`
    );
  }
  // Remplaçants de la règle de rencontre (docs/adr/0044) : contrôlés par le moteur
  if (input.isReserve) {
    const comp = getCompetitionOrThrow(ctx, competitionId);
    const max = teamRuleOf(comp).reserves;
    const team = (ctx.db.teams.getTeamsByCompetition(competitionId) as TeamRow[]).find(
      t => t.id === teamId
    );
    const others = (team?.fencers ?? []).filter(f => f.isReserve && f.fencerId !== fencerId);
    if (others.length + 1 > max) {
      throw new CommandError(
        'invalid_composition',
        max === 0
          ? 'Pas de remplaçant dans la règle de rencontre'
          : `Remplaçants : ${max} au plus par équipe (règle de rencontre)`
      );
    }
  }
  if (!input.dryRun) {
    ctx.db.teams.upsertTeamFencer(teamId, fencerId, input.teamOrder, !!input.isReserve);
    changed(ctx, competitionId);
  }
  return { dryRun: !!input.dryRun, teamId, fencerId };
}

export function unassignTeamFencer(
  ctx: CommandContext,
  input: { competitionId: string; teamId: string; fencerId: string; dryRun?: boolean }
) {
  const { competitionId, teamId, fencerId } = input;
  teamCompetitionOrThrow(ctx, competitionId);
  teamOrThrow(ctx, competitionId, teamId);
  assertBeforeDraw(ctx, competitionId);
  if (ctx.db.teams.teamOfFencer(competitionId, fencerId) !== teamId) {
    throw new CommandError('fencer_not_found', `Tireur absent de l’équipe : ${fencerId}`);
  }
  if (!input.dryRun) {
    ctx.db.teams.removeTeamFencer(teamId, fencerId);
    changed(ctx, competitionId);
  }
  return { dryRun: !!input.dryRun, teamId, fencerId };
}

// ─── Tirage des poules d'équipes (journalisé) ───────────────────────────────

/**
 * Tirage des poules de la formule (docs/adr/0044) : formule d'équipe (tour de poules : taille,
 * ordre des rencontres) ou nombre de poules demandé ; undefined : épreuve existante sans formule
 * d'équipe, poule unique tous contre tous (rejouée à l'identique). Arène : jamais.
 */
function teamPoolsDraw(
  comp: Competition,
  teams: TeamRow[],
  rule: TeamMatchRule,
  poolCount: number | undefined,
  random: () => number
): TeamPoolsDraw | undefined {
  if (teamFormatOf(comp.settings) !== 'fie-relay') return undefined;
  const formula = teamFormulaOf(comp);
  if (!formula && poolCount === undefined) return undefined;
  // Sans formule d'équipe, l'épreuve garde la poule unique (ADR-0044) : poolCount refusé
  if (!formula) {
    throw new CommandError(
      'invalid_pool_count',
      'Nombre de poules : épreuve sans formule d’équipe, poule unique (enregistrer la formule d’abord)'
    );
  }
  // Tour de poules lu par phaseSettings (ADR-0036, ADR-0044)
  const round = formula ? teamPoolRoundOf(formula) : undefined;
  if (formula && !round) {
    throw new CommandError(
      'no_pools',
      'Formule de l’épreuve sans tour de poules : tirer le tableau d’équipes'
    );
  }
  const n = teams.length;
  const count =
    poolCount ??
    (n < 2 || !round
      ? 1
      : calculateOptimalPoolCount(
          n,
          Math.max(2, round.sizeMin),
          Math.max(2, round.sizeMin, round.sizeMax)
        ));
  if (n >= 2 && count > Math.floor(n / 2)) {
    throw new CommandError(
      'invalid_pool_count',
      `Trop de poules pour ${n} équipes (2 équipes par poule au moins)`
    );
  }
  return {
    poolCount: count,
    boutOrder: round?.boutOrder ?? 'fie',
    starters: rule.starters,
    pairs: relayPairsOf(rule),
    random,
  };
}

export function generateTeamPools(
  ctx: CommandContext,
  input: { competitionId: string; poolCount?: number; replace?: boolean; dryRun?: boolean },
  /** Heure injectée : created_at des rencontres, qui fixe leur rang dans la poule */
  now: Date = new Date(),
  /** Hasard injecté : positions dans la poule (FIE §3) */
  random: () => number = Math.random
) {
  const comp = teamCompetitionOrThrow(ctx, input.competitionId);
  const teams = ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[];
  const rule = teamRuleOf(comp, { kind: 'pool', round: 0 });
  const draw = teamPoolsDraw(comp, teams, rule, input.poolCount, random);
  // Formule : serpentin au rang d'entrée effectif ; sans formule : ordre des noms (inchangé)
  const ordered = draw ? entryRankedTeams(ctx, comp, teams, rule.starters) : teams;
  const plan = planTeamPools(comp.id, ordered, comp.weapon, comp.settings, draw);
  if (isTeamPoolsRefusal(plan)) {
    if (plan.code === 'team_incomplete') {
      throw new CommandError(
        'team_incomplete',
        `Titulaires manquants (${plan.teamSize} par équipe) : ${plan.teamIds.join(', ')}`
      );
    }
    throw new CommandError(
      'invalid_composition',
      plan.code === 'arena_team_count'
        ? `Arène Sabre Laser : calendrier figé pour 8 ou 12 équipes (${plan.count} inscrites)`
        : `Au moins 2 équipes (${plan.count} inscrite(s))`
    );
  }
  if (ctx.db.teams.countTeamMatches(comp.id) > ctx.db.teams.countTeamMatches(comp.id, true)) {
    throw new CommandError('bracket_exists', 'Tableau d’équipes déjà créé');
  }
  if (ctx.db.teams.countTeamMatches(comp.id, true) > 0) {
    if (!input.replace) {
      throw new CommandError(
        'draw_done',
        'Poules d’équipes déjà tirées (« replace » pour refaire)'
      );
    }
    if (ctx.db.teams.countPlayedPoolRelays(comp.id) > 0) {
      throw new CommandError('pools_have_scores', 'Relais de poule déjà joués');
    }
  }
  const relayCount = plan.matches.reduce((n, m) => n + m.relays.length, 0);
  const out = {
    pools: plan.pools,
    matchIds: plan.matches.map(m => m.matchId),
    relayCount,
  };
  if (input.dryRun) return { dryRun: true, ...out };

  ctx.db.teams.deleteTeamPoolMatches(comp.id);
  // Palier de la règle de rencontre du tour (relais FIE) ; plafond d'un assaut (arène)
  const maxScore =
    teamFormatOf(comp.settings) === 'laser-arena'
      ? relayMaxScore(comp.weapon, comp.settings)
      : rule.relayStep;
  plan.matches.forEach((m, k) => {
    // Une milliseconde par rencontre : ordre stable de la poule (getTeamMatchDetail)
    const createdAt = new Date(now.getTime() + k).toISOString();
    ctx.db.teams.insertTeamPoolMatch({
      id: m.matchId,
      competitionId: comp.id,
      poolNumber: m.pool,
      round: m.round,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      createdAt,
    });
    for (const r of m.relays) {
      ctx.db.teams.insertTeamBout({
        id: r.relayId,
        matchId: m.matchId,
        order: r.order,
        fencerAId: r.fencerAId,
        fencerBId: r.fencerBId,
        maxScore,
        createdAt,
      });
    }
  });
  recordEvents(ctx, comp.id, [
    { type: EVENT.teamPoolsGenerated, payload: { pools: plan.pools } },
    ...plan.matches.map(m => ({
      type: EVENT.teamMatchScheduled,
      payload: {
        matchId: m.matchId,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        pool: m.pool,
        round: m.round,
        position: null,
        relays: m.relays,
      },
    })),
  ]);
  changed(ctx, comp.id);
  return { dryRun: false, ...out };
}

// ─── Lecture : bloc « teams » et vue de comparaison ─────────────────────────

type TeamCards = ReturnType<CommandContext['db']['teams']['getTeamCardsByCompetition']>;

/** Carton individuel d'un relais, tel que le bloc « teams » le rend */
export function relayCardDTO(card: Card) {
  const c = card as Omit<Card, 'reason' | 'group'> & {
    reason: string | null;
    group: number | null;
  };
  return {
    id: c.id,
    fencerId: c.fencerId,
    type: c.type as 'WHITE' | 'YELLOW' | 'RED' | 'BLACK',
    reason: c.reason ?? null,
    group: c.group ?? null,
    pointsAwarded: c.pointsAwarded ?? 0,
    excludes: !!c.resultingExclusion,
    at: new Date(c.timestamp).toISOString(),
  };
}

function matchDTO(m: TeamMatchRow & { position?: number | null }, pool: boolean, cards: TeamCards) {
  return {
    id: m.id,
    poolNumber: pool ? (m.poolNumber ?? 1) : null,
    round: m.round ?? null,
    position: pool ? null : (m.position ?? null),
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    scoreBoutsA: m.scoreBoutsA,
    scoreBoutsB: m.scoreBoutsB,
    status: m.status,
    winnerId: m.winnerId,
    currentBoutIndex: m.currentBoutIndex,
    bouts: m.bouts.map(b => ({
      ...b,
      cards: cards.boutCards.filter(c => c.boutId === b.id).map(c => relayCardDTO(c.card)),
    })),
    teamCards: cards.matchCards
      .filter(c => c.matchId === m.id)
      .map(c => ({
        id: c.id,
        teamId: c.teamId,
        type: c.type as 'white' | 'yellow' | 'red' | 'black',
        at: c.createdAt,
      })),
    passivityCards: cards.passivityCards
      .filter(c => c.matchId === m.id)
      .map(c => ({ id: c.id, type: c.type, at: c.createdAt })),
  };
}

/** Relais gagnés et perdus par équipe, rencontres terminées */
function relayWins(matches: TeamMatchRow[]): Map<string, { won: number; lost: number }> {
  const out = new Map<string, { won: number; lost: number }>();
  const of = (id: string) => out.get(id) ?? out.set(id, { won: 0, lost: 0 }).get(id)!;
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    for (const b of m.bouts) {
      if (b.status !== 'finished' || !b.winnerId) continue;
      if (b.winnerId !== b.fencerAId && b.winnerId !== b.fencerBId) continue;
      const [w, l] = b.winnerId === b.fencerAId ? [m.teamAId, m.teamBId] : [m.teamBId, m.teamAId];
      of(w).won++;
      of(l).lost++;
    }
  }
  return out;
}

/**
 * Bloc « teams » de getCompetitionState (docs/adr/0024) : équipes et composition, rencontres
 * de poule et de tableau avec leurs relais, classement de poule. null : épreuve individuelle.
 */
export function teamsState(ctx: CommandContext, comp: Competition): TeamsStateDTO | null {
  if (!comp.isTeamEvent) return null;
  const teams = ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[];
  const pools = ctx.db.teams.getTeamMatchesByCompetition(comp.id) as TeamMatchRow[];
  const tableau = ctx.db.teams.getTeamTableauMatches(comp.id, comp.id) as TeamMatchRow[];
  const format = teamFormatOf(comp.settings);
  const withdrawn = withdrawnTeams(ctx, comp.id);
  // o.99.8 : rencontres de poule d'une équipe retirée annulées, équipe hors classement
  const ranked = withoutWithdrawnTeams(teams, pools, new Set(withdrawn.keys()));
  const wins = relayWins(ranked.matches);
  const ranking =
    format === 'laser-arena'
      ? calculateLaserArenaPoolRanking(ranked.teams, ranked.matches)
      : calculateTeamOverallRanking(ranked.teams, ranked.matches).map(r => ({
          ...r,
          draws: 0,
          tied: false,
        }));
  const cards = ctx.db.teams.getTeamCardsByCompetition(comp.id);
  const final = finalRankingOf(
    ctx,
    comp,
    ranking.map(r => r.team),
    tableau
  );
  // Têtes de série du tableau (docs/adr/0044) : tableau tiré par le moteur, sinon classement
  // d'entrée coupé par la qualification (même fonction que le tirage, sans tirage au sort)
  const seeds =
    tableau.length > 0
      ? tableauSeedIds(tableauOf(ctx, comp))
      : tableauEntryOf(ctx, comp).qualified.map(t => t.id);
  return {
    format,
    teamSize: format === 'laser-arena' ? teamSizeOf(comp.settings) : teamRuleOf(comp).starters,
    teams: teams.map(t => ({
      ...t,
      ranking: t.ranking ?? null,
      fencers: t.fencers.map(f => ({ ...f })),
    })),
    poolMatches: pools.map(m => matchDTO(m, true, cards)),
    tableauMatches: tableau.map(m => matchDTO(m, false, cards)),
    poolRanking: ranking.map((r, i) => ({
      teamId: r.team.id,
      rank: i + 1,
      victories: r.victories,
      defeats: r.defeats,
      draws: r.draws,
      relaysWon: wins.get(r.team.id)?.won ?? 0,
      relaysLost: wins.get(r.team.id)?.lost ?? 0,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      tied: r.tied,
    })),
    withdrawn: [...withdrawn.values()],
    tableauSeeds: seeds,
    // Placement du tableau tiré (docs/adr/0045) : par emplacement ; avant le tirage, têtes de série
    tableauPlacement: tableau.length > 0 ? tableauPlacementIds(tableauOf(ctx, comp)) : seeds,
    finalRanking: {
      rows: final.rows.map(r => ({ teamId: r.team.id, rank: r.rank })),
      provisional: final.provisional,
    },
  };
}

// ─── Tableau tiré et classement d'entrée du tableau ────────────────────────

/** Équipes et rencontres de poule classables : sans les équipes retirées (o.99.8) */
export function rankable(ctx: CommandContext, comp: Competition) {
  const pools = ctx.db.teams.getTeamMatchesByCompetition(comp.id) as TeamMatchRow[];
  const out = withoutWithdrawnTeams(
    ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[],
    pools,
    new Set(withdrawnTeams(ctx, comp.id).keys())
  );
  return out;
}

/**
 * Tableau tiré : celui du journal (TeamTableauGenerated) ; à défaut (tableau créé par l'écran,
 * sans journal), recalculé sur le classement de poule comme l'écran
 */
export function tableauOf(ctx: CommandContext, comp: Competition): TeamTableauPlan {
  const fact = projectCompetition(readJournal(ctx, comp.id)).teams?.tableau;
  if (fact) return fact;
  const { teams, matches } = rankable(ctx, comp);
  return planTeamTableau(rankTeamsForTableau(teams, matches, teamFormatOf(comp.settings)));
}

/**
 * Classement d'entrée du tableau (docs/adr/0044) : formule d'équipe, classement de poule coupé
 * par la qualification du tour (cutAtBar), ou rang d'entrée sans tour de poules ; sinon
 * classement de poule de l'écran (inchangé). Équipes retirées exclues (o.99.8).
 */
export function tableauEntryOf(
  ctx: CommandContext,
  comp: Competition,
  random?: () => number
): { qualified: TeamRow[]; eliminated: TeamRow[] } {
  const ranked = rankable(ctx, comp);
  const formula = teamFormulaOf(comp);
  if (!formula) {
    return {
      qualified: rankTeamsForTableau(ranked.teams, ranked.matches, teamFormatOf(comp.settings)),
      eliminated: [],
    };
  }
  const starters = teamRuleOf(comp).starters;
  return teamTableauEntry({
    teams: ranked.teams,
    poolMatches: ranked.matches,
    entryOrder: entryRankedTeams(ctx, comp, ranked.teams, starters),
    hasPools: !!teamPoolRoundOf(formula),
    qualification: tableauQualificationOf(formula),
    random,
  });
}

/**
 * Classement final des équipes (teamFinalRanking, docs/adr/0044). Épreuve sans formule
 * d'équipe : sur le classement de poule, comme l'écran (même résultat). Formule d'équipe :
 * têtes de série du tableau tiré (journal), puis les équipes éliminées à l'issue des poules ;
 * avant le tableau, classement de poule ou rang d'entrée sans poule.
 */
function finalRankingOf(
  ctx: CommandContext,
  comp: Competition,
  poolOrder: TeamRow[],
  tableau: TeamMatchRow[]
) {
  const formula = teamFormulaOf(comp);
  if (!formula) return teamFinalRanking(poolOrder, tableau);
  const teams = ctx.db.teams.getTeamsByCompetition(comp.id) as TeamRow[];
  const byId = new Map(teams.map(t => [t.id, t]));
  const fact = projectCompetition(readJournal(ctx, comp.id)).teams?.tableau;
  const hasPools = !!teamPoolRoundOf(formula);
  if (!fact) {
    const order = hasPools
      ? poolOrder
      : entryRankedTeams(ctx, comp, poolOrder, teamRuleOf(comp).starters);
    return teamFinalRanking(order, tableau);
  }
  const seeds = tableauSeedIds(fact).flatMap(id => byId.get(id) ?? []);
  const inTableau = new Set(seeds.map(t => t.id));
  return teamFinalRanking(
    seeds,
    tableau,
    poolOrder.filter(t => !inTableau.has(t.id))
  );
}

/** Rencontres et relais des tables, comparés au journal rejoué (compareWithState) */
export function teamStateView(ctx: CommandContext, comp: Competition): TeamStateView {
  const state = teamsState(ctx, comp);
  const all = [...(state?.poolMatches ?? []), ...(state?.tableauMatches ?? [])];
  return {
    matches: all.map(m => ({
      id: m.id,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      pool: m.poolNumber,
      round: m.round,
      position: m.position,
      finished: m.status === 'finished',
      winnerId: m.winnerId,
      relays: m.bouts.map(b => ({
        id: b.id,
        order: b.boutOrder,
        fencerAId: b.fencerAId,
        fencerBId: b.fencerBId,
        scoreA: b.scoreA,
        scoreB: b.scoreB,
        finished: b.status === 'finished',
      })),
      cards: [
        ...m.teamCards.map(c => ({ id: c.id, type: c.type, teamId: c.teamId })),
        // Carton P : ni équipe ni tireur, type tel que rangé en table (journal : même forme)
        ...m.passivityCards.map(c => ({ id: c.id, type: `${PASSIVITY_TYPE_PREFIX}${c.type}` })),
        ...m.bouts.flatMap(b =>
          b.cards.map(c => ({ id: c.id, type: c.type, relayId: b.id, fencerId: c.fencerId }))
        ),
      ],
    })),
  };
}

// ─── Branchement au contrat ─────────────────────────────────────────────────

export const teamHandlers: { [N in keyof Ops]: TeamsHandler<N> } = {
  registerTeam: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    registerTeam(ctx, input),
  updateTeam: (ctx, { expectedRevision: _r, commandId: _c, ...input }) => updateTeam(ctx, input),
  unregisterTeam: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    unregisterTeam(ctx, input),
  assignTeamFencer: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    assignTeamFencer(ctx, input),
  unassignTeamFencer: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    unassignTeamFencer(ctx, input),
  generateTeamPools: (ctx, { expectedRevision: _r, commandId: _c, ...input }) =>
    generateTeamPools(ctx, input),
};
