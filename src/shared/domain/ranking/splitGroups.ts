/**
 * BPM - Escrime - Tableaux séparés après les poules (docs/adr/0024, lot A1)
 * Règles pures : partage du classement après poules par groupe (aujourd'hui le sexe), un
 * tableau par groupe dans la même épreuve (session_state.groupTableaux, identifiants de match
 * préfixés par le groupe : « F:32-0 »), lecture de tous les tableaux, et données de
 * l'épreuve séparée quand un groupe est extrait. Le partage n'est pas un fait du journal :
 * c'est un dérivé du classement et du groupe de chaque tireur. Extraction d'un groupe dans une
 * épreuve séparée (lot A3) : refus, projection de départ, classement importé rejoué.
 * Licensed under GPL-3.0
 */

import {
  Competition,
  CompetitionSettings,
  Fencer,
  FencerStatus,
  Gender,
  PoolRanking,
} from '../../types';
import type { ConsolationBracket, FinalResult, TableauMatch } from '../tableau/tableauTypes';
import { tableauDrawStateOf, type TableauDrawState } from '../tableau/tableauDraw';
import { maxScoreLimits } from '../formula/laserMaxScores';

/** Critère de séparation des tableaux (réglage postPoolSplitCriteria) */
export type SplitCriteria = 'gender';

