/**
 * BPM - Escrime - Phase « Tableau » de la compétition (extrait de CompetitionView, #1599)
 * Licensed under GPL-3.0
 */
import {
  tableauAssignmentsDiff,
  tableauScoreOps,
  type AssignmentsInput,
  type TableauScoreOps,
} from '../../hooks/usePoolsLaunch';
import type { TableauViewProps } from '../tableau/tableauViewShared';
import React, { Suspense } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Referee } from '../../../shared/types';
import { specialStatusPatch } from '../../../shared/utils/forfeit';
import type { PoolRanking, Weapon } from '../../../shared/types';
import type { Phase } from '../../hooks/useCompetitionSession';
import type { useFencerManagement } from '../../hooks/useFencerManagement';
import { useTranslation } from '../../hooks/useTranslation';
import { useConfirm } from '../ConfirmDialog';
import { TableSkeleton } from '../Skeleton';
import type {
  ConsolationBracket,
  FinalResult,
  TableauMatch,
} from '../../../shared/domain/tableau/tableauTypes';
import { SplitGroupTabs } from './SplitGroupTabs';
import { TableauDriftBanner } from '../tableau/TableauDriftBanner';
import { TableauStageBanner } from '../tableau/TableauStageBanner';
import type { PoolCorrectionImpact } from '../../../shared/utils/poolCorrectionImpact';
import { useRemoteApi } from '../../api/remoteApi';
import { TableauDrawPanel } from '../tableau/TableauDrawPanel';
import { tableauEmplacements } from '../../../shared/domain/tableau/tableauCalculations';
import { deriveFirstRound } from '../../../shared/domain/tableau/tableauTypes';

const TableauView = React.lazy(() => import('../TableauView'));

interface TableauPhaseProps {
  competitionId: string;
  weapon?: Weapon;
  postPoolSplitCriteria: string | undefined;
  activeSplitGroup: string | null;
  splitGroups: string[];
  onSwitchSplitGroup: (group: string) => void;
  ranking: PoolRanking[];
  tableauMatches: TableauMatch[];
  setTableauMatches: Dispatch<SetStateAction<TableauMatch[]>>;
  consolationBrackets: ConsolationBracket[];
  setConsolationBrackets: Dispatch<SetStateAction<ConsolationBracket[]>>;
  finalResults: FinalResult[];
  setFinalResults: Dispatch<SetStateAction<FinalResult[]>>;
  /** Résultats déverrouillés pour modifier le tableau : état d'interface du poste (docs/adr/0017) */
  tableauEditUnlocked?: boolean;
  setTableauEditUnlocked: Dispatch<SetStateAction<boolean>>;
  setCurrentPhase: Dispatch<SetStateAction<Phase>>;
  tableMaxScore: number;
  thirdPlaceMatch: boolean;
  playAllPositions: boolean;
  remoteArenaCount: number;
  remoteStripStart: number;
  isRemoteActive: boolean;
  maxRefereesPerMatch: number;
  autoFillReferees: Referee[] | undefined;
  tieBreakByVictory: boolean;
  updateFencer: ReturnType<typeof useFencerManagement>['updateFencer'];
  /** Écart cumulé entre le tableau tiré et le classement corrigé (#1996) */
  tableauDrift?: PoolCorrectionImpact | null;
  onRebuildTableau?: () => void;
  /** Score par la commande recordScore (#1980) */
  onRecordScore?: TableauViewProps['onRecordScore'];
  /** Retrait d'un tireur par withdrawFencer (docs/adr/0016) */
  onWithdraw?: TableauViewProps['onWithdraw'];
  /** Tableau généré écrit par le moteur (docs/adr/0017) */
  onGenerateTableau?: TableauViewProps['onGenerateTableau'];
  /** Score annulé par le moteur (docs/adr/0017) */
  onClearScore?: TableauViewProps['onClearScore'];
  /** Pistes et arbitres des matchs écrits par le moteur (assignMatches, docs/adr/0017) */
  onAssign?: (input: AssignmentsInput) => Promise<'recorded' | 'local' | 'refused'>;
  /** Tableau arrêté à N tireurs (docs/adr/0037) : bandeau et passage à la phase suivante */
  stopAt?: number;
  /** Tableau arrêté déjà clos : consultation seule (docs/adr/0037) */
  closedStage?: boolean;
  /** Scission après le tableau arrêté (docs/adr/0039) : retour au Classement à la clôture */
  stageThenSplit?: boolean;
  /** Tirage par le moteur (mode autre que strict, tableau au rang d'entrée, docs/adr/0045) */
  engineDraw?: boolean;
  /** Tableau au rang d'entrée (sans poule) : mentions du PV de tirage */
  byEntryRank?: boolean;
  /** Épreuve : en-tête du PV de tirage */
  competitionInfo?: { title: string; date?: string | null; weapon?: string };
}

