/**
 * BPM - Escrime - Classement après poules et tableau à refaire (#1980, docs/adr/0017)
 * adjustRanking : classement ajusté par le DT (ordre, points Quest) ou recalculé à l'écran ;
 * skipPools : épreuve sans poules, classement initial sur les tireurs pointés ;
 * clearTableau : tableau retiré, refait sur le classement courant à l'ouverture de l'onglet.
 * Journal : RankingAdjusted, PoolsSkipped, TableauCleared.
 * Licensed under GPL-3.0
 */
import { FencerStatus, type Pool, type PoolRanking } from '../../../shared/types';
import { generateInitialRanking } from '../../../shared/utils/poolCalculations';
import { allTableauMatches } from '../../../shared/domain/ranking/splitGroups';
import { sortByEntryRank } from '../../../shared/domain/tableau/tableauDraw';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import { slotOfGroup, slotPatch } from './groupTableaux';
import {
  PHASE,
  assertScoreSupported,
  assertTableauGroup,
  emitSession,
  sessionPools,
  writeSession,
} from './sport';

export interface RankingEntryInput {
  fencerId: string;
  rank: number;
  questPoints?: number;
}

/** Classement ajusté : rangs (et points Quest) du DT, répercutés dans les classements de poule */
export function adjustRanking(
  ctx: CommandContext,
  input: { competitionId: string; ranking: RankingEntryInput[]; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  assertScoreSupported(comp);
  const session = readSession(ctx, comp.id);
  const current = Array.isArray(session.overallRanking)
    ? (session.overallRanking as PoolRanking[])
    : [];
  const byId = new Map(current.map(r => [r.fencer.id, r]));
  const fencers = new Map(ctx.db.getFencersByCompetition(comp.id).map(f => [f.id, f]));
  const ranking: PoolRanking[] = input.ranking.map(e => {
    const base = byId.get(e.fencerId);
    const fencer = base?.fencer ?? fencers.get(e.fencerId);
    if (!fencer) throw new CommandError('fencer_not_found', `Tireur introuvable : ${e.fencerId}`);
    return {
      ...(base ?? generateInitialRanking([fencer])[0]),
      fencer,
      rank: e.rank,
      ...(e.questPoints !== undefined ? { questPoints: e.questPoints } : {}),
    };
  });
  const rankOf = new Map(ranking.map(r => [r.fencer.id, r]));
  const pools: Pool[] = sessionPools(session).map(pool => ({
    ...pool,
    ranking: (pool.ranking ?? []).map(pr => {
      const r = rankOf.get(pr.fencer.id);
      return r ? { ...pr, rank: r.rank, questPoints: r.questPoints ?? pr.questPoints } : pr;
    }),
  }));
  const report = { dryRun: !!input.dryRun, fencers: ranking.length };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    writeSession(ctx, comp.id, { overallRanking: ranking, pools });
    recordEvents(ctx, comp.id, [
      {
        type: EVENT.rankingAdjusted,
        payload: {
          ranking: ranking.map(r => ({
            fencerId: r.fencer.id,
            rank: r.rank,
            questPoints: r.questPoints ?? null,
          })),
        },
      },
    ]);
  });
  emitSession(ctx, comp.id);
  return report;
}

/**
 * Épreuve sans poules : classement initial sur les tireurs pointés (ou choisis par
 * `fencerIds`), rangés par rang d'entrée puis par nom (docs/adr/0045). Le départage des ex
 * aequo et l'ordre des non classés reviennent au tirage du tableau, avec sa graine.
 */
export function skipPools(
  ctx: CommandContext,
  input: { competitionId: string; fencerIds?: string[]; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  assertScoreSupported(comp);
  const session = readSession(ctx, comp.id);
  if (allTableauMatches(session).length > 0) {
    throw new CommandError('bracket_exists', 'Tableau déjà tiré');
  }
  const all = ctx.db.getFencersByCompetition(comp.id);
  const byId = new Map(all.map(f => [f.id, f]));
  // `fencerIds` choisit les tireurs (l'ordre fourni ne compte plus) ; sinon tous les pointés
  const chosen = input.fencerIds
    ? [...new Set(input.fencerIds)].map(id => {
        const f = byId.get(id);
        if (!f) throw new CommandError('fencer_not_found', `Tireur introuvable : ${id}`);
        return f;
      })
    : all.filter(f => f.status === FencerStatus.CHECKED_IN);
  const ordered = sortByEntryRank(chosen);
  if (ordered.length < 2) {
    throw new CommandError('not_enough_fencers', 'Moins de 2 tireurs pointés');
  }
  const overallRanking = generateInitialRanking(ordered);
  const report = { dryRun: !!input.dryRun, fencers: ordered.length };
  if (input.dryRun) return report;
  ctx.db.transaction(() => {
    writeSession(ctx, comp.id, {
      currentPhase: PHASE.ranking,
      skipPoolPhase: true,
      pools: [],
      overallRanking,
    });
    recordEvents(ctx, comp.id, [
      { type: EVENT.poolsSkipped, payload: { fencerIds: ordered.map(f => f.id) } },
    ]);
  });
  emitSession(ctx, comp.id);
  return report;
}

/**
 * Tableau retiré : refait sur le classement courant à l'ouverture de l'onglet Tableau.
 * Tableaux séparés : tableau du groupe « group » seul (docs/adr/0024).
 */
export function clearTableau(
  ctx: CommandContext,
  input: { competitionId: string; group?: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  assertScoreSupported(comp);
  const session = readSession(ctx, comp.id);
  const group = assertTableauGroup(comp, session, input.group);
  const slot = slotOfGroup(comp, session, group);
  const had = slot.matches.length;
  const report = { dryRun: !!input.dryRun, cleared: had };
  // Mode de tableau hérité des rapières (`rapieres.tableauMode`) : effacé avec le tableau, la
  // formule décide ensuite (docs/adr/0043, F4b)
  const { tableauMode, ...rapieres } = (session.rapieres ?? {}) as Record<string, unknown>;
  const legacyMode = tableauMode !== undefined;
  if (input.dryRun || (had === 0 && !legacyMode)) return report;
  ctx.db.transaction(() => {
    writeSession(ctx, comp.id, {
      ...(had > 0
        ? slotPatch(session, slot, {
            tableauMatches: [],
            consolationBrackets: [],
            finalResults: [],
            // Tirage effacé avec le tableau (docs/adr/0045) : un nouveau tirage tire une graine
            tableauDraw: null,
          })
        : {}),
      ...(legacyMode ? { rapieres } : {}),
    });
    if (had > 0)
      recordEvents(ctx, comp.id, [{ type: EVENT.tableauCleared, payload: group ? { group } : {} }]);
  });
  emitSession(ctx, comp.id);
  return report;
}
