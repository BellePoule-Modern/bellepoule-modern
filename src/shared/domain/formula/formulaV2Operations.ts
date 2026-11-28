/**
 * BPM - Escrime - Opérations de frise sur la formule v2 (#2013 étape C, ADR-0036)
 * Même grammaire que la frise de l'écran (ADR-0032) et même forme d'opérations
 * qu'updateCompetitionFormula (ADR-0033), sur un seul modèle pour toutes les armes. `setPhase`
 * règle **chaque tour** séparément. Les anciens noms de réglages (poolMaxScore, tableMaxScore,
 * qualifiers, advancementRule…) restent acceptés. Domaine pur : identifiants injectés.
 * Licensed under GPL-3.0
 */

import {
  AdvancementRule,
  Category,
  CompetitionSettings,
  CustomFormulaConfig,
  CustomScoringConfig,
  Gender,
  QuestPhaseConfig,
  Weapon,
} from '../../types';
import { getCoherenceIssues, CoherenceIssue } from '../../utils/formulaCoherence';
import { MAX_POOL_ROUNDS } from './formulaDraft';
import type { FormulaSummaryPart, FriezeBrick, FriezePhase } from './formulaFrieze';
import { FormulaOperation, FormulaOperationError } from './formulaOperations';
import {
  coupledFormula,
  customFormulaOf,
  flatSettingsOf,
  formulaOf,
  isCoupledSplit,
  playedTableauOf,
  uncoupledFormula,
  type FormulaPhaseV2,
  type FormulaV2,
  type PoolDistribution,
  type PoolRoundPhase,
  type QuestPhase,
  type SplitBranch,
  type SplitCriterion,
  type SplitPhase,
  type TableauPhase,
} from './formulaV2';
import { validateFormulaSettings } from './validateFormulaSettings';
import { remark, type FormulaProgress, type FormulaRemark } from './formulaRemarks';
import {
  branchEndIssues,
  fightPhaseIssues,
  poolQualificationIssues,
  progressIssues,
  splitTakeIssues,
} from './formulaStructure';
import { tiesIssue } from '../ranking/advancement';
import { normalizeRankingFilterKeys, rankingFilterKeysIssue } from '../ranking/rankingFilters';
import { teamFormulaIssues } from '../teams/teamMatchRule';
import type { TeamFormat } from '../teams/relay';
import { TABLEAU_DRAW_MODES, type TableauDrawMode } from '../tableau/tableauDraw';
export { tiesIssue };

const isPool = (p: FormulaPhaseV2): p is PoolRoundPhase => p.kind === 'pool';
const isQuest = (p: FormulaPhaseV2): p is QuestPhase => p.kind === 'quest';
const isTableau = (p: FormulaPhaseV2): p is TableauPhase => p.kind === 'tableau';
const isSplit = (p: FormulaPhaseV2): p is SplitPhase => p.kind === 'split';

/** Phases de la frise (clés stables : pool-0, pool-1…, quest, tableau, split) */
export function friezeOfV2(f: FormulaV2): FriezePhase[] {
  let round = 0;
  return f.phases.flatMap((p): FriezePhase[] =>
    isPool(p)
      ? [{ kind: 'pool', round, key: `pool-${round++}` }]
      : isQuest(p)
        ? [{ kind: 'quest', key: 'quest' }]
        : isTableau(p)
          ? [{ kind: 'tableau', key: 'tableau' }]
          : [{ kind: 'split', key: 'split' }]
  );
}

/**
 * Place d'une scission (ADR-0039) : dernière phase, unique, sans Tour Quest, après un tour de
 * poules ou un tableau arrêté à N. null : conforme ou pas de scission.
 */
export function splitPlacementIssue(f: FormulaV2): FormulaRemark | null {
  const at = f.phases.findIndex(isSplit);
  if (at < 0) return null;
  if (f.phases.filter(isSplit).length > 1)
    return remark('split_unique', 'split', 'une seule scission');
  if (at !== f.phases.length - 1)
    return remark('split_not_last', 'split', 'scission : toujours la dernière phase');
  if (f.phases.some(isQuest))
    return remark('split_with_quest', 'split', 'scission : sans Tour Quest');
  const prev = f.phases[at - 1];
  if (!prev || !(isPool(prev) || (isTableau(prev) && !!prev.stopAt)))
    return remark(
      'split_misplaced',
      'split',
      'scission : après un tour de poules ou un tableau arrêté à N tireurs'
    );
  return null;
}

/**
 * Briques autorisées au « ＋ » d'indice `at` (0 = après l'appel) : tours de poules avant le Tour
 * Quest et le tableau, Tour Quest (Sabre Laser) après les poules, un tableau en dernier ; après
 * un tableau arrêté à N tireurs, des tours de poules pour les restants (ADR-0037, D2).
 */
export function insertOptionsV2(f: FormulaV2, weapon: Weapon, at: number): FriezeBrick[] {
  const rounds = f.phases.filter(isPool).length;
  const quest = f.phases.some(isQuest);
  const tableauAt = f.phases.findIndex(isTableau);
  const tableau = tableauAt >= 0 ? (f.phases[tableauAt] as TableauPhase) : undefined;
  const preRounds = tableau ? f.phases.slice(0, tableauAt).filter(isPool).length : rounds;
  const total = friezeOfV2(f).length;
  const split = f.phases.some(isSplit);
  // Scission : toujours la dernière phase, plus rien ne s'insère après elle (ADR-0039)
  const lastAt = split ? total - 1 : total;
  const out: FriezeBrick[] = [];
  // Tour Quest : au plus un tour de poules préliminaire
  const maxRounds = quest ? 1 : MAX_POOL_ROUNDS;
  const afterStopped = !!tableau?.stopAt && !quest && at > tableauAt && at <= lastAt;
  if (rounds < maxRounds && (at <= preRounds || afterStopped)) out.push('pool');
  if (
    weapon === Weapon.LASER &&
    !quest &&
    !split &&
    !tableau?.stopAt &&
    at === preRounds &&
    preRounds <= 1
  )
    out.push('quest');
  if (!tableau && !split && at === total) out.push('tableau');
  // Scission en fin de frise, après un tour de poules ou un tableau arrêté (ADR-0039)
  const prev = f.phases[f.phases.length - 1];
  if (
    !split &&
    !quest &&
    at === total &&
    !!prev &&
    (isPool(prev) || (isTableau(prev) && !!prev.stopAt))
  )
    out.push('split');
  return out;
}

export function canRemoveV2(f: FormulaV2, phase: FriezePhase): boolean {
  if (friezeOfV2(f).length <= 1) return false;
  if (phase.kind === 'split') return true;
  // Une scission garde sa place : après un tour de poules ou un tableau arrêté (ADR-0039)
  if (f.phases.some(isSplit) && splitPlacementIssue(removeV2(f, phase))) return false;
  if (phase.kind === 'tableau') return f.phases.some(isPool) || f.phases.some(isQuest);
  if (phase.kind === 'pool') {
    // Tableau arrêté (ADR-0037) : au moins un tour avant lui
    const at = f.phases.findIndex(isTableau);
    const tableau = f.phases[at] as TableauPhase | undefined;
    if (tableau?.stopAt) {
      const pre = f.phases.slice(0, at).filter(isPool).length;
      // Dernier tour d'après : retiré avec l'arrêt du tableau (removeV2)
      if (phase.round < pre && pre <= 1) return false;
    }
  }
  return true;
}

