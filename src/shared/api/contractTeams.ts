/**
 * BPM - Escrime - Épreuves par équipes par le moteur (docs/adr/0024, lot E1) : inscription des
 * équipes et composition (non journalisées, docs/adr/0018), tirage des poules d'équipes
 * (TeamPoolsGenerated, puis un TeamMatchScheduled par rencontre), bloc « teams » de
 * getCompetitionState. Les tables teams, team_fencers, team_matches, team_bouts sont la
 * projection des équipes.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import {
  command,
  CommandId,
  CompetitionId,
  DryRun,
  Id,
  TableauDrawSeed,
  TableauDrawSummary,
} from './contractDef';
import {
  PassivityCardSchema,
  RelayCardSchema,
  teamCardOperations,
  TeamCardSchema,
  TeamWithdrawalSchema,
} from './contractTeamCards';

const ExpectedRevision = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    'Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps.'
  );
const Revision = z.number().int().optional();
const Name = z.string().trim().min(1).max(200);
const TeamRanking = z
  .number()
  .int()
  .min(1)
  .max(100000)
  .describe('Rang d’entrée de l’équipe (1 = la meilleure, docs/adr/0044)');

// ─── Bloc « teams » de getCompetitionState ──────────────────────────────────

const TeamFencerSchema = z.object({
  fencerId: z.string(),
  fencerLastName: z.string(),
  fencerFirstName: z.string(),
  /** Ordre dans l'équipe (titulaires d'abord, dès 1) */
  teamOrder: z.number().int(),
  isReserve: z.boolean(),
});

const TeamRelaySchema = z.object({
  id: z.string(),
  boutOrder: z.number().int(),
  fencerAId: z.string(),
  fencerBId: z.string(),
  /** Score du relais (le fait) ; le cumul se calcule */
  scoreA: z.number().int(),
  scoreB: z.number().int(),
  maxScore: z.number().int(),
  status: z.string(),
  winnerId: z.string().nullable(),
  /** Cartons individuels du relais (docs/adr/0028) */
  cards: z.array(RelayCardSchema),
});

const TeamMatchSchema = z.object({
  id: z.string(),
  /** Poule ; null au tableau */
  poolNumber: z.number().int().nullable(),
  /** Tour du tableau ; en poule, créneau de l'arène Sabre Laser */
  round: z.number().int().nullable(),
  /** Position au tableau ; null en poule */
  position: z.number().int().nullable(),
  teamAId: z.string(),
  teamBId: z.string(),
  /** Touches cumulées de la rencontre */
  scoreBoutsA: z.number().int(),
  scoreBoutsB: z.number().int(),
  status: z.string(),
  winnerId: z.string().nullable(),
  currentBoutIndex: z.number().int(),
  bouts: z.array(TeamRelaySchema),
  /** Cartons E de la rencontre (arène Sabre Laser, docs/adr/0028) */
  teamCards: z.array(TeamCardSchema),
  /** Cartons P de la rencontre, donnés aux deux équipes (relais FIE, t.124, docs/adr/0028) */
  passivityCards: z.array(PassivityCardSchema),
});

