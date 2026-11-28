/**
 * BPM - Escrime - Competition View Component (Refactored)
 * Licensed under GPL-3.0
 */

import { entrySeeds, resultsTableauMatches } from '../../shared/domain/tableau/tableauStage';
import { formulaSegment } from '../../shared/domain/formula/formulaSteps';
import { resultsRanking } from '../../shared/domain/ranking/resultsRanking';
import {
  formulaOf,
  pendingSplitOf,
  tableauDrawOf,
  poolBoutOrderOfRound,
  poolDistributionOfRound,
  rankingFiltersOf,
} from '../../shared/domain/formula/formulaV2';
import { screenFormulaProgress } from './formula/screenFormulaProgress';
import GregAutoPublishToggle from './remote/GregAutoPublishToggle';
import { useGregAutoPublish } from '../hooks/useGregAutoPublish';
import React, { Suspense, useState } from 'react';
import { Gender, type Pool } from '../../shared/types';
import { teamPoolPrepProps } from '../../features/teamEntry/teamPoolPrepProps';
import FencerList from './FencerList';
import ResultsView from './ResultsView';
import AddFencerModal from './AddFencerModal';
import CompetitionPropertiesModal from './CompetitionPropertiesModal';
import {
  defaultSplitCompetitionTitle,
  extractSplitGroupRanking,
} from '../../shared/domain/ranking/splitGroups';
import PoolPrepView from './PoolPrepView';
import { TEAM_PHASE_VIEWS, isTeamPhase } from './competition/teamPhases';
import type { TeamPhase } from './competition/teamPhases';
import { CV_STYLES } from './competition/competitionViewStyles';
import TeamImportModal from '../../features/teamEntry/TeamImportModal';
import { ScoreAuditLog } from './ScoreAuditLog';
import CompetitionHeader from './competition/CompetitionHeader';
import CompetitionNav from './competition/CompetitionNav';
import OrganizationModal from './competition/OrganizationModal';
import { useFormulaPreview } from '../hooks/useFormulaPreview';
import { startsWithTableau } from '../../shared/domain/formula/formulaSteps';
import CompetitionExportModals from './competition/CompetitionExportModals';
import CompetitionSecondaryModals from './competition/CompetitionSecondaryModals';
import RefereesPhase from './competition/RefereesPhase';
import TableauPhase from './competition/TableauPhase';
import type { CompetitionViewProps } from './competition/competitionViewTypes';
import { useCompetitionPhaseFlow } from '../hooks/competitionView/useCompetitionPhaseFlow';
import { useCompetitionSessionSync } from '../hooks/competitionView/useCompetitionSessionSync';
import { useCompetitionCore } from '../hooks/competitionView/useCompetitionCore';
import { useOrganizerNotes } from '../hooks/competitionView/useOrganizerNotes';
import { useBlackCardReportRequest } from '../hooks/competitionView/useBlackCardReportRequest';
import QuestSection from './competition/QuestSection';
import PoolsPhase from './competition/PoolsPhase';
import RankingPhase from './competition/RankingPhase';
import { rankingNextRoundAction, rankingTableauNavAction } from './competition/competitionDerived';
import { useBpmClient } from '../api/BpmClientContext';
import { persistCompetitionUpdate } from '../api/competitionUpdate';
import { writePoolDraft } from '../hooks/posteUiState';

// Modales ouvertes à la demande : hors du chunk CompetitionView (budget check:bundle-size)
const ImportModal = React.lazy(() => import('./ImportModal'));
const CompetitionFormulaModal = React.lazy(() => import('./formula/CompetitionFormulaModal'));
const SplitCompetitionModal = React.lazy(() => import('./SplitCompetitionModal'));
const SplitLaunchDialog = React.lazy(() => import('./competition/SplitLaunchDialog'));
const OrganizerNotesModal = React.lazy(() => import('./competition/OrganizerNotesModal'));
const RemoteScoreManager = React.lazy(() => import('./RemoteScoreManager'));
const MatchAuditLog = React.lazy(() =>
  import('./MatchAuditLog').then(m => ({ default: m.MatchAuditLog }))
);

const TeamManagerView = React.lazy(() =>
  import('./TeamManagerView').then(m => ({ default: m.TeamManagerView }))
);

// ─── Static style constants ───────────────────────────────────────────────────

