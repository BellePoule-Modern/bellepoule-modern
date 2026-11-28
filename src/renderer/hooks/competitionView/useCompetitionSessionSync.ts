/**
 * BPM - Escrime - Session, synchronisation distante, menu natif et entrée en équipes de la compétition
 * Licensed under GPL-3.0
 */

import { usePrintShortcut } from '../usePrintShortcut';
import { useState, useCallback } from 'react';
import { FencerStatus, type Fencer, type Pool } from '../../../shared/types';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import {
  poolsHaveScores,
  poolsMatchFencers,
  scoredMatchesLost,
} from '../../components/poolLaunchState';
import { writePoolDraft } from '../posteUiState';
import type { PoolPrepDraft } from '../../components/PoolPrepView';
import { useSplitGroups } from '../useSplitGroups';
import { useCompetitionNavigation } from '../useCompetitionNavigation';
import { useCompetitionMenu } from '../useCompetitionMenu';
import { useCompetitionBootstrap } from '../useCompetitionBootstrap';
import { useCompetitionRestore } from '../useCompetitionRestore';
import { useRemoteScoreSync } from '../useRemoteScoreSync';
import { useRecordScore } from '../useRecordScore';
import type { RecordScoreOutcome } from '../../components/tableau/tableauViewShared';
import { useFencerWithdrawal, type WithdrawInput } from '../useFencerWithdrawal';
import {
  usePoolFencerAdd,
  usePoolsLaunch,
  usePoolWaveCommands,
  useAssignMatches,
  useCompetitionCommand,
  useScoreClear,
  useTableauGenerate,
} from '../usePoolsLaunch';
import { checkInStatusUpdate } from '../../../shared/utils/forfeit';
import { isWithdrawn } from '../../../shared/domain/fencers/fencerStatus';
import {
  WITHDRAWAL_STATUS,
  type WithdrawalReason,
} from '../../../shared/domain/fencers/withdrawal';
import { useCompetitionReferees } from '../useCompetitionReferees';
import { useTeamEntryCompetition } from '../../../features/teamEntry/useTeamEntryCompetition';
import { usePoolWavesView } from '../usePoolWavesView';
import { useTeamImport } from '../../../features/teamEntry/useTeamImport';
import type { CompetitionViewProps } from '../../components/competition/competitionViewTypes';
import { useCompetitionCore } from './useCompetitionCore';
import { useRemoteApi } from '../../api/remoteApi';

type Ctx = CompetitionViewProps & ReturnType<typeof useCompetitionCore>;

/** Statut de la liste d'appel → motif de retrait (docs/adr/0016) */
const REASON_BY_STATUS: Partial<Record<FencerStatus, WithdrawalReason>> = {
  [FencerStatus.ABANDONED]: 'abandon',
  [FencerStatus.FORFAIT]: 'forfait',
  [FencerStatus.EXCLUDED]: 'exclusion',
};

