/**
 * BPM - Escrime - Clôture d'un tableau arrêté à N tireurs (#2013 étape D2, docs/adr/0037)
 * Formule enregistrée dont le tableau porte `stopAt` et qu'une phase suit : quand tous les
 * matchs avant l'arrêt sont décidés, les N restants passent à la phase suivante (classement =
 * rang d'entrée), les éliminés sortent (classés par tour atteint puis rang d'entrée, Q5).
 * Scission après le tableau (docs/adr/0039) : pas de nouveau tour de poules ; les restants
 * passent dans les compétitions filles par splitCompetition.
 * Écritures dans la transaction de runCommand : tireurs, état de session, TableauStageClosed.
 * Licensed under GPL-3.0
 */
import { FencerStatus } from '../../../shared/types';
import { closeStage, type TableauStageRecord } from '../../../shared/domain/tableau/tableauStage';
import { stoppedTableauOf } from '../../../shared/domain/formula/formulaSteps';
import { isTableauEligible } from '../../../shared/domain/fencers/fencerStatus';
import { CommandError, type CommandContext } from './context';
import { getCompetitionOrThrow } from './competitions';
import { EVENT, recordEvents } from './eventLog';
import { readSession } from './sessionView';
import {
  PHASE,
  emitSession,
  sessionPoolHistory,
  sessionPools,
  sessionTableau,
  writeSession,
} from './sport';

export function closeTableauStage(
  ctx: CommandContext,
  input: { competitionId: string; dryRun?: boolean }
) {
  const comp = getCompetitionOrThrow(ctx, input.competitionId);
  const formula = comp.settings?.formula;
  const tableau = formula ? stoppedTableauOf(formula) : null;
  if (!tableau?.stopAt) {
    throw new CommandError(
      'invalid_settings',
      'Formule sans tableau arrêté à N tireurs suivi d’une autre phase'
    );
  }
  const stopAt = tableau.stopAt;
  const session = readSession(ctx, comp.id);
  const matches = sessionTableau(session);
  const outcome = closeStage(matches, stopAt);
  if (!outcome) {
    throw new CommandError(
      'tableau_stage_not_complete',
      `Tous les matchs du tableau avant l’arrêt à ${stopAt} tireurs doivent être joués`
    );
  }
  const fencers = ctx.db.getFencersByCompetition(comp.id);
  const byId = new Map(fencers.map(f => [f.id, f]));
  // Retirés (abandon, forfait, exclusion) : statut conservé, seuls les actifs sont éliminés
  const toEliminate = outcome.eliminated.filter(e => {
    const status = byId.get(e.fencer.id)?.status;
    return status !== undefined && isTableauEligible({ status });
  });
  const report = {
    dryRun: !!input.dryRun,
    stopAt,
    qualified: outcome.qualified.length,
    eliminated: toEliminate.length,
  };
  if (input.dryRun) return report;

  // Poules du dernier tour joué : archivées avec les tours précédents (consultation, PDF)
  const pools = sessionPools(session);
  const poolHistory =
    pools.length > 0 ? [...sessionPoolHistory(session), pools] : sessionPoolHistory(session);
  const stageHistory = Array.isArray(session.stageHistory) ? [...session.stageHistory] : [];
  const record: TableauStageRecord = {
    kind: 'tableau',
    stopAt,
    matches,
    eliminated: outcome.eliminated.map(e => ({
      fencerId: e.fencer.id,
      round: e.round,
      seed: e.seed,
    })),
  };
  stageHistory.push(record);
  // Phase qui suit le tableau arrêté : tour de poules, ou scission (ADR-0039)
  const at = formula!.phases.indexOf(tableau);
  const thenSplit = formula!.phases[at + 1]?.kind === 'split';
  ctx.db.transaction(() => {
    for (const e of toEliminate)
      ctx.db.updateFencer(e.fencer.id, { status: FencerStatus.ELIMINATED });
    // Restants : classement = rang d'entrée (ordre d'entrée dans la phase suivante)
    outcome.qualified.forEach((f, i) => {
      if (byId.get(f.id)?.ranking !== i + 1) ctx.db.updateFencer(f.id, { ranking: i + 1 });
    });
    const closed = {
      stageHistory,
      tableauMatches: [],
      consolationBrackets: [],
      finalResults: [],
      tableauDraw: undefined,
    };
    writeSession(
      ctx,
      comp.id,
      thenSplit
        ? // Scission (ADR-0039) : pas de tour suivant ; le dernier tour reste le tour courant,
          // le classement attend splitCompetition
          { ...closed, currentPhase: PHASE.ranking }
        : {
            ...closed,
            currentPhase: PHASE.checkin,
            // Phase suivante : nouveau tour de poules, après ceux déjà joués
            currentPoolRound: poolHistory.length + 1,
            poolHistory,
            pools: [],
            poolsLaunched: false,
          }
    );
    recordEvents(ctx, comp.id, [
      {
        type: EVENT.tableauStageClosed,
        payload: {
          stopAt,
          qualifiedIds: outcome.qualified.map(f => f.id),
          eliminatedIds: toEliminate.map(e => e.fencer.id),
        },
      },
    ]);
  });
  // Tireurs éliminés et classés : l'écran relit la liste (statuts, rangs)
  ctx.emitChange?.({ scope: 'fencers', competitionIds: [comp.id] });
  emitSession(ctx, comp.id);
  return report;
}
