/**
 * BPM - Escrime - État de l'épreuve exposé par le contrat (#1980, docs/adr/0017, étape 4a)
 * Projection tenue par le moteur dans session_state, lue par getCompetitionState : l'écran la
 * relit quand le journal avance au lieu de relire le bloc par sa propre API.
 * Licensed under GPL-3.0
 */
import { tableauStagesOf } from '../../../shared/domain/tableau/tableauStage';
import { splitHistoryOf } from '../../../shared/domain/formula/splitPlan';
import type { CompetitionStateDTO } from '../../../shared/api/contract';
import type { Competition } from '../../../shared/types';
import type { TeamsStateDTO } from '../../../shared/api/contractTeams';
import { sessionGroupTableaux } from '../../../shared/domain/ranking/splitGroups';
import { poolWavesOf } from '../../../shared/domain/pools/waves';
import { groupTableauxView } from './groupTableaux';
import { tableauDrawStateOf } from '../../../shared/domain/tableau/tableauDraw';

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Numéros des phases d'une épreuve par équipes (useCompetitionSession, jamais renumérotés) */
const TEAM_PHASE = { checkin: 0, teams: 10, teampool: 11, teamtableau: 12 } as const;

/**
 * Phase d'une épreuve par équipes, déduite de ses tables : tableau tiré, poules tirées, équipes
 * inscrites. Borne l'onglet rouvert par le poste (posteUiState) ; l'écran n'écrit plus la phase
 */
function teamPhase(teams: TeamsStateDTO): number {
  if (teams.tableauMatches.length > 0) return TEAM_PHASE.teamtableau;
  if (teams.poolMatches.length > 0) return TEAM_PHASE.teampool;
  return teams.teams.length > 0 ? TEAM_PHASE.teams : TEAM_PHASE.checkin;
}

/**
 * État d'une épreuve à partir du bloc de session ; null si l'épreuve n'a jamais été ouverte.
 * Tableaux séparés après les poules (docs/adr/0024) : un tableau par groupe dans
 * groupTableaux, tableau repris de la racine compris (rangé sous son groupe).
 */
export function competitionState(
  session: Record<string, unknown>,
  comp?: Competition,
  /** Épreuve par équipes : bloc lu dans les tables des équipes (docs/adr/0024) */
  teams?: TeamsStateDTO | null
): CompetitionStateDTO | null {
  // Jamais ouverte : pas d'état. Épreuve par équipes : l'état vient des tables des équipes,
  // écrites par les commandes seules ; il existe dès la création (docs/adr/0024, lot N)
  if (Object.keys(session).length === 0 && !teams) return null;
  const groups = comp ? groupTableauxView(comp, session) : null;
  // Tableau repris lu dans son groupe : la racine ne le montre plus
  const rootMoved =
    !!groups &&
    Array.isArray(session.tableauMatches) &&
    session.tableauMatches.length > 0 &&
    Object.values(groups).some(g => g.tableauMatches === session.tableauMatches);
  const ui = (session.uiState ?? {}) as { currentPoolRound?: number };
  const prep = session.poolPrepParams as CompetitionStateDTO['poolPrepParams'];
  return {
    currentPhase: Math.max(
      typeof session.currentPhase === 'number' ? session.currentPhase : 0,
      teams ? teamPhase(teams) : 0
    ),
    pools: arr(session.pools),
    poolHistory: arr(session.poolHistory),
    appelHistory: arr(session.appelHistory),
    overallRanking: arr(session.overallRanking),
    tableauMatches: rootMoved ? [] : arr(session.tableauMatches),
    finalResults: rootMoved ? [] : arr(session.finalResults),
    consolationBrackets: rootMoved ? [] : arr(session.consolationBrackets),
    // Tour courant : l'écran le range dans uiState, le moteur au premier niveau
    currentPoolRound: Number(ui.currentPoolRound ?? session.currentPoolRound ?? 1) || 1,
    skipPoolPhase: session.skipPoolPhase === true,
    ...(typeof session.poolsLaunched === 'boolean' ? { poolsLaunched: session.poolsLaunched } : {}),
    ...(typeof session.remoteArenaCount === 'number'
      ? { remoteArenaCount: session.remoteArenaCount }
      : {}),
    ...(session.rapieres ? { rapieres: session.rapieres as CompetitionStateDTO['rapieres'] } : {}),
    ...(session.waves ? { waves: poolWavesOf(session as Parameters<typeof poolWavesOf>[0]) } : {}),
    ...(prep ? { poolPrepParams: prep } : {}),
    // Étapes closes (tableau arrêté, docs/adr/0037) : classement final de l'écran
    ...(Array.isArray(session.stageHistory) && session.stageHistory.length > 0
      ? { stageHistory: tableauStagesOf(session.stageHistory) }
      : {}),
    // Scission de la formule (docs/adr/0039) : compétitions filles créées par splitCompetition
    ...(splitHistoryOf(session.splitHistory).length > 0
      ? { splitHistory: splitHistoryOf(session.splitHistory) }
      : {}),
    // Tableaux séparés après les poules (docs/adr/0024) : onglets de l'écran (lot A2)
    ...(groups
      ? { groupTableaux: groups }
      : session.groupTableaux && Object.keys(sessionGroupTableaux(session)).length > 0
        ? { groupTableaux: sessionGroupTableaux(session) }
        : {}),
    // Tirage du tableau unique ou du tableau d'équipes (docs/adr/0045) ; groupes : groupTableaux
    ...(tableauDrawStateOf(session.tableauDraw) && !rootMoved
      ? { tableauDraw: tableauDrawStateOf(session.tableauDraw)! }
      : {}),
    // Épreuve par équipes (docs/adr/0024) : équipes, rencontres, relais ; null : individuelle
    ...(teams !== undefined ? { teams } : {}),
  };
}
