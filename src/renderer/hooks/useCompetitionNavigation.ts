/**
 * BPM - Escrime - Navigation entre phases de la compétition (poules → classement → tableau,
 * tour suivant, 3e place) (extrait de CompetitionView, #1599)
 * Licensed under GPL-3.0
 */
import { sortByEntryRank } from '../../shared/domain/tableau/tableauDraw';
import { legacyRapieresRead } from '../../shared/domain/formula/rapieresFormula';
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { FencerStatus, Weapon } from '../../shared/types';
import { nextRoundPlan } from '../../shared/domain/pools/roundSeeding';
import type {
  Competition,
  Fencer,
  Pool,
  PoolRanking,
  QuestPhaseConfig,
  TiesAtBar,
} from '../../shared/types';
import { generateInitialRanking } from '../../shared/utils/poolCalculations';
import { selectNextRoundFencers } from '../../shared/utils/poolRounds';
import type { ConsolationBracket, TableauMatch } from '../../shared/domain/tableau/tableauTypes';
import type { GroupTableau } from '../../shared/domain/ranking/splitGroups';
import { useConfirm } from '../components/ConfirmDialog';
import { TIES_CHOICES, tiesNotice, type TiesChoice } from '../components/ties/TiesAtBar';
import { setTableauTies } from './tableauTiesChoice';
import { tableauQualificationOf } from '../../shared/domain/formula/formulaV2';
import type { TiedAtBar } from '../../shared/domain/ranking/advancement';
import {
  getActiveFormula,
  getTableauAdvancement,
  resolveCompetitionSettings,
} from '../../shared/utils/customFormulaSettings';
import { tableauCut } from '../../shared/domain/ranking/tableauRanking';
import { useToast } from '../components/Toast';
import type { Phase } from './useCompetitionSession';
import type { useFencerManagement } from './useFencerManagement';
import type { usePoolManagement } from './usePoolManagement';
import { useTranslation } from './useTranslation';
import { useBpmClient } from '../api/BpmClientContext';
import { persistCompetitionUpdate } from '../api/competitionUpdate';
import { isTableauEligible } from '../../shared/domain/fencers/fencerStatus';

type PoolManagement = ReturnType<typeof usePoolManagement>;
type Setter<T> = Dispatch<SetStateAction<T>>;
interface UseCompetitionNavigationParams {
  competition: Competition;
  onUpdate: (competition: Competition) => void;
  setCurrentPhase: Setter<Phase>;
  fencers: Fencer[];
  updateFencers: ReturnType<typeof useFencerManagement>['updateFencers'];
  getCheckedInFencers: () => Fencer[];
  pools: Pool[];
  /** Tours de poules terminés (cumul des tours, Q4) */
  poolHistory?: Pool[][];
  setPools: Setter<Pool[]>;
  overallRanking: PoolRanking[];
  setOverallRanking: Setter<PoolRanking[]>;
  computeOverallRanking: PoolManagement['computeOverallRanking'];
  nextPoolRound: PoolManagement['nextPoolRound'];
  currentPoolRound: number;
  currentAppelFencers: Fencer[];
  poolRoundQualifiers: number[] | undefined;
  customFormula: ReturnType<typeof getActiveFormula>;
  hasDirectElimination: boolean;
  thirdPlaceMatch: boolean;
  playAllPositions: boolean;
  setPoolsLaunched: Setter<boolean>;
  setViewedPoolRound: Setter<number | null>;
  setRankingValidated: Setter<boolean>;
  setSkipPoolPhase: Setter<boolean>;
  rankingChanged: boolean;
  setRankingChanged: Setter<boolean>;
  tableauMatches: TableauMatch[];
  setTableauMatches: Setter<TableauMatch[]>;
  consolationBrackets: ConsolationBracket[];
  setConsolationBrackets: Setter<ConsolationBracket[]>;
  activeSplitGroup: string | null;
  /** Tableaux des groupes lus dans l'état du moteur (docs/adr/0024) */
  groupTableaux: Record<string, GroupTableau>;
  /** Groupe affiché (préférence du poste) et son tableau */
  showSplitGroup: (group: string | null) => void;
}

