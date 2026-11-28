/**
 * BPM - Escrime - Contrôles de structure de la formule S1, S3, S4, S5, S6 (#2013 étape F, lot F2 ;
 * docs/adr/0041). Remarques situées (`FormulaRemark`), bloquantes. S2 (tableau arrêté, place de
 * la scission) reste dans formulaV2Operations. Domaine pur.
 * Licensed under GPL-3.0
 */

import type { AdvancementRule } from '../../types';
import {
  keyOfKinds,
  phaseKeys,
  remark,
  type FormulaPhaseKind,
  type FormulaProgress,
  type FormulaRemark,
} from './formulaRemarks';
import {
  isCoupledSplit,
  type FormulaPhaseV2,
  type FormulaV2,
  type SplitPhase,
  type TableauPhase,
} from './formulaV2';

const NAMES: Record<FormulaPhaseKind, string> = {
  pool: 'tour de poules',
  quest: 'Tour Quest',
  tableau: 'tableau',
  split: 'scission',
};

/** S1 : au moins une phase de combat (tour de poules, Tour Quest ou tableau) */
export function fightPhaseIssues(phases: readonly FormulaPhaseV2[]): FormulaRemark[] {
  return phases.some(p => p.kind !== 'split')
    ? []
    : [
        remark(
          'no_fight_phase',
          null,
          'au moins une phase de combat (tour de poules, Tour Quest ou tableau)'
        ),
      ];
}

/**
 * Nombre fixé par une règle de qualification (nombre, taille de tableau, têtes de poule) ; null :
 * autre mode
 */
const fixedNumber = (rule?: AdvancementRule): number | null => {
  if (
    !rule ||
    (rule.mode !== 'fixed_count' && rule.mode !== 'fixed_bracket' && rule.mode !== 'pool_heads')
  )
    return null;
  const n = Number(rule.count);
  return Number.isFinite(n) ? n : null;
};

/** `n` tireurs se répartissent-ils en poules de `min` à `max` ? */
export const poolable = (n: number, min: number, max: number): boolean =>
  min >= 1 && max >= min && Math.ceil(n / max) <= Math.floor(n / min);

/**
 * S3 et S4 : le nombre fixé par `rule` (`where` : « tour 1 », « branche A ») convient à la phase
 * qui le reçoit. S3 : assez de tireurs (au moins `sizeMin` pour un tour de poules, 2 pour un
 * tableau, plus de `stopAt` pour un tableau arrêté). S4 : répartition possible en poules de
 * `sizeMin` à `sizeMax`. Un pourcentage dépend de l'effectif : avertissement de la simulation.
 */
export function qualificationIssues(
  rule: AdvancementRule | undefined,
  next: FormulaPhaseV2 | undefined,
  where: string,
  phase: string
): FormulaRemark[] {
  if (rule?.mode === 'pool_heads') {
    // Têtes de poule, puis suivants (docs/adr/0043, F4b) : un nombre, et un tableau juste après
    if (!(Number.isInteger(rule.count) && Number(rule.count) >= 1))
      return [
        remark('pool_heads_count', phase, `${where} : têtes de poule, nombre de qualifiés ≥ 1`),
      ];
    if (next?.kind !== 'tableau')
      return [
        remark(
          'pool_heads_needs_tableau',
          phase,
          `${where} : « têtes de poule » ne qualifie que pour un tableau qui suit le tour`
        ),
      ];
  }
  const n = fixedNumber(rule);
  if (n === null || !next) return [];
  if (next.kind === 'pool') {
    if (n < next.sizeMin)
      return [
        remark(
          'qualified_below_pool_min',
          phase,
          `${where} : ${n} qualifié(s) pour des poules de ${next.sizeMin} tireurs au moins`
        ),
      ];
    if (!poolable(n, next.sizeMin, next.sizeMax))
      return [
        remark(
          'qualified_not_poolable',
          phase,
          `${where} : ${n} qualifiés ne se répartissent pas en poules de ${next.sizeMin} à ${next.sizeMax} tireurs`
        ),
      ];
  }
  if (next.kind === 'tableau') {
    if (next.stopAt && n <= next.stopAt)
      return [
        remark(
          'qualified_not_above_stop',
          phase,
          `${where} : ${n} qualifié(s) pour un tableau arrêté à ${next.stopAt} (plus de ${next.stopAt} requis)`
        ),
      ];
    if (n < 2)
      return [
        remark(
          'qualified_below_tableau_min',
          phase,
          `${where} : 2 qualifiés au moins pour le tableau`
        ),
      ];
  }
  return [];
}