/** Répartit le classement général en sous-classements par genre (rangs renumérotés) */
export function splitRankingByGender(overallRanking: PoolRanking[]): Map<string, PoolRanking[]> {
  const groups = new Map<string, PoolRanking[]>();
  for (const r of overallRanking) {
    const key = r.fencer.gender as string;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  for (const [key, rankings] of groups) {
    groups.set(
      key,
      rankings.map((r, i) => ({ ...r, rank: i + 1 }))
    );
  }
  return groups;
}

/** Groupe d'un tireur selon le critère ; null : hors des groupes (mixte, inconnu) */
export function groupOfFencer(
  fencer: Pick<Fencer, 'gender'> | null | undefined,
  criteria: string | undefined
): string | null {
  if (criteria !== 'gender' || !fencer) return null;
  const g = fencer.gender as string | undefined;
  return g && g !== Gender.MIXED ? g : null;
}

export interface SplitGroupPlan {
  group: string;
  /** Tireurs du groupe dans l'ordre du classement, rangs renumérotés à partir de 1 */
  ranking: PoolRanking[];
}

/**
 * Groupes restants après les poules : ceux qui ont des tireurs, hors mixte et hors groupes
 * extraits dans une épreuve séparée (splitOffIds), dans l'ordre alphabétique.
 */
export function planSplitGroups(
  ranking: PoolRanking[],
  criteria: string | undefined,
  splitOffIds: Partial<Record<string, string>> | undefined
): SplitGroupPlan[] {
  if (criteria !== 'gender') return [];
  const byGroup = splitRankingByGender(ranking);
  return [...byGroup.keys()]
    .filter(g => groupOfFencer({ gender: g as Gender }, criteria) && !splitOffIds?.[g])
    .sort()
    .map(group => ({ group, ranking: byGroup.get(group)! }));
}

/**
 * Part « groupe » du classement effectif du tableau : tireurs du groupe affiché, ou, sans
 * groupe, tireurs des groupes non extraits ; rangs renumérotés.
 */
export function filterSplitGroup(
  ranking: PoolRanking[],
  criteria: string | undefined,
  group: string | null,
  splitOffIds: Partial<Record<string, string>> | undefined
): PoolRanking[] {
  if (criteria !== 'gender') return ranking;
  if (group) {
    return ranking
      .filter(r => (r.fencer.gender as string) === group)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
  if (splitOffIds) {
    return ranking
      .filter(r => !splitOffIds[r.fencer.gender as string])
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
  return ranking;
}

// ─── Tableaux des groupes ────────────────────────────────────────────────────

/** Tableau d'un groupe dans session_state.groupTableaux */
export interface GroupTableau {
  tableauMatches: TableauMatch[];
  consolationBrackets: ConsolationBracket[];
  finalResults: FinalResult[];
  /** Tirage du tableau du groupe (docs/adr/0045) ; absent : tableau tiré avant, ou pas tiré */
  tableauDraw?: TableauDrawState;
}

/** Identifiant de match d'un tableau de groupe : préfixé par le groupe (idempotent) */
export function groupMatchId(group: string, id: string): string {
  return id.startsWith(`${group}:`) ? id : `${group}:${id}`;
}

/** Match qui appartient au tableau du groupe (identifiant préfixé) */
export const isGroupMatchId = (group: string, id: string): boolean => id.startsWith(`${group}:`);

/** Matchs d'un tableau de groupe, identifiants préfixés */
export function prefixTableau(matches: TableauMatch[], group: string): TableauMatch[] {
  return matches.map(m => ({ ...m, id: groupMatchId(group, m.id) }));
}

/**
 * Tableaux de classement d'un groupe, identifiants préfixés. Le parent « main » reste tel
 * quel : la recherche d'un tableau existant (syncConsolationBrackets) se fait par parent et
 * tour, pas par identifiant.
 */
export function prefixBrackets(
  brackets: ConsolationBracket[],
  group: string
): ConsolationBracket[] {
  return brackets.map(b => ({
    ...b,
    id: groupMatchId(group, b.id),
    parentBracketId: b.parentBracketId === 'main' ? 'main' : groupMatchId(group, b.parentBracketId),
    matches: prefixTableau(b.matches, group),
  }));
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Tableaux des groupes rangés dans l'état de session (objet vide sans séparation) */
export function sessionGroupTableaux(
  session: Record<string, unknown>
): Record<string, GroupTableau> {
  const raw = session.groupTableaux;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, GroupTableau> = {};
  for (const [group, t] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    if (!t || typeof t !== 'object') continue;
    const draw = tableauDrawStateOf(t.tableauDraw);
    out[group] = {
      tableauMatches: list<TableauMatch>(t.tableauMatches),
      consolationBrackets: list<ConsolationBracket>(t.consolationBrackets),
      finalResults: list<FinalResult>(t.finalResults),
      ...(draw ? { tableauDraw: draw } : {}),
    };
  }
  return out;
}

/**
 * Matchs de tous les tableaux de l'épreuve : tableau unique (racine) et tableaux des groupes.
 * Lecteurs du cache : moteur, résultats publics, arbitres des tablettes.
 */
export function allTableauMatches(session: Record<string, unknown>): TableauMatch[] {
  return [
    ...list<TableauMatch>(session.tableauMatches),
    ...Object.values(sessionGroupTableaux(session)).flatMap(t => t.tableauMatches),
  ];
}

/** Tableaux de classement de tous les tableaux de l'épreuve */
export function allConsolationBrackets(session: Record<string, unknown>): ConsolationBracket[] {
  return [
    ...list<ConsolationBracket>(session.consolationBrackets),
    ...Object.values(sessionGroupTableaux(session)).flatMap(t => t.consolationBrackets),
  ];
}

/**
 * Reprise d'une épreuve en cours (ADR-0024, « Conséquences ») : groupe d'un tableau tiré à la
 * racine avant les tableaux par groupe, d'après ses tireurs ; identifiants non renommés.
 * null : aucun tireur d'un groupe dans ce tableau.
 */
export function legacyTableauGroup(
  matches: TableauMatch[],
  criteria: string | undefined
): string | null {
  for (const m of matches) {
    const g = groupOfFencer(m.fencerA, criteria) ?? groupOfFencer(m.fencerB, criteria);
    if (g) return g;
  }
  return null;
}

/** Libellé par défaut proposé pour la compétition séparée */
export function defaultSplitCompetitionTitle(baseTitle: string, group: string): string {
  const suffix = group === Gender.FEMALE ? 'Dames' : group === Gender.MALE ? 'Hommes' : group;
  return `${baseTitle} – ${suffix}`;
}

/** Paramètres numériques exigés par la validation DB (absents des compétitions créées sans formule) */
const REQUIRED_SETTINGS_DEFAULTS = {
  defaultPoolMaxScore: 5,
  defaultTableMaxScore: 15,
  poolRounds: 1,
  defaultRanking: 0,
  minTeamSize: 3,
};

/** Convertit une date éventuellement sérialisée (chaîne ISO) en Date valide */
function toValidDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(value as string);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Données de création de la compétition séparée (mêmes paramètres, sans le mode couplé) */
export function buildSplitCompetitionData(
  source: Competition,
  title: string,
  group: string,
  /** Date de repli si l'épreuve d'origine n'en a pas (heure injectée, docs/adr/0002) */
  now: Date
): Partial<Competition> {
  const {
    postPoolSplitCriteria: _criteria,
    splitOffCompetitionIds: _splitOff,
    poolWinnersOnly: _winners,
    ...settings
  } = source.settings ?? ({} as CompetitionSettings);
  const merged = { ...REQUIRED_SETTINGS_DEFAULTS, ...settings };
  // Pas de poules dans la compétition séparée : borner le score de poule à la limite DB
  if (typeof merged.defaultPoolMaxScore !== 'number' || !(merged.defaultPoolMaxScore >= 1)) {
    merged.defaultPoolMaxScore = REQUIRED_SETTINGS_DEFAULTS.defaultPoolMaxScore;
  }
  merged.defaultPoolMaxScore = Math.min(
    merged.defaultPoolMaxScore,
    maxScoreLimits({ weapon: source.weapon, isTeamEvent: !!source.isTeamEvent }).pool.max
  );
  return {
    title: title.trim(),
    date: toValidDate(source.date) ?? now,
    location: source.location,
    weapon: source.weapon,
    gender: group as Gender,
    category: source.category,
    color: source.color && /^#[0-9A-Fa-f]{6}$/.test(source.color) ? source.color : undefined,
    settings: { ...merged, splitFromCompetitionId: source.id } as CompetitionSettings,
  };
}

/** Classement du groupe à extraire (rangs renumérotés à partir de 1) */
export function extractSplitGroupRanking(
  overallRanking: PoolRanking[],
  group: string
): PoolRanking[] {
  return splitRankingByGender(overallRanking).get(group) ?? [];
}

/** Données tireur à recréer dans la compétition séparée (ranking = rang après poules) */
export function toSplitFencerData(r: PoolRanking): Partial<Fencer> {
  const f = r.fencer;
  return {
    lastName: f.lastName,
    firstName: f.firstName,
    birthDate: toValidDate(f.birthDate),
    category: f.category,
    members: f.members,
    level: f.level,
    handicap: f.handicap,
    gender: f.gender,
    nationality: f.nationality,
    region: f.region,
    club: f.club,
    license: f.license,
    ranking: r.rank,
    status: f.status === FencerStatus.NOT_CHECKED_IN ? FencerStatus.CHECKED_IN : f.status,
    photo: f.photo,
  };
}

/** Remplace les tireurs du classement par leurs copies créées dans la nouvelle compétition */
export function remapRankingFencers(
  ranking: PoolRanking[],
  newFencerByOldId: Map<string, Fencer>
): PoolRanking[] {
  return ranking
    .filter(r => newFencerByOldId.has(r.fencer.id))
    .map(r => ({
      ...r,
      fencer: { ...newFencerByOldId.get(r.fencer.id)!, poolStats: r.fencer.poolStats },
    }));
}

// ─── Extraction d'un groupe (splitOffGroup, docs/adr/0024, lot A3) ──────────

/** Refus d'une extraction : code du catalogue (docs/adr/0009) et message */
export interface SplitOffRefusal {
  code: 'invalid_input' | 'split_group_not_found' | 'bracket_exists';
  message: string;
}

/**
 * Groupe extractible : épreuve à tableaux séparés, groupe présent au classement après poules,
 * pas encore extrait, sans tableau tiré. null : extraction admise.
 */
export function splitOffRefusal(
  source: Pick<Competition, 'settings'>,
  ranking: PoolRanking[],
  group: string,
  groupTableauMatches: number
): SplitOffRefusal | null {
  const criteria = source.settings?.postPoolSplitCriteria;
  if (!criteria) {
    return { code: 'invalid_input', message: 'Épreuve sans tableaux séparés après les poules' };
  }
  const splitOffIds = source.settings?.splitOffCompetitionIds;
  if (splitOffIds?.[group]) {
    return {
      code: 'split_group_not_found',
      message: `Groupe déjà extrait dans une épreuve séparée : ${group}`,
    };
  }
  if (groupTableauMatches > 0) {
    return { code: 'bracket_exists', message: `Tableau du groupe ${group} déjà tiré` };
  }
  const groups = planSplitGroups(ranking, criteria, splitOffIds).map(p => p.group);
  if (!groups.includes(group)) {
    return {
      code: 'split_group_not_found',
      message: `Groupe absent du classement après poules : ${group} (groupes : ${groups.join(', ') || 'aucun'})`,
    };
  }
  return null;
}

/**
 * Projection de départ de l'épreuve séparée : classement après poules du groupe (tireurs
 * copiés, statistiques de poule de l'épreuve d'origine), phase Classement, sans poules.
 */
export function splitOffSessionState(ranking: PoolRanking[]): Record<string, unknown> {
  return {
    currentPhase: 3,
    overallRanking: ranking,
    pools: [],
    poolHistory: [],
    tableauMatches: [],
    finalResults: [],
    consolationBrackets: [],
    currentPoolRound: 1,
    skipPoolPhase: false,
  };
}

/** Ligne du classement importé (événement SplitRankingImported) */
export interface ImportedRankEntry {
  fencerId: string;
  sourceFencerId: string;
  rank: number;
}

/**
 * Classement importé rendu à partir du journal (SplitRankingImported) : tireurs de l'épreuve
 * séparée dans l'ordre des rangs ; statistiques de poule relues dans le classement de l'épreuve
 * d'origine (sourceRanking), rangs seuls si elle a été supprimée (docs/adr/0024).
 */
export function importedRanking(
  entries: readonly ImportedRankEntry[],
  fencers: ReadonlyMap<string, Fencer>,
  sourceRanking: PoolRanking[] | null
): PoolRanking[] {
  const source = new Map((sourceRanking ?? []).map(r => [r.fencer.id, r]));
  return [...entries]
    .sort((a, b) => a.rank - b.rank)
    .filter(e => fencers.has(e.fencerId))
    .map(e => {
      const fencer = fencers.get(e.fencerId)!;
      const from = source.get(e.sourceFencerId);
      if (from) {
        return { ...from, rank: e.rank, fencer: { ...fencer, poolStats: from.fencer.poolStats } };
      }
      return {
        fencer,
        rank: e.rank,
        victories: 0,
        defeats: 0,
        matchesPlayed: 0,
        touchesScored: 0,
        touchesReceived: 0,
        index: 0,
        ratio: 0,
      };
    });
}
