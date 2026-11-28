/**
 * BPM - Escrime - Tirage du tableau individuel par le moteur (docs/adr/0045)
 * Mode de la formule, tableau au rang d'entrée (sans poule), graine tirée par crypto.randomInt
 * sauf si la commande en reçoit une ; refus de la composition de l'écran quand le moteur doit
 * tirer. Le tirage lui-même est une fonction du domaine (shared/domain/tableau/tableauDraw).
 * Licensed under GPL-3.0
 */
import { randomInt } from 'crypto';
import type { Competition } from '../../../shared/types';
import { tableauDrawOf } from '../../../shared/domain/formula/formulaV2';
import { tableauEmplacements } from '../../../shared/domain/tableau/tableauCalculations';
import type { TableauDrawMode } from '../../../shared/domain/tableau/tableauDraw';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';
import { CommandError } from './context';

/**
 * Réglages du tirage : mode de la formule (strict sans formule), tableau au rang d'entrée
 * (`skipPools`), graine (0 à 2³² − 1). Le moteur tire, l'écran ne place plus : une composition
 * est refusée pour un mode autre que strict ou un tableau au rang d'entrée (invalid_composition).
 */
export function tableauDrawSetup(
  comp: Competition,
  session: Record<string, unknown>,
  options: { composition?: unknown; seed?: number }
): { mode: TableauDrawMode; byEntryRank: boolean; seed: number } {
  const mode = tableauDrawOf(comp.settings);
  const byEntryRank = session.skipPoolPhase === true;
  if (options.composition && (mode !== 'strict' || byEntryRank)) {
    throw new CommandError(
      'invalid_composition',
      mode !== 'strict'
        ? `Tableau tiré au sort (mode ${mode}) : placement par le moteur, sans « composition »`
        : 'Tableau au rang d’entrée : ex aequo et non classés tirés par le moteur, sans « composition »'
    );
  }
  return { mode, byEntryRank, seed: options.seed ?? randomInt(0, 2 ** 32) };
}

/** Rang d'entrée d'un tireur (classement saisi) ; absent ou ≤ 0 : non classé */
export const validEntryRank = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;

/**
 * Ordre d'entrée d'un placement de l'écran (strict après des poules) : tireurs du premier tour
 * et des barrages, par rang d'entrée (`seedA`, `seedB`), puis par emplacement
 */
export function entryOrderOfComposition(matches: TableauMatch[], size: number): string[] {
  const seen = new Map<string, number>();
  for (const m of matches.filter(x => x.round === size || x.round === size * 2)) {
    if (m.fencerA && !seen.has(m.fencerA.id)) seen.set(m.fencerA.id, m.seedA ?? Infinity);
    if (m.fencerB && !seen.has(m.fencerB.id)) seen.set(m.fencerB.id, m.seedB ?? Infinity);
  }
  const at = tableauEmplacements(matches);
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1] || (at[a[0]] ?? 0) - (at[b[0]] ?? 0))
    .map(([id]) => id);
}