/**
 * S3 et S4 de la qualification de chaque tour de poules, vers la phase qui le suit. « Têtes de
 * poule » : avec l'effectif connu `fencerCount`, jamais moins de poules que de tireurs
 * qualifiés (S4, docs/adr/0043) ; jugé sur le premier tour, dont l'effectif est celui de l'épreuve.
 */
export function poolQualificationIssues(f: FormulaV2, fencerCount?: number): FormulaRemark[] {
  const keys = phaseKeys(f.phases);
  let round = 0;
  return f.phases.flatMap((p, i) => {
    if (p.kind !== 'pool') return [];
    const where = `tour ${++round}`;
    const out = qualificationIssues(p.qualification, f.phases[i + 1], where, keys[i]);
    const heads = p.qualification;
    if (heads.mode === 'pool_heads' && out.length === 0 && i === 0 && fencerCount) {
      // Le moins de poules possible : tireurs répartis au plus par `sizeMax`
      const fewest = Math.ceil(fencerCount / Math.max(1, p.sizeMax));
      if (fewest > Number(heads.count))
        out.push(
          remark(
            'pool_heads_more_pools',
            keys[i],
            `${where} : ${fencerCount} tireurs font au moins ${fewest} poules de ${p.sizeMax} au plus, plus que les ${heads.count} qualifiés « têtes de poule »`
          )
        );
    }
    return out;
  });
}

/**
 * S3 et S4 de la part de chaque branche d'une scission par rang (vers sa première phase) ; la
 * somme des parts reste sous l'effectif connu `fencerCount`.
 */
export function splitTakeIssues(split: SplitPhase, fencerCount?: number): FormulaRemark[] {
  if (split.criterion !== 'rank') return [];
  const out: FormulaRemark[] = [];
  const last = split.branches.length - 1;
  let sum = 0;
  split.branches.forEach((b, i) => {
    if (i === last) return;
    const name = `branche « ${(b.label ?? '').trim() || i + 1} »`;
    out.push(...qualificationIssues(b.take, b.phases[0], name, 'split'));
    if (b.take?.mode === 'fixed_count') sum += Number(b.take.count) || 0;
  });
  if (fencerCount && fencerCount > 0 && sum >= fencerCount)
    out.push(
      remark(
        'split_takes_exceed',
        'split',
        `scission : les parts (${sum} tireurs) ne laissent rien à la dernière branche (effectif : ${fencerCount})`
      )
    );
  return out;
}

/** S5 : une branche se termine par une phase qui classe, jamais par un tableau arrêté */
export function branchEndIssues(phases: readonly FormulaPhaseV2[]): FormulaRemark[] {
  const last = phases[phases.length - 1];
  return last?.kind === 'tableau' && last.stopAt
    ? [
        remark(
          'ends_with_stopped_tableau',
          'tableau',
          `se termine par un tableau arrêté à ${last.stopAt} : finir par un tour de poules ou un tableau complet`
        ),
      ]
    : [];
}

/** Règle de qualification comparable : « ex aequo : all » vaut l'absence de réglage */
const ruleKey = (rule: AdvancementRule): string =>
  rule.mode === 'all'
    ? 'all'
    : JSON.stringify({
        mode: rule.mode,
        count: rule.count,
        percentage: rule.percentage,
        ties: rule.ties === 'all' ? undefined : rule.ties,
      });

/**
 * S6, qualification verrouillée (docs/adr/0041, amendements du 2026-11-27) : la règle de
 * qualification d'un tour de poules clos (`closePoolRound`, `progress.closedRounds`) ou du tour
 * qui précède une phase commencée (tour suivant lancé, tableau tiré, scission faite) est celle
 * de la formule enregistrée `stored`. Toutes les règles : nombre, pourcentage, têtes de poule,
 * ex aequo à la barre. Les éliminés d'un tour clos sont fixés dès la clôture, et le classement
 * final relit la formule : la coupe doit rester celle du tirage. Un tableau arrêté clos n'est
 * pas concerné (il n'a pas de règle de qualification).
 */