/** Réglages d'un tour neuf : ceux du tour voisin, tous qualifiés */
function newPool(f: FormulaV2, at: number, id: string): PoolRoundPhase {
  const list = f.phases.filter(isPool);
  // `at` : position dans la frise ; voisin = tour qui précède (ou suit) cette position
  const before = f.phases.slice(0, at).filter(isPool).length;
  const neighbour = list[before - 1] ?? list[before];
  const base: PoolRoundPhase = neighbour ?? {
    kind: 'pool',
    id,
    sizeMin: 5,
    sizeMax: 7,
    maxScore: 5,
    timerSeconds: 180,
    qualification: { mode: 'all' },
    seeding: 'previous_round',
    boutOrder: 'fie',
  };
  const { label: _label, ...rest } = base;
  return { ...rest, id, qualification: { mode: 'all' } };
}

/** Tableau neuf : réglages du tableau enregistrés sur l'épreuve, sinon défauts de l'arme */
export function newTableau(ctx: FormulaV2Context, id: string): TableauPhase {
  const s = ctx.settings ?? {};
  const flat = flatSettingsOf(
    formulaOf({ weapon: ctx.weapon, category: ctx.category }),
    ctx.weapon
  );
  return {
    kind: 'tableau',
    id,
    maxScore: s.defaultTableMaxScore ?? flat.defaultTableMaxScore ?? 15,
    timerSeconds: s.defaultTableTimerSeconds ?? flat.defaultTableTimerSeconds ?? 180,
    thirdPlace: s.thirdPlaceMatch ?? false,
    allPlaces: s.playAllPositions ?? false,
  };
}

/** Modèle de branche d'une scission (ADR-0039) : phases par défaut de l'arme */
export type BranchPreset = 'tableau' | 'pools_tableau' | 'pools';

/** Phases d'une branche selon son modèle : tour de poules et tableau par défaut de l'arme */
export function branchPhases(
  preset: BranchPreset,
  ctx: FormulaV2Context,
  newId: () => string
): FormulaPhaseV2[] {
  const pool = (): PoolRoundPhase => {
    const first = formulaOf({ weapon: ctx.weapon, category: ctx.category }).phases.find(isPool);
    return newPool({ version: 2, phases: first ? [first] : [], general: {} }, 1, newId());
  };
  if (preset === 'tableau') return [newTableau(ctx, newId())];
  if (preset === 'pools') return [pool()];
  return [pool(), newTableau(ctx, newId())];
}

/** Scission neuve : par rang, « Tableau A » (16 premiers) et « Tableau B » (le reste) */
function newSplit(ctx: FormulaV2Context, newId: () => string): SplitPhase {
  return {
    kind: 'split',
    id: newId(),
    criterion: 'rank',
    branches: [
      {
        label: 'Tableau A',
        phases: branchPhases('tableau', ctx, newId),
        take: { mode: 'fixed_count', count: 16 },
      },
      { label: 'Tableau B', phases: branchPhases('tableau', ctx, newId) },
    ],
  };
}

/** Modèle d'une branche d'après ses phases ; null : autre suite (réglée dans la fille) */
export function branchPresetOf(phases: FormulaPhaseV2[]): BranchPreset | null {
  if (phases.some(p => !isPool(p) && !isTableau(p))) return null;
  const pools = phases.some(isPool);
  const tableau = phases.some(isTableau);
  if (pools && tableau) return isTableau(phases[phases.length - 1]) ? 'pools_tableau' : null;
  if (tableau) return phases.length === 1 ? 'tableau' : null;
  return pools ? 'pools' : null;
}

/** Part par défaut d'une branche par rang : 16 premiers */
const DEFAULT_TAKE: AdvancementRule = { mode: 'fixed_count', count: 16 };

/** Branche sans les champs d'un critère (sexe, catégories, part) */
function bareBranch(b: SplitBranch): SplitBranch {
  const { gender: _g, categories: _c, take: _t, ...rest } = b;
  return rest;
}

/** Champ propre au critère pour la branche `i` sur `count` (ADR-0039) */
function criterionFields(
  criterion: SplitCriterion,
  i: number,
  count: number,
  prev?: SplitBranch
): Partial<SplitBranch> {
  if (criterion === 'rank') return i < count - 1 ? { take: prev?.take ?? DEFAULT_TAKE } : {};
  if (criterion === 'gender') {
    const g = prev?.gender ?? [Gender.MALE, Gender.FEMALE][i];
    return g ? { gender: g } : {};
  }
  if (criterion === 'category') return { categories: prev?.categories ?? [] };
  return {};
}

/**
 * Critère changé à l'écran (ADR-0039) : chaque branche perd les champs de l'ancien critère et
 * reçoit ceux du nouveau (rang : 16 premiers sauf la dernière ; sexe : hommes puis dames ;
 * catégorie : à cocher).
 */
export function withSplitCriterion(split: SplitPhase, criterion: SplitCriterion): SplitPhase {
  const n = split.branches.length;
  return {
    ...split,
    criterion,
    branches: split.branches.map((b, i) => {
      // Rester dans l'épreuve : critère sexe seulement (ADR-0039, E3)
      const { stayInCompetition: _stay, ...rest } = bareBranch(b);
      return {
        ...(criterion === 'gender' ? bareBranch(b) : rest),
        ...criterionFields(criterion, i, n),
      };
    }),
  };
}

/** Lettre de la branche `i` : « Tableau A », « Tableau B »… */
const branchLabel = (i: number) => `Tableau ${String.fromCharCode(65 + (i % 26))}`;

/**
 * Branche ajoutée en dernier (modèle « Tableau ») ; par rang, elle prend le reste et l'ancienne
 * dernière reçoit une part.
 */
export function addSplitBranch(
  split: SplitPhase,
  ctx: FormulaV2Context,
  newId: () => string
): SplitPhase {
  const used = new Set(split.branches.map(b => b.label));
  let k = split.branches.length;
  while (used.has(branchLabel(k))) k++;
  const added: SplitBranch = { label: branchLabel(k), phases: branchPhases('tableau', ctx, newId) };
  const branches = [...split.branches, added];
  const n = branches.length;
  return {
    ...split,
    branches: branches.map((b, i) => ({
      ...bareBranch(b),
      ...criterionFields(split.criterion, i, n, i < n - 1 ? b : undefined),
    })),
  };
}

/** Branche `index` retirée (deux branches au moins) ; par rang, la nouvelle dernière prend le reste */
export function removeSplitBranch(split: SplitPhase, index: number): SplitPhase {
  if (split.branches.length <= 2) return split;
  const branches = split.branches.filter((_, i) => i !== index);
  const n = branches.length;
  return {
    ...split,
    branches: branches.map((b, i) => ({
      ...bareBranch(b),
      ...criterionFields(split.criterion, i, n, b),
    })),
  };
}

