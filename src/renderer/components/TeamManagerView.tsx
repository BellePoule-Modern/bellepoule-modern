/**
 * BPM - Escrime - Gestionnaire de compétitions par équipes
 * Vue: création d'équipes, affectation tireurs, poule équipes, tableau équipes, scores
 * Écritures par le contrat seulement (docs/adr/0024, lot E3) : inscription, composition,
 * tirages des poules et du tableau, fin de relais, réouverture, remplacement. État lu dans le
 * bloc « teams » du moteur (useTeamCompetition) ; le compteur de touches du relais en cours
 * est un état de l'écran, envoyé à la fin du relais (recordRelayScore). Cartons et retrait
 * d'une équipe par le moteur (docs/adr/0028, lot C2) : lus dans le bloc « teams », écrits par
 * giveTeamCard, giveRelayCard, cancelTeamCard, cancelRelayCard, withdrawTeam ; succès affiché
 * après la réponse du moteur (docs/adr/0005). Cartons P (relais FIE, t.124, #2227) par
 * givePassivityCard : essai à blanc, confirmation du noir P (il décide la rencontre), envoi.
 * Formule d'équipe (docs/adr/0044) : rang d'entrée saisi (registerTeam, updateTeam), tableau
 * seul sans poules, palier de la rencontre lu dans ses relais, petite finale, remplaçant choisi,
 * classement final lu dans le bloc « teams » (teamFinalRanking du moteur).
 * Licensed under GPL-3.0
 */

import { TableauDrawPanel } from './tableau/TableauDrawPanel';
import { teamDrawEntries } from '../../shared/domain/teams/teamEntryRanking';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CardReason, Competition, Fencer, Weapon } from '../../shared/types';
import { TeamRow, TeamMatchRow, TeamBoutRow } from '../../shared/domain/teams/team.types';
import { calculateTableSize, getTeamTargetRule } from '../../shared/domain/teams/teamCalculations';
import {
  getLaserArenaBoutCap,
  isLaserArenaBoutComplete,
} from '../../shared/domain/teams/laserArenaCalculations';
import {
  relayCap,
  relayOvershoot,
  relayCumulative,
  relayRuleOf,
  teamFormatOf,
} from '../../shared/domain/teams/relay';
import { hasTeamPools, teamFormulaOf } from '../../shared/domain/teams/teamMatchRule';
import { hasPassivityCards } from '../../shared/domain/teams/passivityCards';
import TeamPoolView, { CardHandlers, CardTarget, RelayHandlers } from './TeamPoolView';
import TeamTableauView from './TeamTableauView';
import BookSectionsModal from './BookSectionsModal';
import {
  TEAM_BOOK_SECTION_KINDS,
  type BookSectionKind,
} from '../../shared/utils/pdfExport/bookToc';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { useTranslation } from '../hooks/useTranslation';
import { useTeamCompetition } from '../hooks/useTeamCompetition';
import { ipcErrorText } from '../services/ipcError';
import { Button } from './common/Button';
import { TriangleAlert, Users } from 'lucide-react';
import EmptyState from './common/EmptyState';
import { Icon } from './common/Icon';
import { useRemoteApi } from '../api/remoteApi';

// ── Composant ─────────────────────────────────────────────────────────────────

export type TeamViewMode = 'teams' | 'pool' | 'tableau' | 'ranking';

interface Props {
  competition: Competition;
  fencers: Fencer[];
  /** Onglet affiché — piloté par la phase courante de CompetitionView (#1085) */
  view: TeamViewMode;
  /** Demande de changement de phase (ex. vers la poule après génération) */
  onNavigate?: (view: TeamViewMode) => void;
}

/** Rang saisi : entier ≥ 1, sinon aucun */
const parseRank = (v: string): number | undefined => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

/** Score du relais en cours, compté à l'écran jusqu'à la fin du relais */
type Draft = { scoreA: number; scoreB: number };

const relayScoresOf = (m: TeamMatchRow) =>
  m.bouts.map(b => ({
    order: b.boutOrder,
    scoreA: b.scoreA,
    scoreB: b.scoreB,
    finished: b.status === 'finished',
  }));

