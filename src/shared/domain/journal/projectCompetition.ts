/**
 * BPM - Escrime - Rejeu du journal d'une épreuve (#1980, docs/adr/0017, étape 5)
 * projectCompetition : fonction pure qui rejoue les événements et rend les faits rejouables
 * (statuts, tours de poules, résultats des matchs, tableau). Les dérivés (classements, tableaux
 * de classement, classement final, poules terminées) n'y sont pas : ils se recalculent.
 * Le moteur s'en sert pour vérifier ou reconstruire l'état ; les clients ne l'utilisent pas.
 * Licensed under GPL-3.0
 */
import type { TableauDrawMode } from '../tableau/tableauDraw';
import { JOURNAL_EVENT, type JournalEventBody } from '../../api/events';
import { FencerStatus } from '../../types';
import { WITHDRAWAL_STATUS } from '../fencers/withdrawal';
import { projectTeamEvent } from './projectTeams';

/**
 * Résultat d'un match selon le journal. Les scores ne sont connus que pour un score saisi sans
 * statut spécial ; un abandon, un forfait ou une exclusion ne donne que le perdant.
 */
export interface MatchFact {
  scoreA?: number;
  scoreB?: number;
  winnerId?: string | null;
  loserId?: string;
}

export interface PoolMatchFact {
  matchId: string;
  fencerAId: string;
  fencerBId: string;
  /** null : à jouer */
  result: MatchFact | null;
}

export interface PoolFact {
  poolId: string;
  number: number;
  strip: number | null;
  fencerIds: string[];
  matches: PoolMatchFact[];
}

export interface RoundFact {
  round: number;
  pools: PoolFact[];
  /** Tour clos : qualifiés dans l'ordre, éliminés */
  closed: { qualifiedIds: string[]; eliminatedIds: string[] } | null;
}

export interface TableauSlotFact {
  matchId: string;
  round: number;
  position: number;
  fencerAId: string | null;
  fencerBId: string | null;
  isBye: boolean;
}

/** Tirage d'un tableau au journal (docs/adr/0045) : mode, graine, ordre d'entrée tiré */
export interface TableauDrawFact {
  mode: TableauDrawMode;
  seed: number;
  order: string[];
}

export interface TableauFact {
  size: number;
  thirdPlaceMatch: boolean;
  playAllPositions: boolean;
  /** Placement du tirage (premier tour, exemptions) */
  slots: TableauSlotFact[];
  /** Tirage (docs/adr/0045) ; absent : événement antérieur, placement strict */
  draw?: TableauDrawFact;
}

/** Rencontre d'équipes telle que le journal l'a créée (docs/adr/0024) */
export interface TeamMatchFact {
  matchId: string;
  teamAId: string;
  teamBId: string;
  pool: number | null;
  round: number | null;
  position: number | null;
  relays: Array<{ relayId: string; order: number; fencerAId: string; fencerBId: string }>;
  /** Rencontre créée après le premier carton du journal (docs/adr/0028 § 10) */
  afterCards?: boolean;
}

/**
 * Carton E (TeamCardGiven), carton individuel d'un relais (RelayCardGiven) ou carton P
 * (PassivityCardGiven : ni équipe ni tireur, type `p_…`), docs/adr/0028
 */
export interface TeamCardFact {
  cardId: string;
  matchId: string;
  type: string;
  /** Carton E : équipe sanctionnée */
  teamId?: string;
  /** Carton individuel : relais et tireur */
  relayId?: string;
  fencerId?: string;
}

