/**
 * Mode de tirage du tableau dans la formule v2 (docs/adr/0045) : réglage `draw` de la phase
 * tableau, opérations, branches restées, aucun réglage plat, verrou S6 (ADR-0041 amendée le
 * 2026-11-28).
 */
import { describe, expect, it } from 'vitest';
import { Category, CompetitionSettings, Weapon } from '../../types';
import { buildDefaultCompetitionSettings } from '../../utils/defaultCompetitionSettings';
import {
  coupledSplit,
  flatSettingsOf,
  formulaOf,
  tableauDrawOf,
  withFlatSettings,
  type FormulaV2,
  type PoolRoundPhase,
  type TableauPhase,
} from './formulaV2';
import {
  applyOperationsV2,
  formulaV2Issues,
  operationsBetweenV2,
  splitIssues,
  type FormulaScope,
} from './formulaV2Operations';
import { FormulaOperationError } from './formulaOperations';
import { formulaProgress, startedProgress } from './formulaRemarks';
import { formulaNeedsExpert } from './formulaExpert';

let n = 0;
const id = () => `id-${++n}`;
const settings = buildDefaultCompetitionSettings({
  weapon: Weapon.EPEE,
  category: Category.SENIOR,
}) as CompetitionSettings;
const ctx = { weapon: Weapon.EPEE, category: Category.SENIOR, settings };
const scope: FormulaScope = { weapon: Weapon.EPEE };
const base = (): FormulaV2 => formulaOf(ctx);
const tableauOf = (f: FormulaV2) => f.phases.find((p): p is TableauPhase => p.kind === 'tableau');
const poolOf = (f: FormulaV2) => f.phases.find((p): p is PoolRoundPhase => p.kind === 'pool')!;
const withDraw = (f: FormulaV2, draw?: TableauPhase['draw']): FormulaV2 => ({
  ...f,
  phases: f.phases.map(p => (p.kind === 'tableau' ? { ...p, draw } : p)),
});

describe('réglage draw de la phase tableau (ADR-0045, « Modes de tirage »)', () => {
  it('absent : strict ; setPhase règle pairs, groups, random ; strict ou null retire la clé', () => {
    expect(tableauOf(base())?.draw).toBeUndefined();
    for (const draw of ['pairs', 'groups', 'random'] as const) {
      const f = applyOperationsV2(
        ctx,
        [{ op: 'setPhase', phase: 'tableau', settings: { draw } }],
        id
      );
      expect(tableauOf(f)?.draw).toBe(draw);
    }
    const paired = { ...ctx, settings: { ...settings, formula: withDraw(base(), 'pairs') } };
    for (const draw of ['strict', null]) {
      const f = applyOperationsV2(
        paired,
        [{ op: 'setPhase', phase: 'tableau', settings: { draw } }],
        id
      );
      expect(tableauOf(f)).not.toHaveProperty('draw');
    }
  });

  it('valeur inconnue refusée', () => {
    expect(() =>
      applyOperationsV2(ctx, [{ op: 'setPhase', phase: 'tableau', settings: { draw: 'x' } }], id)
    ).toThrow(FormulaOperationError);
  });

  it('opérations de l’éditeur : le changement de draw devient un setPhase du tableau', () => {
    const ops = operationsBetweenV2(base(), withDraw(base(), 'groups'));
    expect(ops).toEqual([{ op: 'setPhase', phase: 'tableau', settings: { draw: 'groups' } }]);
    expect(operationsBetweenV2(withDraw(base(), 'groups'), base())).toEqual([
      { op: 'setPhase', phase: 'tableau', settings: { draw: null } },
    ]);
  });

  it('mode normal : draw ne demande pas le mode expert', () => {
    expect(formulaNeedsExpert(withDraw(base(), 'random'))).toBe(false);
  });

  it('branche de scission : le tableau d’une branche porte son draw', () => {
    const f = applyOperationsV2(
      ctx,
      [
        { op: 'removePhase', phase: 'tableau' },
        { op: 'insertPhase', brick: 'split', at: 1 },
        {
          op: 'setPhase',
          phase: 'split',
          settings: {
            criterion: 'rank',
            branches: [
              {
                label: 'A',
                phases: [{ ...tableauOf(base())!, draw: 'pairs' }],
                take: { mode: 'fixed_count', count: 8 },
              },
              { label: 'B', phases: [tableauOf(base())!] },
            ],
          },
        },
      ],
      id
    );
    const split = f.phases.find(p => p.kind === 'split');
    expect(split?.kind === 'split' && split.branches[0].phases[0]).toMatchObject({
      draw: 'pairs',
    });
  });

  it('compétition couplée : un seul tableau joué, même draw pour les branches restées', () => {
    const t = tableauOf(base())!;
    const split = coupledSplit({ ...t, draw: 'pairs' });
    expect(splitIssues(split, scope).map(r => r.code)).not.toContain('split_stay_same_tableau');
    const mixed = {
      ...split,
      branches: [split.branches[0], { ...split.branches[1], phases: [{ ...t, draw: 'random' }] }],
    } as typeof split;
    expect(splitIssues(mixed, scope).map(r => r.code)).toContain('split_stay_same_tableau');
  });
});

