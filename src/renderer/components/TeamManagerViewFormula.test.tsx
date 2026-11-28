// @vitest-environment jsdom
/**
 * Écran des équipes et formule d'équipe (docs/adr/0044, Conséquences « écran des équipes :
 * phases générées, saisie du rang ») : rang d'entrée saisi par registerTeam et updateTeam,
 * tableau seul tiré depuis l'onglet Équipes, petite finale affichée, classement final lu dans
 * l'état (teams.finalRanking), remplaçant choisi (inFencerId). Écritures par le contrat
 * seulement (useTeamCompetition → useBpmClient). Moteur simulé.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));
vi.mock('../contexts/TranslationContext', async () => {
  const m = await import('../testUtils/i18nMock');
  return { useTranslation: m.useTranslation, translateStatic: m.frT };
});
const run = vi.fn();
const data = vi.hoisted(() => ({
  teams: [] as unknown[],
  poolMatches: [] as unknown[],
  tableauMatches: [] as unknown[],
  finalRanking: { rows: [] as Array<{ teamId: string; rank: number }>, provisional: true },
  tableauSeeds: [] as string[],
  tableauPlacement: undefined as string[] | undefined,
}));
vi.mock('../hooks/useTeamCompetition', () => ({
  useTeamCompetition: () => ({
    teams: data.teams,
    poolMatches: data.poolMatches,
    tableauMatches: data.tableauMatches,
    poolRanking: [],
    relayCards: {},
    teamCards: {},
    passivityCards: {},
    withdrawn: {},
    finalRanking: data.finalRanking,
    tableauSeeds: data.tableauSeeds,
    tableauPlacement: data.tableauPlacement,
    loading: false,
    run,
  }),
}));
vi.mock('../api/remoteApi', () => ({ useRemoteApi: () => ({}) }));
const pdf = vi.hoisted(() => ({
  exportTeamTableauToPDF: vi.fn(async () => {}),
  exportTeamRankingToPDF: vi.fn(async () => {}),
  exportTeamPoolsToPDF: vi.fn(async () => {}),
  exportTeamBookToPDF: vi.fn(async () => {}),
}));
vi.mock('../../shared/utils/pdfExport/teamPdf', () => pdf);
// Exports fédéraux (#1949) : résultats transmis espionnés
const federal = vi.hoisted(() => ({ fff: vi.fn(), xml: vi.fn() }));
vi.mock('../../shared/utils/fencerExport', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/utils/fencerExport')>();
  return {
    ...actual,
    exportTeamResultsToFFF: federal.fff.mockImplementation(actual.exportTeamResultsToFFF),
  };
});
vi.mock('../../shared/utils/multiFormatExport', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/utils/multiFormatExport')>();
  return {
    ...actual,
    exportTeamResultsXMLFFE: federal.xml.mockImplementation(actual.exportTeamResultsXMLFFE),
  };
});

import { TeamManagerView, type TeamViewMode } from './TeamManagerView';
import { ConfirmProvider } from './ConfirmDialog';
import { ToastProvider } from './Toast';
import { frT } from '../testUtils/i18nMock';
import { BpmClientProvider } from '../api/BpmClientContext';
import { PlatformProvider } from '../platform/PlatformContext';
import { fakePlatform } from '../../shared/platform/testing';
import type { BpmClient } from '../../shared/api/client';
import type { Competition } from '../../shared/types';

const RULE = { starters: 3, reserves: 2, relayStep: 5, relayOrder: 'fie' };
const tableauOnly = {
  version: 2,
  phases: [
    {
      kind: 'tableau',
      id: 'tableau',
      maxScore: 45,
      timerSeconds: 180,
      thirdPlace: true,
      allPlaces: false,
    },
  ],
  general: { teamMatch: RULE },
};

const competition = (settings: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    title: 'Coupe',
    weapon: 'E',
    isTeamEvent: true,
    settings: { minTeamSize: 3, ...settings },
  }) as never as Competition;

const member = (team: string, k: number, isReserve = false) => ({
  fencerId: `${team}${k}`,
  fencerLastName: `${team.toUpperCase()}${k}`,
  fencerFirstName: '',
  teamOrder: k,
  isReserve,
});
const team = (id: string, name: string, ranking: number | null = null) => ({
  id,
  name,
  club: '',
  ranking,
  fencers: [1, 2, 3].map(k => member(id, k)).concat([member(id, 4, true), member(id, 5, true)]),
});
const bout = (matchId: string, order: number, a: string, b: string, finished = false) => ({
  id: `${matchId}-r${order}`,
  matchId,
  boutOrder: order,
  fencerAId: a,
  fencerBId: b,
  scoreA: finished ? 5 : 0,
  scoreB: 0,
  maxScore: 5,
  status: finished ? 'finished' : 'not_started',
  winnerId: null,
});
const tableauMatch = (id: string, round: number, position: number, a: string, b: string) => ({
  id,
  round,
  position,
  teamAId: a,
  teamBId: b,
  scoreBoutsA: 0,
  scoreBoutsB: 0,
  status: 'in_progress',
  winnerId: null,
  currentBoutIndex: 0,
  bouts: [bout(id, 1, `${a}1`, `${b}1`)],
});

const show = (view: TeamViewMode, settings: Record<string, unknown> = {}, onNavigate = vi.fn()) =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <TeamManagerView
          competition={competition(settings)}
          fencers={[]}
          view={view}
          onNavigate={onNavigate}
        />
      </ConfirmProvider>
    </ToastProvider>
  );

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue({ dryRun: false });
  data.teams = [team('ta', 'Alpha', 2), team('tb', 'Bravo')];
  data.poolMatches = [];
  data.tableauMatches = [];
  data.tableauPlacement = undefined;
  data.finalRanking = { rows: [], provisional: true };
  data.tableauSeeds = ['ta', 'tb'];
  Object.values(pdf).forEach(f => f.mockClear());
  Object.values(federal).forEach(f => f.mockClear());
});

describe('TeamManagerView — rang d’entrée (docs/adr/0044)', () => {
  it('inscription : rang facultatif transmis à registerTeam', async () => {
    show('teams');
    fireEvent.change(screen.getByPlaceholderText(frT('teamManager.team_name_ph')), {
      target: { value: 'Charlie' },
    });
    fireEvent.change(screen.getByLabelText(frT('teamManager.entry_rank')), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: frT('teamManager.create') }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith('registerTeam', {
        competitionId: 'c1',
        name: 'Charlie',
        ranking: 3,
      })
    );
  });

  it('rang affiché ; modifié par updateTeam, vidé : rang retiré (null)', async () => {
    show('teams');
    expect(screen.getByText(frT('teamManager.entry_rank_badge', { n: 2 }))).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Gérer' })[0]);
    const input = screen.getByLabelText(frT('teamManager.entry_rank'), {
      selector: '#rank-ta',
    });
    expect(input).toHaveValue(2);
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: frT('teamManager.entry_rank_save') }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith('updateTeam', {
        competitionId: 'c1',
        teamId: 'ta',
        ranking: 1,
      })
    );
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: frT('teamManager.entry_rank_save') }));
    await waitFor(() =>
      expect(run).toHaveBeenLastCalledWith('updateTeam', {
        competitionId: 'c1',
        teamId: 'ta',
        ranking: null,
      })
    );
  });
});

describe('TeamManagerView — phases de la formule d’équipe (docs/adr/0044)', () => {
  it('sans formule d’équipe : « Générer la poule », comme avant', () => {
    show('teams');
    expect(
      screen.getByRole('button', { name: frT('teamManager.generate_pool') })
    ).toBeInTheDocument();
  });

  it('tableau seul : le tableau se tire depuis l’onglet Équipes, puis s’affiche', async () => {
    const onNavigate = vi.fn();
    show('teams', { formula: tableauOnly }, onNavigate);
    expect(screen.queryByRole('button', { name: frT('teamManager.generate_pool') })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: frT('teams.tableauGenerate', { count: 2 }) })
    );
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith('generateTeamTableau', { competitionId: 'c1' })
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('tableau'));
  });

  it('petite finale (case round 1, position 1) affichée après la finale', () => {
    data.teams = [
      team('ta', 'Alpha'),
      team('tb', 'Bravo'),
      team('tc', 'Charlie'),
      team('td', 'Delta'),
    ];
    data.tableauMatches = [
      tableauMatch('f', 1, 0, 'ta', 'tb'),
      tableauMatch('p', 1, 1, 'tc', 'td'),
    ];
    data.tableauSeeds = ['ta', 'tb', 'tc', 'td'];
    show('tableau', { formula: tableauOnly });
    const third = screen.getByTestId('team-third-place');
    expect(third).toHaveTextContent(frT('tableau.round_third_place'));
    expect(third).toHaveTextContent('Charlie');
    expect(third).toHaveTextContent('Delta');
  });

  it('classement final lu dans l’état (teams.finalRanking), jamais recalculé', () => {
    data.tableauMatches = [tableauMatch('f', 1, 0, 'ta', 'tb')];
    data.finalRanking = {
      rows: [
        { teamId: 'tb', rank: 1 },
        { teamId: 'ta', rank: 2 },
      ],
      provisional: false,
    };
    show('ranking', { formula: tableauOnly });
    const rows = within(screen.getByTestId('team-final-ranking')).getAllByRole('row');
    expect(rows.map(r => r.textContent)).toEqual(['1Bravo', '2Alpha']);
  });
});

describe('TeamManagerView — tableau tiré par le moteur (teams.tableauSeeds, docs/adr/0044)', () => {
  const five = () => [
    team('ta', 'Alpha'),
    team('tb', 'Bravo'),
    team('tc', 'Charlie'),
    team('td', 'Delta'),
    team('te', 'Echo'),
  ];
  const cutFormula = {
    ...tableauOnly,
    phases: [
      {
        kind: 'pool',
        id: 'pool-1',
        sizeMin: 3,
        sizeMax: 6,
        maxScore: 45,
        timerSeconds: 180,
        qualification: { mode: 'fixed_count', count: 4 },
        seeding: 'previous_round',
        boutOrder: 'fie',
      },
      tableauOnly.phases[0],
    ],
  };

  it('qualification qui coupe : 4 équipes au tableau sur 5, comme le moteur', async () => {
    data.teams = five();
    // Classement de poule : Echo 5e, coupée par la qualification (moteur)
    data.tableauSeeds = ['ta', 'tb', 'tc', 'td'];
    show('tableau', { formula: cutFormula });
    expect(
      screen.getByRole('button', { name: frT('teams.tableauGenerate', { count: 4 }) })
    ).toBeInTheDocument();
  });

  it('tableau tiré : tableau de 4 sans exempt, PDF sur les mêmes têtes de série', async () => {
    data.teams = five();
    data.tableauSeeds = ['ta', 'tb', 'tc', 'td'];
    data.tableauMatches = [
      tableauMatch('s1', 2, 0, 'ta', 'td'),
      tableauMatch('s2', 2, 1, 'tc', 'tb'),
    ];
    show('tableau', { formula: cutFormula });
    expect(screen.queryByText(/Echo/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(frT('teams.pdfExport')) }));
    await waitFor(() => expect(pdf.exportTeamTableauToPDF).toHaveBeenCalled());
    const [, seeds] = pdf.exportTeamTableauToPDF.mock.calls[0] as unknown as [
      unknown,
      Array<{ id: string }>,
    ];
    expect(seeds.map(x => x.id)).toEqual(['ta', 'tb', 'tc', 'td']);
  });

  it('tableau sans poule : têtes de série au rang d’entrée du moteur', async () => {
    data.teams = [team('ta', 'Alpha', 2), team('tb', 'Bravo', 1), team('tc', 'Charlie', 3)];
    data.tableauSeeds = ['tb', 'ta', 'tc'];
    data.tableauMatches = [tableauMatch('s2', 2, 1, 'tc', 'ta')];
    show('tableau', { formula: tableauOnly });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(frT('teams.pdfExport')) }));
    await waitFor(() => expect(pdf.exportTeamTableauToPDF).toHaveBeenCalled());
    const [, seeds] = pdf.exportTeamTableauToPDF.mock.calls[0] as unknown as [
      unknown,
      Array<{ id: string }>,
    ];
    expect(seeds.map(x => x.id)).toEqual(['tb', 'ta', 'tc']);
    // Tête de série 1 exempte au premier tour (tableau de 4)
    expect(screen.getAllByText(/Bravo/).length).toBeGreaterThan(0);
  });
});

describe('TeamManagerView — tableau tiré au sort (teams.tableauPlacement, docs/adr/0045)', () => {
  it('placement affiché et PDF : équipes par emplacement tiré, pas les têtes de série', async () => {
    data.teams = [team('ta', 'Alpha', 1), team('tb', 'Bravo', 2), team('tc', 'Charlie', 3)];
    data.tableauSeeds = ['ta', 'tb', 'tc'];
    data.tableauPlacement = ['tb', 'ta', 'tc'];
    data.tableauMatches = [tableauMatch('s2', 2, 1, 'tc', 'ta')];
    show('tableau', { formula: tableauOnly });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(frT('teams.pdfExport')) }));
    await waitFor(() => expect(pdf.exportTeamTableauToPDF).toHaveBeenCalled());
    const [, placed] = pdf.exportTeamTableauToPDF.mock.calls[
      pdf.exportTeamTableauToPDF.mock.calls.length - 1
    ] as unknown as [unknown, Array<{ id: string }>];
    expect(placed.map(x => x.id)).toEqual(['tb', 'ta', 'tc']);
  });
});

describe('TeamManagerView — mode, graine et PV du tableau d’équipes (docs/adr/0045)', () => {
  it('tableau sans poule tiré par paires : mode et graine affichés, PV imprimé par la plateforme', async () => {
    data.teams = [team('ta', 'Alpha', 1), team('tb', 'Bravo', 2), team('tc', 'Charlie')];
    data.tableauSeeds = ['ta', 'tb', 'tc'];
    data.tableauPlacement = ['tb', 'ta', 'tc'];
    data.tableauMatches = [tableauMatch('s2', 2, 1, 'tc', 'ta')];
    const state = {
      tableauDraw: {
        mode: 'pairs',
        seed: 31337,
        at: '2026-11-28T09:00:00.000Z',
        order: ['ta', 'tb', 'tc'],
      },
    };
    const client = { query: vi.fn(async () => ({ state })) } as unknown as BpmClient;
    const print = vi.fn(async (_html: string) => undefined);
    render(
      <PlatformProvider platform={fakePlatform({ over: { print } })}>
        <BpmClientProvider client={client}>
          <ToastProvider>
            <ConfirmProvider>
              <TeamManagerView
                competition={competition({ formula: tableauOnly })}
                fencers={[]}
                view="tableau"
                onNavigate={vi.fn()}
              />
            </ConfirmProvider>
          </ToastProvider>
        </BpmClientProvider>
      </PlatformProvider>
    );
    expect(await screen.findByTestId('tableau-draw-seed')).toHaveTextContent('31337');
    expect(screen.getByTestId('tableau-draw-mode')).toHaveTextContent(
      frT('tableauDraw.mode_pairs')
    );
    fireEvent.click(screen.getByTestId('tableau-draw-print'));
    await waitFor(() => expect(print).toHaveBeenCalled());
    const html = print.mock.calls[0][0];
    expect(html).toContain('31337');
    expect(html).toContain('Alpha');
    expect(html).toContain('Charlie');
    // Équipe sans rang saisi ni calculé : non classée, tirée au sort (ADR-0044 amendée)
    expect(html).toContain(frT('tableauDraw.note_unranked'));
  });
});

describe('TeamManagerView — PDF du classement lu dans l’état (teams.finalRanking, docs/adr/0044)', () => {
  it('PDF du classement : classement final du moteur, équipe coupée comprise', async () => {
    data.teams = [team('ta', 'Alpha'), team('tb', 'Bravo'), team('tc', 'Charlie')];
    data.tableauSeeds = ['ta', 'tb'];
    data.tableauMatches = [
      { ...tableauMatch('f', 1, 0, 'ta', 'tb'), status: 'finished', winnerId: 'tb' },
    ];
    data.finalRanking = {
      rows: [
        { teamId: 'tb', rank: 1 },
        { teamId: 'ta', rank: 2 },
        { teamId: 'tc', rank: 3 },
      ],
      provisional: false,
    };
    show('ranking', { formula: tableauOnly });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(frT('teams.pdfExport')) }));
    await waitFor(() => expect(pdf.exportTeamRankingToPDF).toHaveBeenCalled());
    const [, ranking] = pdf.exportTeamRankingToPDF.mock.calls[0] as unknown as [
      unknown,
      { rows: Array<{ rank: number; team: { id: string } }>; provisional: boolean },
    ];
    expect(ranking.rows.map(r => [r.rank, r.team.id])).toEqual([
      [1, 'tb'],
      [2, 'ta'],
      [3, 'tc'],
    ]);
    expect(ranking.provisional).toBe(false);
  });
});

describe('TeamManagerView — export fédéral lu dans l’état (teams.finalRanking, docs/adr/0044)', () => {
  it('FFF et XML FFE : classement final du moteur, équipe coupée comprise, sans poule', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    data.teams = [team('ta', 'Alpha'), team('tb', 'Bravo'), team('tc', 'Charlie')];
    data.tableauSeeds = ['ta', 'tb'];
    data.tableauMatches = [
      { ...tableauMatch('f', 1, 0, 'ta', 'tb'), status: 'finished', winnerId: 'tb' },
    ];
    // Ordre du moteur, différent de l'ordre des équipes et du tableau
    data.finalRanking = {
      rows: [
        { teamId: 'tb', rank: 1 },
        { teamId: 'ta', rank: 2 },
        { teamId: 'tc', rank: 3 },
      ],
      provisional: false,
    };
    show('ranking', { formula: tableauOnly });
    const expected = [
      [1, 'Bravo'],
      [2, 'Alpha'],
      [3, 'Charlie'],
    ];
    type Results = Array<{ rank: number; name: string }>;
    fireEvent.click(screen.getByRole('button', { name: frT('results.export_fff') }));
    await waitFor(() => expect(federal.fff).toHaveBeenCalled());
    const [, fffResults] = federal.fff.mock.calls[0] as [unknown, Results];
    expect(fffResults.map(r => [r.rank, r.name])).toEqual(expected);
    fireEvent.click(screen.getByRole('button', { name: frT('results.export_xml_ffe') }));
    await waitFor(() => expect(federal.xml).toHaveBeenCalled());
    const [, xmlResults] = federal.xml.mock.calls[0] as [unknown, Results];
    expect(xmlResults.map(r => [r.rank, r.name])).toEqual(expected);
  });
});

describe('TeamManagerView — remplaçant choisi (inFencerId, docs/adr/0044)', () => {
  it('deux remplaçants : celui qui entre se choisit', async () => {
    data.poolMatches = [
      {
        id: 'm1',
        poolNumber: 1,
        teamAId: 'ta',
        teamBId: 'tb',
        scoreBoutsA: 0,
        scoreBoutsB: 0,
        status: 'in_progress',
        winnerId: null,
        currentBoutIndex: 0,
        bouts: [bout('m1', 1, 'ta3', 'tb3'), bout('m1', 2, 'ta1', 'tb2')],
      },
    ];
    show('pool');
    fireEvent.click(screen.getByRole('button', { name: frT('teams.score') }));
    fireEvent.change(screen.getByLabelText(frT('teams.substituteOut', { team: 'Alpha' })), {
      target: { value: 'ta3' },
    });
    fireEvent.change(screen.getByLabelText(frT('teams.substituteIn', { team: 'Alpha' })), {
      target: { value: 'ta5' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(frT('teams.substitute')) })[0]
    );
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith('substituteTeamFencer', {
        competitionId: 'c1',
        matchId: 'm1',
        teamId: 'ta',
        outFencerId: 'ta3',
        inFencerId: 'ta5',
      })
    );
  });
});