export function insertV2(
  f: FormulaV2,
  ctx: FormulaV2Context,
  brick: FriezeBrick,
  at: number,
  newId: () => string
): FormulaV2 {
  const phases = [...f.phases];
  if (brick === 'split') {
    phases.push(newSplit(ctx, newId));
  } else if (brick === 'tableau') {
    phases.push(newTableau(ctx, newId()));
  } else if (brick === 'quest') {
    const rounds = phases.filter(isPool).length;
    const config: QuestPhaseConfig = {
      enabled: true,
      hasPreliminaryPools: rounds > 0,
      qualifiersCount: rounds > 0 ? 8 : undefined,
      opponentConstraint: 'none',
    };
    phases.splice(rounds, 0, { kind: 'quest', id: newId(), config });
  } else {
    // Le tour neuf se place à la position `at` de la frise (avant ou après un tableau arrêté)
    phases.splice(at, 0, newPool(f, at, newId()));
  }
  return withQuestPools({ ...f, phases });
}

export function removeV2(f: FormulaV2, phase: FriezePhase): FormulaV2 {
  if (phase.kind === 'tableau') return { ...f, phases: f.phases.filter(p => !isTableau(p)) };
  if (phase.kind === 'quest') return { ...f, phases: f.phases.filter(p => !isQuest(p)) };
  let round = -1;
  const phases = f.phases.filter(p =>
    phase.kind === 'split' ? !isSplit(p) : !(isPool(p) && ++round === phase.round)
  );
  // Plus de tour ni de scission après un tableau arrêté : il va de nouveau jusqu'à la finale
  const at = phases.findIndex(isTableau);
  const tableau = phases[at] as TableauPhase | undefined;
  if (tableau?.stopAt && !phases.slice(at + 1).some(p => isPool(p) || isSplit(p))) {
    const { stopAt: _stopAt, ...full } = tableau;
    phases[at] = full;
  }
  return withQuestPools({ ...f, phases });
}

/** Tour Quest : « poules préliminaires » suit la présence d'un tour de poules */
function withQuestPools(f: FormulaV2): FormulaV2 {
  const hasPools = f.phases.some(isPool);
  return {
    ...f,
    phases: f.phases.map(p =>
      isQuest(p) && p.config.hasPreliminaryPools !== hasPools
        ? { ...p, config: { ...p.config, hasPreliminaryPools: hasPools } }
        : p
    ),
  };
}

// ── Réglages d'une phase ──────────────────────────────────────────────────

const POOL_FIELDS = [
  'label',
  'sizeMin',
  'sizeMax',
  'maxScore',
  'timerSeconds',
  'scoring',
  'qualification',
  'seeding',
  'boutOrder',
  'distribution',
  'teamMatch',
] as const;
const TABLEAU_FIELDS = [
  'label',
  'maxScore',
  'timerSeconds',
  'thirdPlace',
  'allPlaces',
  'scoring',
  'stopAt',
  'draw',
  'teamMatch',
] as const;

/** Arrêt du tableau : puissance de 2, de 2 à 128 tireurs restants (ADR-0037) */
export const TABLEAU_STOP_AT = [2, 4, 8, 16, 32, 64, 128] as const;
const QUEST_FIELDS = [
  'qualifiersCount',
  'fightsPerFencer',
  'availableTimeMinutes',
  'numberOfArenas',
  'opponentConstraint',
] as const;
const GENERAL_FIELDS = [
  'restTimeSeconds',
  'ruleSet',
  'postPoolSplitCriteria',
  'entry',
  'rankingFilters',
  'tieBreakByVictory',
  'teamMatch',
] as const;

/**
 * Anciens noms (ADR-0033). Ceux de l'épée… Sabre Laser (poolMaxScore…) gardent leur sens : un
 * réglage commun à **tous** les tours ; les noms v2 (maxScore…) ne règlent que le tour visé.
 */
const SHARED_POOL_ALIASES: Record<string, string> = {
  poolMaxScore: 'maxScore',
  poolTimerSeconds: 'timerSeconds',
  poolSizeMin: 'sizeMin',
  poolSizeMax: 'sizeMax',
  poolBoutOrder: 'boutOrder',
};
const POOL_ALIASES: Record<string, string> = { advancementRule: 'qualification' };
const TABLEAU_ALIASES: Record<string, string> = {
  tableMaxScore: 'maxScore',
  tableTimerSeconds: 'timerSeconds',
  thirdPlaceMatch: 'thirdPlace',
  playAllPositions: 'allPlaces',
};
const QUEST_ALIASES: Record<string, string> = { questQualifiers: 'qualifiersCount' };

function renamed(settings: Record<string, unknown>, aliases: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) out[aliases[k] ?? k] = v;
  return out;
}

function checkFields(settings: Record<string, unknown>, allowed: readonly string[], where: string) {
  const unknown = Object.keys(settings).filter(k => !allowed.includes(k));
  if (unknown.length)
    throw new FormulaOperationError(
      `${where} : réglage(s) non modifiable(s) ici (${unknown.join(', ')}) ; autorisés : ${allowed.join(', ')}`
    );
}

/**
 * Surcharge de la règle de rencontre d'une phase (ADR-0044) : null la retire ; sinon un objet,
 * bornes jugées par formulaV2Issues
 */
function withTeamMatchOverride<T extends { teamMatch?: unknown }>(
  phase: T,
  raw: Record<string, unknown>,
  where: string
): T {
  if (!('teamMatch' in raw)) return phase;
  if (raw.teamMatch == null) {
    const { teamMatch: _t, ...rest } = phase;
    return rest as T;
  }
  if (typeof raw.teamMatch !== 'object' || Array.isArray(raw.teamMatch))
    throw new FormulaOperationError(
      `${where} : « teamMatch » attend { starters, reserves, relayStep, relayOrder }`
    );
  return phase;
}

const isRule = (v: unknown): v is AdvancementRule =>
  typeof v === 'object' && v !== null && typeof (v as { mode?: unknown }).mode === 'string';

const POOL_DISTRIBUTIONS: readonly PoolDistribution[] = ['serpentine', 'byLevel'];

function setPool(
  p: PoolRoundPhase,
  raw: Record<string, unknown>,
  where: string,
  isLastRound: boolean
): PoolRoundPhase {
  const { qualifiers, poolWinnersOnly, ...rest } = renamed(raw, POOL_ALIASES);
  checkFields(rest, POOL_FIELDS, where);
  let next = withTeamMatchOverride({ ...p, ...(rest as Partial<PoolRoundPhase>) }, rest, where);
  if (rest.qualification !== undefined && !isRule(rest.qualification))
    throw new FormulaOperationError(`${where} : « qualification » attend { mode, … }`);
  if ('distribution' in rest) {
    // null : retour au serpentin (défaut, clé absente)
    if (rest.distribution == null) {
      const { distribution: _d, ...withoutDistribution } = next;
      next = withoutDistribution;
    } else if (!POOL_DISTRIBUTIONS.includes(rest.distribution as PoolDistribution)) {
      throw new FormulaOperationError(
        `${where} : « distribution » attend ${POOL_DISTRIBUTIONS.join(' | ')}`
      );
    }
  }
  if (qualifiers !== undefined) {
    if (isLastRound)
      throw new FormulaOperationError(
        `${where} : « qualifiers » ne vaut que pour un tour suivi d'un autre tour`
      );
    const n = Number(qualifiers);
    next = { ...next, qualification: n > 0 ? { mode: 'fixed_count', count: n } : { mode: 'all' } };
  }
  if (poolWinnersOnly !== undefined)
    next = {
      ...next,
      qualification: poolWinnersOnly === true ? { mode: 'pool_winner' } : { mode: 'all' },
    };
  if (rest.maxScore !== undefined && next.scoring && next.scoring.type === 'standard')
    next = {
      ...next,
      scoring: { ...next.scoring, maxScore: next.maxScore } as CustomScoringConfig,
    };
  return next;
}

