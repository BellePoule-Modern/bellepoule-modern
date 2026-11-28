/**
 * BPM - Escrime - Rang d'entrée effectif d'une équipe (ADR-0044) : `ranking` saisi ou importé ;
 * à défaut, somme des classements des titulaires, à condition que chacun en ait un ; puis le nom.
 * Les équipes au rang saisi passent devant celles au rang calculé, chacune dans l'ordre de son
 * rang ; puis les équipes sans rang, au nom. Les deux échelles ne se mélangent pas (ADR-0044
 * amendée). Sert au serpentin des poules d'équipes, au placement du tableau sans poule et au
 * carton noir P. Domaine pur.
 * Licensed under GPL-3.0
 */
import type { TeamRow } from './team.types';
import { titulars } from './relay';
import type { TableauDrawEntry } from '../tableau/tableauDraw';

/** Classement d'un tireur (rang national…) ; absent ou ≤ 0 : non classé */
export type FencerRankingOf = (fencerId: string) => number | null | undefined;

const ranked = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Rang effectif d'une équipe : `ranking` saisi, sinon somme des classements de ses `starters`
 * titulaires s'ils sont tous classés ; null : non classée (rangée au nom)
 */
export function teamEntryKey(
  team: Pick<TeamRow, 'ranking' | 'fencers'>,
  starters: number,
  fencerRanking: FencerRankingOf
): number | null {
  if (ranked(team.ranking)) return team.ranking;
  const ids = titulars(team as TeamRow, starters);
  if (ids.length < starters || ids.length === 0) return null;
  const ranks = ids.map(fencerRanking);
  return ranks.every(ranked) ? ranks.reduce((s, r) => s + r, 0) : null;
}

/**
 * Équipes dans l'ordre d'entrée (1re = la meilleure) : d'abord les équipes au rang saisi, par
 * rang croissant ; puis celles au rang calculé (somme des titulaires), par somme croissante ;
 * puis les équipes sans rang. Les deux échelles ne se comparent jamais ; égalité : le nom.
 */
export function teamEntryRanking<T extends Pick<TeamRow, 'id' | 'name' | 'ranking' | 'fencers'>>(
  teams: readonly T[],
  starters: number,
  fencerRanking: FencerRankingOf
): T[] {
  const keyed = teams.map(team => {
    if (ranked(team.ranking)) return { team, tier: 0, key: team.ranking };
    const sum = teamEntryKey(team, starters, fencerRanking);
    return sum === null ? { team, tier: 2, key: 0 } : { team, tier: 1, key: sum };
  });
  return keyed
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.key - b.key ||
        a.team.name.localeCompare(b.team.name, 'fr') ||
        a.team.id.localeCompare(b.team.id)
    )
    .map(x => x.team);
}

/** Rang d'entrée (dès 1) de chaque équipe, dans l'ordre de `teamEntryRanking` */
export function teamEntryRanks(teams: readonly Pick<TeamRow, 'id'>[]): Map<string, number> {
  return new Map(teams.map((t, i) => [t.id, i + 1]));
}

/**
 * Qualifiés d'un tableau d'équipes à tirer (docs/adr/0045), dans l'ordre donné : rang effectif et
 * échelle (rang saisi, puis rang calculé) ; null : équipe sans rang. Au tableau sans poule, les
 * équipes à rang effectif égal et les équipes sans rang sont tirées au sort avec la graine du
 * tableau, au lieu de suivre le nom (ADR-0044 amendée le 2026-11-28).
 */
export function teamDrawEntries(
  teams: readonly Pick<TeamRow, 'id' | 'ranking' | 'fencers'>[],
  starters: number,
  fencerRanking: FencerRankingOf
): TableauDrawEntry[] {
  return teams.map(team => {
    if (ranked(team.ranking)) return { id: team.id, entryRank: team.ranking, tier: 0 };
    const sum = teamEntryKey(team, starters, fencerRanking);
    return { id: team.id, entryRank: sum, tier: sum === null ? 2 : 1 };
  });
}