/** Transitions entre phases : classement, tableau (3e place), tour de poules suivant. */
export function useCompetitionNavigation({
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
}: UseCompetitionNavigationParams) {
  const client = useBpmClient();
  const { showToast } = useToast();
  const { confirm, choose } = useConfirm();
  const { t } = useTranslation();

  const handleQuestConfigUpdate = useCallback(
    async (updates: Partial<QuestPhaseConfig>) => {
      if (!competition.settings?.questConfig) return;
      const updatedCompetition = {
        ...competition,
        settings: {
          ...competition.settings,
          questConfig: { ...competition.settings.questConfig, ...updates },
        },
      };
      onUpdate(updatedCompetition);
      await persistCompetitionUpdate(client, competition, updatedCompetition);
    },
    [client, competition, onUpdate]
  );

  const handleGoToRanking = () => {
    if (overallRanking.length === 0) {
      const ranking = computeOverallRanking(pools);
      setOverallRanking(ranking);
    }
    setCurrentPhase('ranking');
  };

  /** Commande d'épreuve de l'écran (clearTableau, skipPools ; docs/adr/0017) */
  const runCommand = async (
    name: 'clearTableau' | 'skipPools',
    input: { fencerIds?: string[]; group?: string } = {}
  ): Promise<'recorded' | 'local' | 'refused'> => {
    try {
      await client.call(name, { competitionId: competition.id, ...input });
      return 'recorded';
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'internal';
      if (code === 'unavailable') return 'local';
      showToast((e as Error).message ?? code, 'error');
      return 'refused';
    }
  };

  const splitCriteria = competition.settings?.postPoolSplitCriteria;

  /**
   * Tableau retiré par le moteur (TableauCleared) ; repli local hors moteur. Tableaux séparés
   * (docs/adr/0024) : tableaux des groupes « groups » qui en ont un, chacun par sa commande.
   */
  const clearTableau = async (groups: string[] = []) => {
    if (splitCriteria) {
      for (const group of groups) {
        const t = groupTableaux[group];
        if (!t || (t.tableauMatches.length === 0 && t.consolationBrackets.length === 0)) continue;
        if ((await runCommand('clearTableau', { group })) !== 'local') continue;
        if (group === activeSplitGroup) {
          setTableauMatches([]);
          setConsolationBrackets([]);
        }
      }
      return;
    }
    if (tableauMatches.length === 0 && consolationBrackets.length === 0) return;
    if ((await runCommand('clearTableau')) !== 'local') return;
    setTableauMatches([]);
    setConsolationBrackets([]);
  };

  const handleSkipToRanking = async () => {
    const checkedIn = getCheckedInFencers();
    // Épreuve sans poules par le moteur (PoolsSkipped) ; l'écran relit l'état. Le moteur range
    // par rang puis nom, le tirage du tableau départage (docs/adr/0045) : `fencerIds` choisit
    const outcome = await runCommand('skipPools', { fencerIds: checkedIn.map(f => f.id) });
    if (outcome === 'refused') return;
    if (outcome === 'recorded') {
      setRankingValidated(false);
      setCurrentPhase('ranking');
      return;
    }
    // Hors moteur : même ordre que skipPools (rang d'entrée, puis nom)
    const initialRanking = generateInitialRanking(sortByEntryRank(checkedIn));
    setOverallRanking(initialRanking);
    setSkipPoolPhase(true);
    setPools([]);
    setRankingValidated(false);
    setCurrentPhase('ranking');
  };

  const handleGoToTableau = (splitGroup?: string) => {
    setRankingValidated(true);
    // Ne pas recalculer : overallRanking est déjà à jour

    // Tableaux séparés (docs/adr/0024) : groupe affiché = préférence du poste, tableau lu dans
    // l'état du moteur ; le groupe visé devient le groupe affiché
    const group = splitCriteria ? (splitGroup ?? activeSplitGroup) : null;
    if (group && group !== activeSplitGroup) showSplitGroup(group);

    // Tableau déjà tiré : on y retourne sans le refaire, sinon ses matchs joués seraient
    // effacés par le choix de la petite finale (#1996)
    const targetHasTableau = group
      ? (groupTableaux[group]?.tableauMatches.length ?? 0) > 0
      : tableauMatches.length > 0;
    if (targetHasTableau) {
      setCurrentPhase('tableau');
      return;
    }

    // Si le classement a changé, réinitialiser les matches du tableau
    if (rankingChanged) {
      void clearTableau(Object.keys(groupTableaux));
      setRankingChanged(false);
      showToast("Le classement a changé. Le tableau d'élimination va être régénéré.", 'warning');
    }

    // Rapières comme les autres épreuves : mode de tableau (tous, 3e place, toutes les places,
    // demi-finales) décidé dans la formule, plus de fenêtre au passage (docs/adr/0043, F4b)
    const draw = () => {
      // Tirer toutes les places → 3ème place implicite, pas de question
      if (playAllPositions) {
        handleThirdPlaceDecision(true, undefined, group);
        return;
      }
      // 3ème place décidée dans la formule (#1125, #2013) : plus de question au lancement
      handleThirdPlaceDecision(thirdPlaceMatch, undefined, group);
    };
    // Ex aequo à la barre de qualification (docs/adr/0040) : listés et choix pour ce tableau,
    // avant sa génération ; le tableau est tiré avec le classement retenu
    const tied = tableauTiedAtBar();
    if (!tied) {
      setTableauTies(competition.id, undefined);
      draw();
      return;
    }
    void chooseTies(tied, tableauFormulaRule()?.ties).then(ties => {
      if (!ties) return;
      setTableauTies(competition.id, ties);
      draw();
    });
  };

  /** Règle de qualification vers le tableau : formule « Autre » (v1), sinon formule v2 */
  const tableauFormulaRule = () => {
    const custom = getActiveFormula(competition.weapon, competition.settings);
    if (custom) return getTableauAdvancement(custom);
    const formula = competition.settings?.formula;
    return formula ? tableauQualificationOf(formula) : undefined;
  };

  /** Ex aequo à la barre du tableau selon la formule (comme le moteur, tableauCut) */
  const tableauTiedAtBar = () => {
    const formula = competition.settings?.formula;
    // Même coupe que le classement du tableau (useCompetitionPhaseFlow) et que le moteur
    return tableauCut(overallRanking, pools, {
      // Épreuve enregistrée en mode spécial : lue comme avant (docs/adr/0043, F4e)
      legacyRapieres: legacyRapieresRead(competition.settings, undefined),
      poolWinnersOnly: !!resolveCompetitionSettings(competition.weapon, competition.settings)
        .poolWinnersOnly,
      customFormula: getActiveFormula(competition.weapon, competition.settings),
      tableauQualification: formula ? tableauQualificationOf(formula) : undefined,
      postPoolSplitCriteria: undefined,
      activeSplitGroup: null,
      splitOffCompetitionIds: undefined,
    }).tiedAtBar;
  };

  /** Ex aequo listés, choix pour cette coupe ; null : annulé */
  const chooseTies = async (
    tied: TiedAtBar,
    formulaTies: TiesAtBar | undefined
  ): Promise<TiesChoice | null> => {
    const nameOf = (id: string) => {
      const f = fencers.find(x => x.id === id);
      return f ? `${f.lastName} ${f.firstName}` : id;
    };
    const picked = await choose({
      message: `${tiesNotice(t, tied, nameOf)}\n${t('tiesAtBar.choose')}`,
      choices: TIES_CHOICES.map(c => ({
        value: c,
        label:
          c === (formulaTies ?? 'all')
            ? t('tiesAtBar.formula', { label: t(`tiesAtBar.${c}`) })
            : t(`tiesAtBar.${c}`),
      })),
    });
    return (picked as TiesChoice | null) ?? null;
  };

  const handleThirdPlaceDecision = (
    thirdPlace: boolean,
    extra?: { playAllPositions: boolean },
    /** Tableaux séparés : groupe du tableau à refaire (docs/adr/0024) */
    group: string | null = activeSplitGroup
  ) => {
    const settings = { ...competition.settings, ...extra, thirdPlaceMatch: thirdPlace };
    const updatedCompetition = { ...competition, settings };

    void persistCompetitionUpdate(client, competition, updatedCompetition).catch(e =>
      showToast((e as Error).message, 'error')
    );

    onUpdate(updatedCompetition);
    void clearTableau(group ? [group] : []);
    setCurrentPhase('tableau');
  };

  // Tour suivant (#1051) : qualifiés selon le classement du tour terminé, non-qualifiés
  // éliminés, puis appel + nouveau tirage seedé sur ce classement.
  const afterRoundClosed = (nextRound: number) => {
    setPoolsLaunched(false);
    setRankingValidated(false);
    setViewedPoolRound(null);
    setCurrentPhase('checkin');
    showToast(t('pools.next_round_checkin', { n: nextRound }), 'success');
  };

  /**
   * Clôture par le moteur (closePoolRound, PoolRoundClosed au journal, docs/adr/0017) :
   * simulation pour la confirmation, puis commande ; l'écran relit tireurs et état.
   * « local » : moteur absent (hors Electron).
   */
  const closeRoundByCommand = async (): Promise<'recorded' | 'local' | 'refused'> => {
    try {
      let sim = await client.call('closePoolRound', {
        competitionId: competition.id,
        dryRun: true,
      });
      // Ex aequo à la barre au-delà du quota (docs/adr/0040) : choix pour cette coupe
      let ties: TiesChoice | undefined;
      if (sim.tiedAtBar) {
        const formulaTies = nextRoundPlan({
          weapon: competition.weapon,
          settings: competition.settings,
          round: currentPoolRound,
          pools,
          history: poolHistory ?? [],
          isLaserSabre: competition.weapon === Weapon.LASER,
        }).ties;
        const picked = await chooseTies(sim.tiedAtBar, formulaTies);
        if (!picked) return 'refused';
        ties = picked as TiesChoice;
        sim = await client.call('closePoolRound', {
          competitionId: competition.id,
          dryRun: true,
          ties,
        });
      }
      const ok = await confirm(
        t('pools.next_round_confirm', {
          n: sim.nextRound,
          qualified: sim.qualified,
          eliminated: sim.eliminated,
        })
      );
      if (!ok) return 'refused';
      await client.call('closePoolRound', {
        competitionId: competition.id,
        ...(ties ? { ties } : {}),
      });
      afterRoundClosed(sim.nextRound);
      return 'recorded';
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'internal';
      if (code === 'unavailable') return 'local';
      if (code === 'not_enough_qualifiers') {
        showToast('Il faut au moins 4 qualifiés pour un nouveau tour de poules.', 'warning');
      } else {
        showToast((e as Error).message ?? code, 'error');
      }
      return 'refused';
    }
  };

  const handleNextPoolRound = async () => {
    if ((await closeRoundByCommand()) !== 'local') return;
    const nextRound = currentPoolRound + 1;
    // Même plan que le moteur (classement du tour ou cumul, qualifiés de la formule, ADR-0036)
    const plan = nextRoundPlan({
      weapon: competition.weapon,
      settings: competition.settings,
      round: currentPoolRound,
      pools,
      history: poolHistory ?? [],
      isLaserSabre: competition.weapon === Weapon.LASER,
    });
    let cut = selectNextRoundFencers(plan.ranking, plan.qualifierCount, plan.ties);
    // Ex aequo à la barre (docs/adr/0040) : listés et choix pour cette coupe, comme le moteur
    if (cut.tiedAtBar) {
      const ties = await chooseTies(cut.tiedAtBar, plan.ties);
      if (!ties) return;
      cut = selectNextRoundFencers(plan.ranking, plan.qualifierCount, ties, Math.random);
    }
    const { qualified, eliminated } = cut;
    if (qualified.length < 4) {
      showToast('Il faut au moins 4 qualifiés pour un nouveau tour de poules.', 'warning');
      return;
    }
    const toEliminate = eliminated.filter(f => {
      const status = fencers.find(x => x.id === f.id)?.status;
      return status !== undefined && isTableauEligible({ status });
    });
    const ok = await confirm(
      t('pools.next_round_confirm', {
        n: nextRound,
        qualified: qualified.length,
        eliminated: toEliminate.length,
      })
    );
    if (!ok) return;
    // Appel du tour terminé figé avant MAJ (consultation + export PDF par tour)
    const appelSnapshot = currentAppelFencers;
    // Non-qualifiés éliminés ; qualifiés : classement = place au tour terminé
    const updates: Record<string, Partial<Fencer>> = {};
    for (const f of toEliminate) updates[f.id] = { status: FencerStatus.ELIMINATED };
    for (const f of qualified) {
      if (fencers.find(x => x.id === f.id)?.ranking !== f.ranking) {
        updates[f.id] = { ranking: f.ranking };
      }
    }
    await updateFencers(updates);
    nextPoolRound(appelSnapshot);
    afterRoundClosed(nextRound);
  };

  return {
    handleQuestConfigUpdate,
    handleGoToRanking,
    handleSkipToRanking,
    handleGoToTableau,
    handleThirdPlaceDecision,
    handleNextPoolRound,
  };
}