function lockedQualificationIssues(
  f: FormulaV2,
  progress: FormulaProgress,
  stored: FormulaV2
): FormulaRemark[] {
  const keys = phaseKeys(f.phases);
  const { phases: started, closedRounds: closed } = progress;
  const out: FormulaRemark[] = [];
  let round = 0;
  for (let i = 0; i < started.length; i++) {
    const was = stored.phases[i];
    const now = f.phases[i];
    if (was?.kind !== 'pool') continue;
    const ordinal = round++;
    if (now?.kind !== 'pool' || ruleKey(was.qualification) === ruleKey(now.qualification)) continue;
    // Phase suivante commencée, ou à défaut tour clos (closePoolRound)
    const reason =
      i + 1 < started.length
        ? `elle mène à une phase déjà commencée (${NAMES[started[i + 1]]})`
        : ordinal < closed
          ? 'le tour est clos, ses éliminés sont fixés'
          : null;
    if (reason)
      out.push(
        remark(
          'started_qualification_changed',
          keys[i],
          `qualification du tour : ${reason}, elle ne change plus`
        )
      );
  }
  return out;
}

/**
 * Mode du tableau tiré (docs/adr/0043, F4b ; ADR-0041 S6 amendée le 2026-11-28) : petite
 * finale, « toutes les places » et mode de tirage (docs/adr/0045) sont modifiables tant que le
 * tableau n'est pas tiré ; ensuite, ceux de la formule enregistrée.
 */
const tableauAt = (p: FormulaPhaseV2 | undefined): TableauPhase | undefined => {
  if (p?.kind === 'tableau') return p;
  const kept = p?.kind === 'split' && isCoupledSplit(p) ? p.branches[0]?.phases[0] : undefined;
  return kept?.kind === 'tableau' ? kept : undefined;
};

function lockedTableauModeIssues(
  f: FormulaV2,
  progress: FormulaProgress,
  stored: FormulaV2
): FormulaRemark[] {
  const keys = phaseKeys(f.phases);
  const out: FormulaRemark[] = [];
  for (let i = 0; i < progress.phases.length; i++) {
    // Compétition couplée : tableau des branches restées (ADR-0039 E3, ADR-0045)
    const was = tableauAt(stored.phases[i]);
    const now = tableauAt(f.phases[i]);
    if (!was || !now) continue;
    if (
      !!was.thirdPlace === !!now.thirdPlace &&
      !!was.allPlaces === !!now.allPlaces &&
      (was.draw ?? 'strict') === (now.draw ?? 'strict')
    )
      continue;
    out.push(
      remark(
        'started_tableau_mode_changed',
        keys[i],
        'tableau déjà tiré : la petite finale, « toutes les places » et le mode de tirage ne changent plus'
      )
    );
  }
  return out;
}

/**
 * S6 : une phase commencée ne se retire pas, ne change pas de nature, et rien ne s'insère avant
 * elle ; la règle de qualification qui sort d'un tour de poules clos, ou qui mène à une phase
 * commencée, ne change plus ; le mode d'un tableau tiré non plus (ADR-0043, F4b) (`stored` :
 * formule enregistrée). Ses autres réglages restent soumis aux règles actuelles (Q15). Première
 * incohérence de structure seulement (les suivantes en découlent).
 */
export function progressIssues(
  f: FormulaV2,
  progress: FormulaProgress,
  stored?: FormulaV2
): FormulaRemark[] {
  const at = progress.phases.findIndex((kind, i) => f.phases[i]?.kind !== kind);
  if (at < 0)
    return stored
      ? [
          ...lockedQualificationIssues(f, progress, stored),
          ...lockedTableauModeIssues(f, progress, stored),
        ]
      : [];
  const kind = progress.phases[at];
  const key = keyOfKinds(progress.phases, at);
  const found = f.phases[at];
  const name = `phase déjà commencée (${NAMES[kind]})`;
  return [
    found
      ? remark(
          'started_phase_moved',
          key,
          `${name} : sa nature ne change pas et rien ne s'insère avant elle`
        )
      : remark('started_phase_removed', key, `${name} : elle ne se retire pas`),
  ];
}