/** Épreuve par équipes : poules tirées et rencontres créées (docs/adr/0024) */
export interface TeamsFact {
  pools: Array<{ number: number; teamIds: string[] }>;
  /** Rencontres, dans l'ordre du journal */
  matches: TeamMatchFact[];
  /**
   * Tableau tiré (TeamTableauGenerated, lot E2) ; null : pas de tableau au journal. `draw` :
   * tirage (docs/adr/0045), absent pour un événement antérieur
   */
  tableau: { size: number; slots: TeamTableauSlotFact[]; draw?: TableauDrawFact } | null;
  /** Score de chaque relais terminé (le fait), par relais */
  relayResults: Record<string, { matchId: string; scoreA: number; scoreB: number }>;
  /** Rencontres terminées : vainqueur (null : égalité en poule), par rencontre */
  decisions: Record<string, string | null>;
  /** Cartons non annulés, dans l'ordre du journal (docs/adr/0028) */
  cards: TeamCardFact[];
  /** Rencontres dont le journal porte un carton, donné ou annulé */
  cardMatchIds: string[];
  /** Le journal porte au moins un événement de carton (lot C1 et après) */
  cardsJournaled: boolean;
  /** Équipes retirées ou exclues (TeamWithdrawn), par équipe */
  withdrawn: Record<string, { matchId: string; reason: 'exclusion' | 'abandon' }>;
}

export interface TeamTableauSlotFact {
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
  isBye: boolean;
}

export interface CompetitionFacts {
  /**
   * Journal complet : il commence (après l'appel) par le tirage des poules, l'épreuve sans
   * poules ou le tableau. Sinon les tables font foi pour ce qui précède.
   */
  complete: boolean;
  /** Statut des tireurs nommés par le journal (les autres : tables) */
  fencerStatus: Record<string, string>;
  rounds: RoundFact[];
  /** Tireurs de l'épreuve sans poules, dans l'ordre */
  skippedPoolsFencerIds: string[] | null;
  tableau: TableauFact | null;
  /**
   * Tableaux séparés après les poules (docs/adr/0024) : tableau tiré de chaque groupe. Les
   * identifiants de leurs matchs sont préfixés par le groupe (« F:32-0 »)
   */
  groupTableaux: Record<string, TableauFact>;
  /**
   * Décisions du tableau principal, des tableaux des groupes et des tableaux de classement,
   * par match (identifiants uniques dans l'épreuve)
   */
  bracketResults: Record<string, MatchFact>;
  /**
   * Groupes extraits dans une épreuve séparée (GroupSplitOff, docs/adr/0024) : ils n'ont plus
   * d'onglet ni de tableau dans cette épreuve
   */
  splitOffGroups: Record<string, { targetCompetitionId: string; fencerIds: string[] }>;
  /**
   * Scission de la formule (docs/adr/0039) : GroupSplitOff dans l'ordre du journal, rejoués en
   * `splitHistory` de l'état de session (libellé de la branche, fille, tireurs partis)
   */
  splitHistory: Array<{ label: string; competitionId: string; fencerIds: string[] }>;
  /**
   * Épreuve séparée : classement après poules importé (SplitRankingImported), son premier fait
   */
  importedRanking: {
    sourceCompetitionId: string;
    group: string;
    ranking: Array<{ fencerId: string; sourceFencerId: string; rank: number }>;
  } | null;
  /** Épreuve par équipes (docs/adr/0024) ; null : aucun fait d'équipe */
  teams: TeamsFact | null;
  /**
   * Tour en vagues : vague lancée, vagues arrêtées (undefined : jamais lancées). Écrit par
   * PoolWaveLaunched / PoolWavesEnded, et par les anciens RapieresWave* (docs/adr/0043)
   */
  waves?: { wave: number; ended: boolean };
  /**
   * Plan des pistes (docs/adr/0015) : dernière piste de départ et état de chaque piste nommés
   * par le journal ; null : aucun événement de plan (plan repris par la migration 50)
   */
  strips: { start: number | null; available: Record<number, boolean> } | null;
  /** Révision du dernier événement rejoué */
  revision: number;
}

type ReplayEvent = JournalEventBody & { revision?: number };

const FACT_EVENTS: ReadonlySet<string> = new Set([
  JOURNAL_EVENT.poolsGenerated,
  JOURNAL_EVENT.poolsSkipped,
  JOURNAL_EVENT.splitRankingImported,
  JOURNAL_EVENT.tableauGenerated,
  JOURNAL_EVENT.teamPoolsGenerated,
  JOURNAL_EVENT.teamTableauGenerated,
]);
/** Événements qui précèdent le premier fait sans rendre le journal incomplet : appel, pistes */
const PRELUDE_EVENTS: ReadonlySet<string> = new Set([
  JOURNAL_EVENT.fencerCheckedIn,
  JOURNAL_EVENT.fencerCheckedOut,
  JOURNAL_EVENT.stripStartChanged,
  JOURNAL_EVENT.stripAvailabilityChanged,
]);