export const TeamsStateSchema = z.object({
  format: z.enum(['fie-relay', 'laser-arena']),
  /** Titulaires par équipe */
  teamSize: z.number().int(),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      club: z.string(),
      /** Rang d'entrée saisi ou importé (docs/adr/0044) ; null : rang calculé (teamEntryRanking) */
      ranking: z.number().int().nullable(),
      fencers: z.array(TeamFencerSchema),
    })
  ),
  poolMatches: z.array(TeamMatchSchema),
  tableauMatches: z.array(TeamMatchSchema),
  /** Classement de poule (dérivé) : relais FIE au ratio V/M toutes poules confondues (poule unique : victoires, docs/adr/0044), arène par points marqués */
  poolRanking: z.array(
    z.object({
      teamId: z.string(),
      rank: z.number().int(),
      victories: z.number().int(),
      defeats: z.number().int(),
      draws: z.number().int(),
      relaysWon: z.number().int(),
      relaysLost: z.number().int(),
      pointsFor: z.number().int(),
      pointsAgainst: z.number().int(),
      /** Égalité à départager par tirage au sort (arène) */
      tied: z.boolean(),
    })
  ),
  /** Équipes retirées ou exclues (docs/adr/0028) : hors classement de poule */
  withdrawn: z.array(TeamWithdrawalSchema),
  /**
   * Têtes de série du tableau, dans l'ordre d'entrée (docs/adr/0044) : tableau tiré par le
   * moteur (TeamTableauGenerated) ; avant le tirage, classement d'entrée coupé par la
   * qualification du tour (teamTableauEntry), ou rang d'entrée sans poule. Placement du
   * tableau de l'écran et des PDF.
   */
  tableauSeeds: z.array(z.string()),
  /**
   * Équipes du tableau tiré par emplacement (docs/adr/0045) : placées par la table de
   * placement, elles redonnent le premier tour tiré (écran, PDF) ; avant le tirage, les têtes
   * de série
   */
  tableauPlacement: z.array(z.string()),
  /**
   * Classement final (teamFinalRanking, docs/adr/0044) : perdants ex aequo par tour, départagés
   * par le classement d'entrée du tableau ; petite finale ; éliminées à l'issue des poules
   * ensuite. provisional : tableau pas terminé (ou pas encore tiré).
   */
  finalRanking: z.object({
    rows: z.array(z.object({ teamId: z.string(), rank: z.number().int() })),
    provisional: z.boolean(),
  }),
});
export type TeamsStateDTO = z.infer<typeof TeamsStateSchema>;

const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  club: z.string(),
  ranking: z.number().int().nullable(),
});

// ─── Opérations ─────────────────────────────────────────────────────────────

