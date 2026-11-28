// @vitest-environment jsdom
/**
 * Éditeur de formule : liste « Placement » du tableau (mode de tirage, docs/adr/0045), en mode
 * normal ; verrou S6 du mode de tirage d'un tableau tiré à l'écran (ADR-0041 amendée).
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useFormulaPreview', () => ({ useFormulaPreview: () => true }));
// Préférence du poste : lue et écrite par le contrat (réglages du poste), jamais window.electronAPI
const station = vi.hoisted(() => ({ expert: false, saved: [] as boolean[] }));
vi.mock('../../hooks/useFormulaExpert', async () => {
  const { useState } = await import('react');
  return {
    useFormulaExpert: () => {
      const [expert, setLocal] = useState(station.expert);
      return {
        expert,
        setExpert: (v: boolean) => {
          station.saved.push(v);
          setLocal(v);
        },
      };
    },
  };
});

vi.mock('../../hooks/useFormulaTemplates', () => ({
  useFormulaTemplates: () => ({
    templates: [],
    all: [],
    available: false,
    save: vi.fn(),
    reload: vi.fn(),
  }),
}));
vi.mock('../../api/BpmClientContext', () => ({
  useBpmClient: () => ({ call: vi.fn(), query: vi.fn() }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { FormulaEditor } from './FormulaEditor';
import { CompetitionFormulaModal } from './CompetitionFormulaModal';
import { Category, Competition, CompetitionSettings, Gender, Weapon } from '../../../shared/types';
import {
  formulaOf,
  type FormulaV2,
  type TableauPhase,
} from '../../../shared/domain/formula/formulaV2';
import { buildDefaultCompetitionSettings } from '../../../shared/utils/defaultCompetitionSettings';
import { startedProgress } from '../../../shared/domain/formula/formulaRemarks';

const settings = (weapon: Weapon) =>
  buildDefaultCompetitionSettings({ weapon, category: Category.SENIOR }) as CompetitionSettings;
const base = (weapon = Weapon.EPEE): FormulaV2 =>
  formulaOf({ weapon, category: Category.SENIOR, settings: settings(weapon) });

let last: FormulaV2 | null = null;
const Harness: React.FC<{
  initial: FormulaV2;
  weapon?: Weapon;
  progress?: ('pool' | 'quest' | 'tableau' | 'split')[];
}> = ({ initial, weapon = Weapon.EPEE, progress }) => {
  const [formula, setFormula] = useState(initial);
  last = formula;
  return (
    <FormulaEditor
      weapon={weapon}
      category={Category.SENIOR}
      formula={formula}
      onChange={setFormula}
      progress={progress && startedProgress(progress)}
    />
  );
};

beforeEach(() => {
  station.expert = false;
  station.saved = [];
});

describe('liste « Placement » de la carte du tableau (ADR-0045)', () => {
  it('mode normal : strict par défaut, pairs / groups / random réglés dans la formule', () => {
    render(<Harness initial={base()} />);
    expect(screen.getByTestId('formula-expert-toggle')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    const select = document.getElementById('tableau-draw') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['strict', 'pairs', 'groups', 'random']);
    expect(select.value).toBe('strict');
    fireEvent.change(select, { target: { value: 'pairs' } });
    expect((last!.phases[1] as TableauPhase).draw).toBe('pairs');
    fireEvent.change(select, { target: { value: 'strict' } });
    expect((last!.phases[1] as TableauPhase).draw).toBeUndefined();
  });
});

describe('S6 à l’écran : mode de tirage d’un tableau tiré verrouillé (ADR-0041 amendée)', () => {
  const competition = (formula?: FormulaV2): Competition =>
    ({
      id: 'c1',
      title: 'Coupe',
      weapon: Weapon.EPEE,
      category: Category.SENIOR,
      gender: Gender.MALE,
      fencerCount: 0,
      settings: { ...settings(Weapon.EPEE), ...(formula ? { formula } : {}) },
    }) as unknown as Competition;

  it('tableau tiré : changer le placement grise Enregistrer ; pas tiré : modifiable', () => {
    const { unmount } = render(
      <CompetitionFormulaModal
        competition={competition(base())}
        progress={startedProgress(['pool', 'tableau'])}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    fireEvent.change(document.getElementById('tableau-draw')!, { target: { value: 'random' } });
    expect(screen.getByTestId('formula-modal-save')).toBeDisabled();
    expect(screen.getByTestId('phase-remarks')).toHaveTextContent('mode de tirage');
    unmount();
    render(
      <CompetitionFormulaModal
        competition={competition(base())}
        progress={startedProgress(['pool'])}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('formula-step-tableau'));
    fireEvent.change(document.getElementById('tableau-draw')!, { target: { value: 'random' } });
    expect(screen.getByTestId('formula-modal-save')).not.toBeDisabled();
  });
});
