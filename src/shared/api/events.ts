/**
 * BPM - Escrime - Événements du journal d'une épreuve (#1980, docs/adr/0007)
 * Un événement est un fait accompli, nommé au passé ; sa charge porte des identifiants,
 * jamais de nom (RGPD). Types et charges sont déclarés ICI, une fois, en union zod :
 * le moteur écrit ces types, le contrat les expose, les clients les lisent.
 * Évolution d'une charge : incrémenter schemaVersion et ajouter un membre ; un événement
 * stocké ne se réécrit jamais.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';

const Id = z.string();
/** Groupe d'un tableau séparé après les poules (aujourd'hui le sexe : « F », « M ») */
const Group = z.string();
const SpecialStatus = z.enum(['abandon', 'forfait', 'exclusion']);
/** Carton E (arène Sabre Laser), table team_match_cards */
const TeamCardType = z.enum(['white', 'yellow', 'red', 'black']);
/** Carton individuel (CardType) */
const RelayCardType = z.enum(['WHITE', 'YELLOW', 'RED', 'BLACK']);
/**
 * Tirage d'un tableau (docs/adr/0045) : mode, graine, identifiants dans l'ordre d'entrée tiré.
 * Absent : tableau tiré avant (placement strict, ordre du placement)
 */
export const TableauDrawPayload = z.object({
  mode: z.enum(['strict', 'pairs', 'groups', 'random']),
  seed: z.number().int().min(0).max(0xffffffff),
  order: z.array(Id),
});

/** Types d'événements écrits par le moteur */
export const JOURNAL_EVENT = {
  fencerCheckedIn: 'FencerCheckedIn',
  fencerCheckedOut: 'FencerCheckedOut',
  scoreRecorded: 'ScoreRecorded',
  poolCompleted: 'PoolCompleted',
  tableauMatchDecided: 'TableauMatchDecided',
  tableauCompleted: 'TableauCompleted',
  fencerWithdrawn: 'FencerWithdrawn',
  fencerReinstated: 'FencerReinstated',
  poolsGenerated: 'PoolsGenerated',
  poolFencerAdded: 'PoolFencerAdded',
  poolRoundClosed: 'PoolRoundClosed',
  tableauStageClosed: 'TableauStageClosed',
  tableauGenerated: 'TableauGenerated',
  // Tour en vagues (docs/adr/0043, F4a) ; les anciens noms Rapieres* restent lus au rejeu
  poolWaveLaunched: 'PoolWaveLaunched',
  poolWavesEnded: 'PoolWavesEnded',
  rapieresWaveLaunched: 'RapieresWaveLaunched',
  rapieresWavesEnded: 'RapieresWavesEnded',
  scoreCleared: 'ScoreCleared',
  rankingAdjusted: 'RankingAdjusted',
  poolsSkipped: 'PoolsSkipped',
  tableauCleared: 'TableauCleared',
  rapieresTeamsUpdated: 'RapieresTeamsUpdated',
  groupSplitOff: 'GroupSplitOff',
  splitRankingImported: 'SplitRankingImported',
  teamPoolsGenerated: 'TeamPoolsGenerated',
  teamMatchScheduled: 'TeamMatchScheduled',
  teamTableauGenerated: 'TeamTableauGenerated',
  relayScoreRecorded: 'RelayScoreRecorded',
  relayReopened: 'RelayReopened',
  teamMatchDecided: 'TeamMatchDecided',
  teamFencerSubstituted: 'TeamFencerSubstituted',
  teamCardGiven: 'TeamCardGiven',
  relayCardGiven: 'RelayCardGiven',
  passivityCardGiven: 'PassivityCardGiven',
  teamCardCancelled: 'TeamCardCancelled',
  relayCardCancelled: 'RelayCardCancelled',
  teamWithdrawn: 'TeamWithdrawn',
  stripStartChanged: 'StripStartChanged',
  stripAvailabilityChanged: 'StripAvailabilityChanged',
} as const;

const member = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), schemaVersion: z.literal(1), payload });

