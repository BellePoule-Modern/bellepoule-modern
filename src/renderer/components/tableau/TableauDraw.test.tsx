// @vitest-environment jsdom
/**
 * Tirage du tableau à l'écran (docs/adr/0045) : le moteur tire, l'écran ne place plus et ne
 * régénère pas un tableau tiré ; mode et graine affichés ; PV imprimé par les services de
 * plateforme (ADR-0021).
 */
import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';

const showToast = vi.fn();
vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import TableauView from '../TableauView';
import { ConfirmProvider } from '../ConfirmDialog';
import { TableauDrawPanel } from './TableauDrawPanel';
import { useTableauGenerate } from '../../hooks/usePoolsLaunch';
import { BpmClientProvider } from '../../api/BpmClientContext';
import { PlatformProvider } from '../../platform/PlatformContext';
import { fakePlatform } from '../../../shared/platform/testing';
import type { BpmClient } from '../../../shared/api/client';
import { FencerStatus, Gender, type Fencer, type PoolRanking } from '../../../shared/types';
import { planTableau } from '../../../shared/domain/tableau/tableauCalculations';
import type { TableauMatch } from '../../../shared/domain/tableau/tableauTypes';

const fencer = (n: number): Fencer =>
  ({
    id: `f${n}`,
    ref: n,
    lastName: `Nom${n}`,
    firstName: 'P',
    gender: Gender.MALE,
    status: FencerStatus.CHECKED_IN,
  }) as Fencer;
const rankingOf = (n: number): PoolRanking[] =>
  Array.from({ length: n }, (_, i) => ({
    fencer: fencer(i + 1),
    rank: i + 1,
    victories: 0,
    defeats: 0,
    touchesScored: 0,
    touchesReceived: 0,
    index: 0,
    ratio: 0,
  })) as unknown as PoolRanking[];

const Host: React.FC<{
  ranking: PoolRanking[];
  initial?: TableauMatch[];
  onGenerate: (m: TableauMatch[] | null, third: boolean) => Promise<'recorded'>;
  engineDraw: boolean;
}> = ({ ranking, initial = [], onGenerate, engineDraw }) => {
  const [matches, setMatches] = useState<TableauMatch[]>(initial);
  return (
    <ConfirmProvider>
      <TableauView
        ranking={ranking}
        matches={matches}
        onMatchesChange={setMatches}
        onGenerateTableau={onGenerate}
        engineDraw={engineDraw}
        maxScore={15}
      />
    </ConfirmProvider>
  );
};

describe('TableauView : le moteur tire (ADR-0045)', () => {
  it('tableau à tirer : demande au moteur, sans placement de l’écran', async () => {
    const onGenerate = vi.fn(async (_m: TableauMatch[] | null, _t: boolean) => 'recorded' as const);
    render(<Host ranking={rankingOf(6)} onGenerate={onGenerate} engineDraw />);
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toBeNull();
  });

  it('tableau tiré : jamais régénéré, même si le classement a changé', async () => {
    const drawn = planTableau(rankingOf(6), { playAllPositions: false, thirdPlaceMatch: false });
    const onGenerate = vi.fn(async (_m: TableauMatch[] | null, _t: boolean) => 'recorded' as const);
    // Classement de 12 : l'écran régénérait un tableau de 16
    render(
      <Host ranking={rankingOf(12)} initial={drawn.matches} onGenerate={onGenerate} engineDraw />
    );
    await new Promise(r => setTimeout(r, 20));
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('strict après des poules : l’écran garde son placement (chemin actuel)', async () => {
    const onGenerate = vi.fn(async (_m: TableauMatch[] | null, _t: boolean) => 'recorded' as const);
    render(<Host ranking={rankingOf(6)} onGenerate={onGenerate} engineDraw={false} />);
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(Array.isArray(onGenerate.mock.calls[0][0])).toBe(true);
  });
});

describe('useTableauGenerate : tirage par le moteur', () => {
  it('matches null : generateTableau sans composition ni remplacement', async () => {
    const call = vi.fn(async () => ({}));
    const client = { call } as unknown as BpmClient;
    const { result } = renderHook(() => useTableauGenerate('c1'), {
      wrapper: ({ children }) => <BpmClientProvider client={client}>{children}</BpmClientProvider>,
    });
    expect(await result.current(null, false)).toBe('recorded');
    expect(call).toHaveBeenCalledWith('generateTableau', {
      competitionId: 'c1',
      thirdPlaceMatch: false,
    });
  });
});

describe('TableauDrawPanel : mode, graine et PV (ADR-0045)', () => {
  const state = {
    tableauDraw: { mode: 'pairs', seed: 4242, at: '2026-11-28T09:00:00.000Z', order: ['a', 'b'] },
    groupTableaux: { F: { tableauDraw: { mode: 'random', seed: 7, at: '', order: ['a', 'b'] } } },
  };
  const renderPanel = (group: string | null, print = vi.fn(async (_html: string) => undefined)) => {
    const client = { query: vi.fn(async () => ({ state })) } as unknown as BpmClient;
    const platform = fakePlatform({ over: { print } });
    render(
      <PlatformProvider platform={platform}>
        <BpmClientProvider client={client}>
          <TableauDrawPanel
            competitionId="c1"
            competition={{ title: 'Coupe <b>' }}
            group={group}
            size={2}
            entrants={[
              { id: 'a', name: 'ALPHA', affiliation: 'Paris', entryRank: 1 },
              { id: 'b', name: 'BRAVO', affiliation: 'Lyon', entryRank: null },
            ]}
            emplacements={{ a: 2, b: 1 }}
            byEntryRank
            refreshKey={1}
          />
        </BpmClientProvider>
      </PlatformProvider>
    );
    return print;
  };

  it('affiche le mode et la graine du tableau tiré ; PV imprimé par la plateforme', async () => {
    const print = renderPanel(null);
    expect(await screen.findByTestId('tableau-draw-seed')).toHaveTextContent('4242');
    expect(screen.getByTestId('tableau-draw-mode')).toHaveTextContent('tableauDraw.mode_pairs');
    fireEvent.click(screen.getByTestId('tableau-draw-print'));
    await waitFor(() => expect(print).toHaveBeenCalled());
    const html = print.mock.calls[0][0];
    expect(html).toContain('4242');
    expect(html).toContain('Coupe &lt;b&gt;');
    expect(html).toContain('tableauDraw.note_unranked');
  });

  it('tableau séparé : tirage du groupe', async () => {
    renderPanel('F');
    expect(await screen.findByTestId('tableau-draw-seed')).toHaveTextContent('7');
  });
});
