/**
 * BPM - Escrime - Tirage d'un tableau tiré : mode et graine, PV de tirage imprimable
 * (docs/adr/0045). Le tirage est lu dans l'état du moteur (getCompetitionState : tableau unique,
 * tableau d'un groupe ou tableau d'équipes), jamais calculé ici. Le PV est construit par le
 * domaine (tableauDrawReport) et imprimé par les services de plateforme (ADR-0021).
 * Licensed under GPL-3.0
 */
import React, { useEffect, useState } from 'react';
import { useBpmClient } from '../../api/BpmClientContext';
import { usePlatform } from '../../platform/PlatformContext';
import { useTranslation } from '../../hooks/useTranslation';
import { useToast } from '../Toast';
import { Button } from '../common/Button';
import {
  tableauDrawStateOf,
  type TableauDrawMode,
  type TableauDrawState,
} from '../../../shared/domain/tableau/tableauDraw';
import {
  tableauDrawReport,
  type TableauDrawEntrant,
} from '../../../shared/domain/tableau/tableauDrawReport';
import { generateTableauDrawReportHTML } from '../../../shared/utils/pdfExport/tableauDrawPdf';

export interface TableauDrawPanelProps {
  competitionId: string;
  competition: { title: string; date?: string | null; weapon?: string };
  /** Groupe d'un tableau séparé ; null : tableau unique ou tableau d'équipes */
  group: string | null;
  /** Taille du tableau tiré */
  size: number;
  /** Inscrits du tableau (tireurs ou équipes) */
  entrants: readonly TableauDrawEntrant[];
  /** Emplacement de chaque qualifié dans la grille du tableau tiré */
  emplacements: Readonly<Record<string, number>>;
  /** Tableau au rang d'entrée (sans poule) : mentions du PV */
  byEntryRank: boolean;
  /** Relecture du tirage quand le tableau change (identité des matchs) */
  refreshKey: unknown;
}

const MODE_KEYS: Record<TableauDrawMode, string> = {
  strict: 'tableauDraw.mode_strict',
  pairs: 'tableauDraw.mode_pairs',
  groups: 'tableauDraw.mode_groups',
  random: 'tableauDraw.mode_random',
};

/** Tirage du tableau visé, lu dans l'état de l'épreuve */
function drawOf(state: unknown, group: string | null): TableauDrawState | null {
  const s = (state ?? {}) as {
    tableauDraw?: unknown;
    groupTableaux?: Record<string, { tableauDraw?: unknown }>;
  };
  return tableauDrawStateOf(group ? s.groupTableaux?.[group]?.tableauDraw : s.tableauDraw);
}

export const TableauDrawPanel: React.FC<TableauDrawPanelProps> = ({
  competitionId,
  competition,
  group,
  size,
  entrants,
  emplacements,
  byEntryRank,
  refreshKey,
}) => {
  const client = useBpmClient();
  const platform = usePlatform();
  const { t, language } = useTranslation();
  const { showToast } = useToast();
  const [draw, setDraw] = useState<TableauDrawState | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const out = await client.query('getCompetitionState', { competitionId });
        if (alive) setDraw(drawOf(out?.state, group));
      } catch {
        if (alive) setDraw(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, competitionId, group, refreshKey]);

  if (!draw) return null;

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(language);
  };

  const print = async () => {
    try {
      const report = tableauDrawReport(
        { competition, size, group, draw, entrants, emplacements, byEntryRank },
        new Date()
      );
      const html = generateTableauDrawReportHTML(report, {
        title: t('tableauDraw.pv_title'),
        competition: t('tableauDraw.pv_competition'),
        date: t('tableauDraw.pv_date'),
        tableau: t('tableauDraw.pv_size'),
        group: t('tableauDraw.pv_group'),
        drawnAt: t('tableauDraw.pv_drawn_at'),
        printedAt: t('tableauDraw.pv_printed_at'),
        mode: t('tableauDraw.mode'),
        seed: t('tableauDraw.seed'),
        modes: {
          strict: t(MODE_KEYS.strict),
          pairs: t(MODE_KEYS.pairs),
          groups: t(MODE_KEYS.groups),
          random: t(MODE_KEYS.random),
        },
        rank: t('tableauDraw.pv_rank'),
        name: t('tableauDraw.pv_name'),
        affiliation: t('tableauDraw.pv_affiliation'),
        emplacement: t('tableauDraw.pv_emplacement'),
        note: t('tableauDraw.pv_note'),
        unranked: t('tableauDraw.note_unranked'),
        tie: t('tableauDraw.note_tie'),
        formatDateTime,
      });
      await platform.print(html);
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  return (
    <div className="tableau-draw" role="status" data-testid="tableau-draw">
      <span>
        {t('tableauDraw.mode')} :{' '}
        <strong data-testid="tableau-draw-mode">{t(MODE_KEYS[draw.mode])}</strong>
      </span>
      <span>
        {t('tableauDraw.seed')} : <strong data-testid="tableau-draw-seed">{draw.seed}</strong>
      </span>
      <Button size="sm" onClick={() => void print()} data-testid="tableau-draw-print">
        {t('tableauDraw.print')}
      </Button>
    </div>
  );
};