/** Charge typée par type d'événement (schemaVersion 1) */
export const JournalEventBodySchema = z.discriminatedUnion('type', [
  member(JOURNAL_EVENT.fencerCheckedIn, z.object({ fencerId: Id })),
  member(JOURNAL_EVENT.fencerCheckedOut, z.object({ fencerId: Id })),
  member(
    JOURNAL_EVENT.scoreRecorded,
    z.object({
      matchId: Id,
      /** Match de poule ; absent au tableau */
      poolId: Id.optional(),
      scoreA: z.number(),
      scoreB: z.number(),
      winnerId: Id.nullable(),
      specialStatus: SpecialStatus.optional(),
      /** Tireur sanctionné par le statut spécial */
      fencerId: Id.nullable().optional(),
      /** Correction après tirage du tableau (#1996) : motif, tableau retiré ou gardé */
      correction: z.object({ reason: z.string(), rebuildTableau: z.boolean() }).optional(),
    })
  ),
  member(JOURNAL_EVENT.poolCompleted, z.object({ poolId: Id })),
  member(JOURNAL_EVENT.tableauMatchDecided, z.object({ matchId: Id, winnerId: Id })),
  // Tableaux séparés après les poules (docs/adr/0024) : group absent = tableau unique
  member(JOURNAL_EVENT.tableauCompleted, z.object({ group: Group.optional() })),
  // Retrait et réintégration d'un tireur (docs/adr/0016)
  member(
    JOURNAL_EVENT.fencerWithdrawn,
    z.object({
      fencerId: Id,
      reason: SpecialStatus,
      /** Exclusion sur carton noir (motif du rapport fédéral) */
      blackCard: z.boolean(),
      /** Match où le retrait a lieu ; null pour un retrait décidé à l'appel */
      matchId: Id.nullable(),
      /** Matchs perdus par le retrait */
      forfeitedMatchIds: z.array(Id),
    })
  ),
  // Tirage des poules (docs/adr/0017) : composition complète, rejouable sans graine
  member(
    JOURNAL_EVENT.poolsGenerated,
    z.object({
      round: z.number().int(),
      pools: z.array(
        z.object({
          poolId: Id,
          number: z.number().int(),
          strip: z.number().int().nullable(),
          fencerIds: z.array(Id),
          /** Ordre des matchs */
          matches: z.array(z.object({ matchId: Id, fencerAId: Id, fencerBId: Id })),
        })
      ),
    })
  ),
  // Tireur ajouté à une poule lancée : ses matchs, dans l'ordre (docs/adr/0017)
  member(
    JOURNAL_EVENT.poolFencerAdded,
    z.object({
      poolId: Id,
      fencerId: Id,
      matches: z.array(z.object({ matchId: Id, fencerAId: Id, fencerBId: Id })),
    })
  ),
  // Clôture d'un tour de poules : qualifiés (dans l'ordre, seed du tour suivant), éliminés
  member(
    JOURNAL_EVENT.poolRoundClosed,
    z.object({
      round: z.number().int(),
      qualifierCount: z.number().int().nullable(),
      qualifiedIds: z.array(Id),
      eliminatedIds: z.array(Id),
    })
  ),
  // Tableau arrêté à N (docs/adr/0037) : restants par rang d'entrée, éliminés classés (Q5)
  member(
    JOURNAL_EVENT.tableauStageClosed,
    z.object({
      stopAt: z.number().int(),
      qualifiedIds: z.array(Id),
      eliminatedIds: z.array(Id),
    })
  ),
  // Tableau généré : placement complet (barrages, exemptions, rangs de sortie de poules) ;
  // tirage (mode, graine, ordre d'entrée tiré, docs/adr/0045)
  member(
    JOURNAL_EVENT.tableauGenerated,
    z.object({
      /** Tableaux séparés : groupe du tableau (docs/adr/0024) ; absent = tableau unique */
      group: Group.optional(),
      size: z.number().int(),
      thirdPlaceMatch: z.boolean(),
      playAllPositions: z.boolean(),
      /** Tournoi des rapières : mode de tableau (#1441) */
      rapieresTableauMode: z.enum(['normal', 'third', 'all', 'semis']).optional(),
      matches: z.array(
        z.object({
          matchId: Id,
          round: z.number().int(),
          position: z.number().int(),
          fencerAId: Id.nullable(),
          fencerBId: Id.nullable(),
          isBye: z.boolean(),
          seedA: z.number().nullable(),
          seedB: z.number().nullable(),
        })
      ),
      draw: TableauDrawPayload.optional(),
    })
  ),
  // Tour en vagues : vague lancée (0 = aucune), vagues arrêtées ou reprises (docs/adr/0043)
  member(
    JOURNAL_EVENT.poolWaveLaunched,
    z.object({ wave: z.number().int(), matchIds: z.array(Id) })
  ),
  member(JOURNAL_EVENT.poolWavesEnded, z.object({ ended: z.boolean() })),
  // Anciens événements des rapières : plus écrits, toujours lus au rejeu des épreuves enregistrées (docs/adr/0043, F4e)
  member(
    JOURNAL_EVENT.rapieresWaveLaunched,
    z.object({ wave: z.number().int(), matchIds: z.array(Id) })
  ),
  member(JOURNAL_EVENT.rapieresWavesEnded, z.object({ ended: z.boolean() })),
  // Score annulé : match de poule remis à jouer, ou match de tableau rouvert
  member(JOURNAL_EVENT.scoreCleared, z.object({ matchId: Id, poolId: Id.optional() })),
  // Classement ajusté par le DT (ou recalculé) ; épreuve sans poules ; tableau retiré
  member(
    JOURNAL_EVENT.rankingAdjusted,
    z.object({
      ranking: z.array(
        z.object({ fencerId: Id, rank: z.number().int(), questPoints: z.number().nullable() })
      ),
    })
  ),
  member(JOURNAL_EVENT.poolsSkipped, z.object({ fencerIds: z.array(Id) })),
  member(JOURNAL_EVENT.tableauCleared, z.object({ group: Group.optional() })),
  // Composition des équipes des rapières : identifiants seulement (RGPD), non rejouable
  member(JOURNAL_EVENT.rapieresTeamsUpdated, z.object({ fencerIds: z.array(Id) })),
  member(
    JOURNAL_EVENT.fencerReinstated,
    z.object({ fencerId: Id, restoredStatus: z.string(), restoredMatchIds: z.array(Id) })
  ),
  // Tableaux séparés (docs/adr/0024) : groupe extrait dans une épreuve séparée (épreuve
  // d'origine), puis classement importé, premier fait de l'épreuve séparée ; même commandId
  member(
    JOURNAL_EVENT.groupSplitOff,
    z.object({ group: Group, targetCompetitionId: Id, fencerIds: z.array(Id) })
  ),
  member(
    JOURNAL_EVENT.splitRankingImported,
    z.object({
      sourceCompetitionId: Id,
      group: Group,
      ranking: z.array(z.object({ fencerId: Id, sourceFencerId: Id, rank: z.number().int() })),
    })
  ),
  // Épreuves par équipes (docs/adr/0024) : poules d'équipes tirées, puis chaque rencontre
  // avec ses relais fixés à la création (titulaires dans l'ordre de l'arme)
  member(
    JOURNAL_EVENT.teamPoolsGenerated,
    z.object({ pools: z.array(z.object({ number: z.number().int(), teamIds: z.array(Id) })) })
  ),
  member(
    JOURNAL_EVENT.teamMatchScheduled,
    z.object({
      matchId: Id,
      teamAId: Id,
      teamBId: Id,
      /** Poule de la rencontre ; null au tableau */
      pool: z.number().int().nullable(),
      /** Tour du tableau ; en poule, créneau du calendrier de l'arène Sabre Laser, sinon null */
      round: z.number().int().nullable(),
      /** Position au tableau ; null en poule */
      position: z.number().int().nullable(),
      relays: z.array(
        z.object({ relayId: Id, order: z.number().int(), fencerAId: Id, fencerBId: Id })
      ),
    })
  ),
  // Tableau d'équipes (lot E2) : placement complet du premier tour, exemptés compris ;
  // tour = nombre de rencontres du tour (taille / 2 au premier, 1 en finale) ; tirage (ADR-0045)
  member(
    JOURNAL_EVENT.teamTableauGenerated,
    z.object({
      size: z.number().int(),
      slots: z.array(
        z.object({
          round: z.number().int(),
          position: z.number().int(),
          teamAId: Id.nullable(),
          teamBId: Id.nullable(),
          isBye: z.boolean(),
        })
      ),
      draw: TableauDrawPayload.optional(),
    })
  ),
  // Relais : le fait est le score du relais, pas le cumul (calculé)
  member(
    JOURNAL_EVENT.relayScoreRecorded,
    z.object({
      matchId: Id,
      relayId: Id,
      scoreA: z.number().int().min(0),
      scoreB: z.number().int().min(0),
    })
  ),
  member(JOURNAL_EVENT.relayReopened, z.object({ matchId: Id, relayId: Id })),
  // Rencontre terminée ; vainqueur null : égalité admise en poule
  member(JOURNAL_EVENT.teamMatchDecided, z.object({ matchId: Id, winnerTeamId: Id.nullable() })),
  member(
    JOURNAL_EVENT.teamFencerSubstituted,
    z.object({
      matchId: Id,
      teamId: Id,
      outFencerId: Id,
      inFencerId: Id,
      relayIds: z.array(Id),
    })
  ),
  // Cartons des épreuves par équipes (docs/adr/0028) : identifiants et codes seulement ;
  // groupe, points et exclusion se recalculent du motif et de l'arme
  member(
    JOURNAL_EVENT.teamCardGiven,
    z.object({ matchId: Id, teamId: Id, cardId: Id, type: TeamCardType })
  ),
  member(
    JOURNAL_EVENT.relayCardGiven,
    z.object({
      matchId: Id,
      relayId: Id,
      fencerId: Id,
      cardId: Id,
      type: RelayCardType,
      /** Code CardReason ; null : carton imposé par l'appareil de piste, sans motif */
      reason: z.string().nullable(),
    })
  ),
  // Carton P (t.124), donné aux deux équipes : team_match_cards, team_id NULL, type `p_…`
  member(
    JOURNAL_EVENT.passivityCardGiven,
    z.object({ matchId: Id, cardId: Id, type: z.enum(['yellow', 'red', 'black']) })
  ),
  member(JOURNAL_EVENT.teamCardCancelled, z.object({ matchId: Id, cardId: Id })),
  member(JOURNAL_EVENT.relayCardCancelled, z.object({ matchId: Id, relayId: Id, cardId: Id })),
  // Équipe retirée (o.99.7.a, abandon) ou exclue (o.99.7.b, noir individuel) ; la rencontre
  // perdue est décidée par TeamMatchDecided dans la même commande
  member(
    JOURNAL_EVENT.teamWithdrawn,
    z.object({ teamId: Id, matchId: Id, reason: z.enum(['exclusion', 'abandon']) })
  ),
  // Plan des pistes de l'épreuve (docs/adr/0015) : numéros seulement ; panne d'une journée =
  // un événement par épreuve, même commandId
  member(JOURNAL_EVENT.stripStartChanged, z.object({ start: z.number().int() })),
  member(
    JOURNAL_EVENT.stripAvailabilityChanged,
    z.object({ strip: z.number().int(), available: z.boolean() })
  ),
]);
export type JournalEventBody = z.infer<typeof JournalEventBodySchema>;
export type JournalEventType = JournalEventBody['type'];

/** Origine d'une écriture */
export const EventSourceSchema = z.enum(['screen', 'mcp', 'tablet', 'cyrano', 'opp2', 'engine']);
export type EventSource = z.infer<typeof EventSourceSchema>;

/** Événement tel que le contrat l'expose (épreuve implicite) */
export const JournalEventSchema = z.intersection(
  JournalEventBodySchema,
  z.object({
    /** Identifiant unique, stable entre postes */
    eventId: Id,
    /** Commune aux événements d'une même commande (corrélation, idempotence) */
    commandId: Id,
    /** Ordre local, croissant par épreuve */
    revision: z.number(),
    author: z.string().nullable(),
    source: EventSourceSchema,
    at: z.string(),
  })
);
export type JournalEvent = z.infer<typeof JournalEventSchema>;