const TableauPhase: React.FC<TableauPhaseProps> = ({
  competitionId,
  weapon,
  postPoolSplitCriteria,
  activeSplitGroup,
  splitGroups,
  onSwitchSplitGroup,
  ranking,
  tableauMatches,
  setTableauMatches,
  consolationBrackets,
  setConsolationBrackets,
  finalResults,
  setFinalResults,
  tableauEditUnlocked = false,
  setTableauEditUnlocked,
  setCurrentPhase,
  tableMaxScore,
  thirdPlaceMatch,
  playAllPositions,
  remoteArenaCount,
  remoteStripStart,
  isRemoteActive,
  maxRefereesPerMatch,
  autoFillReferees,
  tieBreakByVictory,
  updateFencer,
  tableauDrift,
  onRebuildTableau,
  onRecordScore,
  onWithdraw,
  onGenerateTableau,
  onClearScore,
  onAssign,
  stopAt,
  closedStage = false,
  stageThenSplit = false,
  engineDraw = false,
  byEntryRank = false,
  competitionInfo,
}) => {
  const remote = useRemoteApi();
  // Changement d'organisation seul (pistes, arbitres) : par le moteur ; le reste, à l'écran
  const handleMatchesChange = (next: TableauMatch[]) => {
    const diff = onAssign ? tableauAssignmentsDiff(tableauMatches, next) : null;
    if (onAssign && diff) {
      if (diff.length === 0) return;
      void onAssign({ matches: diff }).then(outcome => {
        if (outcome === 'local') setTableauMatches(next);
      });
      return;
    }
    // Scores changés en bloc (retour arrière, remplissage automatique) : une commande par
    // match, dans l'ordre des tours ; l'écran relit l'état (docs/adr/0017)
    const ops = onRecordScore && onClearScore ? tableauScoreOps(tableauMatches, next) : null;
    if (ops && (ops.clears.length || ops.records.length)) {
      void applyScoreOps(ops).then(outcome => {
        if (outcome === 'local') setTableauMatches(next);
      });
      return;
    }
    setTableauMatches(next);
  };

  // Tableaux de classement (« toutes les places ») : scores des matchs connus du moteur par
  // commandes ; les tableaux de classement eux-mêmes sont créés par le moteur
  const handleBracketsChange = (next: ConsolationBracket[]) => {
    if (onRecordScore && onClearScore) {
      const known = new Set(consolationBrackets.flatMap(b => b.matches.map(m => m.id)));
      const before = consolationBrackets.flatMap(b => b.matches);
      const after = next.flatMap(b => b.matches).filter(m => known.has(m.id));
      const ops = before.length === after.length ? tableauScoreOps(before, after) : null;
      if (ops && (ops.clears.length || ops.records.length)) {
        void applyScoreOps(ops).then(outcome => {
          if (outcome === 'local') setConsolationBrackets(next);
        });
        return;
      }
    }
    setConsolationBrackets(next);
  };

  const applyScoreOps = async (ops: TableauScoreOps): Promise<'recorded' | 'local' | 'refused'> => {
    for (const matchId of ops.clears) {
      const outcome = await onClearScore!(matchId);
      if (outcome !== 'recorded') return outcome;
    }
    for (const r of ops.records) {
      const outcome = await onRecordScore!(r);
      if (outcome !== 'recorded') return outcome;
    }
    if (ops.assignments.length && onAssign) await onAssign({ matches: ops.assignments });
    return 'recorded';
  };
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  return (
    <Suspense fallback={<TableSkeleton label={t('competitionView.loading_tableau')} />}>
      {/* Sélecteur de groupe pour compétition couplée */}
      {postPoolSplitCriteria && activeSplitGroup && splitGroups.length > 1 && (
        <SplitGroupTabs
          groups={splitGroups}
          active={activeSplitGroup}
          onSelect={onSwitchSplitGroup}
        />
      )}
      {closedStage && stopAt && (
        <div className="tableau-stage" role="status" data-testid="tableau-stage-closed">
          <p>
            <strong>{t('tableauStage.closed_title', { n: stopAt })}</strong>
          </p>
          <p>{t('tableauStage.closed_hint')}</p>
        </div>
      )}
      {!closedStage && stopAt && tableauMatches.length > 0 && (
        <TableauStageBanner
          competitionId={competitionId}
          stopAt={stopAt}
          matches={tableauMatches}
          thenSplit={stageThenSplit}
          onClosed={() => setCurrentPhase(stageThenSplit ? 'ranking' : 'checkin')}
        />
      )}
      {tableauDrift && onRebuildTableau && (
        <TableauDriftBanner drift={tableauDrift} onRebuild={onRebuildTableau} />
      )}
      {!closedStage && finalResults.length > 0 && !tableauEditUnlocked && (
        <div className="tableau-phase-1">
          <span>{t('competitionView.readonly')}</span>
          <button
            onClick={async () => {
              // Déverrouillage : état d'interface du poste ; le classement final, calculé par le
              // moteur, est refait au prochain score (docs/adr/0017)
              if (await confirm(t('competitionView.edit_confirm'))) {
                setTableauEditUnlocked(true);
              }
            }}
            className="tableau-phase-2"
          >
            {t('competitionView.edit_tableau')}
          </button>
        </div>
      )}
      {competitionInfo && tableauMatches.length > 0 && (
        <TableauDrawPanel
          competitionId={competitionId}
          competition={competitionInfo}
          group={postPoolSplitCriteria ? activeSplitGroup : null}
          size={deriveFirstRound(tableauMatches)}
          entrants={ranking.map(r => ({
            id: r.fencer.id,
            name: `${r.fencer.lastName.toUpperCase()} ${r.fencer.firstName ?? ''}`.trim(),
            affiliation: r.fencer.club || r.fencer.nationality || null,
            entryRank: r.fencer.ranking ?? null,
          }))}
          emplacements={tableauEmplacements(tableauMatches)}
          byEntryRank={byEntryRank}
          refreshKey={tableauMatches}
        />
      )}
      <TableauView
        engineDraw={engineDraw}
        ranking={ranking}
        matches={tableauMatches}
        onMatchesChange={handleMatchesChange}
        consolationBrackets={consolationBrackets}
        onConsolationBracketsChange={handleBracketsChange}
        maxScore={tableMaxScore === 0 ? 999 : tableMaxScore}
        thirdPlaceMatch={thirdPlaceMatch}
        playAllPositions={playAllPositions}
        arenaCount={remoteArenaCount}
        stripStart={remoteStripStart}
        readOnly={closedStage || (finalResults.length > 0 && !tableauEditUnlocked)}
        competitionId={competitionId}
        weapon={weapon}
        maxRefereesPerMatch={maxRefereesPerMatch}
        autoFillReferees={autoFillReferees}
        tieBreakByVictory={tieBreakByVictory}
        onRecordScore={onRecordScore}
        onWithdraw={onWithdraw}
        onGenerateTableau={onGenerateTableau}
        onClearScore={onClearScore}
        onBlackCard={id => updateFencer(id, specialStatusPatch('exclusion', true))}
        onComplete={results => {
          setFinalResults(results);
          setTableauEditUnlocked(false);
          setCurrentPhase('results');
        }}
        onMatchArenaChange={(matchId, oldArena, newArena, fencerAParam, fencerBParam) => {
          if (isRemoteActive) {
            const match = tableauMatches.find(m => m.id === matchId);
            remote.updateMatchArena(
              competitionId,
              matchId,
              oldArena,
              newArena,
              fencerAParam ?? match?.fencerA ?? null,
              fencerBParam ?? match?.fencerB ?? null
            );
          }
        }}
      />
    </Suspense>
  );
};

export default React.memo(TableauPhase);