function setTableau(p: TableauPhase, raw: Record<string, unknown>, where: string): TableauPhase {
  const s = renamed(raw, TABLEAU_ALIASES);
  checkFields(s, TABLEAU_FIELDS, where);
  const { stopAt, draw, ...rest } = s;
  const next: TableauPhase = withTeamMatchOverride(
    { ...p, ...(rest as Partial<TableauPhase>) },
    rest,
    where
  );
  if (draw !== undefined) {
    // null ou « strict » : placement au rang (défaut, clé absente), docs/adr/0045
    if (draw === null || draw === 'strict') delete next.draw;
    else if (!(TABLEAU_DRAW_MODES as readonly unknown[]).includes(draw))
      throw new FormulaOperationError(
        `${where} : « draw » attend ${TABLEAU_DRAW_MODES.join(' | ')}`
      );
    else next.draw = draw as TableauDrawMode;
  }
  if (stopAt !== undefined) {
    // null ou 0 : tableau jusqu'à la finale
    if (stopAt === null || stopAt === 0) delete next.stopAt;
    else if (!(TABLEAU_STOP_AT as readonly unknown[]).includes(stopAt))
      throw new FormulaOperationError(
        `${where} : « stopAt » attend ${TABLEAU_STOP_AT.join(', ')} (ou 0 : jusqu'à la finale)`
      );
    else next.stopAt = stopAt as number;
  }
  return s.maxScore !== undefined && next.scoring?.type === 'standard'
    ? { ...next, scoring: { ...next.scoring, maxScore: next.maxScore } }
    : next;
}

function setQuest(p: QuestPhase, raw: Record<string, unknown>, where: string): QuestPhase {
  const s = renamed(raw, QUEST_ALIASES);
  checkFields(s, QUEST_FIELDS, where);
  return { ...p, config: { ...p.config, ...(s as Partial<QuestPhaseConfig>) } };
}

const SPLIT_FIELDS = ['criterion', 'branches'] as const;
const SPLIT_CRITERIA: readonly SplitCriterion[] = ['gender', 'category', 'rank', 'manual'];
const BRANCH_FIELDS = [
  'label',
  'phases',
  'gender',
  'categories',
  'take',
  'stayInCompetition',
] as const;
const GENDERS: readonly string[] = Object.values(Gender);
const CATEGORIES: readonly string[] = Object.values(Category);

/** Forme d'une branche reçue (écran, MCP) ; bornes et règles : formulaV2Issues */
function parseBranch(raw: unknown, where: string): SplitBranch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new FormulaOperationError(`${where} : branche attendue { label, phases, … }`);
  const b = raw as Record<string, unknown>;
  checkFields(b, BRANCH_FIELDS, where);
  if (typeof b.label !== 'string')
    throw new FormulaOperationError(`${where} : « label » attend un texte`);
  if (
    !Array.isArray(b.phases) ||
    !b.phases.every(
      p =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as { id?: unknown }).id === 'string' &&
        ['pool', 'quest', 'tableau', 'split'].includes(String((p as { kind?: unknown }).kind))
    )
  )
    throw new FormulaOperationError(`${where} : « phases » attend des phases { kind, id, … }`);
  if (b.gender !== undefined && !GENDERS.includes(b.gender as string))
    throw new FormulaOperationError(`${where} : « gender » attend ${GENDERS.join(', ')}`);
  if (
    b.categories !== undefined &&
    (!Array.isArray(b.categories) || !b.categories.every(c => CATEGORIES.includes(c as string)))
  )
    throw new FormulaOperationError(`${where} : « categories » attend ${CATEGORIES.join(', ')}`);
  if (b.take !== undefined && !isRule(b.take))
    throw new FormulaOperationError(`${where} : « take » attend { mode, count | percentage }`);
  if (b.stayInCompetition !== undefined && typeof b.stayInCompetition !== 'boolean')
    throw new FormulaOperationError(`${where} : « stayInCompetition » attend un booléen`);
  return { ...(b as unknown as SplitBranch), label: b.label.trim() };
}

function setSplit(p: SplitPhase, raw: Record<string, unknown>, where: string): SplitPhase {
  checkFields(raw, SPLIT_FIELDS, where);
  const next: SplitPhase = { ...p };
  if (raw.criterion !== undefined) {
    if (!SPLIT_CRITERIA.includes(raw.criterion as SplitCriterion))
      throw new FormulaOperationError(
        `${where} : « criterion » attend ${SPLIT_CRITERIA.join(', ')}`
      );
    next.criterion = raw.criterion as SplitCriterion;
  }
  if (raw.branches !== undefined) {
    if (!Array.isArray(raw.branches))
      throw new FormulaOperationError(`${where} : « branches » attend une liste`);
    next.branches = raw.branches.map((b, i) => parseBranch(b, `${where}, branche ${i + 1}`));
  }
  return next;
}

export interface FormulaV2Context {
  weapon: Weapon;
  category: Category;
  settings?: Partial<CompetitionSettings>;
}

const findPhase = (phases: FriezePhase[], key: string) => {
  const p = phases.find(x => x.key === key);
  if (!p)
    throw new FormulaOperationError(
      `phase « ${key} » inconnue ; phases : ${phases.map(x => x.key).join(', ') || 'aucune'}`
    );
  return p;
};

/** Index dans `f.phases` d'une phase de la frise */
function indexOf(f: FormulaV2, phase: FriezePhase): number {
  let round = -1;
  return f.phases.findIndex(p =>
    phase.kind === 'pool'
      ? isPool(p) && ++round === phase.round
      : phase.kind === 'quest'
        ? isQuest(p)
        : phase.kind === 'split'
          ? isSplit(p)
          : isTableau(p)
  );
}

