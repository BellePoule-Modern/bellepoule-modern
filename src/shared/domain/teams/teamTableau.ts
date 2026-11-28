/**
 * BPM - Escrime - Tableau d'équipes par le moteur (docs/adr/0024, lot E2)
 * Placement du classement de poule (évitement de revanche en arène Sabre Laser), puis
 * avancement : une rencontre est créée dès que ses deux équipes sont connues (têtes de série,
 * exemptés, vainqueurs du tour précédent). Mêmes règles que l'écran (resolveTeamTableauSlot) :
 * tour = nombre de rencontres du tour (taille / 2 au premier tour, 1 en finale).
 * Pur : ni heure ni hasard.
 * Licensed under GPL-3.0
 */
import type { Weapon } from '../../types';
import type { TeamMatchRow, TeamRow } from './team.types';
import {
  calculateTableSize,
  calculateTeamOverallRanking,
  placeRankedTeamsInTable,
  resolveTeamTableauSlot,
} from './teamCalculations';
import { calculateLaserArenaPoolRanking } from './laserArenaCalculations';
import { generateSeedingChart } from '../../utils/tableCalculations';
import { applyRematchAvoidanceSwap, buildPoolPairHistory } from './laserArenaBracketRules';
import { planRelays, teamTableauMatchId, type RelayPlan, type TeamFormat } from './relay';

/** Case du premier tour : deux équipes, ou une seule (exempt), ou aucune */
export interface TeamTableauSlot {
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
  isBye: boolean;
}

/** Tableau tiré (fait du journal TeamTableauGenerated) */
export interface TeamTableauPlan {
  size: number;
  slots: TeamTableauSlot[];
  /** Tirage (docs/adr/0045) : ordre d'entrée tiré ; absent : placement strict (événement antérieur) */
  draw?: { order: string[] };
}

/** Rencontre de tableau déjà créée : seuls sa case, son statut et son vainqueur comptent */
export interface TeamTableauMatchState {
  round: number;
  position: number;
  status: string;
  winnerId: string | null;
}

export interface TeamTableauMatchPlan {
  matchId: string;
  round: number;
  position: number;
  teamAId: string;
  teamBId: string;
  /** null : titulaires manquants d'un côté */
  relays: RelayPlan[] | null;
}

/**
 * Classement de poule qui place le tableau, comme l'écran : relais FIE par ratio V/M toutes
 * poules confondues (poule unique : victoires, docs/adr/0044), arène
 * Sabre Laser par points, avec l'évitement de revanche au premier tour (5↔6, 7↔8)
 */
export function rankTeamsForTableau(
  teams: TeamRow[],
  poolMatches: TeamMatchRow[],
  format: TeamFormat
): TeamRow[] {
  if (format !== 'laser-arena')
    return calculateTeamOverallRanking(teams, poolMatches).map(r => r.team);
  const ranked = calculateLaserArenaPoolRanking(teams, poolMatches).map(r => r.team);
  return applyRematchAvoidanceSwap(ranked, buildPoolPairHistory(poolMatches));
}

/** Tableau à la taille du classement (puissance de 2), cases du premier tour */
export function planTeamTableau(rankedTeams: TeamRow[]): TeamTableauPlan {
  const size = calculateTableSize(rankedTeams.length);
  const placements = placeRankedTeamsInTable(rankedTeams, size);
  const round = size / 2;
  const slots = Array.from({ length: round }, (_, position) => {
    const a = placements[position * 2]?.id ?? null;
    const b = placements[position * 2 + 1]?.id ?? null;
    return { round, position, teamAId: a, teamBId: b, isBye: !(a && b) };
  });
  return { size, slots };
}

/**
 * Têtes de série d'un tableau tiré (fait du journal) : identifiants des équipes dans l'ordre
 * d'entrée du tableau (tête de série 1 d'abord) : ordre tiré (docs/adr/0045), sinon retrouvé
 * par la table de placement (placement strict)
 */
export function tableauSeedIds(tableau: TeamTableauPlan): string[] {
  return tableau.draw?.order ? [...tableau.draw.order] : tableauPlacementIds(tableau);
}

/**
 * Équipes d'un tableau tiré par emplacement (emplacement 1 d'abord) : placées par la table de
 * placement, elles redonnent le premier tour tiré (écran, PDF ; docs/adr/0045)
 */
export function tableauPlacementIds(tableau: TeamTableauPlan): string[] {
  const chart = generateSeedingChart(tableau.size);
  const seeded: Array<{ id: string; seed: number }> = [];
  for (const s of tableau.slots) {
    const pos = s.position * 2;
    if (s.teamAId) seeded.push({ id: s.teamAId, seed: chart[pos] });
    if (s.teamBId) seeded.push({ id: s.teamBId, seed: chart[pos + 1] });
  }
  return seeded.sort((a, b) => a.seed - b.seed).map(x => x.id);
}