export const TeamManagerView: React.FC<Props> = ({ competition, fencers, view, onNavigate }) => {
  const teamSize = competition.settings?.minTeamSize ?? 3;
  const reserveCount = competition.settings?.teamReserveCount ?? 1;
  const targetRule = getTeamTargetRule(
    competition.weapon,
    teamSize,
    competition.settings?.laserTeamMode ?? 'touches',
    competition.settings?.teamRelayStepSize ?? 5
  );
  const isEpee = competition.weapon === Weapon.EPEE;
  const isLaserPoints = competition.weapon === Weapon.LASER && targetRule.mode === 'points';
  // Format arène Sabre Laser (assauts indépendants plafonnés à 5 touches/3min,
  // score = total de points) — distinct du relais FIE classique ci-dessus,
  // qui reste le comportement par défaut pour tous les autres cas.
  const isLaserArena = competition.settings?.teamFormat === 'laser-arena';
  const format = teamFormatOf(competition.settings);
  const rule = relayRuleOf(competition.weapon, competition.settings);
  // Formule d'équipe (docs/adr/0044) : poules ou tableau seul ; règle de rencontre du tableau
  const teamFormula = teamFormulaOf(competition);
  const teamPools = hasTeamPools(competition);
  const boutCap = getLaserArenaBoutCap();
  const competitionId = competition.id;
  const { confirm } = useConfirm();
  const { showToast, showUndoToast } = useToast();
  const { t } = useTranslation();
  const remote = useRemoteApi();
  const {
    teams,
    poolMatches: matches,
    tableauMatches,
    poolRanking,
    relayCards,
    teamCards,
    passivityCards,
    withdrawn,
    finalRanking,
    tableauSeeds,
    tableauPlacement: placementIds,
    loading,
    run,
  } = useTeamCompetition(competitionId);
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);

  // Création équipe
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamClub, setNewTeamClub] = useState('');
  // Rang d'entrée (docs/adr/0044) : facultatif, 1 = la meilleure
  const [newTeamRanking, setNewTeamRanking] = useState('');
  const [rankDraft, setRankDraft] = useState('');
  const [creating, setCreating] = useState(false);

  // Edition fencer assignment
  const [editTeamId, setEditTeamId] = useState<string | null>(null);
  const [selectedFencerId, setSelectedFencerId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(1);
  const [selectedIsReserve, setSelectedIsReserve] = useState(false);

  // Scoring
  const [scoringMatchId, setScoringMatchId] = useState<string | null>(null);
  // Touches du relais en cours, par relais (non persistées : seule la fin du relais l'est)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // Égalité au dernier relais du tableau : vainqueur à désigner (draw_needs_winner)
  const [pendingTie, setPendingTie] = useState<{
    matchId: string;
    boutId: string;
    draft: Draft;
  } | null>(null);
  const sending = useRef(new Set<string>());

  // Carton individuel en cours de saisie (relais et tireur visés, motif)
  const [cardTarget, setCardTarget] = useState<CardTarget | null>(null);
  const [selectedReason, setSelectedReason] = useState<CardReason | ''>('');

  const allMatches = useMemo(() => [...matches, ...tableauMatches], [matches, tableauMatches]);
  const teamName = (id: string) => teams.find(team => team.id === id)?.name ?? '—';

  // Relais terminés ou rouverts par le moteur : leur compteur local tombe
  useEffect(() => {
    setDrafts(prev => {
      const open = new Map(
        allMatches.flatMap(m => m.bouts.filter(b => b.status !== 'finished').map(b => [b.id, b]))
      );
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => open.has(id)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [allMatches]);

  // ── Créer équipe ──────────────────────────────────────────────────────────────
  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreating(true);
    try {
      const club = newTeamClub.trim();
      const ranking = parseRank(newTeamRanking);
      const out = await run('registerTeam', {
        competitionId,
        name: newTeamName.trim(),
        ...(club ? { club } : {}),
        ...(ranking ? { ranking } : {}),
      });
      if (out) {
        setNewTeamName('');
        setNewTeamClub('');
        setNewTeamRanking('');
      }
    } finally {
      setCreating(false);
    }
  };

  // ── Rang d'entrée d'une équipe (updateTeam, avant le tirage ; vide : rang retiré) ──
  const handleSaveRanking = async (teamId: string) => {
    await run('updateTeam', { competitionId, teamId, ranking: parseRank(rankDraft) ?? null });
  };

  // ── Supprimer équipe ──────────────────────────────────────────────────────────
  const handleDeleteTeam = async (teamId: string) => {
    await run('unregisterTeam', { competitionId, teamId });
  };

  // ── Affecter tireur ───────────────────────────────────────────────────────────
  const handleUpsertFencer = async () => {
    if (!editTeamId || !selectedFencerId) return;
    const out = await run('assignTeamFencer', {
      competitionId,
      teamId: editTeamId,
      fencerId: selectedFencerId,
      teamOrder: selectedOrder,
      isReserve: selectedIsReserve,
    });
    if (out) setSelectedFencerId('');
  };

  const handleRemoveFencer = async (
    teamId: string,
    fencerId: string,
    teamOrder: number,
    isReserve: boolean
  ) => {
    const out = await run('unassignTeamFencer', { competitionId, teamId, fencerId });
    if (!out) return;
    // Retrait annulable sans confirmation modale (#1535)
    showUndoToast(t('teamManager.fencer_removed'), () => {
      void run('assignTeamFencer', { competitionId, teamId, fencerId, teamOrder, isReserve });
    });
  };

  // ── Tirer les poules (moteur : relais FIE tous contre tous, arène 8 ou 12 équipes) ──
  const handleGeneratePool = async () => {
    if (teams.length < 2) return;
    const replace = matches.length > 0;
    if (replace && !(await confirm(t('teams.confirmRegenerate')))) return;
    const out = await run('generateTeamPools', { competitionId, ...(replace ? { replace } : {}) });
    if (out) onNavigate?.('pool');
  };

  // ── Tirer le tableau (action explicite : plus de création à l'ouverture) ──────
  const handleGenerateTableau = async () => {
    const replace = tableauMatches.length > 0;
    if (replace && !(await confirm(t('teams.confirmRegenerate')))) return;
    const out = await run('generateTeamTableau', {
      competitionId,
      ...(replace ? { replace } : {}),
    });
    // Formule d'équipe sans poules : le tableau suit l'appel (docs/adr/0044)
    if (out && !teamPools) onNavigate?.('tableau');
  };

  // ── Relais en cours : touches comptées à l'écran, fin envoyée au moteur ───────
  const endRelay = async (matchId: string, bout: TeamBoutRow, draft: Draft, winner?: 'A' | 'B') => {
    if (sending.current.has(bout.id)) return;
    sending.current.add(bout.id);
    try {
      const out = await run(
        'recordRelayScore',
        {
          competitionId,
          matchId,
          relay: bout.boutOrder,
          scoreA: draft.scoreA,
          scoreB: draft.scoreB,
          ...(winner ? { winner } : {}),
        },
        ['draw_needs_winner']
      );
      if (out) setPendingTie(null);
    } catch {
      // Égalité au dernier relais du tableau : le moteur demande le vainqueur
      setPendingTie({ matchId, boutId: bout.id, draft });
    } finally {
      sending.current.delete(bout.id);
    }
  };

  // side='double' : touche double simultanée (épée uniquement, pas de priorité).
  // points : 1 par défaut, valeur de zone A/B/C (1/3/5) en Sabre Laser mode points, -1 pour
  // retirer une touche. Palier du relais atteint : fin du relais envoyée.
  const handleScoreBout = (bout: TeamBoutRow, side: 'A' | 'B' | 'double', points: number = 1) => {
    const match = allMatches.find(m => m.bouts.some(b => b.id === bout.id));
    if (!match || bout.status === 'finished' || sending.current.has(bout.id)) return;
    const cur = drafts[bout.id] ?? { scoreA: bout.scoreA, scoreB: bout.scoreB };
    const before = isLaserArena
      ? { scoreA: 0, scoreB: 0 }
      : relayCumulative(relayScoresOf(match), bout.boutOrder - 1);
    // Formule d'équipe : palier et cible figés dans les relais de la rencontre, comme le moteur
    // (docs/adr/0044) ; sinon réglages d'épreuve
    const step = match.bouts[0]?.maxScore ?? rule.stepSize;
    const matchRule =
      teamFormula && !isLaserArena
        ? { ...rule, stepSize: step, target: step * match.bouts.length }
        : rule;
    const cap = relayCap(bout.boutOrder, format, matchRule);
    // Relais en points (Sabre Laser) : la dernière touche peut dépasser le palier (cible C, #2188)
    const ceiling =
      !isLaserArena && matchRule.mode === 'points' ? cap + relayOvershoot(matchRule) : cap;
    const clamp = (v: number, prior: number) => Math.max(0, Math.min(v, ceiling - prior));
    const next: Draft = {
      scoreA: clamp(cur.scoreA + (side === 'B' ? 0 : points), before.scoreA),
      scoreB: clamp(cur.scoreB + (side === 'A' ? 0 : points), before.scoreB),
    };
    setDrafts(prev => ({ ...prev, [bout.id]: next }));
    setPendingTie(null);
    const complete = isLaserArena
      ? isLaserArenaBoutComplete(next.scoreA, next.scoreB, 0, boutCap)
      : before.scoreA + next.scoreA >= cap || before.scoreB + next.scoreB >= cap;
    if (complete && points > 0) void endRelay(match.id, bout, next);
  };

  const relayHandlers: RelayHandlers = {
    onEndRelay: (matchId, bout) =>
      void endRelay(matchId, bout, drafts[bout.id] ?? { scoreA: bout.scoreA, scoreB: bout.scoreB }),
    onReopenRelay: matchId => void run('reopenRelay', { competitionId, matchId }),
    pendingTieMatchId: pendingTie?.matchId ?? null,
    onResolveTie: winner => {
      if (!pendingTie) return;
      const bout = allMatches
        .find(m => m.id === pendingTie.matchId)
        ?.bouts.find(b => b.id === pendingTie.boutId);
      if (bout) void endRelay(pendingTie.matchId, bout, pendingTie.draft, winner);
    },
    onSubstitute: (matchId, teamId, outFencerId, inFencerId) =>
      void run('substituteTeamFencer', {
        competitionId,
        matchId,
        teamId,
        outFencerId,
        ...(inFencerId ? { inFencerId } : {}),
      }),
    onWithdrawTeam: (matchId, teamId) => void handleWithdrawTeam(matchId, teamId),
  };

  // ── Abandon d'une équipe incomplète sans remplaçant (o.99.7.a) ───────────────
  const handleWithdrawTeam = async (matchId: string, teamId: string) => {
    if (!(await confirm(t('teams.confirmWithdrawTeam', { team: teamName(teamId) })))) return;
    const out = await run('withdrawTeam', { competitionId, matchId, teamId, reason: 'abandon' });
    if (out) showToast(t('teams.teamWithdrawnDone', { team: teamName(teamId) }), 'success');
  };

  // Relais en cours affichés avec le compteur de l'écran
  const withDrafts = (list: TeamMatchRow[]) =>
    list.map(m =>
      m.bouts.some(b => drafts[b.id])
        ? {
            ...m,
            bouts: m.bouts.map(b =>
              b.status !== 'finished' && drafts[b.id] ? { ...b, ...drafts[b.id] } : b
            ),
          }
        : m
    );

  // ── Cartons par le moteur (docs/adr/0028) : affichés après sa réponse ─────────
  const cardHandlers: CardHandlers = {
    // Carton E (arène Sabre Laser) ; sans type : escalade du moteur
    onAddTeamCard: (matchId, teamId, type) =>
      void run('giveTeamCard', { competitionId, matchId, teamId, ...(type ? { type } : {}) }).then(
        out => out && showToast(t('teams.cardGiven'), 'success')
      ),
    // Annulation : décision du Directoire technique (t.164, t.172), après confirmation
    onCancelCard: (matchId, cardId, kind) =>
      void (async () => {
        if (!(await confirm(t('teams.confirmCancelCard')))) return;
        const out =
          kind === 'team'
            ? await run('cancelTeamCard', { competitionId, matchId, cardId })
            : await run('cancelRelayCard', { competitionId, matchId, cardId });
        if (out) showToast(t('teams.cardCancelled'), 'success');
      })(),
    // Carton P : relais FIE des armes olympiques seulement, jamais en Sabre Laser (t.124)
    ...(format === 'fie-relay' && hasPassivityCards(competition.weapon)
      ? { onGivePassivityCard: (matchId: string) => void handleGivePassivityCard(matchId) }
      : {}),
  };

  // ── Carton P aux deux équipes : le moteur dit lequel (essai à blanc) ; le noir P décide la
  // rencontre (score cumulé des relais terminés, puis classement) : confirmation d'abord ──
  const handleGivePassivityCard = async (matchId: string) => {
    const input = { competitionId, matchId };
    const preview = await run('givePassivityCard', { ...input, dryRun: true });
    if (!preview) return;
    if (preview.card.type === 'black') {
      const winner = preview.winnerTeamId ? teamName(preview.winnerTeamId) : '—';
      const ok = await confirm({
        message: t('teams.confirmPassivityBlack', { team: winner }),
        confirmLabel: t('teams.passivityBlackConfirm'),
      });
      if (!ok) return;
    }
    const out = await run('givePassivityCard', input);
    if (!out) return;
    if (out.card.type === 'black' && out.winnerTeamId) {
      showToast(t('teams.passivityMatchDecided', { team: teamName(out.winnerTeamId) }), 'warning');
    } else {
      showToast(t('teams.passivityCardGiven'), 'success');
    }
  };

  // ── Envoyer une rencontre sur une arène pour saisie tablette temps réel ──────
  const handleAssignArena = async (matchId: string, arenaId: string) => {
    const result = await remote.setTeamArenaMatch(competition.id, arenaId, matchId, isLaserPoints);
    if (!result.success) {
      showToast(
        ipcErrorText(
          t,
          result,
          "Impossible d'assigner cette rencontre à l'arène (serveur distant démarré ?)."
        ),
        'error'
      );
    }
  };

  // ── Carton individuel : type, points et exclusion décidés par le moteur (escalade sur la
  // rencontre, règlement de l'arme) ; noir : tireur exclu, équipe exclue en armes olympiques ──
  const handleAddCard = async (matchId: string) => {
    if (!cardTarget || !selectedReason) return;
    const bout = allMatches
      .find(m => m.id === matchId)
      ?.bouts.find(b => b.id === cardTarget.boutId);
    if (!bout) return;
    const side = bout.fencerAId === cardTarget.fencerId ? 'A' : 'B';
    const out = await run('giveRelayCard', {
      competitionId,
      matchId,
      relayId: bout.id,
      side,
      reason: selectedReason,
    });
    if (!out) return;
    setCardTarget(null);
    setSelectedReason('');
    if (out.withdrawnTeamId) {
      showToast(t('teams.teamExcludedToast', { team: teamName(out.withdrawnTeamId) }), 'warning');
    } else if (out.fencerWithdrawn) {
      showToast(t('teams.fencerExcludedToast', { name: fencerName(out.card.fencerId) }), 'warning');
    } else {
      showToast(t('teams.cardGiven'), 'success');
    }
  };

  // ── Lookup helpers ────────────────────────────────────────────────────────────
  const fencerById = new Map(fencers.map(f => [f.id, f]));
  const allTeamFencerIds = new Set(teams.flatMap(t => t.fencers.map(f => f.fencerId)));

  const fencerName = (id: string) => {
    const f = fencerById.get(id);
    return f ? `${f.lastName} ${f.firstName ?? ''}`.trim() : id.slice(0, 8);
  };

  // Classement de poule du moteur (relais FIE par victoires, arène par points)
  const teamById = new Map(teams.map(team => [team.id, team]));
  const rankings = poolRanking
    .map(r => ({ ...r, team: teamById.get(r.teamId) }))
    .filter((r): r is typeof r & { team: TeamRow } => !!r.team);
  // Placement affiché du tableau (exempts, cases en attente) : têtes de série du tableau tiré
  // par le moteur, ou, avant le tirage, classement d'entrée coupé par la qualification
  // (teams.tableauSeeds, docs/adr/0044), jamais recalculé ici ; tableau tiré : équipes par
  // emplacement (teams.tableauPlacement, docs/adr/0045)
  const tableauPlacement = placementIds ?? tableauSeeds;
  const bracketSeeding = tableauPlacement.flatMap(id => teamById.get(id) ?? []);
  // Classement final du moteur (docs/adr/0044) : équipes dans l'ordre, rang du moteur
  const finalRows = finalRanking.rows
    .map(r => ({ rank: r.rank, team: teamById.get(r.teamId) }))
    .filter((r): r is { rank: number; team: TeamRow } => !!r.team);
  const finalRankingView = { rows: finalRows, provisional: finalRanking.provisional };

  const canExportPdf =
    (view === 'pool' && matches.length > 0) ||
    (view === 'tableau' && bracketSeeding.length >= 2 && tableauMatches.length > 0) ||
    (view === 'ranking' && finalRows.length > 0);

  const handleExportPdf = async () => {
    try {
      const pdf = await import('../../shared/utils/pdfExport/teamPdf');
      const opts = { title: competition.title, teams, fencerName, isLaserArena };
      if (view === 'pool') await pdf.exportTeamPoolsToPDF(opts, matches);
      else if (view === 'tableau')
        await pdf.exportTeamTableauToPDF(opts, bracketSeeding, tableauMatches);
      // Classement final de l'état (teamFinalRanking du moteur, docs/adr/0044)
      else await pdf.exportTeamRankingToPDF(opts, finalRankingView);
    } catch (e) {
      showToast(`${t('teams.pdfError')} : ${(e as Error).message}`, 'error');
    }
  };

  const handleExportBook = async (order: BookSectionKind[]) => {
    try {
      const pdf = await import('../../shared/utils/pdfExport/teamPdf');
      const opts = { title: competition.title, teams, fencerName, isLaserArena };
      await pdf.exportTeamBookToPDF(
        opts,
        matches,
        bracketSeeding,
        tableauMatches,
        finalRankingView,
        order
      );
    } catch (e) {
      showToast(`${t('teams.pdfError')} : ${(e as Error).message}`, 'error');
    }
  };

  // Résultats pour la fédération (#1949) : classement final, noms d'équipe et licences conservés
  const handleExportFederal = async (kind: 'fff' | 'xml') => {
    try {
      const [fff, xml] = await Promise.all([
        import('../../shared/utils/fencerExport'),
        import('../../shared/utils/multiFormatExport'),
      ]);
      // Classement final lu dans l'état (teamFinalRanking du moteur, docs/adr/0044)
      const results = finalRows.map(r => ({
        rank: r.rank,
        name: r.team.name,
        club: r.team.club,
        fencers: [...r.team.fencers]
          .sort((a, b) => Number(a.isReserve) - Number(b.isReserve) || a.teamOrder - b.teamOrder)
          .map(tf => fencerById.get(tf.fencerId))
          .filter((f): f is Fencer => !!f),
      }));
      const blob =
        kind === 'fff'
          ? new Blob(
              [fff.encodeFFFWin1252(fff.exportTeamResultsToFFF(competition, results)) as BlobPart],
              { type: 'text/plain;charset=windows-1252' }
            )
          : new Blob(
              [xml.exportTeamResultsXMLFFE(competition, results, competition.referees ?? [])],
              { type: 'application/xml' }
            );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resultats_${competition.title.replace(/[^a-z0-9]/gi, '_')}.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const toolbarButtons = (
    <>
      {view === 'teams' && teams.length >= 2 && teamPools && (
        <button
          onClick={handleGeneratePool}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {t('teamManager.generate_pool')}
        </button>
      )}
      {/* Formule d'équipe sans tour de poules : tableau au rang d'entrée (docs/adr/0044) */}
      {view === 'teams' && teams.length >= 2 && !teamPools && (
        <button
          onClick={() => void handleGenerateTableau()}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {t('teams.tableauGenerate', { count: teams.length })}
        </button>
      )}
      {canExportPdf && (
        <button
          onClick={handleExportPdf}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
        >
          ↓ {t('teams.pdfExport')}
        </button>
      )}
      {(matches.length > 0 || finalRows.length > 0) && (
        <button
          onClick={() => setIsBookModalOpen(true)}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
        >
          ↓ {t('teams.pdfBook')}
        </button>
      )}
    </>
  );

  const content = (
    <>
      {/* ── Vue ÉQUIPES ── */}
      {view === 'teams' && (
        <div className="space-y-4">
          {/* Formulaire création */}
          <div className="bg-gray-50 rounded-lg p-4 flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 block mb-1">
                {t('teamManager.team_name')}
              </label>
              <input
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                placeholder={t('teamManager.team_name_ph')}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                onKeyDown={e => e.key === 'Enter' && handleCreateTeam()}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 block mb-1">
                {t('teamManager.club')}
              </label>
              <input
                value={newTeamClub}
                onChange={e => setNewTeamClub(e.target.value)}
                placeholder={t('teamManager.club_ph')}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div className="w-24">
              <label
                htmlFor="new-team-ranking"
                className="text-xs font-medium text-gray-500 block mb-1"
              >
                {t('teamManager.entry_rank')}
              </label>
              <input
                id="new-team-ranking"
                type="number"
                min={1}
                value={newTeamRanking}
                onChange={e => setNewTeamRanking(e.target.value)}
                placeholder={t('teamManager.entry_rank_ph')}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleCreateTeam}
              disabled={creating || !newTeamName.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
            >
              {t('teamManager.create')}
            </button>
          </div>

          {teams.length === 0 && (
            <EmptyState icon={<Icon icon={Users} />} title={t('teamManager.no_team')} />
          )}

          {/* Liste équipes */}
          {teams.map(team => {
            const isEditing = editTeamId === team.id;
            const mainFencers = team.fencers
              .filter(f => !f.isReserve)
              .sort((a, b) => a.teamOrder - b.teamOrder);
            const reserves = team.fencers.filter(f => f.isReserve);
            const valid = mainFencers.length === teamSize;
            const availableFencers = fencers.filter(
              f => !allTeamFencerIds.has(f.id) || team.fencers.some(tf => tf.fencerId === f.id)
            );

            return (
              <div
                key={team.id}
                className={`border rounded-lg overflow-hidden ${valid ? 'border-green-200' : 'border-yellow-300'}`}
              >
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                  <div>
                    <span className="font-semibold text-gray-900">{team.name}</span>
                    <span className="text-sm text-gray-400 ml-2">{team.club}</span>
                    {team.ranking != null && (
                      <span className="ml-2 text-xs text-gray-500">
                        {t('teamManager.entry_rank_badge', { n: team.ranking })}
                      </span>
                    )}
                    {withdrawn[team.id] && (
                      <span className="ml-2 text-xs text-red-600 font-semibold">
                        {t(
                          withdrawn[team.id].reason === 'exclusion'
                            ? 'teams.statusExcluded'
                            : 'teams.statusAbandoned'
                        )}
                      </span>
                    )}
                    {valid ? (
                      <span className="ml-2 text-xs text-green-600 font-medium">
                        {t('teamManager.complete')}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-yellow-600 font-medium">
                        <Icon icon={TriangleAlert} />{' '}
                        {t('plural.fencers_missing', { count: teamSize - mainFencers.length })}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditTeamId(isEditing ? null : team.id);
                        setRankDraft(team.ranking != null ? String(team.ranking) : '');
                      }}
                      className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      {isEditing ? 'Fermer' : 'Gérer'}
                    </button>
                    <button
                      aria-label={t('actions.delete')}
                      onClick={() => handleDeleteTeam(team.id)}
                      className="text-xs px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Tireurs actuels */}
                <div className="px-4 py-2 flex flex-wrap gap-2">
                  {mainFencers.map(f => (
                    <div
                      key={f.fencerId}
                      className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-1 text-xs"
                    >
                      <span className="font-bold text-blue-700">#{f.teamOrder}</span>
                      <span>
                        {f.fencerLastName} {f.fencerFirstName}
                      </span>
                      {isEditing && (
                        <button
                          aria-label={t('actions.remove')}
                          onClick={() =>
                            handleRemoveFencer(team.id, f.fencerId, f.teamOrder, false)
                          }
                          className="text-red-400 hover:text-red-600 ml-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {reserves.map(reserve => (
                    <div
                      key={reserve.fencerId}
                      className="flex items-center gap-1 bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs"
                    >
                      <span className="text-gray-500">{t('teamManager.reserve_short')}</span>
                      <span>
                        {reserve.fencerLastName} {reserve.fencerFirstName}
                      </span>
                      {isEditing && (
                        <button
                          aria-label={t('actions.remove')}
                          onClick={() =>
                            handleRemoveFencer(team.id, reserve.fencerId, reserve.teamOrder, true)
                          }
                          className="text-red-400 hover:text-red-600 ml-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {team.fencers.length === 0 && (
                    <span className="text-xs text-gray-400 italic">
                      {t('teamManager.no_fencer')}
                    </span>
                  )}
                </div>

                {/* Formulaire affectation */}
                {isEditing && (
                  <div className="px-4 py-3 bg-blue-50 border-t border-blue-100 flex gap-3 items-end flex-wrap">
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">
                        {t('teamManager.fencer')}
                      </label>
                      <select
                        value={selectedFencerId}
                        onChange={e => setSelectedFencerId(e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">{t('teamManager.select')}</option>
                        {availableFencers.map(f => (
                          <option key={f.id} value={f.id}>
                            {f.lastName} {f.firstName ?? ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">
                        {t('teamManager.position')}
                      </label>
                      <select
                        value={selectedOrder}
                        onChange={e => setSelectedOrder(Number(e.target.value))}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                      >
                        {Array.from({ length: teamSize }, (_, i) => i + 1).map(n => (
                          <option key={n} value={n}>
                            #{n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`res-${team.id}`}
                        checked={selectedIsReserve}
                        disabled={
                          reserves.length >= reserveCount &&
                          !reserves.some(r => r.fencerId === selectedFencerId)
                        }
                        onChange={e => setSelectedIsReserve(e.target.checked)}
                      />
                      <label htmlFor={`res-${team.id}`} className="text-sm text-gray-600">
                        {t('teamManager.reserve_max', { n: reserveCount })}
                      </label>
                    </div>
                    <div>
                      <label
                        htmlFor={`rank-${team.id}`}
                        className="text-xs text-gray-600 block mb-1"
                      >
                        {t('teamManager.entry_rank')}
                      </label>
                      <input
                        id={`rank-${team.id}`}
                        type="number"
                        min={1}
                        value={rankDraft}
                        onChange={e => setRankDraft(e.target.value)}
                        placeholder={t('teamManager.entry_rank_ph')}
                        className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm"
                      />
                      <button
                        onClick={() => void handleSaveRanking(team.id)}
                        className="ml-1 px-2 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        {t('teamManager.entry_rank_save')}
                      </button>
                    </div>
                    <button
                      onClick={handleUpsertFencer}
                      disabled={
                        !selectedFencerId ||
                        (selectedIsReserve &&
                          reserves.length >= reserveCount &&
                          !reserves.some(r => r.fencerId === selectedFencerId))
                      }
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40"
                    >
                      {t('teamManager.assign')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Vue POULE ── */}
      {view === 'pool' && (
        <TeamPoolView
          teams={teams}
          matches={withDrafts(matches)}
          weapon={competition.weapon}
          targetRule={targetRule}
          isEpee={isEpee}
          isLaserPoints={isLaserPoints}
          fencerName={fencerName}
          scoringMatchId={scoringMatchId}
          onToggleScoring={id => setScoringMatchId(scoringMatchId === id ? null : id)}
          onScoreBout={handleScoreBout}
          relay={relayHandlers}
          boutCards={relayCards}
          cardTarget={cardTarget}
          onSetCardTarget={setCardTarget}
          selectedReason={selectedReason}
          onSelectReason={setSelectedReason}
          onAddCard={handleAddCard}
          emptyLabel={t('teamManager.no_pool_match')}
          isLaserArena={isLaserArena}
          boutCap={boutCap}
          matchCards={teamCards}
          passivityCards={passivityCards}
          cards={cardHandlers}
          withdrawn={withdrawn}
          onAssignArena={handleAssignArena}
        />
      )}

      {/* ── Vue TABLEAU ── */}
      {view === 'tableau' && tableauMatches.length > 0 && (
        <TableauDrawPanel
          competitionId={competitionId}
          competition={{
            title: competition.title,
            date: competition.date ? new Date(competition.date).toLocaleDateString() : null,
            weapon: competition.weapon,
          }}
          group={null}
          size={calculateTableSize(bracketSeeding.length)}
          entrants={teamDrawEntries(teams, teamSize, id => fencerById.get(id)?.ranking ?? null).map(
            e => ({
              ...e,
              name: teamById.get(e.id)?.name ?? e.id,
              affiliation: teamById.get(e.id)?.club ?? null,
            })
          )}
          emplacements={Object.fromEntries(tableauPlacement.map((id, k) => [id, k + 1]))}
          byEntryRank={!!teamFormula && !teamPools}
          refreshKey={tableauMatches}
        />
      )}
      {view === 'tableau' && (
        <TeamTableauView
          teams={teams}
          rankedTeams={bracketSeeding}
          tableauMatches={withDrafts(tableauMatches)}
          weapon={competition.weapon}
          targetRule={targetRule}
          isEpee={isEpee}
          isLaserPoints={isLaserPoints}
          fencerName={fencerName}
          scoringMatchId={scoringMatchId}
          onToggleScoring={id => setScoringMatchId(scoringMatchId === id ? null : id)}
          onScoreBout={handleScoreBout}
          relay={relayHandlers}
          boutCards={relayCards}
          cardTarget={cardTarget}
          onSetCardTarget={setCardTarget}
          selectedReason={selectedReason}
          onSelectReason={setSelectedReason}
          onAddCard={handleAddCard}
          onGenerate={() => void handleGenerateTableau()}
          isLaserArena={isLaserArena}
          boutCap={boutCap}
          matchCards={teamCards}
          passivityCards={passivityCards}
          cards={cardHandlers}
          withdrawn={withdrawn}
          onAssignArena={handleAssignArena}
        />
      )}

      {/* ── Vue CLASSEMENT ── */}
      {view === 'ranking' && isLaserArena && (
        <div>
          {rankings.length > 0 && (
            <div className="team-manager-view-1">
              <Button
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}
                onClick={() => {
                  const header = 'Rang,Équipe,Club,V,D,Points+,Points-,Ratio,Égalité\n';
                  const rows = rankings
                    .map((r, i) =>
                      [
                        i + 1,
                        `"${r.team.name}"`,
                        `"${r.team.club ?? ''}"`,
                        r.victories,
                        r.defeats,
                        r.pointsFor,
                        r.pointsAgainst,
                        r.pointsAgainst === 0
                          ? r.pointsFor
                          : (r.pointsFor / r.pointsAgainst).toFixed(2),
                        r.tied ? 'oui' : '',
                      ].join(',')
                    )
                    .join('\n');
                  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'classement-equipes.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                {t('teamManager.export_csv')}
              </Button>
            </div>
          )}
          {rankings.length === 0 ? (
            <div className="text-center text-gray-400 py-10">{t('teamManager.no_match')}</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center w-8">
                    #
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-left">
                    {t('teamManager.team')}
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">
                    V
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">
                    D
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center"
                    title={t('teamManager.points_plus_title')}
                  >
                    {t('teamManager.points_plus')}
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">
                    {t('teamManager.points_minus')}
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center"
                    title={t('teamManager.ratio_title')}
                  >
                    {t('teamManager.ratio')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rankings.map((r, i) => (
                  <tr
                    key={r.team.id}
                    className={i === 0 ? 'bg-yellow-50' : 'hover:bg-gray-50'}
                    title={
                      r.tied
                        ? 'Égalité totale avec une équipe voisine — à départager par tirage au sort'
                        : undefined
                    }
                  >
                    <td className="px-3 py-2 text-center font-bold text-gray-400">
                      {i + 1}
                      {r.tied && (
                        <span className="text-yellow-500 ml-1">
                          <Icon icon={TriangleAlert} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-900">
                      {r.team.name}
                      <span className="text-xs text-gray-400 font-normal ml-2">{r.team.club}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-green-700 font-bold">
                      {r.victories}
                    </td>
                    <td className="px-3 py-2 text-center text-red-500">{r.defeats}</td>
                    <td className="px-3 py-2 text-center font-mono font-bold">{r.pointsFor}</td>
                    <td className="px-3 py-2 text-center font-mono text-gray-400">
                      {r.pointsAgainst}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {r.pointsAgainst === 0
                        ? r.pointsFor
                        : (r.pointsFor / r.pointsAgainst).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {view === 'ranking' && !isLaserArena && (
        <div>
          {(rankings.length > 0 || finalRows.length > 0) && (
            <div className="team-manager-view-1">
              {rankings.length > 0 && (
                <Button
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}
                  onClick={() => {
                    const header = 'Rang,Équipe,Club,V,D,RelaisG,RelaisP,Ind.,Touches+,Touches-\n';
                    const rows = rankings
                      .map((r, i) =>
                        [
                          i + 1,
                          `"${r.team.name}"`,
                          `"${r.team.club ?? ''}"`,
                          r.victories,
                          r.defeats,
                          r.relaysWon,
                          r.relaysLost,
                          r.relaysWon - r.relaysLost,
                          r.pointsFor,
                          r.pointsAgainst,
                        ].join(',')
                      )
                      .join('\n');
                    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'classement-equipes.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t('teamManager.export_csv')}
                </Button>
              )}
              {/* Résultats fédéraux : classement final de l'état, aussi sans poule (docs/adr/0044) */}
              {finalRows.length > 0 && (
                <>
                  <Button
                    className="team-manager-export-btn"
                    onClick={() => void handleExportFederal('xml')}
                  >
                    {t('results.export_xml_ffe')}
                  </Button>
                  <Button
                    className="team-manager-export-btn"
                    onClick={() => void handleExportFederal('fff')}
                  >
                    {t('results.export_fff')}
                  </Button>
                </>
              )}
            </div>
          )}
          {rankings.length === 0 ? (
            <div className="text-center text-gray-400 py-10">{t('teamManager.no_match')}</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center w-8">
                    #
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-left">
                    {t('teamManager.team')}
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">
                    V
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">
                    D
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center"
                    title={t('teams.relaysTooltip')}
                  >
                    {t('teams.relaysWon')}
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center"
                    title={t('teams.relaysTooltip')}
                  >
                    {t('teams.relaysLost')}
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">
                    {t('teamManager.ind')}
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center"
                    title={t('teamManager.fie_title')}
                  >
                    {t('teamManager.touches_plus')}
                  </th>
                  <th
                    className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center"
                    title={t('teamManager.fie_title')}
                  >
                    {t('teamManager.touches_minus')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rankings.map((r, i) => (
                  <tr key={r.team.id} className={i === 0 ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-2 text-center font-bold text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold text-gray-900">
                      {r.team.name}
                      <span className="text-xs text-gray-400 font-normal ml-2">{r.team.club}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-green-700 font-bold">
                      {r.victories}
                    </td>
                    <td className="px-3 py-2 text-center text-red-500">{r.defeats}</td>
                    <td className="px-3 py-2 text-center">{r.relaysWon}</td>
                    <td className="px-3 py-2 text-center">{r.relaysLost}</td>
                    <td
                      className={`px-3 py-2 text-center font-bold ${r.relaysWon - r.relaysLost >= 0 ? 'text-green-600' : 'text-red-500'}`}
                    >
                      {r.relaysWon - r.relaysLost > 0 ? '+' : ''}
                      {r.relaysWon - r.relaysLost}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">{r.pointsFor}</td>
                    <td className="px-3 py-2 text-center font-mono text-gray-400">
                      {r.pointsAgainst}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* Classement final du moteur (teamFinalRanking, docs/adr/0044) */}
      {view === 'ranking' && !isLaserArena && tableauMatches.length > 0 && finalRows.length > 0 && (
        <section className="mt-4" aria-label={t('results.final_ranking')}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {t('results.final_ranking')}
            {finalRanking.provisional && (
              <span className="ml-2 text-xs text-gray-400 font-normal">
                {t('teamManager.final_ranking_provisional')}
              </span>
            )}
          </h3>
          <table className="min-w-full text-sm" data-testid="team-final-ranking">
            <tbody className="divide-y divide-gray-100">
              {finalRows.map(r => (
                <tr key={r.team.id}>
                  <td className="px-3 py-2 text-center font-bold text-gray-400 w-8">{r.rank}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">
                    {r.team.name}
                    <span className="text-xs text-gray-400 font-normal ml-2">{r.team.club}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {/* Équipes retirées (o.99.7.a, « N'a pas terminé ») ou exclues (o.99.7.b, sans rang) */}
      {view === 'ranking' && Object.keys(withdrawn).length > 0 && (
        <ul className="mt-3 text-sm space-y-1" aria-label={t('teams.withdrawnTitle')}>
          {Object.values(withdrawn).map(w => (
            <li key={w.teamId} className="flex gap-2 px-3">
              <span className="font-bold text-gray-400 w-8 text-center">—</span>
              <span className="font-semibold text-gray-900">{teamName(w.teamId)}</span>
              <span className="text-red-600 font-medium">
                {t(w.reason === 'exclusion' ? 'teams.statusExcluded' : 'teams.statusAbandoned')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (loading) return <div className="content text-gray-400">{t('teams.loading')}</div>;

  return (
    <div className="content">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {competition.title} · {t('teams.teamCount', { count: teams.length })}
        </p>
        <div className="flex items-center gap-2">{toolbarButtons}</div>
      </div>
      {content}
      {isBookModalOpen && (
        <BookSectionsModal
          kinds={TEAM_BOOK_SECTION_KINDS}
          onClose={() => setIsBookModalOpen(false)}
          onConfirm={order => {
            setIsBookModalOpen(false);
            void handleExportBook(order);
          }}
        />
      )}
    </div>
  );
};