/** Applique les opérations dans l'ordre (tout ou rien) ; rend la nouvelle formule */
export function applyOperationsV2(
  ctx: FormulaV2Context,
  operations: FormulaOperation[],
  newId: () => string
): FormulaV2 {
  if (operations.length === 0) throw new FormulaOperationError('aucune opération');
  let f = formulaOf(ctx);
  operations.forEach((o, i) => {
    const where = `opération ${i + 1} (${o.op})`;
    if (o.op === 'insertPhase') {
      const allowed = insertOptionsV2(f, ctx.weapon, o.at);
      if (!allowed.includes(o.brick))
        throw new FormulaOperationError(
          `${where} : « ${o.brick} » interdit en position ${o.at} ; autorisé : ${allowed.join(', ') || 'rien'}`
        );
      f = insertV2(f, ctx, o.brick, o.at, newId);
    } else if (o.op === 'removePhase') {
      const p = findPhase(friezeOfV2(f), o.phase);
      if (!canRemoveV2(f, p))
        throw new FormulaOperationError(
          `${where} : la phase « ${o.phase} » ne peut pas être retirée`
        );
      f = removeV2(f, p);
    } else if (
      o.op === 'setPhase' &&
      o.phase === 'tableau' &&
      !f.phases.some(isTableau) &&
      isCoupledSplit(f.phases.find(isSplit))
    ) {
      // Tableau joué dans l'épreuve par les branches restées (compétition couplée, ADR-0039 E3) :
      // mêmes réglages pour chacune
      f = setStayingTableaux(f, o.settings, where);
    } else if (o.op === 'setPhase') {
      const frieze = friezeOfV2(f);
      const p = findPhase(frieze, o.phase);
      const index = indexOf(f, p);
      const phases = [...f.phases];
      const current = phases[index];
      const rounds = frieze.filter(x => x.kind === 'pool').length;
      if (isPool(current) && p.kind === 'pool') {
        const shared: Record<string, unknown> = {};
        const own: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(o.settings)) {
          if (k in SHARED_POOL_ALIASES) shared[SHARED_POOL_ALIASES[k]] = v;
          else if (k === 'poolWinnersOnly') shared[k] = v;
          else own[k] = v;
        }
        const { poolWinnersOnly, ...common } = shared;
        let round = -1;
        for (let k = 0; k < phases.length; k++) {
          const q = phases[k];
          if (!isPool(q)) continue;
          round++;
          if (Object.keys(common).length)
            phases[k] = setPool(q, common, where, round >= rounds - 1);
        }
        // « Vainqueurs de poule seulement » : qualification du dernier tour avant le tableau
        if (poolWinnersOnly !== undefined) {
          const tableauAt = phases.findIndex(isTableau);
          const last = phases
            .map((x, k) => (isPool(x) && (tableauAt < 0 || k < tableauAt) ? k : -1))
            .filter(k => k >= 0)
            .pop();
          if (last !== undefined)
            phases[last] = setPool(
              phases[last] as PoolRoundPhase,
              { poolWinnersOnly },
              where,
              true
            );
        }
        if (Object.keys(own).length)
          phases[index] = setPool(
            phases[index] as PoolRoundPhase,
            own,
            where,
            p.round >= rounds - 1
          );
      } else if (isTableau(current)) phases[index] = setTableau(current, o.settings, where);
      else if (isQuest(current)) phases[index] = setQuest(current, o.settings, where);
      else if (isSplit(current)) phases[index] = setSplit(current, o.settings, where);
      f = { ...f, phases };
    } else {
      checkFields(o.settings, GENERAL_FIELDS, where);
      const {
        postPoolSplitCriteria: coupled,
        entry,
        rankingFilters,
        tieBreakByVictory,
        teamMatch,
        ...rest
      } = o.settings as Partial<FormulaV2['general']>;
      f = { ...f, general: { ...f.general, ...rest } };
      if ('teamMatch' in o.settings) {
        // null : règle retirée (réglages d'épreuve) ; sinon un objet, bornes jugées par
        // formulaV2Issues (ADR-0044)
        const { teamMatch: _old, ...general } = f.general;
        if (teamMatch != null && (typeof teamMatch !== 'object' || Array.isArray(teamMatch)))
          throw new FormulaOperationError(
            `${where} : « teamMatch » attend { starters, reserves, relayStep, relayOrder }`
          );
        f = { ...f, general: teamMatch ? { ...general, teamMatch } : general };
      }
      if ('tieBreakByVictory' in o.settings) {
        // null ou false : réglage retiré (défaut : selon l'arme) ; vrai : égalité par vainqueur désigné
        const { tieBreakByVictory: _old, ...general } = f.general;
        if (tieBreakByVictory != null && typeof tieBreakByVictory !== 'boolean')
          throw new FormulaOperationError(`${where} : « tieBreakByVictory » attend un booléen`);
        f = {
          ...f,
          general: tieBreakByVictory === true ? { ...general, tieBreakByVictory } : general,
        };
      }
      if ('entry' in o.settings) {
        // null ou individuelle : clé absente (défaut) ; équipes : libellés contrôlés
        const { entry: _old, ...general } = f.general;
        const issue = entry ? entryIssue(entry) : null;
        if (issue) throw new FormulaOperationError(`${where} : « entry » ${issue}`);
        f = {
          ...f,
          general: entry && entry.kind === 'team' ? { ...general, entry } : general,
        };
      }
      if ('rankingFilters' in o.settings) {
        // null ou liste vide : clé absente (aucun filtre) ; sinon critères connus et distincts
        const { rankingFilters: _oldFilters, ...general } = f.general;
        const issue = rankingFilters == null ? null : rankingFilterKeysIssue(rankingFilters);
        if (issue) throw new FormulaOperationError(`${where} : « rankingFilters » ${issue}`);
        f = {
          ...f,
          general: rankingFilters?.length
            ? { ...general, rankingFilters: normalizeRankingFilterKeys(rankingFilters) }
            : general,
        };
      }
      // Compétition couplée : scission par sexe dont les branches restent (ADR-0039, E3)
      if ('postPoolSplitCriteria' in o.settings) {
        if (coupled && coupled !== 'gender')
          throw new FormulaOperationError(`${where} : « postPoolSplitCriteria » attend gender`);
        f = coupled
          ? coupledFormula({ ...f, general: { ...f.general, postPoolSplitCriteria: 'gender' } })
          : uncoupledFormula(f);
        if (coupled && !isCoupledSplit(f.phases.find(isSplit)))
          throw new FormulaOperationError(
            `${where} : compétition couplée seulement avec un tableau final après un tour de poules`
          );
        if (!coupled) {
          const { postPoolSplitCriteria: _old, ...general } = f.general;
          f = { ...f, general };
        }
      }
    }
  });
  return f;
}

/** Réglages du tableau des branches restées dans l'épreuve (mêmes pour toutes) */
function setStayingTableaux(f: FormulaV2, settings: Record<string, unknown>, where: string) {
  const split = f.phases.find(isSplit)!;
  const next: SplitPhase = {
    ...split,
    branches: split.branches.map(b => ({
      ...b,
      phases: b.phases.map(p => (isTableau(p) ? setTableau(p, settings, where) : p)),
    })),
  };
  return { ...f, phases: f.phases.map(p => (p === split ? next : p)) };
}

/** Libellés de niveau : de 1 à 10, texte non vide de 40 caractères au plus, deux à deux distincts */
const MAX_LEVELS = 10;
const MAX_LEVEL_LABEL = 40;