export const teamSetupOperations = {
  registerTeam: command({
    description:
      'Épreuve par équipes : inscrit une équipe (nom, club ; club = nom par défaut ; rang d’entrée facultatif, docs/adr/0044). Inscription (docs/adr/0018), sans journal. ' +
      'Refus : épreuve individuelle (unsupported_format).',
    input: z.object({
      competitionId: CompetitionId,
      name: Name.describe('Nom de l’équipe'),
      club: Name.optional().describe('Club (défaut : le nom)'),
      ranking: TeamRanking.optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), team: TeamSchema.nullable(), revision: Revision }),
    permission: 'fencers:write',
  }),

  updateTeam: command({
    description:
      'Épreuve par équipes : modifie le nom, le club ou le rang d’entrée d’une équipe (ranking null : rang retiré, rang calculé sur les classements des titulaires puis le nom, docs/adr/0044). Sans journal (docs/adr/0018). ' +
      'Refus : épreuve individuelle (unsupported_format), équipe inconnue (team_not_found), après le tirage (draw_done).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      name: Name.optional().describe('Nouveau nom'),
      club: Name.optional().describe('Nouveau club'),
      ranking: TeamRanking.nullable().optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), team: TeamSchema.nullable(), revision: Revision }),
    permission: 'fencers:write',
    mcp: { name: 'update_team', title: 'Modifier une équipe' },
  }),

  unregisterTeam: command({
    description:
      'Épreuve par équipes : supprime une équipe et sa composition. Refus après le tirage (draw_done), équipe inconnue (team_not_found).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), teamId: z.string(), revision: Revision }),
    permission: 'fencers:write',
  }),

  assignTeamFencer: command({
    description:
      'Épreuve par équipes : place un tireur de l’épreuve dans une équipe, titulaire ou remplaçant, à un ordre (déplacement dans la même équipe admis). ' +
      'Refus après le tirage (draw_done : seul le remplacement change alors la composition), équipe inconnue (team_not_found), tireur absent de l’épreuve (fencer_not_found) ou déjà dans une autre équipe (invalid_composition).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      fencerId: Id.describe('Identifiant du tireur'),
      teamOrder: z.number().int().min(1).max(20).describe('Ordre dans l’équipe (dès 1)'),
      isReserve: z.boolean().optional().describe('Remplaçant (défaut : titulaire)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      teamId: z.string(),
      fencerId: z.string(),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  unassignTeamFencer: command({
    description:
      'Épreuve par équipes : retire un tireur d’une équipe. Refus après le tirage (draw_done), équipe inconnue (team_not_found), tireur absent de l’équipe (fencer_not_found).',
    input: z.object({
      competitionId: CompetitionId,
      teamId: Id.describe('Identifiant de l’équipe'),
      fencerId: Id.describe('Identifiant du tireur'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      teamId: z.string(),
      fencerId: z.string(),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  generateTeamPools: command({
    description:
      'Épreuve par équipes : tire les poules d’équipes et crée leurs rencontres, chacune avec ses relais fixés (titulaires par ordre, ordre des relais de la règle de rencontre du tour : FIE o.99.3 à 3 titulaires ou rotation). ' +
      'Relais FIE avec une formule d’équipe (general.teamMatch, docs/adr/0044) : poules du tour de la formule comme en individuel (taille de poule, nombre optimal ou « poolCount », serpentin au rang d’entrée effectif des équipes, clubs séparés, ordre officiel des rencontres, positions tirées au sort), relais et palier de la règle du tour ; sans formule d’équipe : poule unique tous contre tous dans l’ordre des noms (« poolCount » refusé, invalid_pool_count). Arène Sabre Laser : calendrier figé du règlement, 8 ou 12 équipes seulement. ' +
      'Refus : épreuve individuelle (unsupported_format), moins de 2 équipes ou arène hors 8/12 (invalid_composition), titulaires manquants (team_incomplete), formule sans tour de poules (no_pools), plus de poules que la moitié des équipes (invalid_pool_count), poules déjà tirées sans « replace » (draw_done), relais déjà joués (pools_have_scores), tableau d’équipes créé (bracket_exists). ' +
      'Journal : TeamPoolsGenerated, puis un TeamMatchScheduled par rencontre.',
    input: z.object({
      competitionId: CompetitionId,
      poolCount: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Nombre de poules (formule d’équipe seulement ; défaut : nombre optimal ; docs/adr/0044)'
        ),
      replace: z
        .boolean()
        .optional()
        .describe('Remplacer des poules déjà tirées dont aucun relais n’est joué'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      pools: z.array(z.object({ number: z.number().int(), teamIds: z.array(z.string()) })),
      matchIds: z.array(z.string()),
      relayCount: z.number().int(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: {
      name: 'generate_team_pools',
      title: 'Tirer les poules d’équipes',
      destructive: true,
    },
  }),
};

// ─── Relais et tableau d'équipes (lot E2) ───────────────────────────────────

const MatchId = Id.describe('Identifiant de la rencontre (getCompetitionState, bloc « teams »)');
const TeamSide = z.enum(['A', 'B']);

export const teamRelayOperations = {
  generateTeamTableau: command({
    description:
      'Épreuve par équipes : tire le tableau d’équipes sur le classement de poule (arène Sabre Laser : évitement de revanche au premier tour, 5↔6 et 7↔8) et crée les rencontres dont les deux équipes sont connues, avec leurs relais. ' +
      'Tour = nombre de rencontres du tour (taille / 2 au premier, 1 en finale) ; identifiants `${competitionId}-t${tour}-${position}`. ' +
      'Refus : épreuve individuelle (unsupported_format), moins de 2 équipes (invalid_composition), titulaires manquants (team_incomplete), rencontres de poule non terminées (pools_not_complete), tableau déjà créé sans « replace » (bracket_exists), relais du tableau déjà joués (bracket_has_scores). ' +
      'Tirage (docs/adr/0045) : mode de la phase tableau de la formule (« draw » : strict, pairs, groups, random ; arène Sabre Laser : strict) ; tableau sans poule : équipes à rang effectif égal et sans rang tirées au sort (ADR-0044). Le moteur tire la graine (0 à 2³² − 1) sauf « seed » ; « draw » rend { mode, seed }, aperçu compris : rejouer avec la graine de l’aperçu donne le même tableau. ' +
      'Journal : TeamTableauGenerated (tirage compris), puis un TeamMatchScheduled par rencontre.',
    input: z.object({
      competitionId: CompetitionId,
      replace: z
        .boolean()
        .optional()
        .describe('Remplacer un tableau d’équipes dont aucun relais n’est joué'),
      seed: TableauDrawSeed,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      size: z.number().int(),
      slots: z.array(
        z.object({
          round: z.number().int(),
          position: z.number().int(),
          teamAId: z.string().nullable(),
          teamBId: z.string().nullable(),
          isBye: z.boolean(),
        })
      ),
      matchIds: z.array(z.string()),
      draw: TableauDrawSummary,
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: {
      name: 'generate_team_tableau',
      title: 'Tirer le tableau d’équipes',
      destructive: true,
    },
  }),

  recordRelayScore: command({
    description:
      'Épreuve par équipes : enregistre le score d’un relais (le score du relais, pas le cumul) et le termine. Le cumul, le vainqueur du relais et celui de la rencontre se calculent. ' +
      'Dernier relais : rencontre terminée ; égalité au tableau → « winner » requis (minute avec priorité), en poule → égalité. Au tableau, la rencontre suivante est créée dès que ses deux équipes sont connues. ' +
      'Refus : rencontre inconnue (match_not_found), relais déjà terminé ou précédents non terminés (relay_out_of_order), cumul au-delà du palier du relais FIE (armes olympiques : d’autant de touches que de cartons rouges adverses du relais, t.41.1 ; Sabre Laser en points : de 4 points) ou assaut au-delà du plafond en arène (score_above_max), égalité sans vainqueur au tableau (draw_needs_winner), vainqueur contraire au score (winner_contradicts_score), équipe retirée ou exclue (team_withdrawn). ' +
      'Journal : RelayScoreRecorded, puis TeamMatchDecided et TeamMatchScheduled selon le cas.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: MatchId,
      relay: z.number().int().min(1).describe('Ordre du relais dans la rencontre (dès 1)'),
      scoreA: z.number().int().min(0).describe('Touches de l’équipe A dans ce relais'),
      scoreB: z.number().int().min(0).describe('Touches de l’équipe B dans ce relais'),
      winner: TeamSide.optional().describe(
        'Vainqueur de la rencontre en cas d’égalité au dernier relais (minute avec priorité)'
      ),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      relayId: z.string(),
      /** Cumul de la rencontre après ce relais */
      scoreA: z.number().int(),
      scoreB: z.number().int(),
      matchFinished: z.boolean(),
      winnerTeamId: z.string().nullable(),
      /** Rencontres du tableau créées à la suite */
      scheduledMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'record_relay_score', title: 'Saisir le score d’un relais' },
  }),

  reopenRelay: command({
    description:
      'Épreuve par équipes : rouvre le dernier relais terminé d’une rencontre pour correction (son score est gardé comme score en cours). La rencontre repasse en cours ; au tableau, la rencontre suivante pas encore commencée est retirée. ' +
      'Refus : rencontre inconnue (match_not_found), aucun relais terminé (relay_out_of_order), rencontre suivante du tableau commencée (next_match_played), équipe retirée ou exclue (team_withdrawn). ' +
      'Journal : RelayReopened.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: MatchId,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      relayId: z.string(),
      relay: z.number().int(),
      /** Score du relais rouvert, repris comme score en cours */
      scoreA: z.number().int(),
      scoreB: z.number().int(),
      removedMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'reopen_relay', title: 'Rouvrir le dernier relais', destructive: true },
  }),

  substituteTeamFencer: command({
    description:
      'Épreuve par équipes : le remplaçant de l’équipe prend la place du tireur sortant dans les relais non terminés de la rencontre (o.99.5, o.99.6). Un seul remplaçant par équipe et par rencontre. ' +
      'Remplaçant choisi par « inFencerId » (facultatif ; absent : le premier remplaçant ; remplaçants admis par la règle de rencontre de la phase, docs/adr/0044). ' +
      'Refus : rencontre inconnue (match_not_found), équipe absente de la rencontre (team_not_found), tireur absent de la rencontre (fencer_not_found), pas de remplaçant (no_reserve), « inFencerId » qui n’est pas un remplaçant de l’équipe (invalid_composition), remplaçant déjà entré (reserve_used), plus aucun relais à tirer pour ce tireur (no_later_relay). ' +
      'Journal : TeamFencerSubstituted.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: MatchId,
      teamId: Id.describe('Équipe du tireur sortant'),
      outFencerId: Id.describe('Tireur sortant'),
      inFencerId: Id.optional().describe(
        'Remplaçant qui entre (défaut : le premier remplaçant de l’équipe, docs/adr/0044)'
      ),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      matchId: z.string(),
      teamId: z.string(),
      outFencerId: z.string(),
      inFencerId: z.string(),
      relayIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'substitute_team_fencer', title: 'Faire entrer le remplaçant' },
  }),
};

/** Opérations des épreuves par équipes : inscription, poules (E1), relais et tableau (E2), cartons */
export const teamOperations = {
  ...teamSetupOperations,
  ...teamRelayOperations,
  ...teamCardOperations,
};