const CompetitionView: React.FC<CompetitionViewProps> = (props: CompetitionViewProps) => {
  const client = useBpmClient();
  // Page Organisation (engrenage avant l'appel)
  const [showOrganization, setShowOrganization] = useState(false);
  // Organisation ▸ Formule : nouvelle interface de formule (aperçu, docs/adr/0032)
  const formulaPreview = useFormulaPreview();
  const [showFormula, setShowFormula] = useState(false);
  // Organisation ▸ Notes & retours (settings.organizerNotes, updateCompetitionSettings)
  const [showNotes, setShowNotes] = useState(false);
  // Scission (docs/adr/0039) : simulation et confirmation avant splitCompetition
  const [showSplitLaunch, setShowSplitLaunch] = useState(false);
  const competitionCore = useCompetitionCore({ ...props });
  const competitionSessionSync = useCompetitionSessionSync({ ...props, ...competitionCore });
  const competitionPhaseFlow = useCompetitionPhaseFlow({
    ...props,
    ...competitionCore,
    ...competitionSessionSync,
  });
  // Poules du classement ajusté, en attente de la réponse du moteur (repli local)
  const pendingRankingPoolsRef = React.useRef<Pool[] | null>(null);
  const {
    competition,
    language,
    t,
    matchProgress,
    modals,
    actionsMenuRef,
    currentPhase,
    pools,
    tableauMatches,
    fencers,
    getCheckedInFencers,
    setCurrentPhase,
    phases,
    handleGoBack,
    handleGeneratePools,
    checkinUnchanged,
    poolsNextAction,
    poolPrepLaunch,
    questEnabled,
    questConfig,
    isTeamEvent,
    isLoaded,
    isRemoteActive,
    poolsLaunched,
    currentPoolRound,
    poolRoundSelector,
    viewedRoundAppel,
    viewedPoolRound,
    currentAppelFencers,
    handleCheckInFencer,
    isTeamEntry,
    entry,
    withTeams,
    teamImport,
    remoteServerUrl,
    updateFencer,
    deleteFencer,
    deleteAllFencers,
    checkInAll,
    uncheckAll,
    handleOpenImportDialog,
    loadFencers,
    handleAppelStateChange,
    getSeededCheckedInFencers,
    poolMaxScore,
    minFencersPerPool,
    maxFencersPerPool,
    expertMode,
    remoteArenaCount,
    remoteStripStart,
    handlePoolStripChange,
    confirmScoresLoss,
    setPoolsLaunched,
    relaunchPending,
    setRelaunchPending,
    poolPrepDraft,
    setPoolPrepDraft,
    resetPoolWaves,
    setPools,
    setSkipPoolPhase,
    handleSkipToRanking,
    setPoolPrepLaunch,
    setMinFencersPerPool,
    setMaxFencersPerPool,
    historyPoolsToShow,
    tieBreakByVictory,
    isLaserSabre,
    renderPoolCard,
    poolsFrozen,
    poolCorrectionDialog,
    tableauDrift,
    requestRebuild,
    isWaves,
    waves,
    updateWaves,
    confirm,
    setOverallRanking,
    computeOverallRanking,
    handlePrintWaveSheets,
    printWaves,
    poolCardSize,
    setPoolCardSize,
    poolsViewMode,
    setPoolsViewMode,
    singlePoolIndex,
    setSinglePoolIndex,
    handlePrintAllPoolsPDF,
    handleExportAllPoolsPDF,
    viewedRoundPools,
    overallRanking,
    hasDirectElimination,
    skipPoolPhase,
    poolWinnersOnly,
    postPoolSplitCriteria,
    splitOffCompetitionIds,
    handleGoToTableau,
    setRankingChanged,
    handleSplitOff,
    isLastPoolRound,
    canAdvanceFromPools,
    handleNextPoolRound,
    teamStats,
    setRankingValidated,
    handleQuestConfigUpdate,
    activeSplitGroup,
    splitGroups,
    handleSwitchSplitGroup,
    effectiveTableauRanking,
    setTableauMatches,
    consolationBrackets,
    setConsolationBrackets,
    finalResults,
    setFinalResults,
    tableauEditUnlocked,
    setTableauEditUnlocked,
    tableMaxScore,
    thirdPlaceMatch,
    playAllPositions,
    maxRefereesPerMatch,
    autoFillReferees,
    poolHistory,
    appelFencers,
    appelHistory,
    appelVisibleColumns,
    exportResultsXML,
    setRemoteArenaCount,
    setRemoteStripStart,
    setIsRemoteActive,
    setArenaStates,
    setRemoteServerUrl,
    matchAuditOptions,
    referees,
    setReferees,
    refereeAssignableMatches,
    applyPoolRefereeAssignments,
    arenaStates,
    exports,
    poolsRemoteInfo,
    addFencer,
    pendingSplitOffGroup,
    createSplitOffCompetition,
    setPendingSplitOffGroup,
    onUpdate,
    importData,
    handleImportFencers,
    handleImportRanking,
    handleImportReferees,
    setImportData,
    areAllPoolsComplete,
    updateScore,
    recordScreenScore,
    handleWithdrawFencer,
    launchPools,
    generateTableau,
    poolWaves,
    runCompetitionCommand,
    clearScore,
    assignMatches,
    handleSetFencerStatus,
    handleEditFencer,
    handleGoToRanking,
  } = { ...props, ...competitionCore, ...competitionSessionSync, ...competitionPhaseFlow };
  // Entrée en binômes (ADR-0043) : libellés des niveaux de la formule (ou de la lecture du mode spécial)
  const teamLevels = entry.kind === 'team' ? entry.levels : undefined;
  const teamFencers = React.useMemo(() => withTeams(fencers), [withTeams, fencers]);
  const appelTeamFencers = React.useMemo(
    () => withTeams(currentAppelFencers),
    [withTeams, currentAppelFencers]
  );
  // Tireurs pointés pour le tirage : recalculés quand la liste ou le classement du tour précédent change
  const seededTeamFencers = React.useMemo(
    () => withTeams(getSeededCheckedInFencers()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getSeededCheckedInFencers suit fencers et le classement du tour précédent
    [withTeams, fencers, getSeededCheckedInFencers]
  );
  const filterKeys = rankingFiltersOf(competitionCore.readableFormula);
  // Rapport de carton noir demandé depuis l'appel DT (#2190)
  useBlackCardReportRequest(
    competition,
    fencers,
    [...poolHistory.flat(), ...pools],
    tableauMatches
  );

  // Scission en attente (docs/adr/0039) : branches pas encore parties ; compétition couplée
  // (branches toutes restées, E3) : aucune. Le bouton suit rankingNextRoundAction
  const pendingSplit =
    competition.settings?.formula && competitionCore.splitHistory.length === 0
      ? pendingSplitOf(competition.settings.formula)
      : undefined;
  // Tour suivant ou lancement de la scission (docs/adr/0039) : règle de l'écran testée à part
  const rankingNextRound = rankingNextRoundAction({
    t,
    formula: competition.settings?.formula,
    splitDone: competitionCore.splitHistory.length > 0,
    isLastPoolRound,
    hasPools: pools.length > 0,
    canAdvanceFromPools,
    currentPoolRound,
    hasDirectElimination,
    onNextRound: handleNextPoolRound,
    onLaunchSplit: () => setShowSplitLaunch(true),
  });
  // « Voir le tableau » dans la barre du haut, entre « Retour » et « Journal » (#2008)
  const rankingTableauAction = rankingTableauNavAction({
    t,
    hasDirectElimination,
    hasNextRound: rankingNextRound != null,
    viewingPastRound: viewedRoundPools != null,
    splitByGender: postPoolSplitCriteria === 'gender',
    frozen: poolsFrozen,
    poolWinnersOnly,
    pools,
    onGoToTableau: () => handleGoToTableau(),
  });

  // Publication GREG auto : minuteur au niveau de la compétition, actif quel que soit
  // l'onglet ouvert ; le bouton ON/OFF reste dans « Saisie distante » (#1328)
  const [gregAutoOn, setGregAutoOn] = useGregAutoPublish(
    () => void exportResultsXML(overallRanking, finalResults, pools, 'greg-auto'),
    competition.id
  );

  // Formule enregistrée sans tour de poules : le tableau suit l'appel (ADR-0037)
  const storedFormula = competition.settings?.formula;
  const tableauFirst = !!storedFormula && startsWithTableau(storedFormula);
  const organizerNotes = useOrganizerNotes(competition, onUpdate);

  // Tableau arrêté et clos (docs/adr/0037) : consultable en lecture seule, classement d'entrée
  // = tour de poules qui le précède, tireurs du tableau seulement
  const { stageHistory } = competitionCore;
  const closedStage = hasDirectElimination ? undefined : stageHistory[stageHistory.length - 1];
  const closedStageRanking = React.useMemo(() => {
    if (!closedStage || !storedFormula) return [];
    const pre = formulaSegment(storedFormula, 0)?.poolRounds ?? 0;
    const seeds = entrySeeds(closedStage.matches);
    return computeOverallRanking(poolHistory[pre - 1] ?? []).filter(r => seeds.has(r.fencer.id));
  }, [closedStage, storedFormula, poolHistory, computeOverallRanking]);

  // Classement final : classement complet des poules (comme le moteur), pas la seule coupe du
  // tableau : les non-qualifiés suivent le tableau (docs/adr/0043 amendée, F4d). Tableau arrêté
  // (docs/adr/0037) : restants, puis éliminés du tableau (Q5), puis les autres. Tableaux séparés :
  // le groupe affiché (docs/adr/0024).
  const stagedRanking = React.useMemo(
    () =>
      resultsRanking({
        overallRanking,
        postPoolSplitCriteria,
        activeSplitGroup,
        splitOffCompetitionIds,
        stageHistory: competitionCore.stageHistory,
        splitHistory: competitionCore.splitHistory,
      }),
    [
      overallRanking,
      postPoolSplitCriteria,
      activeSplitGroup,
      splitOffCompetitionIds,
      competitionCore.stageHistory,
      competitionCore.splitHistory,
    ]
  );

  return (
    <div style={CV_STYLES.root}>
      {showOrganization && (
        <OrganizationModal
          t={t}
          onClose={() => setShowOrganization(false)}
          onOpenArenaPlanner={props.onOpenArenaPlanner}
          onOpenRoadmap={props.onOpenRoadmap}
          onOpenFormula={formulaPreview ? () => setShowFormula(true) : undefined}
          onOpenNotes={() => setShowNotes(true)}
          openNotesCount={organizerNotes.openCount}
        />
      )}
      {showSplitLaunch && pendingSplit && (
        <Suspense fallback={null}>
          <SplitLaunchDialog
            competitionId={competition.id}
            criterion={pendingSplit.criterion}
            onClose={() => setShowSplitLaunch(false)}
            onDone={result => {
              setShowSplitLaunch(false);
              competitionCore.showToast(
                t('splitLaunch.done', {
                  n: result.branches.filter(b => !!b.competitionId).length,
                }),
                'success'
              );
              // Toutes les branches sont parties (pas de mélange, ADR-0039) : résultats de l'origine
              setCurrentPhase('results');
            }}
          />
        </Suspense>
      )}
      {showNotes && (
        <Suspense fallback={null}>
          <OrganizerNotesModal
            t={t}
            notes={organizerNotes.notes}
            currentPhase={currentPhase}
            phases={phases}
            competitionTitle={competition.title}
            onSave={organizerNotes.save}
            onClose={() => setShowNotes(false)}
          />
        </Suspense>
      )}
      {showFormula && (
        <Suspense fallback={null}>
          <CompetitionFormulaModal
            competition={competition}
            // Phases commencées (S6, docs/adr/0041) : lues dans l'état de l'épreuve
            progress={screenFormulaProgress({
              formula: storedFormula ?? formulaOf(competition),
              poolsLaunched,
              pools,
              poolHistory,
              tableauMatches,
              stageHistory,
              splitHistory: competitionCore.splitHistory,
              currentPhase,
            })}
            // Écrit par applyFormulaTemplate / updateCompetitionFormula (docs/adr/0033)
            onApplied={settings => onUpdate({ ...competition, settings })}
            onClose={() => setShowFormula(false)}
          />
        </Suspense>
      )}
      <CompetitionHeader
        competition={competition}
        language={language}
        t={t}
        matchProgress={matchProgress}
        showConfetti={modals.showConfetti}
        showActionsMenu={modals.showActionsMenu}
        setShowActionsMenu={modals.setShowActionsMenu}
        actionsMenuRef={actionsMenuRef}
        currentPhase={currentPhase}
        pools={pools}
        tableauMatches={tableauMatches}
        fencersCount={fencers.length}
        checkedInCount={getCheckedInFencers().length}
        setShowFencerComparison={modals.setShowFencerComparison}
        setShowAnalytics={modals.setShowAnalytics}
        setShowSeasonRanking={modals.setShowSeasonRanking}
        setShowQRCode={modals.setShowQRCode}
        setShowPresentation={modals.setShowPresentation}
        setShowKiosk={modals.setShowKiosk}
        setShowKioskDisplay={modals.setShowKioskDisplay}
        setShowPropertiesModal={modals.setShowPropertiesModal}
        setShowExportCenter={modals.setShowExportCenter}
        onOpenRemote={() => setCurrentPhase('remote')}
      />
      <CompetitionNav
        competition={competition}
        phases={phases}
        currentPhase={currentPhase}
        setCurrentPhase={setCurrentPhase}
        language={language}
        t={t}
        handleGoBack={handleGoBack}
        // Formule sans tour de poules (ADR-0037) : l'appel mène au classement d'entrée
        handleGeneratePools={tableauFirst ? () => void handleSkipToRanking() : handleGeneratePools}
        generateLabelKey={tableauFirst ? 'competitionNav.goto_entry_ranking' : undefined}
        checkinUnchanged={checkinUnchanged}
        poolsNextAction={poolsNextAction}
        rankingTableauAction={currentPhase === 'ranking' ? rankingTableauAction : null}
        poolPrepLaunch={currentPhase === 'poolprep' ? poolPrepLaunch : null}
        questEnabled={questEnabled}
        questConfig={questConfig}
        fencers={fencers}
        getCheckedInFencers={getCheckedInFencers}
        pools={pools}
        tableauMatches={tableauMatches}
        consolationBrackets={consolationBrackets}
        playAllPositions={playAllPositions}
        onOpenPlanningAssistant={() => modals.setShowPlanningAssistant(true)}
        onOpenOrganization={() => setShowOrganization(true)}
        organizationBadge={organizerNotes.openCount}
        isTeamEvent={isTeamEvent}
        tourReady={isLoaded}
        remoteActive={isRemoteActive}
        poolsLaunched={poolsLaunched}
      />

      {/* Content — keyed pour animation de transition */}
      <div key={currentPhase} className="phase-content" style={CV_STYLES.phaseContent}>
        {currentPhase === 'checkin' && currentPoolRound > 1 && pools.length === 0 && (
          <div className="alert alert-info competition-view-1" role="status">
            {t('pools.round_checkin_banner', { n: currentPoolRound })}
          </div>
        )}
        {currentPhase === 'checkin' && poolRoundSelector}
        {currentPhase === 'checkin' && viewedRoundAppel && (
          <FencerList
            key={`appel-round-${viewedPoolRound}`}
            fencers={viewedRoundAppel}
            competitionId={competition.id}
            competition={competition}
            onCheckIn={() => {}}
            onAddFencer={() => {}}
            readOnly
          />
        )}
        {currentPhase === 'checkin' && !viewedRoundAppel && (
          <FencerList
            fencers={appelTeamFencers}
            competitionId={competition.id}
            competition={competition}
            onCheckIn={handleCheckInFencer}
            teamLevels={teamLevels}
            onAddFencer={() => modals.setShowAddFencerModal(true)}
            {...(isTeamEntry ? teamImport.importButtons : {})}
            registerUrl={
              isRemoteActive && remoteServerUrl ? `${remoteServerUrl}/register` : undefined
            }
            onEditFencer={handleEditFencer}
            onDeleteFencer={deleteFencer}
            onDeleteAllFencers={deleteAllFencers}
            onCheckInAll={checkInAll}
            onUncheckAll={uncheckAll}
            onComputeCategories={isTeamEntry ? undefined : competitionCore.computeCategories}
            onImport={isTeamEntry ? undefined : type => handleOpenImportDialog(type)}
            onImportFFEConnect={isTeamEntry ? undefined : () => modals.setShowFFEConnect(true)}
            onFencersImported={loadFencers}
            onAppelStateChange={handleAppelStateChange}
            onSetFencerStatus={handleSetFencerStatus}
          />
        )}

        {isTeamEvent && isTeamPhase(currentPhase) && (
          <Suspense fallback={null}>
            <TeamManagerView
              competition={competition}
              fencers={fencers}
              view={TEAM_PHASE_VIEWS[currentPhase]}
              onNavigate={v =>
                setCurrentPhase(
                  (Object.keys(TEAM_PHASE_VIEWS) as TeamPhase[]).find(
                    k => TEAM_PHASE_VIEWS[k] === v
                  ) ?? 'teams'
                )
              }
            />
          </Suspense>
        )}
        {currentPhase === 'poolprep' && (
          <PoolPrepView
            fencers={seededTeamFencers}
            initialPools={pools.length > 0 ? pools : undefined}
            maxScore={poolMaxScore}
            minFencersPerPool={minFencersPerPool}
            maxFencersPerPool={maxFencersPerPool}
            boutOrderMode={poolBoutOrderOfRound(competition.settings, currentPoolRound)}
            // Répartition de la formule : « par niveau » pour l'entrée en équipes (docs/adr/0043)
            distribution={poolDistributionOfRound(competition.settings, currentPoolRound)}
            {...(isTeamEntry ? teamPoolPrepProps(teamLevels, t) : {})}
            expertMode={expertMode}
            arenaCount={remoteArenaCount}
            stripStart={remoteStripStart}
            onStripChange={handlePoolStripChange}
            poolsLaunched={poolsLaunched || relaunchPending}
            draft={poolPrepDraft}
            onDraftChange={setPoolPrepDraft}
            onGoToPools={
              poolsLaunched && !relaunchPending
                ? () => {
                    setPoolPrepDraft(null);
                    setCurrentPhase('pools');
                  }
                : undefined
            }
            onPoolsConfirm={async preparedPools => {
              if (!(await confirmScoresLoss(preparedPools))) return;
              const confirmedPools = preparedPools;
              // Lancement par le moteur (generatePools, PoolsGenerated au journal, docs/adr/0017) :
              // poules, vagues du tour et phase relues dans l'état de l'épreuve
              const outcome = await launchPools(confirmedPools);
              if (outcome === 'refused') return;
              // Tirage lancé : la préparation gardée par le poste n'a plus lieu d'être
              writePoolDraft(competition.id, null);
              setRelaunchPending(false);
              setPoolPrepDraft(null);
              if (outcome === 'recorded') {
                setCurrentPhase('pools');
                return;
              }
              setPoolsLaunched(true);
              resetPoolWaves(confirmedPools);
              setPools(confirmedPools);
              setSkipPoolPhase(false);
              setCurrentPhase('pools');
            }}
            onSkipPools={handleSkipToRanking}
            onLaunchActionChange={setPoolPrepLaunch}
            onSettingsChange={(min, max) => {
              setMinFencersPerPool(min);
              setMaxFencersPerPool(max);
            }}
          />
        )}

        {currentPhase === 'pools' && (
          <PoolsPhase
            poolRoundSelector={poolRoundSelector}
            historyPools={historyPoolsToShow}
            pools={pools}
            weapon={competition.weapon}
            competitionId={competition.id}
            competitionTitle={competition.title}
            tieBreakByVictory={tieBreakByVictory}
            poolMaxScore={poolMaxScore}
            isLaserSabre={isLaserSabre}
            onBackToCheckin={() => setCurrentPhase('checkin')}
            renderPoolCard={renderPoolCard}
            isTeamEntry={isTeamEntry}
            isWaves={isWaves}
            launchedWave={waves.launched}
            wavesEnded={waves.ended}
            // Vagues par le moteur (docs/adr/0017, 0043) ; repli local hors moteur
            onLaunchWave={async wave => {
              if ((await poolWaves.launchWave(wave)) === 'local') {
                updateWaves({ launched: wave });
              }
            }}
            onEndWaves={async () => {
              if (!(await confirm(t('poolWaves.confirm_end_waves')))) return;
              const outcome = await poolWaves.endWaves(true);
              if (outcome === 'refused') return;
              if (outcome === 'local') {
                updateWaves({ ended: true });
                setOverallRanking(computeOverallRanking(pools));
              }
              setCurrentPhase('ranking');
            }}
            onResumeWaves={async () => {
              if ((await poolWaves.endWaves(false)) === 'local') {
                updateWaves({ ended: false });
              }
            }}
            onPrintWaveSheets={handlePrintWaveSheets}
            onPrintWaveRange={printWaves}
            poolCardSize={poolCardSize}
            onPoolCardSizeChange={setPoolCardSize}
            poolsViewMode={poolsViewMode}
            onPoolsViewModeChange={setPoolsViewMode}
            singlePoolIndex={singlePoolIndex}
            setSinglePoolIndex={setSinglePoolIndex}
            onPrintAll={handlePrintAllPoolsPDF}
            onExportAll={handleExportAllPoolsPDF}
          />
        )}

        {currentPhase === 'ranking' &&
          closedStage &&
          !!storedFormula &&
          !!pendingSplitOf(storedFormula) &&
          competitionCore.splitHistory.length === 0 && (
            // Tableau arrêté clos, scission à venir : le tableau ci-dessous est celui des poules ;
            // la scission répartit les restants du tableau par rang d'entrée (ADR-0037 Q5)
            <div className="tableau-stage" role="note" data-testid="split-after-stage-note">
              <p>{t('splitLaunch.after_stage_note', { n: closedStage.stopAt })}</p>
            </div>
          )}
        {currentPhase === 'ranking' && (
          <RankingPhase
            poolRoundSelector={poolRoundSelector}
            viewedPoolRound={viewedPoolRound}
            viewedRoundPools={viewedRoundPools}
            computeOverallRanking={computeOverallRanking}
            pools={pools}
            overallRanking={overallRanking}
            weapon={competition.weapon}
            competitionTitle={competition.title}
            hasDirectElimination={hasDirectElimination}
            skipPoolPhase={skipPoolPhase}
            poolWinnersOnly={poolWinnersOnly}
            postPoolSplitCriteria={postPoolSplitCriteria}
            splitOffCompetitionIds={splitOffCompetitionIds}
            onGoToTableau={handleGoToTableau}
            onGoToResults={() => setCurrentPhase('results')}
            onPoolsChange={(updatedPools, hasRankingChanged) => {
              // Écrit avec le classement (adjustRanking) ; gardé pour le repli local
              pendingRankingPoolsRef.current = updatedPools;
              if (hasRankingChanged) {
                setRankingChanged(true);
              }
            }}
            onRankingChange={async ranking => {
              // Classement ajusté ou recalculé par le moteur (RankingAdjusted, docs/adr/0017)
              const outcome = await runCompetitionCommand('adjustRanking', {
                ranking: ranking.map(r => ({
                  fencerId: r.fencer.id,
                  rank: r.rank,
                  ...(r.questPoints !== undefined ? { questPoints: r.questPoints } : {}),
                })),
              });
              const pendingPools = pendingRankingPoolsRef.current;
              pendingRankingPoolsRef.current = null;
              if (outcome !== 'local') return;
              if (pendingPools) setPools(pendingPools);
              setOverallRanking(ranking);
            }}
            rankingFrozen={poolsFrozen}
            onSplitOff={handleSplitOff}
            nextRoundAction={rankingNextRound}
            tableauActionInNav={rankingTableauAction != null}
            isTeamEntry={isTeamEntry}
            launchedWave={waves.launched}
            teamFencers={teamFencers}
            teamStats={teamStats}
            teamLevels={teamLevels}
            rankingFilters={filterKeys}
          />
        )}

        {questEnabled && questConfig && (
          <QuestSection
            isActive={currentPhase === 'quest'}
            questConfig={questConfig}
            weapon={competition.weapon}
            poolMaxScore={poolMaxScore}
            getCheckedInFencers={getCheckedInFencers}
            overallRanking={overallRanking}
            setOverallRanking={setOverallRanking}
            onRankingAdjust={ranking =>
              runCompetitionCommand('adjustRanking', {
                ranking: ranking.map(r => ({
                  fencerId: r.fencer.id,
                  rank: r.rank,
                  ...(r.questPoints !== undefined ? { questPoints: r.questPoints } : {}),
                })),
              })
            }
            setRankingValidated={setRankingValidated}
            setCurrentPhase={setCurrentPhase}
            handleQuestConfigUpdate={handleQuestConfigUpdate}
          />
        )}

        {currentPhase === 'tableau' && (
          <TableauPhase
            competitionId={competition.id}
            weapon={competition.weapon}
            postPoolSplitCriteria={postPoolSplitCriteria}
            activeSplitGroup={activeSplitGroup}
            splitGroups={splitGroups}
            onSwitchSplitGroup={handleSwitchSplitGroup}
            ranking={closedStage ? closedStageRanking : effectiveTableauRanking}
            tableauMatches={closedStage ? closedStage.matches : tableauMatches}
            setTableauMatches={setTableauMatches}
            consolationBrackets={consolationBrackets}
            setConsolationBrackets={setConsolationBrackets}
            finalResults={finalResults}
            setFinalResults={setFinalResults}
            tableauEditUnlocked={tableauEditUnlocked}
            setTableauEditUnlocked={setTableauEditUnlocked}
            setCurrentPhase={setCurrentPhase}
            tableMaxScore={tableMaxScore}
            thirdPlaceMatch={thirdPlaceMatch}
            playAllPositions={playAllPositions}
            remoteArenaCount={remoteArenaCount}
            remoteStripStart={remoteStripStart}
            isRemoteActive={isRemoteActive}
            maxRefereesPerMatch={maxRefereesPerMatch}
            autoFillReferees={autoFillReferees}
            tieBreakByVictory={tieBreakByVictory}
            updateFencer={updateFencer}
            tableauDrift={tableauDrift}
            onRebuildTableau={requestRebuild}
            onRecordScore={recordScreenScore}
            onWithdraw={handleWithdrawFencer}
            onGenerateTableau={generateTableau}
            onClearScore={clearScore}
            onAssign={assignMatches}
            stopAt={closedStage ? closedStage.stopAt : competitionCore.tableauStopAt}
            stageThenSplit={!!storedFormula && !!pendingSplitOf(storedFormula)}
            closedStage={!!closedStage}
            // Tirage par le moteur (docs/adr/0045) : mode de la formule, ou tableau sans poule
            engineDraw={tableauDrawOf(competition.settings) !== 'strict' || skipPoolPhase}
            byEntryRank={skipPoolPhase}
            competitionInfo={{
              title: competition.title,
              date: competition.date ? new Date(competition.date).toLocaleDateString() : null,
              weapon: competition.weapon,
            }}
          />
        )}

        {currentPhase === 'results' && (
          <ResultsView
            competition={competition}
            poolRanking={stagedRanking.ranking}
            stageEliminatedAt={stagedRanking.eliminatedAt}
            finalResults={finalResults}
            fencers={teamFencers}
            pools={[...poolHistory.flat(), ...pools]}
            tableauMatches={resultsTableauMatches(tableauMatches, closedStage)}
            consolationBrackets={consolationBrackets}
            isLaserSabre={isLaserSabre}
            appelFencers={appelFencers.length > 0 ? appelFencers : undefined}
            appelHistory={appelHistory}
            appelVisibleColumns={appelVisibleColumns.length > 0 ? appelVisibleColumns : undefined}
            splitBranches={competitionCore.splitHistory}
            onOpenCompetition={props.onOpenCompetition}
          />
        )}
        {currentPhase === 'remote' && (
          <GregAutoPublishToggle on={gregAutoOn} onChange={setGregAutoOn} />
        )}
        <Suspense fallback={null}>
          <RemoteScoreManager
            competition={competition}
            pools={pools}
            tableauMatches={tableauMatches}
            consolationBrackets={consolationBrackets}
            initialStripCount={remoteArenaCount}
            initialStripStart={remoteStripStart}
            onArenaCountChange={setRemoteArenaCount}
            onStripStartChange={setRemoteStripStart}
            onStartRemote={() => setIsRemoteActive(true)}
            onStopRemote={() => {
              setIsRemoteActive(false);
              setArenaStates([]);
              setRemoteServerUrl(null);
            }}
            onServerStarted={setRemoteServerUrl}
            isRemoteActive={isRemoteActive}
            isVisible={currentPhase === 'remote'}
          />
        </Suspense>

        {currentPhase === 'logs' && (
          <>
            <ScoreAuditLog competitionId={competition.id} matchOptions={matchAuditOptions} />
            <Suspense fallback={null}>
              <MatchAuditLog
                competitionId={competition.id}
                competitionName={competition.title}
                matchOptions={matchAuditOptions}
              />
            </Suspense>
          </>
        )}

        {currentPhase === 'referees' && competition.settings?.refereeFeatureEnabled && (
          <RefereesPhase
            competition={competition}
            referees={referees}
            setReferees={setReferees}
            pools={pools}
            poolHistory={poolHistory}
            assignableMatches={refereeAssignableMatches}
            tableauMatches={tableauMatches}
            setTableauMatches={setTableauMatches}
            consolationBrackets={consolationBrackets}
            setConsolationBrackets={setConsolationBrackets}
            applyPoolRefereeAssignments={applyPoolRefereeAssignments}
            assign={assignMatches}
          />
        )}
      </div>

      {/* Modals */}
      <CompetitionExportModals
        modals={modals}
        competition={competition}
        currentPhase={currentPhase}
        setCurrentPhase={setCurrentPhase}
        fencers={fencers}
        pools={pools}
        currentPoolRound={currentPoolRound}
        overallRanking={overallRanking}
        finalResults={finalResults}
        tableauMatches={tableauMatches}
        consolationBrackets={consolationBrackets}
        arenaCount={arenaStates.length}
        isLaserSabre={isLaserSabre}
        exports={exports}
        poolsRemoteInfo={poolsRemoteInfo}
      />

      {teamImport.teamImportModal && <TeamImportModal {...teamImport.teamImportModal} />}

      {modals.showAddFencerModal && (
        <AddFencerModal
          onClose={() => modals.setShowAddFencerModal(false)}
          onAdd={addFencer}
          competitionGender={competition.gender}
          teamLevels={teamLevels}
        />
      )}

      {pendingSplitOffGroup && (
        <Suspense fallback={null}>
          <SplitCompetitionModal
            groupLabel={
              pendingSplitOffGroup === Gender.FEMALE
                ? t('genders.female')
                : pendingSplitOffGroup === Gender.MALE
                  ? t('genders.male')
                  : pendingSplitOffGroup
            }
            fencerCount={extractSplitGroupRanking(overallRanking, pendingSplitOffGroup).length}
            defaultTitle={defaultSplitCompetitionTitle(competition.title, pendingSplitOffGroup)}
            onConfirm={title => createSplitOffCompetition(pendingSplitOffGroup, title)}
            onCancel={() => setPendingSplitOffGroup(null)}
          />
        </Suspense>
      )}

      {modals.showPropertiesModal && (
        <CompetitionPropertiesModal
          competition={competition}
          onSave={async updates => {
            const updatedCompetition = { ...competition, ...updates };
            // Mettre à jour l'UI immédiatement avant l'écriture DB pour éviter le flash
            onUpdate(updatedCompetition);
            // Par les commandes du contrat (docs/adr/0018) : un refus remonte à la modale
            await persistCompetitionUpdate(client, competition, updates);
          }}
          onClose={() => modals.setShowPropertiesModal(false)}
        />
      )}

      {importData && (
        <Suspense fallback={null}>
          <ImportModal
            format={importData.format}
            filepath={importData.filepath}
            content={importData.content}
            fencers={fencers}
            onImport={handleImportFencers}
            onImportRanking={handleImportRanking}
            onImportReferees={handleImportReferees}
            onClose={() => setImportData(null)}
          />
        </Suspense>
      )}

      {poolCorrectionDialog}

      <CompetitionSecondaryModals
        modals={modals}
        competition={competition}
        fencers={fencers}
        pools={pools}
        tableauMatches={tableauMatches}
        consolationBrackets={consolationBrackets}
        overallRanking={overallRanking}
        finalResults={finalResults}
        poolMaxScore={poolMaxScore}
        allPoolsComplete={areAllPoolsComplete()}
        updateScore={updateScore}
        onImportFencers={handleImportFencers}
        onKioskFinish={() => {
          modals.setShowKiosk(false);
          handleGoToRanking();
        }}
      />
    </div>
  );
};

export default React.memo(CompetitionView);