/** Entrée de la formule invalide (message sans préfixe), null si valide (docs/adr/0043) */
export function entryIssue(entry: unknown): string | null {
  const e = entry as { kind?: unknown; size?: unknown; levels?: unknown } | null;
  if (!e || typeof e !== 'object') return 'attend { kind: individual | team, size, levels }';
  if (e.kind === 'individual') return null;
  if (e.kind !== 'team') return 'attend kind individual ou team';
  if (e.size !== 2) return 'équipe : des binômes (size 2) seulement';
  const levels = e.levels;
  if (!Array.isArray(levels) || levels.length < 1 || levels.length > MAX_LEVELS)
    return `équipe : de 1 à ${MAX_LEVELS} libellés de niveau (levels)`;
  const labels = levels.map(l => (typeof l === 'string' ? l.trim() : ''));
  if (labels.some(l => !l || l.length > MAX_LEVEL_LABEL))
    return `équipe : chaque niveau a un libellé de 1 à ${MAX_LEVEL_LABEL} caractères`;
  if (new Set(labels.map(l => l.toLowerCase())).size !== labels.length)
    return 'équipe : libellés de niveau distincts';
  return null;
}

/** Contexte du jugement : arme, type d'épreuve, effectif connu (S4, somme des parts d'une scission) */
export interface FormulaScope {
  weapon: Weapon;
  isTeamEvent?: boolean;
  fencerCount?: number;
  /** Épreuve par équipes : relais FIE (défaut) ou arène Sabre Laser (ADR-0044) */
  teamFormat?: TeamFormat;
  /** Épreuve par équipes : équipes inscrites (S3, S4 sur l'effectif d'équipes, ADR-0044) */
  teamCount?: number;
}

/**
 * Remarques bloquantes de la formule (moteur, à chaque écriture, ADR-0012 ; écran, à chaque
 * changement, ADR-0041) : bornes des réglages, S1 à S5, et S6 avec `progress` (phases déjà
 * commencées de l'épreuve, `formulaProgress`). Chacune dit la phase de la frise en cause.
 */
export function formulaV2Issues(
  f: FormulaV2,
  scope: FormulaScope,
  progress?: FormulaProgress,
  /** Formule enregistrée de l'épreuve : verrouille la qualification des phases commencées (S6) */
  stored?: FormulaV2
): FormulaRemark[] {
  return formulaIssues(f, scope, progress, false, stored);
}

function formulaIssues(
  f: FormulaV2,
  scope: FormulaScope,
  progress: FormulaProgress | undefined,
  inBranch: boolean,
  stored?: FormulaV2
): FormulaRemark[] {
  const out: FormulaRemark[] = [];
  out.push(...fightPhaseIssues(f.phases));
  const entry = f.general.entry && !inBranch ? entryIssue(f.general.entry) : null;
  if (entry) out.push(remark('invalid_entry', null, `entrée : ${entry}`));
  const filters =
    f.general.rankingFilters && !inBranch ? rankingFilterKeysIssue(f.general.rankingFilters) : null;
  if (filters)
    out.push(remark('invalid_ranking_filters', null, `filtres du classement : ${filters}`));
  const pools = f.phases.filter(isPool);
  pools.forEach((p, r) => {
    if (p.distribution !== undefined && !POOL_DISTRIBUTIONS.includes(p.distribution))
      out.push(remark('invalid_distribution', `pool-${r}`, `tour ${r + 1} : répartition inconnue`));
  });
  // Chaque tour jugé comme s'il était le premier (mêmes bornes que les réglages plats)
  pools.forEach((p, r) => {
    const issues = validateFormulaSettings(
      {
        defaultPoolMaxScore: p.maxScore,
        defaultPoolTimerSeconds: p.timerSeconds,
        poolSizeMin: p.sizeMin,
        poolSizeMax: p.sizeMax,
        // Tour en vagues : poules de 2 à 10 (docs/adr/0043)
        poolBoutOrder: p.boutOrder,
      },
      undefined,
      scope
    );
    out.push(
      ...issues.map(i =>
        remark('pool_settings', `pool-${r}`, `tour ${r + 1} : ${i.field} (${i.message})`)
      )
    );
  });
  const tableau = f.phases.find(isTableau);
  if (tableau) {
    const issues = validateFormulaSettings(
      { defaultTableMaxScore: tableau.maxScore, defaultTableTimerSeconds: tableau.timerSeconds },
      undefined,
      scope
    );
    out.push(
      ...issues.map(i =>
        remark('tableau_settings', 'tableau', `tableau : ${i.field} (${i.message})`)
      )
    );
  }
  if (pools.length > MAX_POOL_ROUNDS)
    out.push(remark('too_many_pool_rounds', null, `${MAX_POOL_ROUNDS} tours de poules au plus`));
  // Ex aequo à la barre (ADR-0040) : 'barrage' attend le lot F1b
  const rules: [string, string, AdvancementRule | undefined][] = [
    ...pools.map((p, r): [string, string, AdvancementRule] => [
      `tour ${r + 1}`,
      `pool-${r}`,
      p.qualification,
    ]),
    ...(f.phases.find(isSplit)?.branches ?? []).map(
      (b): [string, string, AdvancementRule | undefined] => [`branche ${b.label}`, 'split', b.take]
    ),
  ];
  for (const [where, key, rule] of rules) {
    const issue = tiesIssue(rule?.ties);
    if (issue) out.push(remark('ties_unsupported', key, `${where} : ${issue}`));
  }
  // Tableau arrêté (ADR-0037, D2) : des tours de poules ou une scission (ADR-0039) le suivent.
  // Dans une branche, S5 dit la même chose (la branche finit par un tour ou un tableau complet).
  if (tableau) {
    const after = f.phases.slice(f.phases.indexOf(tableau) + 1);
    if (tableau.stopAt && !inBranch && !after.some(p => isPool(p) || isSplit(p)))
      out.push(
        remark(
          'stopped_tableau_unfollowed',
          'tableau',
          `tableau arrêté à ${tableau.stopAt} : ajouter un tour de poules ou une scission après le tableau`
        )
      );
    if (!tableau.stopAt && after.some(isPool))
      out.push(
        remark(
          'pools_after_full_tableau',
          'tableau',
          'tours de poules après le tableau : arrêter le tableau à N tireurs'
        )
      );
    if (tableau.stopAt && !f.phases.slice(0, f.phases.indexOf(tableau)).some(isPool))
      out.push(
        remark(
          'stopped_tableau_without_pool',
          'tableau',
          'tableau arrêté : un tour de poules avant le tableau'
        )
      );
    if (tableau.stopAt && f.phases.some(isQuest))
      out.push(remark('stopped_tableau_with_quest', 'tableau', 'tableau arrêté : sans Tour Quest'));
  }
  if (inBranch) out.push(...branchEndIssues(f.phases));
  out.push(...poolQualificationIssues(f, scope.fencerCount));
  const placement = splitPlacementIssue(f);
  if (placement) out.push(placement);
  const split = f.phases.find(isSplit);
  if (split) out.push(...splitIssues(split, scope));
  // Branche restée : tableau séparé après les poules (ADR-0024), donc juste après un tour
  const prev = split ? f.phases[f.phases.indexOf(split) - 1] : undefined;
  if (split?.branches.some(b => b.stayInCompetition) && prev && !isPool(prev))
    out.push(
      remark(
        'split_stay_after_pool',
        'split',
        'scission : rester dans l’épreuve seulement après un tour de poules'
      )
    );
  // Épreuve par équipes en relais FIE : briques admises, règle de rencontre, effectif (ADR-0044)
  if (!inBranch) out.push(...teamFormulaIssues(f, scope));
  if (progress) out.push(...progressIssues(f, progress, stored));
  return out;
}