describe('aucun réglage plat ne porte draw (ADR-0045, « Éditeur et contrôles »)', () => {
  it('réglages plats dérivés sans draw ; un réglage plat garde le draw de la formule', () => {
    const f = withDraw(base(), 'pairs');
    expect(JSON.stringify(flatSettingsOf(f, Weapon.EPEE))).not.toContain('pairs');
    expect(tableauOf(withFlatSettings(f, { defaultTableMaxScore: 10 })!)?.draw).toBe('pairs');
  });

  it('épreuve sans formule enregistrée : placement strict', () => {
    expect(tableauDrawOf(settings)).toBe('strict');
    expect(tableauDrawOf(undefined)).toBe('strict');
    expect(tableauDrawOf({ ...settings, formula: withDraw(base(), 'groups') })).toBe('groups');
    // Compétition couplée : tableau des branches restées
    const coupled: FormulaV2 = {
      ...base(),
      phases: [poolOf(base()), coupledSplit({ ...tableauOf(base())!, draw: 'random' })],
    };
    expect(tableauDrawOf({ ...settings, formula: coupled })).toBe('random');
  });
});

describe('S6 : le mode de tirage d’un tableau tiré ne change plus (ADR-0041 amendée le 2026-11-28)', () => {
  const lock = (now: FormulaV2, was: FormulaV2, progress = startedProgress(['pool', 'tableau'])) =>
    formulaV2Issues(now, scope, progress, was).filter(
      r => r.code === 'started_tableau_mode_changed'
    );

  it('tableau tiré : draw verrouillé', () => {
    const was = base();
    const r = lock(withDraw(was, 'pairs'), was);
    expect(r).toHaveLength(1);
    expect(r[0].phase).toBe('tableau');
    expect(r[0].message).toContain('mode de tirage');
    // strict explicite ou absent : même réglage
    expect(lock(withDraw(was, 'strict'), was)).toEqual([]);
  });

  it('tableau pas tiré : draw modifiable', () => {
    const was = base();
    expect(lock(withDraw(was, 'random'), was, startedProgress(['pool']))).toEqual([]);
  });

  it('compétition couplée : tableau de groupe tiré, draw des branches restées verrouillé', () => {
    const t = tableauOf(base())!;
    const coupled = (draw?: TableauPhase['draw']): FormulaV2 => ({
      ...base(),
      phases: [poolOf(base()), coupledSplit({ ...t, draw })],
    });
    const was = coupled();
    const progress = formulaProgress(was, {
      poolHistory: [[{}]],
      groupTableaux: { F: { tableauMatches: [{ id: 'F:8-0' }] } },
    });
    expect(progress.phases).toEqual(['pool', 'split']);
    expect(lock(coupled('pairs'), was, progress)).toHaveLength(1);
    // Aucun tableau de groupe tiré : modifiable
    const before = formulaProgress(was, { poolHistory: [[{}]] });
    expect(before.phases).toEqual(['pool']);
    expect(lock(coupled('pairs'), was, before)).toEqual([]);
  });
});