/** Case suivante du vainqueur ; null : finale */
export function nextTableauSlot(
  round: number,
  position: number
): { round: number; position: number } | null {
  return round > 1 ? { round: round / 2, position: Math.floor(position / 2) } : null;
}

/** Case de la petite finale (docs/adr/0044) : tour de la finale, position 1 */
export const THIRD_PLACE_SLOT = { round: 1, position: 1 } as const;

/** Rencontre de tableau : la petite finale ? */
export const isThirdPlaceSlot = (m: { round?: number | null; position?: number | null }) =>
  m.round === THIRD_PLACE_SLOT.round && m.position === THIRD_PLACE_SLOT.position;

/** Règle de rencontre du tableau (docs/adr/0044) : ordre des relais, petite finale */
export interface TeamTableauOptions {
  /** Paires des relais (`relayPairsOf`) ; défaut : ordre de l'arme (`relayOrderFor`) */
  pairs?: ReadonlyArray<readonly [number, number]>;
  /** Petite finale entre les perdants des demi-finales (formule, `thirdPlace`) */
  thirdPlace?: boolean;
}

/**
 * Rencontres à créer : toute case dont les deux équipes sont connues et qui n'a pas encore de
 * rencontre, du premier tour à la finale. Identifiants déterministes (`${cid}-t${tour}-${pos}`).
 * Petite finale (`thirdPlace`) : case `t1-1`, créée dès que les deux demi-finales jouées sont
 * terminées (pas de petite finale si une demi-finale est un exempt).
 */
export function planTeamTableauMatches(
  competitionId: string,
  tableau: TeamTableauPlan,
  existing: readonly TeamTableauMatchState[],
  teams: readonly TeamRow[],
  teamSize: number,
  weapon: Weapon,
  options: TeamTableauOptions = {}
): TeamTableauMatchPlan[] {
  const teamById = new Map(teams.map(t => [t.id, t]));
  const placements: (TeamRow | null)[] = new Array(tableau.size).fill(null);
  for (const s of tableau.slots) {
    placements[s.position * 2] = (s.teamAId && teamById.get(s.teamAId)) || null;
    placements[s.position * 2 + 1] = (s.teamBId && teamById.get(s.teamBId)) || null;
  }
  const byKey = new Map<string, TeamMatchRow>(
    existing.map(m => [
      `${m.round}-${m.position}`,
      {
        id: '',
        teamAId: '',
        teamBId: '',
        scoreBoutsA: 0,
        scoreBoutsB: 0,
        currentBoutIndex: 0,
        bouts: [],
        ...m,
      },
    ])
  );
  const out: TeamTableauMatchPlan[] = [];
  for (let round = tableau.size / 2; round >= 1; round /= 2) {
    for (let position = 0; position < round; position++) {
      const slot = resolveTeamTableauSlot(
        round,
        position,
        tableau.size,
        placements,
        byKey,
        teamById
      );
      if (slot.match || !slot.teamA || !slot.teamB) continue;
      const matchId = teamTableauMatchId(competitionId, round, position);
      out.push({
        matchId,
        round,
        position,
        teamAId: slot.teamA.id,
        teamBId: slot.teamB.id,
        relays: planRelays(matchId, slot.teamA, slot.teamB, teamSize, weapon, options.pairs),
      });
      // Rencontre à jouer : son vainqueur n'est pas encore connu
      byKey.set(`${round}-${position}`, {
        id: matchId,
        teamAId: slot.teamA.id,
        teamBId: slot.teamB.id,
        scoreBoutsA: 0,
        scoreBoutsB: 0,
        status: 'not_started',
        winnerId: null,
        currentBoutIndex: 0,
        bouts: [],
      });
    }
  }
  const third = options.thirdPlace && tableau.size >= 4 ? thirdPlaceTeams() : null;
  if (third) {
    const { round, position } = THIRD_PLACE_SLOT;
    const matchId = teamTableauMatchId(competitionId, round, position);
    out.push({
      matchId,
      round,
      position,
      teamAId: third[0].id,
      teamBId: third[1].id,
      relays: planRelays(matchId, third[0], third[1], teamSize, weapon, options.pairs),
    });
  }
  return out;

  /** Perdants des deux demi-finales terminées, si la petite finale n'existe pas encore */
  function thirdPlaceTeams(): [TeamRow, TeamRow] | null {
    if (byKey.has(`${THIRD_PLACE_SLOT.round}-${THIRD_PLACE_SLOT.position}`)) return null;
    const losers = [0, 1].map(position => {
      const slot = resolveTeamTableauSlot(2, position, tableau.size, placements, byKey, teamById);
      const m = slot.match;
      if (!m || m.status !== 'finished' || !m.winnerId || !slot.teamA || !slot.teamB) return null;
      return m.winnerId === slot.teamA.id ? slot.teamB : slot.teamA;
    });
    return losers[0] && losers[1] ? [losers[0], losers[1]] : null;
  }
}