/** Règles d'une scission (ADR-0039) : branches, critère, formule de chaque branche */
export function splitIssues(split: SplitPhase, scope: FormulaScope): FormulaRemark[] {
  const out: FormulaRemark[] = [];
  const add = (code: string, message: string) => out.push(remark(code, 'split', message));
  const { branches, criterion } = split;
  if (branches.length < 2) add('split_branches_min', 'scission : deux branches au moins');
  const labels = branches.map(b => (b.label ?? '').trim());
  if (labels.some(l => !l)) add('split_label_missing', 'scission : chaque branche a un libellé');
  if (new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length)
    add('split_label_duplicate', 'scission : libellés des branches distincts');
  branches.forEach((b, i) => {
    const name = `branche « ${labels[i] || i + 1} »`;
    // S1 (au moins une phase de combat), bornes et S5 : la suite de phases de la branche est
    // jugée comme une formule
    if (b.phases.some(p => isSplit(p) || isQuest(p)))
      add('split_branch_nested', `${name} : ni scission ni Tour Quest dans une branche`);
    else
      out.push(
        ...formulaIssues({ version: 2, phases: b.phases, general: {} }, scope, undefined, true).map(
          r => remark(r.code, 'split', `${name} : ${r.message}`)
        )
      );
    // Rester dans l'épreuve (ADR-0039, E3) : tableaux séparés par sexe (ADR-0024)
    if (b.stayInCompetition && criterion !== 'gender')
      add(
        'split_stay_gender_only',
        `${name} : rester dans l’épreuve, seulement pour une scission par sexe`
      );
    if (b.stayInCompetition && !(b.phases.length === 1 && isTableau(b.phases[0])))
      add(
        'split_stay_tableau_only',
        `${name} : rester dans l’épreuve, seulement une branche réduite à un tableau`
      );
  });
  // Rester dans l'épreuve : toutes les branches ou aucune (compétition couplée, ADR-0039,
  // amendement du 2026-11-26 : pas de mélange d'une branche restée et d'une fille)
  const staying = branches.filter(b => b.stayInCompetition);
  if (staying.length > 0 && staying.length < branches.length)
    add(
      'split_stay_all_or_none',
      'rester dans l’épreuve : toutes les branches ou aucune (dès qu’une branche part en compétition fille, toutes partent)'
    );
  // Compétition couplée : deux branches, Hommes et Dames
  const genders = new Set(branches.map(b => b.gender));
  if (
    staying.length > 0 &&
    staying.length === branches.length &&
    criterion === 'gender' &&
    !(branches.length === 2 && genders.has(Gender.MALE) && genders.has(Gender.FEMALE))
  )
    add('split_stay_men_women', 'rester dans l’épreuve : deux branches, Hommes et Dames');
  // Un seul tableau joué pour les branches restées (réglages communs, ADR-0024)
  const kept = staying
    .map(b => b.phases[0])
    .filter(isTableau)
    .map(t =>
      JSON.stringify([
        t.maxScore,
        t.timerSeconds,
        t.thirdPlace,
        t.allPlaces,
        t.scoring ?? null,
        t.draw ?? 'strict',
      ])
    );
  if (new Set(kept).size > 1)
    add(
      'split_stay_same_tableau',
      'rester dans l’épreuve : mêmes réglages de tableau pour les branches restées'
    );
  if (criterion === 'rank') {
    branches.forEach((b, i) => {
      const last = i === branches.length - 1;
      const name = `branche « ${labels[i] || i + 1} »`;
      if (last && b.take)
        add('split_last_take', `${name} : la dernière branche prend le reste (sans « take »)`);
      if (!last && !(b.take && ['fixed_count', 'percentage'].includes(b.take.mode)))
        add('split_take_required', `${name} : nombre ou pourcentage de tireurs requis (« take »)`);
      if (!last && b.take?.mode === 'fixed_count' && !(Number(b.take.count) >= 1))
        add('split_take_count', `${name} : nombre de tireurs ≥ 1`);
      if (
        !last &&
        b.take?.mode === 'percentage' &&
        !(Number(b.take.percentage) > 0 && Number(b.take.percentage) < 100)
      )
        add('split_take_percentage', `${name} : pourcentage entre 1 et 99`);
    });
    // S3, S4 : parts de la scission par rang (nombre fixé : première phase de la branche)
    out.push(...splitTakeIssues(split, scope.fencerCount));
  }
  if (criterion === 'gender') {
    if (branches.some(b => !b.gender))
      add('split_gender_required', 'scission par sexe : un sexe par branche');
    const genders = branches.map(b => b.gender).filter(Boolean);
    if (new Set(genders).size !== genders.length)
      add('split_gender_duplicate', 'scission par sexe : un sexe n’appartient qu’à une branche');
  }
  if (criterion === 'category') {
    if (branches.some(b => !b.categories?.length))
      add('split_category_required', 'scission par catégorie : au moins une catégorie par branche');
    const all = branches.flatMap(b => b.categories ?? []);
    if (new Set(all).size !== all.length)
      add(
        'split_category_duplicate',
        'scission par catégorie : une catégorie n’appartient qu’à une branche'
      );
  }
  return out;
}

/** Vue de la formule v2 pour l'agent et l'écran (getCompetitionFormula) */
export function formulaViewV2(ctx: FormulaV2Context): {
  formula: FormulaV2;
  phases: FriezePhase[];
  insertOptions: FriezeBrick[][];
  coherence: CoherenceIssue[];
} {
  const formula = formulaOf(ctx);
  const phases = friezeOfV2(formula);
  const pools = formula.phases.filter(isPool);
  const tableau = playedTableauOf(formula);
  return {
    formula,
    phases,
    insertOptions: Array.from({ length: phases.length + 1 }, (_, i) =>
      insertOptionsV2(formula, ctx.weapon, i)
    ),
    coherence:
      ctx.weapon === Weapon.CUSTOM
        ? []
        : getCoherenceIssues(ctx.weapon, ctx.category, {
            poolMaxScore: pools[0]?.maxScore ?? 0,
            tableMaxScore: tableau?.maxScore ?? 0,
            hasPools: pools.length > 0,
            hasDirectElimination: !!tableau,
          }),
  };
}

// ── Opérations qui mènent d'une formule v2 à une autre (écran → updateCompetitionFormula) ──

const POOL_DIFF = [
  'label',
  'sizeMin',
  'sizeMax',
  'maxScore',
  'timerSeconds',
  'scoring',
  'qualification',
  'seeding',
  'boutOrder',
  'distribution',
] as const;
const TABLEAU_DIFF = [
  'label',
  'maxScore',
  'timerSeconds',
  'thirdPlace',
  'allPlaces',
  'scoring',
  'stopAt',
  'draw',
] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function changed(from: object, to: object, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const b = (to as Record<string, unknown>)[k];
    if (!same((from as Record<string, unknown>)[k], b)) out[k] = b ?? null;
  }
  return out;
}

