/**
 * BPM - Escrime - Tableaux de l'épreuve vus par les commandes (docs/adr/0024, lot A1)
 * Une épreuve a un tableau unique (racine de session_state), ou, avec des tableaux séparés
 * après les poules (postPoolSplitCriteria), un tableau par groupe dans
 * session_state.groupTableaux. Les commandes du tableau (score, annulation, retrait,
 * affectation, reconstruction) travaillent sur « le tableau qui contient le match » et
 * réécrivent ce tableau seul.
 *
 * Reprise des épreuves en cours : un tableau tiré à la racine d'une épreuve à tableaux séparés
 * (avant le lot A1, par l'écran) est le tableau du groupe de ses tireurs, identifiants
 * inchangés. Lu comme tel (getCompetitionState), il quitte la racine pour groupTableaux à sa
 * première réécriture par une commande (lot A2 : l'écran n'écrit plus l'état).
 * Licensed under GPL-3.0
 */
import type { Competition } from '../../../shared/types';
import type {
  ConsolationBracket,
  FinalResult,
  TableauMatch,
} from '../../../shared/domain/tableau/tableauTypes';
import {
  legacyTableauGroup,
  planSplitGroups,
  sessionGroupTableaux,
  type GroupTableau,
} from '../../../shared/domain/ranking/splitGroups';
import type { PoolRanking } from '../../../shared/types';
import {
  tableauDrawStateOf,
  type TableauDrawState,
} from '../../../shared/domain/tableau/tableauDraw';