/** Rejoue les événements dans l'ordre du journal */
export function projectCompetition(events: readonly ReplayEvent[]): CompetitionFacts {
  const facts: CompetitionFacts = {
    complete: false,
    fencerStatus: {},
    rounds: [],
    skippedPoolsFencerIds: null,
    tableau: null,
    groupTableaux: {},
    bracketResults: {},
    splitOffGroups: {},
    splitHistory: [],
    importedRanking: null,
    teams: null,
    strips: null,
    revision: 0,
  };
  const firstFact = events.find(e => !PRELUDE_EVENTS.has(e.type));
  facts.complete = !!firstFact && FACT_EVENTS.has(firstFact.type);

  // Résultat d'avant un retrait, par tireur : rendu à la réintégration
  const beforeWithdrawal = new Map<string, Map<string, MatchFact | null>>();
  // Résultat d'avant un score avec statut spécial, suivi du retrait dans la même commande
  const beforeSpecial = new Map<string, MatchFact | null>();

  const current = () => facts.rounds[facts.rounds.length - 1];
  const poolMatch = (matchId: string): PoolMatchFact | undefined => {
    for (const pool of current()?.pools ?? []) {
      const m = pool.matches.find(x => x.matchId === matchId);
      if (m) return m;
    }
    return undefined;
  };
  const isTableauMatch = (matchId: string) =>
    !poolMatch(matchId) && (!!facts.tableau || Object.keys(facts.groupTableaux).length > 0);
  /** Tous les tableaux retirés (nouveau tirage des poules, correction avec tableau à refaire) */
  const clearTableau = () => {
    facts.tableau = null;
    facts.groupTableaux = {};
    facts.bracketResults = {};
  };
  /** Décisions du tableau d'un groupe retirées : ses matchs, préfixés par le groupe */
  const clearGroupResults = (group: string) => {
    for (const id of Object.keys(facts.bracketResults)) {
      if (id.startsWith(`${group}:`)) delete facts.bracketResults[id];
    }
  };
  /** Décisions du tableau unique retirées (celles des groupes restent) */
  const clearMainResults = () => {
    const groups = Object.keys(facts.groupTableaux);
    for (const id of Object.keys(facts.bracketResults)) {
      if (!groups.some(g => id.startsWith(`${g}:`))) delete facts.bracketResults[id];
    }
  };

  for (const event of events) {
    if (typeof event.revision === 'number') facts.revision = event.revision;
    switch (event.type) {
      case JOURNAL_EVENT.fencerCheckedIn:
        facts.fencerStatus[event.payload.fencerId] = FencerStatus.CHECKED_IN;
        break;
      case JOURNAL_EVENT.fencerCheckedOut:
        facts.fencerStatus[event.payload.fencerId] = FencerStatus.NOT_CHECKED_IN;
        break;
      case JOURNAL_EVENT.poolsGenerated: {
        const { round, pools } = event.payload;
        const next: RoundFact = {
          round,
          pools: pools.map(p => ({
            poolId: p.poolId,
            number: p.number,
            strip: p.strip,
            fencerIds: [...p.fencerIds],
            matches: p.matches.map(m => ({ ...m, result: null })),
          })),
          closed: null,
        };
        // Tirage refait sur le même tour : il remplace le précédent
        facts.rounds = [...facts.rounds.filter(r => r.round < round), next];
        facts.skippedPoolsFencerIds = null;
        clearTableau();
        if (facts.waves) facts.waves = { wave: 0, ended: false };
        break;
      }
      case JOURNAL_EVENT.poolFencerAdded: {
        const pool = current()?.pools.find(p => p.poolId === event.payload.poolId);
        if (!pool) break;
        if (!pool.fencerIds.includes(event.payload.fencerId)) {
          pool.fencerIds.push(event.payload.fencerId);
        }
        pool.matches.push(...event.payload.matches.map(m => ({ ...m, result: null })));
        break;
      }
      case JOURNAL_EVENT.tableauStageClosed: {
        // Étape close : les éliminés sortent, le tableau est archivé (ADR-0037)
        for (const id of event.payload.eliminatedIds) {
          facts.fencerStatus[id] = FencerStatus.ELIMINATED;
        }
        clearMainResults();
        facts.tableau = null;
        break;
      }
      case JOURNAL_EVENT.poolRoundClosed: {
        const round = facts.rounds.find(r => r.round === event.payload.round);
        if (round) {
          round.closed = {
            qualifiedIds: [...event.payload.qualifiedIds],
            eliminatedIds: [...event.payload.eliminatedIds],
          };
        }
        for (const id of event.payload.eliminatedIds) {
          facts.fencerStatus[id] = FencerStatus.ELIMINATED;
        }
        break;
      }
      case JOURNAL_EVENT.poolsSkipped:
        facts.skippedPoolsFencerIds = [...event.payload.fencerIds];
        break;
      case JOURNAL_EVENT.scoreRecorded: {
        const p = event.payload;
        const result: MatchFact = p.specialStatus
          ? { loserId: p.fencerId ?? undefined }
          : { scoreA: p.scoreA, scoreB: p.scoreB, winnerId: p.winnerId };
        const inPool = poolMatch(p.matchId);
        if (inPool) {
          if (p.specialStatus) beforeSpecial.set(p.matchId, inPool.result);
          inPool.result = result;
          if (p.correction?.rebuildTableau) clearTableau();
        } else {
          if (p.specialStatus) {
            beforeSpecial.set(p.matchId, facts.bracketResults[p.matchId] ?? null);
          }
          facts.bracketResults[p.matchId] = {
            ...result,
            ...(p.specialStatus ? { winnerId: p.winnerId } : {}),
          };
        }
        break;
      }
      case JOURNAL_EVENT.tableauMatchDecided: {
        const { matchId, winnerId } = event.payload;
        facts.bracketResults[matchId] = { ...facts.bracketResults[matchId], winnerId };
        break;
      }
      case JOURNAL_EVENT.scoreCleared: {
        const inPool = poolMatch(event.payload.matchId);
        if (inPool) inPool.result = null;
        else delete facts.bracketResults[event.payload.matchId];
        break;
      }
      case JOURNAL_EVENT.fencerWithdrawn: {
        const { fencerId, reason, matchId, forfeitedMatchIds } = event.payload;
        facts.fencerStatus[fencerId] = WITHDRAWAL_STATUS[reason];
        const saved = new Map<string, MatchFact | null>();
        for (const id of forfeitedMatchIds) {
          const inPool = poolMatch(id);
          if (id === matchId && beforeSpecial.has(id)) {
            // Match du score avec statut spécial : déjà décidé, état d'avant ce score
            saved.set(id, beforeSpecial.get(id) ?? null);
            continue;
          }
          if (inPool) {
            saved.set(id, inPool.result);
            inPool.result = { loserId: fencerId };
          } else if (isTableauMatch(id)) {
            saved.set(id, facts.bracketResults[id] ?? null);
            facts.bracketResults[id] = { ...facts.bracketResults[id], loserId: fencerId };
          }
        }
        beforeSpecial.clear();
        beforeWithdrawal.set(fencerId, saved);
        break;
      }
      case JOURNAL_EVENT.fencerReinstated: {
        const { fencerId, restoredStatus, restoredMatchIds } = event.payload;
        facts.fencerStatus[fencerId] = restoredStatus;
        const saved = beforeWithdrawal.get(fencerId);
        for (const id of restoredMatchIds) {
          const inPool = poolMatch(id);
          // Match que le retrait n'avait pas changé (déjà joué) : il reste tel quel
          if (inPool) {
            if (saved?.has(id)) inPool.result = saved.get(id) ?? null;
          }
          // Tableau : le match perdu par le retrait est rouvert
          else delete facts.bracketResults[id];
        }
        beforeWithdrawal.delete(fencerId);
        break;
      }
      case JOURNAL_EVENT.tableauGenerated: {
        const p = event.payload;
        const tableau: TableauFact = {
          size: p.size,
          thirdPlaceMatch: p.thirdPlaceMatch,
          playAllPositions: p.playAllPositions,
          slots: p.matches.map(m => ({
            matchId: m.matchId,
            round: m.round,
            position: m.position,
            fencerAId: m.fencerAId,
            fencerBId: m.fencerBId,
            isBye: m.isBye,
          })),
          ...(p.draw
            ? { draw: { mode: p.draw.mode, seed: p.draw.seed, order: [...p.draw.order] } }
            : {}),
        };
        // Tableau d'un groupe : les autres groupes gardent leur tableau (docs/adr/0024)
        if (p.group) {
          clearGroupResults(p.group);
          facts.groupTableaux[p.group] = tableau;
        } else {
          clearMainResults();
          facts.tableau = tableau;
        }
        break;
      }
      case JOURNAL_EVENT.tableauCleared:
        if (event.payload.group) {
          clearGroupResults(event.payload.group);
          delete facts.groupTableaux[event.payload.group];
        } else {
          clearMainResults();
          facts.tableau = null;
        }
        break;
      case JOURNAL_EVENT.groupSplitOff: {
        const { group, targetCompetitionId, fencerIds } = event.payload;
        facts.splitOffGroups[group] = { targetCompetitionId, fencerIds: [...fencerIds] };
        facts.splitHistory = [
          ...facts.splitHistory.filter(h => h.label !== group),
          { label: group, competitionId: targetCompetitionId, fencerIds: [...fencerIds] },
        ];
        // Le groupe extrait n'a plus de tableau ici (le tirage est refusé avant l'extraction)
        clearGroupResults(group);
        delete facts.groupTableaux[group];
        break;
      }
      case JOURNAL_EVENT.splitRankingImported: {
        const { sourceCompetitionId, group, ranking } = event.payload;
        facts.importedRanking = {
          sourceCompetitionId,
          group,
          ranking: ranking.map(r => ({ ...r })),
        };
        break;
      }
      // Épreuves par équipes (docs/adr/0024) : rejeu propre aux rencontres et aux relais
      case JOURNAL_EVENT.teamPoolsGenerated:
      case JOURNAL_EVENT.teamMatchScheduled:
      case JOURNAL_EVENT.teamTableauGenerated:
      case JOURNAL_EVENT.relayScoreRecorded:
      case JOURNAL_EVENT.relayReopened:
      case JOURNAL_EVENT.teamMatchDecided:
      case JOURNAL_EVENT.teamFencerSubstituted:
      case JOURNAL_EVENT.teamCardGiven:
      case JOURNAL_EVENT.relayCardGiven:
      case JOURNAL_EVENT.passivityCardGiven:
      case JOURNAL_EVENT.teamCardCancelled:
      case JOURNAL_EVENT.relayCardCancelled:
      case JOURNAL_EVENT.teamWithdrawn:
        facts.teams = projectTeamEvent(facts.teams, event);
        break;
      case JOURNAL_EVENT.poolWaveLaunched:
      case JOURNAL_EVENT.rapieresWaveLaunched:
        facts.waves = { wave: event.payload.wave, ended: facts.waves?.ended ?? false };
        break;
      case JOURNAL_EVENT.poolWavesEnded:
      case JOURNAL_EVENT.rapieresWavesEnded:
        facts.waves = { wave: facts.waves?.wave ?? 0, ended: event.payload.ended };
        break;
      // Plan des pistes (docs/adr/0015)
      case JOURNAL_EVENT.stripStartChanged:
        facts.strips = { available: {}, ...facts.strips, start: event.payload.start };
        break;
      case JOURNAL_EVENT.stripAvailabilityChanged: {
        const strips = facts.strips ?? { start: null, available: {} };
        strips.available[event.payload.strip] = event.payload.available;
        facts.strips = strips;
        break;
      }
      // Signaux et dérivés : ignorés au rejeu (docs/adr/0017)
      case JOURNAL_EVENT.poolCompleted:
      case JOURNAL_EVENT.tableauCompleted:
      case JOURNAL_EVENT.rankingAdjusted:
      case JOURNAL_EVENT.rapieresTeamsUpdated:
        break;
    }
  }
  return facts;
}