/**
 * Liste d'opérations (noms v2, réglage par tour) qui mène la formule `from` à `to` : structure
 * d'abord (tableau, Tour Quest, nombre de tours), puis réglages de chaque phase et généraux.
 */
export function operationsBetweenV2(origin: FormulaV2, to: FormulaV2): FormulaOperation[] {
  const ops: FormulaOperation[] = [];
  const quest = (f: FormulaV2) => f.phases.find(isQuest);
  const tableau = (f: FormulaV2) => f.phases.find(isTableau);
  // Scission (ADR-0039) : toujours en dernier. Retirée d'abord si elle disparaît ou si un
  // tableau ou un Tour Quest doit s'insérer (rien ne s'insère après elle), remise à la fin.
  const sFrom = origin.phases.find(isSplit);
  const sTo = to.phases.find(isSplit);
  const reinsert =
    !!sFrom &&
    (!sTo ||
      (!tableau(origin) && !!tableau(to)) ||
      (!quest(origin) && !!quest(to)) ||
      // Tableau arrêté qui devient complet : la scission ne peut plus le suivre
      (!!tableau(origin)?.stopAt && !tableau(to)?.stopAt));
  let from = origin;
  if (sFrom && reinsert) {
    ops.push({ op: 'removePhase', phase: 'split' });
    from = removeV2(origin, { kind: 'split', key: 'split' });
  }
  const splitKept = !!sFrom && !reinsert;
  // Tours avant / après le tableau (après : tableau arrêté, ADR-0037). Tableau retiré : tous
  // les tours de `from` comptent comme tours d'avant.
  const split = (f: FormulaV2, keepTableau: boolean) => {
    const at = keepTableau ? f.phases.findIndex(isTableau) : -1;
    const pre = (at >= 0 ? f.phases.slice(0, at) : f.phases).filter(isPool);
    const post = at >= 0 ? f.phases.slice(at + 1).filter(isPool) : [];
    return { pre, post };
  };
  const keep = !!tableau(from) && !!tableau(to);
  const src = split(from, keep);
  const dst = split(to, true);
  if (tableau(from) && !tableau(to)) ops.push({ op: 'removePhase', phase: 'tableau' });
  if (quest(from) && !quest(to)) ops.push({ op: 'removePhase', phase: 'quest' });
  // Retraits : tours d'après d'abord (indices les plus grands), puis tours d'avant
  for (let n = src.post.length; n > dst.post.length; n--)
    ops.push({ op: 'removePhase', phase: `pool-${src.pre.length + n - 1}` });
  for (let n = src.pre.length; n > dst.pre.length; n--)
    ops.push({ op: 'removePhase', phase: `pool-${n - 1}` });
  // Ajouts : tours d'avant (en tête de frise), Tour Quest, tableau, puis tours d'après
  for (let n = src.pre.length; n < dst.pre.length; n++)
    ops.push({ op: 'insertPhase', brick: 'pool', at: n });
  const want = dst.pre.length;
  if (!quest(from) && quest(to)) ops.push({ op: 'insertPhase', brick: 'quest', at: want });
  const tableauAt = want + (quest(to) ? 1 : 0);
  if (!tableau(from) && tableau(to))
    ops.push({ op: 'insertPhase', brick: 'tableau', at: tableauAt });
  // Réglages du tableau (dont l'arrêt à N) avant les tours d'après (grammaire, ADR-0037)
  const tTo = tableau(to);
  if (tTo) {
    // Arrêt retiré par le retrait du dernier tour d'après sans scission qui suit (removeV2)
    const tFrom = tableau(from);
    const unstopped = src.post.length > 0 && dst.post.length === 0 && !splitKept;
    const base = tFrom && unstopped ? { ...tFrom, stopAt: undefined } : tFrom;
    const diff = changed(base ?? {}, tTo, TABLEAU_DIFF);
    if (Object.keys(diff).length) ops.push({ op: 'setPhase', phase: 'tableau', settings: diff });
  }
  const kept = Math.min(src.post.length, dst.post.length);
  for (let n = kept; n < dst.post.length; n++)
    ops.push({ op: 'insertPhase', brick: 'pool', at: tableauAt + 1 + n });
  const pairs: Array<[PoolRoundPhase | undefined, PoolRoundPhase]> = [
    ...dst.pre.map((p, r): [PoolRoundPhase | undefined, PoolRoundPhase] => [src.pre[r], p]),
    ...dst.post.map((p, r): [PoolRoundPhase | undefined, PoolRoundPhase] => [src.post[r], p]),
  ];
  pairs.forEach(([old, p], r) => {
    // Tour inséré : il reprend le tour voisin, tous qualifiés ; on règle tout ce qui diffère
    const before = old ?? newPool(from, src.pre.length, 'new');
    const diff = changed(before, p, POOL_DIFF);
    if (Object.keys(diff).length) ops.push({ op: 'setPhase', phase: `pool-${r}`, settings: diff });
  });
  const qTo = quest(to);
  if (qTo) {
    const diff = changed(quest(from)?.config ?? {}, qTo.config, QUEST_FIELDS);
    if (Object.keys(diff).length) ops.push({ op: 'setPhase', phase: 'quest', settings: diff });
  }
  if (sTo) {
    const settings =
      sFrom && splitKept
        ? changed(sFrom, sTo, SPLIT_FIELDS)
        : { criterion: sTo.criterion, branches: sTo.branches };
    if (!splitKept) ops.push({ op: 'insertPhase', brick: 'split', at: friezeOfV2(to).length - 1 });
    if (Object.keys(settings).length) ops.push({ op: 'setPhase', phase: 'split', settings });
  }
  const general = changed(from.general, to.general, GENERAL_FIELDS);
  if (Object.keys(general).length) ops.push({ op: 'setGeneral', settings: general });
  return ops;
}

/** Résumé sur une ligne ; tours aux touches différentes : un élément par tour */
export function summarizeFormulaV2(f: FormulaV2): FormulaSummaryPart[] {
  const parts: FormulaSummaryPart[] = [];
  const pools = f.phases.filter(isPool);
  if (pools.length > 0) {
    const scores = new Set(pools.map(p => p.maxScore));
    if (scores.size === 1)
      parts.push({ kind: 'pools', rounds: pools.length, maxScore: pools[0].maxScore });
    else for (const p of pools) parts.push({ kind: 'pools', rounds: 1, maxScore: p.maxScore });
  }
  if (f.phases.some(isQuest)) parts.push({ kind: 'quest' });
  const t = playedTableauOf(f);
  if (t)
    parts.push({ kind: 'tableau', maxScore: t.maxScore, thirdPlace: t.thirdPlace || t.allPlaces });
  return parts;
}

/** Formule v2 pour la simulation existante (effectifs, poules, matchs, durée) */
export function simulationFormulaOf(f: FormulaV2): CustomFormulaConfig {
  return customFormulaOf(f);
}