export interface TableauSlot {
  /** Groupe du tableau ; null : tableau unique */
  group: string | null;
  /** Rangé à la racine de l'état : tableau unique, ou tableau repris d'avant les groupes */
  atRoot: boolean;
  matches: TableauMatch[];
  brackets: ConsolationBracket[];
  finalResults: FinalResult[];
  /** Tirage du tableau (docs/adr/0045) ; null : pas de tirage enregistré */
  draw: TableauDrawState | null;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const splitCriteria = (comp: Competition): string | undefined =>
  comp.settings?.postPoolSplitCriteria;

const rootSlot = (session: Record<string, unknown>, group: string | null): TableauSlot => ({
  group,
  atRoot: true,
  matches: list<TableauMatch>(session.tableauMatches),
  brackets: list<ConsolationBracket>(session.consolationBrackets),
  finalResults: list<FinalResult>(session.finalResults),
  draw: tableauDrawStateOf(session.tableauDraw),
});

/** Tableaux de l'épreuve : le tableau unique, ou ceux des groupes (tableau repris compris) */
export function tableauSlots(comp: Competition, session: Record<string, unknown>): TableauSlot[] {
  const criteria = splitCriteria(comp);
  if (!criteria) return [rootSlot(session, null)];
  const groups = sessionGroupTableaux(session);
  const slots: TableauSlot[] = Object.entries(groups).map(([group, t]) => ({
    group,
    atRoot: false,
    matches: t.tableauMatches,
    brackets: t.consolationBrackets,
    finalResults: t.finalResults,
    draw: t.tableauDraw ?? null,
  }));
  const root = rootSlot(session, null);
  if (root.matches.length > 0) {
    const group = legacyTableauGroup(root.matches, criteria);
    if (!group || !groups[group]) slots.push({ ...root, group });
  }
  return slots;
}

/** Tableau d'un groupe (vide s'il n'est pas tiré) ; null : tableau unique */
export function slotOfGroup(
  comp: Competition,
  session: Record<string, unknown>,
  group: string | null
): TableauSlot {
  const found = tableauSlots(comp, session).find(s => s.group === group);
  if (found) return found;
  return group === null
    ? rootSlot({}, null)
    : { group, atRoot: false, matches: [], brackets: [], finalResults: [], draw: null };
}

const hasMatch = (s: TableauSlot, matchId: string) =>
  s.matches.some(m => m.id === matchId) ||
  s.brackets.some(b => b.matches.some(m => m.id === matchId));

/** Tableau qui contient le match (tableau principal ou tableau de classement) */
export function slotOfMatch(
  comp: Competition,
  session: Record<string, unknown>,
  matchId: string
): TableauSlot | null {
  return tableauSlots(comp, session).find(s => hasMatch(s, matchId)) ?? null;
}

const touches = (m: TableauMatch, fencerId: string) =>
  m.fencerA?.id === fencerId || m.fencerB?.id === fencerId;

/**
 * Tableau du tireur (ADR-0024 §3 : le retrait s'applique au tableau du groupe du tireur).
 * Tireur absent des tableaux : le premier tableau tiré, sinon un tableau vide.
 */
export function slotOfFencer(
  comp: Competition,
  session: Record<string, unknown>,
  fencerId: string
): TableauSlot {
  const slots = tableauSlots(comp, session).filter(s => s.matches.length > 0);
  return (
    slots.find(
      s =>
        s.matches.some(m => touches(m, fencerId)) ||
        s.brackets.some(b => b.matches.some(m => touches(m, fencerId)))
    ) ??
    slots[0] ??
    rootSlot({}, null)
  );
}

/** Copie modifiable d'un tableau (matchs et tableaux de classement) */
export function cloneSlot(slot: TableauSlot): TableauSlot {
  return {
    ...slot,
    matches: slot.matches.map(m => ({ ...m })),
    brackets: slot.brackets.map(b => ({ ...b, matches: b.matches.map(m => ({ ...m })) })),
  };
}

/**
 * Fusion à écrire dans l'état de session pour un tableau réécrit (writeSession). Un tableau
 * de groupe réécrit ne touche pas les autres groupes.
 */
export function slotPatch(
  session: Record<string, unknown>,
  slot: Pick<TableauSlot, 'group' | 'atRoot'>,
  /** `tableauDraw: null` : tirage effacé avec le tableau (docs/adr/0045) */
  next: Partial<Omit<GroupTableau, 'tableauDraw'>> & { tableauDraw?: TableauDrawState | null }
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  if (next.tableauMatches) root.tableauMatches = next.tableauMatches;
  if (next.consolationBrackets) root.consolationBrackets = next.consolationBrackets;
  if (next.finalResults) root.finalResults = next.finalResults;
  if (next.tableauDraw !== undefined) root.tableauDraw = next.tableauDraw ?? undefined;
  if (slot.group === null) return root;
  const groups = sessionGroupTableaux(session);
  const withDraw = (t: GroupTableau): GroupTableau => {
    const { tableauDraw: _drop, ...rest } = t;
    if (next.tableauDraw === undefined) return t;
    return next.tableauDraw ? { ...rest, tableauDraw: next.tableauDraw } : rest;
  };
  const { tableauDraw: _draw, ...tables } = next;
  if (slot.atRoot) {
    // Tableau repris (lot A2) : déplacé dans son groupe, identifiants inchangés ; racine vidée
    const legacy = rootSlot(session, slot.group);
    const moved: GroupTableau = withDraw({
      tableauMatches: legacy.matches,
      consolationBrackets: legacy.brackets,
      finalResults: legacy.finalResults,
      ...(legacy.draw ? { tableauDraw: legacy.draw } : {}),
      ...tables,
    });
    return {
      tableauMatches: [],
      consolationBrackets: [],
      finalResults: [],
      tableauDraw: undefined,
      groupTableaux: { ...groups, [slot.group]: moved },
    };
  }
  const current = groups[slot.group] ?? {
    tableauMatches: [],
    consolationBrackets: [],
    finalResults: [],
  };
  return { groupTableaux: { ...groups, [slot.group]: withDraw({ ...current, ...tables }) } };
}

/**
 * Tableaux des groupes tels que l'écran les lit (getCompetitionState) : groupTableaux, plus le
 * tableau repris de la racine rangé sous son groupe. null : épreuve sans tableaux séparés.
 */
export function groupTableauxView(
  comp: Competition,
  session: Record<string, unknown>
): Record<string, GroupTableau> | null {
  if (!splitCriteria(comp)) return null;
  const out: Record<string, GroupTableau> = {};
  for (const s of tableauSlots(comp, session)) {
    if (s.group === null) continue;
    out[s.group] = {
      tableauMatches: s.matches,
      consolationBrackets: s.brackets,
      finalResults: s.finalResults,
      ...(s.draw ? { tableauDraw: s.draw } : {}),
    };
  }
  return out;
}

/** Groupes à tirer après les poules (tireurs du classement, groupes extraits écartés) */
export function splitGroups(comp: Competition, session: Record<string, unknown>): string[] {
  return planSplitGroups(
    list<PoolRanking>(session.overallRanking),
    splitCriteria(comp),
    comp.settings?.splitOffCompetitionIds
  ).map(p => p.group);
}

/**
 * Épreuve terminée après l'écriture du tableau : tableau unique terminé, ou, avec des
 * tableaux séparés, chaque groupe restant tiré et terminé.
 */
export function allTableauxDone(
  comp: Competition,
  session: Record<string, unknown>,
  patch: Record<string, unknown>,
  done: boolean
): boolean {
  if (!splitCriteria(comp)) return done;
  const next = { ...session, ...patch };
  const slots = tableauSlots(comp, next);
  return splitGroups(comp, next).every(g =>
    slots.some(s => s.group === g && s.finalResults.length > 0)
  );
}