/** Session, synchronisation distante, menu natif et entrée en équipes de la compétition (extrait de CompetitionView, #1599) */
export function useCompetitionSessionSync(ctx: Ctx) {
  const remote = useRemoteApi();
  const {
    competition,
    currentPhase,
    setCurrentPhase,
    currentPoolRound,
    setCurrentPoolRound,
    pools,
    setPools,
    poolHistory,
    setPoolHistory,
    setAppelHistory,
    overallRanking,
    setOverallRanking,
    tableauMatches,
    setTableauMatches,
    finalResults,
    setFinalResults,
    consolationBrackets,
    setConsolationBrackets,
    setSkipPoolPhase,
    setRankingValidated,
    remoteArenaCount,
    setRemoteArenaCount,
    remoteStripStart,
    isTeamEntry,
    isWaves,
    waves,
    setWavesState,
    updateWaves,
    rapieresState,
    setRapieresState,
    minFencersPerPool,
    maxFencersPerPool,
    setMinFencersPerPool,
    setMaxFencersPerPool,
    fencers,
    loadFencers,
    syncFencersToPool,
    setReferees,
    isRemoteActive,
    setIsRemoteActive,
    setRemoteServerUrl,
    poolsRef,
    handleFencerForfeitRef,
    setArenaStates,
    updateFencer,
    isLaserSabre,
    exports,
    setImportData,
    modals,
    confirm,
    t,
    generatePoolsHook,
    getSeededCheckedInFencers,
    bulkAddFencers,
    remoteServerUrl,
    exportPoolsPDF,
    printPoolsPDF,
    onUpdate,
    updateFencers,
    getCheckedInFencers,
    computeOverallRanking,
    nextPoolRound,
    currentAppelFencers,
    poolRoundQualifiers,
    customFormula,
    hasDirectElimination,
    thirdPlaceMatch,
    playAllPositions,
    setViewedPoolRound,
    rankingChanged,
    setRankingChanged,
    activeSplitGroup,
    setActiveSplitGroup,
    groupTableaux,
    setGroupTableaux,
    onOpenCompetition,
    setPendingSplitOffGroup,
    splitOffInProgress,
    setSplitOffInProgress,
    referees,
    tableMaxScore,
  } = ctx;

  // Poules lancées au moins une fois (onglet Poules libéré, boutons « Relancer ») (#1499)
  const [poolsLaunched, setPoolsLaunched] = useState(false);
  // « Repréparer » après lancement : onglet Poules verrouillé jusqu'à « Relancer » (#1649)
  const [relaunchPending, setRelaunchPending] = useState(false);
  // Modifications de préparation gardées au retour vers l'appel (#1649)
  const [poolPrepDraft, setPoolPrepDraft] = useState<PoolPrepDraft | null>(null);

  // Tableaux séparés après les poules (docs/adr/0024) : un tableau par groupe, tenu par le
  // moteur ; groupe affiché = préférence du poste
  const splitCriteria = competition.settings?.postPoolSplitCriteria;
  const {
    splitGroups,
    showSplitGroup,
    applyGroupTableaux,
    handleSwitchSplitGroup,
    handleSplitOff,
    createSplitOffCompetition,
  } = useSplitGroups({
    competition,
    onUpdate,
    onOpenCompetition,
    setCurrentPhase,
    overallRanking,
    setTableauMatches,
    setConsolationBrackets,
    setFinalResults,
    activeSplitGroup,
    setActiveSplitGroup,
    groupTableaux,
    setGroupTableaux,
    setPendingSplitOffGroup,
    splitOffInProgress,
    setSplitOffInProgress,
  });

  // Étape 4c (docs/adr/0017, 0024) : seul le moteur écrit l'état, tous formats ; l'écran relit
  const { isLoaded } = useCompetitionRestore({
    competitionId: competition.id,
    onGroupTableaux: splitCriteria ? applyGroupTableaux : undefined,
    currentPhase,
    setCurrentPhase,
    setCurrentPoolRound,
    pools,
    setPools,
    setPoolHistory,
    setAppelHistory,
    setOverallRanking,
    setTableauMatches,
    setFinalResults,
    setConsolationBrackets,
    setSkipPoolPhase,
    setRankingValidated,
    remoteArenaCount,
    setRemoteArenaCount,
    remoteStripStart,
    setRapieresState,
    setWavesState,
    minFencersPerPool,
    maxFencersPerPool,
    setMinFencersPerPool,
    setMaxFencersPerPool,
    setPoolsLaunched,
    setStageHistory: ctx.setStageHistory,
    setSplitHistory: ctx.setSplitHistory,
  });

  // Hors Electron (pas de moteur) : état tenu en mémoire seulement, rien d'écrit
  const { handleFencerForfeit: localForfeit } = ctx;
  const localWithdraw = useCallback(
    (fencerId: string, reason: WithdrawalReason, blackCard = false) => {
      void localForfeit(fencerId, reason);
      updateFencer(fencerId, {
        ...checkInStatusUpdate(pools, fencerId, WITHDRAWAL_STATUS[reason]),
        ...(reason === 'exclusion' ? { exclusionReason: blackCard ? 'black_card' : null } : {}),
      });
    },
    [localForfeit, updateFencer, pools]
  );
  const localReinstate = useCallback(
    (fencerId: string) => {
      updateFencer(fencerId, { status: FencerStatus.CHECKED_IN, exclusionReason: null });
    },
    [updateFencer]
  );

  // Un fait, un chemin (#1980, ADR-0005) : scores saisis à l'écran par recordScore
  const recordScreenScore = useRecordScore(competition.id);
  const fencerWithdrawal = useFencerWithdrawal(competition.id);
  const launchPools = usePoolsLaunch(competition.id);
  const addPoolFencer = usePoolFencerAdd(competition.id);
  const generateTableauCommand = useTableauGenerate(competition.id);
  const poolWaves = usePoolWaveCommands(competition.id);
  const clearScore = useScoreClear(competition.id);
  const assignMatches = useAssignMatches(competition.id);
  // Tableaux séparés (docs/adr/0024) : retirer « le tableau » sans groupe retire celui de
  // chaque groupe qui en a un (classement après poules corrigé : tous sont à refaire)
  const engineCompetitionCommand = useCompetitionCommand(competition.id);
  const runCompetitionCommand: typeof engineCompetitionCommand = useCallback(
    async (name, input) => {
      if (!splitCriteria || name !== 'clearTableau' || (input as { group?: string }).group) {
        return engineCompetitionCommand(name, input);
      }
      let outcome: Awaited<ReturnType<typeof engineCompetitionCommand>> = 'recorded';
      for (const [group, t] of Object.entries(groupTableaux)) {
        if (t.tableauMatches.length === 0 && t.consolationBrackets.length === 0) continue;
        outcome = await engineCompetitionCommand(name, { ...input, group });
        if (outcome !== 'recorded') return outcome;
      }
      return outcome;
    },
    [engineCompetitionCommand, splitCriteria, groupTableaux]
  );
  const localUpdateScore = ctx.updateScore;
  const updateScore = useCallback(
    (...args: Parameters<typeof localUpdateScore>): Promise<RecordScoreOutcome> => {
      const [
        poolIndex,
        matchIndex,
        scoreA,
        scoreB,
        winner,
        specialStatus,
        priority,
        correction,
        blackCard,
        rebuildTableau,
      ] = args;
      const match = pools[poolIndex]?.matches[matchIndex];
      if (!match) {
        localUpdateScore(...args);
        return Promise.resolve('local');
      }
      // Statut spécial : retrait du perdant par le moteur (docs/adr/0016) ; correction après
      // tirage du tableau (#1996) : motif, tableau gardé ou retiré par le moteur (docs/adr/0017)
      return recordScreenScore({
        matchId: match.id,
        scoreA,
        scoreB,
        ...(winner ? { winner } : {}),
        ...(priority ? { priority } : {}),
        ...(specialStatus ? { specialStatus } : {}),
        ...(specialStatus === 'exclusion' && blackCard ? { blackCard: true } : {}),
        ...(correction
          ? { correction: { reason: correction, rebuildTableau: !!rebuildTableau } }
          : {}),
      }).then(outcome => {
        if (outcome !== 'local') return outcome;
        localUpdateScore(...args);
        // Repli local : retrait du perdant à l'écran, comme avant le moteur
        const loser = winner === 'A' ? match.fencerB : winner === 'B' ? match.fencerA : null;
        if (specialStatus && loser) localWithdraw(loser.id, specialStatus, blackCard);
        return outcome;
      });
    },
    [pools, localUpdateScore, recordScreenScore, localWithdraw]
  );

  useCompetitionBootstrap({
    competitionId: competition.id,
    refereeFeatureEnabled: !!competition.settings?.refereeFeatureEnabled,
    fencers,
    loadFencers,
    syncFencersToPool,
    setReferees,
    isRemoteActive,
    setIsRemoteActive,
    setRemoteServerUrl,
  });

  // Scores, cartons et pistes distants (#1599)
  const { fireWebhookNotif } = useRemoteScoreSync({
    competitionId: competition.id,
    competitionTitle: competition.title,
    isRemoteActive,
    poolsRef,
    handleFencerForfeitRef,
    setArenaStates,
    updateFencer,
    withdraw: fencerWithdrawal.withdraw,
  });

  // Menu natif
  useCompetitionMenu({
    competitionId: competition.id,
    currentPhase,
    fencers,
    hasPools: pools.length > 0,
    overallRanking,
    finalResults,
    isLaserSabre,
    exports,
    loadFencers,
    setImportData,
    setShowPropertiesModal: modals.setShowPropertiesModal,
    setShowAddFencerModal: modals.setShowAddFencerModal,
  });

  // Handlers
  // Pointage : commande checkIn du contrat, seul chemin d'écriture (#1980, ADR-0005)
  const handleCheckInFencer = (id: string) => {
    void ctx.toggleCheckIn(id);
  };

  // Tableau écrit par le moteur ; rapières : le mode de tableau est dans la formule, plus joint à
  // la commande (docs/adr/0043, F4b) ; tableaux séparés : tableau du groupe affiché
  // (docs/adr/0024), jamais tous les tireurs ensemble
  const generateTableau = useCallback(
    (matches: TableauMatch[] | null, thirdPlaceMatch: boolean): Promise<RecordScoreOutcome> =>
      splitCriteria && !activeSplitGroup
        ? Promise.resolve('refused')
        : generateTableauCommand(
            matches,
            thirdPlaceMatch,
            splitCriteria ? (activeSplitGroup ?? undefined) : undefined
          ),
    [generateTableauCommand, splitCriteria, activeSplitGroup]
  );

  // ─── Retrait et réintégration d'un tireur (docs/adr/0016) ─────────────────
  /** Retrait (appel, poule, tableau) par withdrawFencer ; repli local si le moteur ne pilote pas */
  const handleWithdrawFencer = useCallback(
    async (input: WithdrawInput) => {
      const outcome = await fencerWithdrawal.withdraw(input);
      if (outcome === 'local') localWithdraw(input.fencerId, input.reason, input.blackCard);
      return outcome;
    },
    [fencerWithdrawal, localWithdraw]
  );

  const handleReinstateFencer = useCallback(
    async (fencerId: string) => {
      const outcome = await fencerWithdrawal.reinstate(fencerId);
      if (outcome === 'local') localReinstate(fencerId);
      return outcome;
    },
    [fencerWithdrawal, localReinstate]
  );

  /** Statut posé depuis la liste d'appel : abandon, forfait, ou réactivation d'un tireur retiré */
  const handleSetFencerStatus = async (
    id: string,
    status: FencerStatus
  ): Promise<'recorded' | 'local' | 'refused'> => {
    const reason = REASON_BY_STATUS[status];
    if (reason) return handleWithdrawFencer({ fencerId: id, reason });
    const current = fencers.find(f => f.id === id);
    if (isWithdrawn(current)) {
      const outcome = await handleReinstateFencer(id);
      if (outcome === 'recorded' && status === FencerStatus.NOT_CHECKED_IN) {
        await ctx.toggleCheckIn(id);
      }
      return outcome;
    }
    if (current && current.status !== status) await ctx.toggleCheckIn(id);
    return 'recorded';
  };

  /**
   * Fiche du tireur : les champs descriptifs s'enregistrent tels quels ; un changement de
   * statut passe par la commande qui porte sa règle (ADR-0008 : pas de patch sur le statut)
   */
  const handleEditFencer = async (id: string, updates: Partial<Fencer>) => {
    const current = fencers.find(f => f.id === id);
    const { status, exclusionReason: _reason, ...details } = updates;
    const statusChange = status !== undefined && !!current && status !== current.status;
    if (!statusChange) return updateFencer(id, updates);
    if (Object.keys(details).length > 0) await updateFencer(id, details);
    await handleSetFencerStatus(id, status);
  };

  /**
   * Alerte « scores perdus » avant de régénérer des poules déjà saisies (#1499).
   * `next` : poules qui remplaceront les actuelles ; alerte seulement si des matchs saisis disparaissent (#1992)
   */
  const confirmScoresLoss = async (next?: Pool[]): Promise<boolean> =>
    !(next ? scoredMatchesLost(pools, next) : poolsHaveScores(pools)) ||
    (await confirm(t('pools.relaunch_confirm')));

  /** Appel inchangé (mêmes tireurs pointés que dans les poules) : préparation sans régénérer (#1992) */
  const checkinUnchanged = poolsMatchFencers(pools, getSeededCheckedInFencers());

  const handleGeneratePools = async () => {
    if (checkinUnchanged) {
      setCurrentPhase('poolprep');
      return;
    }
    if (!(await confirmScoresLoss())) return;
    const newPools = generatePoolsHook(getSeededCheckedInFencers(), currentPoolRound);
    if (newPools) {
      resetPoolWaves(newPools);
      setPoolPrepDraft(null);
      if (poolsLaunched) {
        setPoolsLaunched(false);
        setRelaunchPending(true);
      }
      // Tirage non lancé : travail du poste, relu au rechargement avant « Lancer »
      // (useCompetitionRestore). Rien en base avant le lancement (generatePools, docs/adr/0024)
      writePoolDraft(competition.id, newPools);
      // Fermer l'inscription distante dès que les poules sont générées
      if (isRemoteActive) {
        void remote.setRegistrationEnabled(competition.id, false);
        void remote.setCheckinEnabled(competition.id, false);
      }
      setCurrentPhase('poolprep');
    }
  };

  // ─── Entrée en équipes : import des équipes (binômes tireurs, #1118, docs/adr/0043) ─────
  const teamImport = useTeamImport({
    competitionDate: competition.date,
    // Niveaux de la formule (colonne « niveau » de l'import, ADR-0043)
    levels: ctx.entry.kind === 'team' ? ctx.entry.levels : undefined,
    bulkAddFencers,
    notify: ctx.showToast,
  });

  const { teamStats } = useTeamEntryCompetition({
    isTeamEntry,
    isLoaded,
    fencers,
    overallRanking,
    rapieresState,
    setRapieresState,
    bulkAddFencers,
    teamFencerFields: teamImport.teamFencerFields,
  });

  // Tour en vagues (formule) : vague en cours, tablettes, feuilles (docs/adr/0043)
  const { resetPoolWaves, currentWaveMatchIds, printWaves, handlePrintWaveSheets } =
    usePoolWavesView({
      competitionId: competition.id,
      competitionTitle: competition.title,
      isWaves,
      isRemoteActive,
      pools,
      waves,
      updateWaves,
      notify: ctx.showToast,
    });

  // Saisie distante active : QR de la piste sur chaque feuille de poule (#1037)
  const poolsRemoteInfo =
    isRemoteActive && remoteServerUrl
      ? { serverUrl: remoteServerUrl, arenaCount: remoteArenaCount, stripStart: remoteStripStart }
      : undefined;

  const handleExportAllPoolsPDF = () => {
    exportPoolsPDF(pools, currentPoolRound, poolsRemoteInfo);
  };

  const handlePrintAllPoolsPDF = () => {
    printPoolsPDF(pools, currentPoolRound, poolsRemoteInfo);
  };

  // Ctrl+P / Cmd+P → imprimer les feuilles de poule (le tableau gère son propre raccourci)
  usePrintShortcut(currentPhase === 'pools' && pools.length > 0, handlePrintAllPoolsPDF);

  const {
    handleQuestConfigUpdate,
    handleGoToRanking,
    handleSkipToRanking,
    handleGoToTableau,
    handleThirdPlaceDecision,
    handleNextPoolRound,
  } = useCompetitionNavigation({
    competition,
    onUpdate,
    setCurrentPhase,
    fencers,
    updateFencers,
    getCheckedInFencers,
    pools,
    poolHistory,
    setPools,
    overallRanking,
    setOverallRanking,
    computeOverallRanking,
    nextPoolRound,
    currentPoolRound,
    currentAppelFencers,
    poolRoundQualifiers,
    customFormula,
    hasDirectElimination,
    thirdPlaceMatch,
    playAllPositions,
    setPoolsLaunched,
    setViewedPoolRound,
    setRankingValidated,
    setSkipPoolPhase,
    rankingChanged,
    setRankingChanged,
    tableauMatches,
    setTableauMatches,
    consolationBrackets,
    setConsolationBrackets,
    activeSplitGroup,
    groupTableaux,
    showSplitGroup,
  });

  const questConfig = competition.settings?.questConfig;
  const questEnabled = isLaserSabre && questConfig?.enabled === true;
  const questNoPool = questEnabled && !questConfig?.hasPreliminaryPools;

  // Arbitres proposés au remplissage automatique (tests) — uniquement si la gestion des arbitres est active
  const autoFillReferees = competition.settings?.refereeFeatureEnabled ? referees : undefined;

  const {
    applyPoolRefereeAssignments,
    handlePoolAutoFillReferees,
    handlePoolRefereeAssigned,
    refereeAssignableMatches,
  } = useCompetitionReferees({
    competitionId: competition.id,
    pools,
    setPools,
    referees,
    setReferees,
    tableauMatches,
    setTableauMatches,
    consolationBrackets,
    setConsolationBrackets,
    tableMaxScore,
    assign: assignMatches,
  });

  return {
    updateScore,
    recordScreenScore,
    handleWithdrawFencer,
    launchPools,
    addPoolFencer,
    generateTableau,
    poolWaves,
    clearScore,
    assignMatches,
    runCompetitionCommand,
    handleReinstateFencer,
    handleSetFencerStatus,
    handleEditFencer,
    poolsLaunched,
    setPoolsLaunched,
    relaunchPending,
    setRelaunchPending,
    poolPrepDraft,
    setPoolPrepDraft,
    isLoaded,
    fireWebhookNotif,
    handleCheckInFencer,
    confirmScoresLoss,
    checkinUnchanged,
    handleGeneratePools,
    teamImport,
    resetPoolWaves,
    teamStats,
    currentWaveMatchIds,
    printWaves,
    handlePrintWaveSheets,
    poolsRemoteInfo,
    handleExportAllPoolsPDF,
    handlePrintAllPoolsPDF,
    handleQuestConfigUpdate,
    handleGoToRanking,
    handleSkipToRanking,
    handleGoToTableau,
    handleThirdPlaceDecision,
    handleNextPoolRound,
    splitGroups,
    handleSwitchSplitGroup,
    handleSplitOff,
    createSplitOffCompetition,
    questConfig,
    questEnabled,
    questNoPool,
    autoFillReferees,
    applyPoolRefereeAssignments,
    handlePoolAutoFillReferees,
    handlePoolRefereeAssigned,
    refereeAssignableMatches,
  };
}
