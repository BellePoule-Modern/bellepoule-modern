/**
 * BPM - Escrime - Contrat d'API unique (#1981, lot 1)
 * Chaque opération est décrite une seule fois : entrée (validée par zod), sortie, droit requis,
 * exposition MCP. Les adaptateurs IPC (src/main/engine/api/ipcAdapter.ts) et MCP
 * (src/main/engine/api/mcpAdapter.ts) en sont dérivés ; l'écran appelle un BpmClient
 * (src/shared/api/client.ts) au lieu de window.electronAPI.
 * Le renderer n'importe que les types (import type) : zod reste dans le bundle main.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import {
  command,
  CommandId,
  CompetitionId,
  DryRun,
  ExpectedRevision,
  TiesAtBarInput,
  TiedAtBarSchema,
  Id,
  query,
  Revision,
  subscription,
  type ApiContract,
  type OperationKind,
  FencerSchema,
  FencerCategoryField,
  FencerTeamEntryShape,
  SplitGroup,
  TableauDrawSeed,
  TableauDrawSummary,
} from './contractDef';
import { reportOperations } from './contractReports';
import { dtViewOperations } from './contractDtView';
import { clubOperations } from './contractClub';
import { stationOperations } from './contractStation';
import { remoteOperations } from './contractRemote';
import { trainingOperations } from './contractTraining';
import { devicesOperations } from './contractDevices';
import { fileOperations } from './contractFiles';
import { simulationOperations } from './contractSimulation';
import { SplitHistorySchema, splitOperations } from './contractSplit';
import { poolRoundOperations } from './contractPoolRound';
import { poolWavesOperations } from './contractPoolWaves';
import { teamOperations, TeamsStateSchema } from './contractTeams';
import { stripOperations } from './contractStrips';
import { JournalEventSchema } from './events';
import { CompetitionSchema, CompetitionSettingsPatchSchema } from './competitionSchema';
import { ArenaPlanSchema } from './arenaPlanSchema';
import { Category, Gender, Weapon, type Fencer, type Pool, type PoolRanking } from '../types';
import { formulaOperations, TemplateId } from './contractFormula';
import type { ConsolationBracket, FinalResult, TableauMatch } from '../domain/tableau/tableauTypes';
import type { TableauStageRecord } from '../domain/tableau/tableauStage';
import type { RapieresLegacyState, RapieresSession } from '../domain/rapieres/rapieres.types';
import type { GroupTableau } from '../domain/ranking/splitGroups';
import type { TableauDrawState } from '../domain/tableau/tableauDraw';

export type {
  ApiContract,
  McpExposure,
  OperationDef,
  OperationKind,
  Permission,
} from './contractDef';
export { command, query, subscription } from './contractDef';

// ─── Schémas communs ─────────────────────────────────────────────────────────

const Side = z.enum(['A', 'B']);
const FencerKey = z.union([Id, z.number().int().min(0)]);

const NeutralityCriterion = z.enum(['club', 'nationality', 'region']);
const Neutrality = z.object({
  club: z.boolean().optional().describe('Pas d’arbitre du club d’un tireur'),
  nationality: z.boolean().optional().describe('Pas d’arbitre de la nation d’un tireur'),
  region: z.boolean().optional().describe('Pas d’arbitre de la ligue d’un tireur'),
});
const ResolvedRefereeing = z.object({
  neutrality: z.object({ club: z.boolean(), nationality: z.boolean(), region: z.boolean() }),
  balance: z.boolean(),
  maxConsecutiveMatches: z.number(),
  minRestTimeMinutes: z.number(),
});

/**
 * État de l'épreuve (projection du moteur, docs/adr/0017). Les objets du domaine (poules,
 * matchs de tableau…) sont typés par leurs interfaces : z.custom, sans contrôle à l'exécution.
 * Les champs d'interface (phase affichée, paramètres de préparation, pistes) sortent à l'étape 4b.
 */
/** Écart entre le journal rejoué et l'état (compareWithState) : identifiants et nombres seulement */
const DivergenceSchema = z.object({
  kind: z.string(),
  id: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});

/** Valeur de score d'une ligne du journal des matchs */
const ScoreValue = z.object({ value: z.number().nullable() }).nullable();

/** Statistiques d'un tireur dans son épreuve (touches, cartons, sorties d'arène, durées) */
const FencerStatsSchema = z.object({
  fencerId: z.string(),
  fencerLastName: z.string(),
  fencerFirstName: z.string(),
  fencerClub: z.string().optional(),
  competitionId: z.string(),
  touchesZoneA: z.number(),
  touchesZoneB: z.number(),
  touchesZoneC: z.number(),
  totalTouchPoints: z.number(),
  receivedZoneA: z.number(),
  receivedZoneB: z.number(),
  receivedZoneC: z.number(),
  receivedTouchPoints: z.number(),
  whiteCards: z.number(),
  yellowCards: z.number(),
  redCards: z.number(),
  blackCards: z.number().optional(),
  cardsByReason: z.record(z.string(), z.number()),
  arenaExits: z.number(),
  matchesPlayed: z.number(),
  totalDurationSeconds: z.number(),
  averageDurationSeconds: z.number(),
  matchesFinishedEarly: z.number(),
});

/** Ligne du journal d'un match (scores, touches, cartons, sorties d'arène) */
const MatchEventEntrySchema = z.object({
  id: z.string(),
  matchId: z.string(),
  eventType: z.enum(['score_change', 'touch', 'card', 'arena_exit']),
  timestamp: z.string(),
  fencerId: z.string().nullable(),
  fencerLastName: z.string().nullable(),
  fencerFirstName: z.string().nullable(),
  fencerSide: z.enum(['A', 'B']).nullable(),
  previousScoreA: ScoreValue,
  previousScoreB: ScoreValue,
  newScoreA: ScoreValue,
  newScoreB: ScoreValue,
  changedBy: z.string().nullable(),
  refereeName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  changeReason: z.string().nullable(),
  zone: z.string().nullable(),
  points: z.number().nullable(),
  cardType: z.string().nullable(),
  cardReason: z.string().nullable(),
  cardGroup: z.number().nullable(),
  resultingExclusion: z.boolean().nullable(),
  exitType: z.string().nullable(),
});

/** Tireur exposé par le contrat (docs/adr/0018) : dates en ISO 8601 */
const Text = z.string().trim().max(200);
/** Identité d'un tireur, sans règle (updateFencerDetails, registerFencers) */
const FencerDetailsShape = {
  birthDate: z.string().date().nullable().optional().describe('AAAA-MM-JJ ; null : effacée'),
  category: FencerCategoryField,
  gender: z.enum(['M', 'F', 'X']).optional(),
  nationality: z.string().trim().min(2).max(3).optional().describe('Code ISO (FRA)'),
  region: Text.nullable().optional(),
  department: z.string().trim().max(3).nullable().optional(),
  club: Text.nullable().optional(),
  license: z.string().trim().max(40).nullable().optional(),
  handedness: z.enum(['R', 'L']).optional(),
  photo: z.string().max(2_000_000).nullable().optional().describe('Image en base64'),
  ...FencerTeamEntryShape,
};

/** Arbitre exposé par le contrat (listReferees, commandes d'inscription, docs/adr/0018) */
const RefereeSchema = z.object({
  id: z.string(),
  ref: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.string(),
  club: z.string().nullable(),
  license: z.string().nullable(),
  nationality: z.string().nullable(),
  region: z.string().nullable(),
  category: z.string().nullable(),
  status: z.enum(['available', 'assigned', 'unavailable']),
});

/** Identité d'un arbitre, sans règle */
const RefereeDetailsShape = {
  firstName: Text.optional(),
  gender: z.enum(['M', 'F', 'X']).optional(),
  nationality: z.string().trim().min(2).max(3).optional().describe('Code ISO (FRA)'),
  club: Text.nullable().optional(),
  license: z.string().trim().max(40).nullable().optional(),
  category: Text.nullable().optional().describe('Niveau : régional, national, international…'),
};

const WeaponEnum = z.enum(Weapon);
const GenderEnum = z.enum(Gender);
const CategoryEnum = z.enum(Category);
/** Réglages d'une épreuve (fusion de premier niveau) : clés et valeurs vérifiées */
const SettingsPatch = CompetitionSettingsPatchSchema;

const CompetitionStateSchema = z.object({
  currentPhase: z.number().int(),
  pools: z.array(z.custom<Pool>()),
  poolHistory: z.array(z.array(z.custom<Pool>())),
  appelHistory: z.array(z.array(z.custom<Fencer>())),
  overallRanking: z.array(z.custom<PoolRanking>()),
  tableauMatches: z.array(z.custom<TableauMatch>()),
  finalResults: z.array(z.custom<FinalResult>()),
  consolationBrackets: z.array(z.custom<ConsolationBracket>()),
  currentPoolRound: z.number().int(),
  skipPoolPhase: z.boolean(),
  poolsLaunched: z.boolean().optional(),
  remoteArenaCount: z.number().int().optional(),
  rapieres: z.custom<RapieresSession | RapieresLegacyState>().optional(),
  /** Vagues du tour courant (tour en vagues, docs/adr/0043) */
  waves: z.object({ launched: z.number().int(), ended: z.boolean() }).optional(),
  /** Étapes closes : tableau arrêté à N tireurs (docs/adr/0037) */
  stageHistory: z.array(z.custom<TableauStageRecord>()).optional(),
  splitHistory: SplitHistorySchema.optional(), // Scission faite : filles (docs/adr/0039)
  /** Tableaux séparés après les poules : un tableau par groupe (docs/adr/0024) */
  groupTableaux: z.record(z.string(), z.custom<GroupTableau>()).optional(),
  /**
   * Tirage du tableau unique, ou du tableau d'équipes (docs/adr/0045) : mode, graine, heure,
   * ordre d'entrée tiré ; tableaux séparés : dans le tableau de chaque groupe
   */
  tableauDraw: z.custom<TableauDrawState>().optional(),
  /** Épreuve par équipes (docs/adr/0024) : équipes, rencontres, relais ; null : individuelle */
  teams: TeamsStateSchema.nullable().optional(),
  poolPrepParams: z
    .object({
      poolCount: z.number(),
      minFencersPerPool: z.number(),
      maxFencersPerPool: z.number(),
    })
    .optional(),
});
export type CompetitionStateDTO = z.infer<typeof CompetitionStateSchema>;

const FencerRefSchema = z.object({
  id: z.string(),
  lastName: z.string(),
  firstName: z.string(),
  club: z.string().nullable(),
});

const MatchCard = z.object({
  id: z.string(),
  fencerId: z.string(),
  cardType: z.string(),
  reason: z.string(),
  cardGroup: z.number(),
  timestamp: z.string(),
  pointsAwarded: z.number(),
  resultingExclusion: z.boolean(),
});

// ─── Contrat ─────────────────────────────────────────────────────────────────

export const contract = {
  checkIn: command({
    description:
      'Pointe (présent) ou dépointe des tireurs d’une épreuve, par identifiant ou numéro de dossard (ref).',
    input: z.object({
      competitionId: CompetitionId,
      fencers: z.array(FencerKey).min(1).max(1000).describe('Identifiants ou numéros (ref)'),
      present: z.boolean().describe('true : présent ; false : absent'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      status: z.string(),
      matched: z.number(),
      updated: z.number(),
      skipped: z.number(),
      unknown: z.array(z.union([z.string(), z.number()])),
      revision: Revision,
    }),
    permission: 'fencers:write',
    mcp: { name: 'check_in', title: 'Pointer des tireurs', idempotent: true },
  }),

  recordScore: command({
    description:
      'Score d’un match de poule (tour courant) ou de tableau, tableaux de classement compris (matchId : list_matches), mêmes contrôles que l’écran : score maximum, égalité tranchée par « winner » (ou « priority » en poule), statut spécial du perdant. ' +
      'Classements recalculés ; au tableau, le vainqueur passe au tour suivant. Ne saisir que des scores donnés par le DT ; « dryRun: true » contrôle le score sans l’écrire.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: Id.describe('Identifiant du match (list_matches)'),
      scoreA: z.number().int().min(0).max(99).describe('Touches du tireur A'),
      scoreB: z.number().int().min(0).max(99).describe('Touches du tireur B'),
      winner: Side.optional().describe('Vainqueur imposé'),
      specialStatus: z
        .enum(['abandon', 'forfait', 'exclusion'])
        .optional()
        .describe('Statut du perdant'),
      blackCard: z
        .boolean()
        .optional()
        .describe('Exclusion sur carton noir (motif du rapport fédéral)'),
      correction: z
        .object({
          reason: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .describe('Motif, inscrit au journal des scores'),
          rebuildTableau: z
            .boolean()
            .optional()
            .describe('Retirer le tableau pour le refaire sur le classement corrigé'),
        })
        .optional()
        .describe('Correction d’un score de poule après le tirage du tableau (#1996)'),
      priority: Side.optional().describe('Égalité en poule : prioritaire'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.looseObject({
      dryRun: z.boolean(),
      kind: z.enum(['pool', 'bracket']),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'record_score', title: 'Saisir un score', idempotent: true },
  }),

  generatePools: command({
    description:
      'Poules du tour courant, lancées (phase Poules). Sans « composition » : tirage sur les tireurs pointés par la même fonction que l’écran (serpentin sur le classement, puis clubs et régions séparés, ou les critères de « separation »), poule n sur la piste n ; épreuve individuelle. Tour suivant (après « closePoolRound » ou « closeTableauStage ») : tireurs pointés répartis sur le classement du tour précédent (ou le cumul des tours si le tour est réglé « cumulative »), ou sur le rang d’entrée au tableau après un tableau arrêté, tailles et score maximum du tour lus dans la formule (« minPerPool » et « maxPerPool » priment), comme l’écran (docs/adr/0042). ' +
      'Avec « composition » : poules et ordre des matchs retenus par le DT à la préparation, tels quels (tous formats individuels, tours multiples compris). ' +
      '« replace: true » efface des poules déjà jouées ou un tableau : accord du DT indispensable.',
    input: z.object({
      competitionId: CompetitionId,
      poolCount: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Nombre de poules (défaut : optimal)'),
      minPerPool: z
        .number()
        .int()
        .min(3)
        .max(12)
        .optional()
        .describe('Tireurs par poule, minimum (défaut 5)'),
      maxPerPool: z
        .number()
        .int()
        .min(3)
        .max(12)
        .optional()
        .describe('Tireurs par poule, maximum (défaut 7)'),
      separation: z
        .array(z.enum(['byRanking', 'byClub', 'byRegion', 'byNation']))
        .optional()
        .describe(
          'Critères actifs, par priorité (comme l’écran) : avant « byRanking », ils priment sur le classement ; après, échanges dans le chapeau. Défaut : ["byRanking", "byClub", "byRegion"]'
        ),
      composition: z
        .array(
          z.object({
            poolId: Id,
            number: z.number().int().min(1),
            strip: z.number().int().min(1).nullable().optional(),
            fencerIds: z.array(Id).min(2).max(30),
            matches: z.array(z.object({ matchId: Id, fencerAId: Id, fencerBId: Id })).max(500),
          })
        )
        .min(1)
        .max(200)
        .optional()
        .describe('Poules préparées par le DT (écran) : pas de tirage'),
      replace: z.boolean().optional().describe('Remplacer des poules ou un tableau existants'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      round: z.number().int(),
      fencerCount: z.number().int(),
      poolCount: z.number().int(),
      pools: z.array(
        z.object({
          number: z.number().int(),
          strip: z.number().int().nullable(),
          fencers: z.array(
            z.object({
              id: z.string(),
              lastName: z.string(),
              firstName: z.string(),
              club: z.string().nullable(),
              ranking: z.number().nullable(),
            })
          ),
          matchCount: z.number().int(),
        })
      ),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'generate_pools', title: 'Générer les poules', destructive: true },
  }),

  addPoolFencer: command({
    description:
      'Ajoute un tireur à une poule lancée (tireur arrivé en retard) : un match contre chaque tireur de la poule, à la suite des matchs existants. Refus si le tableau est tiré ou si le tireur est déjà placé.',
    input: z.object({
      competitionId: CompetitionId,
      poolId: Id.describe('Identifiant de la poule'),
      fencerId: Id.describe('Identifiant du tireur'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      poolId: z.string(),
      poolNumber: z.number().int(),
      fencerId: z.string(),
      matchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'add_pool_fencer', title: 'Ajouter un tireur à une poule' },
  }),

  generateTableau: command({
    description:
      'Tableau d’élimination directe. Sans « composition » : construit depuis le classement après poules (tireurs éliminés, abandons, forfaits et exclus écartés), avec ou sans petite finale (épreuve individuelle, tableau simple), ou « tirer toutes les places » (barrages, petite finale imposée, tableaux de classement créés au fil des scores, même planification que l’écran) : après plusieurs tours de poules, classement de tous les tours (docs/adr/0042) ; refus « no_direct_elimination » une fois le tableau arrêté clos, les tours de poules qui suivent terminent l’épreuve (docs/adr/0037). ' +
      'Avec « composition » : placement calculé par l’écran (barrages, exemptions, rangs de sortie de poules), tel quel. « replace: true » efface un tableau déjà joué : accord du DT indispensable. ' +
      'Tableaux séparés après les poules : un tableau par groupe (« group » exigé), identifiants de match préfixés par le groupe (« F:32-0 »). ' +
      'Sans « composition » : « tiedAtBar » liste les ex aequo à la barre de qualification au-delà du quota, « ties » choisit leur sort pour ce tableau (docs/adr/0040). ' +
      'Tirage (docs/adr/0045) : mode de la phase tableau de la formule (« draw » : strict, pairs, groups, random ; strict sans formule) ; tableau au rang d’entrée (sans poule) : ex aequo et non classés tirés au sort, quel que soit le mode. Le moteur tire la graine (0 à 2³² − 1) sauf « seed » ; « draw » rend { mode, seed }, aperçu compris : rejouer avec la graine de l’aperçu donne le même tableau. « composition » refusée (invalid_composition) pour un mode autre que strict ou un tableau au rang d’entrée. Le rang d’entrée (seedA, seedB) reste celui du classement.',
    input: z.object({
      competitionId: CompetitionId,
      thirdPlaceMatch: z.boolean().optional().describe('Match pour la 3e place'),
      composition: z
        .array(
          z.object({
            matchId: Id,
            round: z.number().int().min(2).max(1024),
            position: z.number().int().min(0).max(1024),
            fencerAId: Id.nullable(),
            fencerBId: Id.nullable(),
            isBye: z.boolean(),
            seedA: z.number().int().nullable().optional(),
            seedB: z.number().int().nullable().optional(),
          })
        )
        .min(1)
        .max(2048)
        .optional()
        .describe('Placement calculé par l’écran : pas de planification'),
      group: SplitGroup,
      replace: z.boolean().optional().describe('Remplacer un tableau existant'),
      ties: TiesAtBarInput,
      seed: TableauDrawSeed,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      size: z.number().int(),
      qualified: z.number().int(),
      tiedAtBar: TiedAtBarSchema.nullable(),
      thirdPlaceMatch: z.boolean(),
      draw: TableauDrawSummary,
      firstRound: z.array(
        z.object({
          id: z.string(),
          round: z.number().int(),
          position: z.number().int(),
          fencerA: FencerRefSchema.nullable(),
          fencerB: FencerRefSchema.nullable(),
          scoreA: z.number().nullable(),
          scoreB: z.number().nullable(),
          winner: FencerRefSchema.nullable(),
          isBye: z.boolean(),
          state: z.enum(['pending', 'ready', 'done']),
          strip: z.number().nullable(),
        })
      ),
      revision: Revision,
    }),
    permission: 'score:write',
    // Nom de l'outil publié en 2.0 conservé (docs/adr/0008)
    mcp: { name: 'build_bracket', title: 'Construire le tableau', destructive: true },
  }),

  clearScore: command({
    description:
      'Annule le score d’un match : match de poule remis à jouer (classements recalculés), ou match de tableau rouvert (vainqueur retiré du tour suivant). Refus si le tour suivant est joué, ou pour une poule une fois le tableau tiré.',
    input: z.object({
      competitionId: CompetitionId,
      matchId: Id.describe('Identifiant du match (list_matches)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      kind: z.enum(['pool', 'bracket']),
      matchId: z.string(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'clear_score', title: 'Annuler un score', destructive: true },
  }),

  assignMatches: command({
    description:
      'Arbitres et pistes : d’une poule (« pools » : piste, arbitres principal en tête, l’arbitre principal passant sur les matchs de la poule) ou d’un match (« matches » : arbitre principal ; piste pour un match de tableau). Seuls les champs fournis changent.',
    input: z.object({
      competitionId: CompetitionId,
      pools: z
        .array(
          z.object({
            poolId: Id,
            strip: z.number().int().min(1).max(999).nullable().optional(),
            refereeIds: z.array(Id).max(10).optional(),
          })
        )
        .max(200)
        .optional(),
      matches: z
        .array(
          z.object({
            matchId: Id,
            strip: z.number().int().min(1).max(999).nullable().optional(),
            refereeId: Id.nullable().optional(),
          })
        )
        .max(2000)
        .optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      pools: z.number().int(),
      matches: z.number().int(),
      revision: Revision,
    }),
    permission: 'referees:write',
    mcp: {
      name: 'assign_matches',
      title: 'Arbitres et pistes des poules et des matchs',
      idempotent: true,
    },
  }),

  adjustRanking: command({
    description:
      'Classement après poules ajusté par le DT : rang (et points Quest) de chaque tireur, répercutés dans les classements de poule. Le classement complet est fourni, dans l’ordre.',
    input: z.object({
      competitionId: CompetitionId,
      ranking: z
        .array(
          z.object({
            fencerId: Id,
            rank: z.number().int().min(1),
            questPoints: z.number().optional(),
          })
        )
        .min(1)
        .max(2000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), fencers: z.number().int(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'adjust_ranking', title: 'Ajuster le classement après poules', destructive: true },
  }),

  skipPools: command({
    description:
      'Épreuve sans poules : classement initial sur les tireurs pointés (« fencerIds » : tireurs choisis, sinon tous les pointés), rangés par classement d’entrée puis par nom ; les ex aequo et les non classés sont tirés au sort au tirage du tableau (docs/adr/0045), puis tableau.',
    input: z.object({
      competitionId: CompetitionId,
      fencerIds: z
        .array(Id)
        .min(2)
        .max(2000)
        .optional()
        .describe('Tireurs du classement initial (l’ordre ne compte pas)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), fencers: z.number().int(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'skip_pools', title: 'Passer les poules', destructive: true },
  }),

  clearTableau: command({
    description:
      'Retire le tableau (et les tableaux de classement) : il est refait sur le classement courant à l’ouverture de l’onglet Tableau. Accord du DT indispensable si des matchs sont joués. Tableaux séparés : tableau du groupe « group ».',
    input: z.object({
      competitionId: CompetitionId,
      group: SplitGroup,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), cleared: z.number().int(), revision: Revision }),
    permission: 'score:write',
    mcp: { name: 'clear_tableau', title: 'Retirer le tableau', destructive: true },
  }),

  rebuildCompetitionState: command({
    description:
      'Maintenance (docs/adr/0017) : rejoue le journal de l’épreuve et le compare à son état. ' +
      '« dryRun: true » (conseillé d’abord) rend les écarts sans rien écrire. Sinon l’état est aligné sur le journal pour les faits rejouables : ' +
      'statuts des tireurs, scores de poule du tour courant, décisions du tableau et des tableaux de classement, vagues d’un tour en vagues ; classements et classement final recalculés. ' +
      'Les écarts de structure (poules, tours, placement du tableau) et les abandons sans touches restent dans « remaining ». Journal incomplet (épreuve antérieure) : statuts seuls.',
    input: z.object({
      competitionId: CompetitionId,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      /** Journal complet : il commence par un tirage (sinon les tables font foi) */
      complete: z.boolean(),
      revision: Revision,
      divergences: z.array(DivergenceSchema),
      repaired: z.array(z.object({ kind: z.string(), id: z.string() })),
      remaining: z.array(DivergenceSchema),
    }),
    permission: 'score:write',
    mcp: {
      name: 'rebuild_competition_state',
      title: 'Vérifier et réparer l’état d’une épreuve',
      destructive: true,
    },
  }),

  createCompetition: command({
    description:
      'Crée une épreuve (docs/adr/0018) : réglages par défaut calculés par le moteur pour l’arme et la catégorie, puis réglages choisis fusionnés (« settings »).',
    input: z.object({
      title: Text.min(1),
      date: z.string().describe('AAAA-MM-JJ ou ISO 8601'),
      weapon: WeaponEnum,
      gender: GenderEnum,
      category: CategoryEnum,
      location: Text.optional(),
      color: z.string().max(20).optional(),
      isTeamEvent: z.boolean().optional(),
      templateId: TemplateId.optional(),
      settings: SettingsPatch.optional(),
      dryRun: DryRun,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), competitionId: z.string().nullable() }),
    permission: 'competition:write',
  }),

  updateCompetitionDetails: command({
    description: 'Titre, date, lieu et organisateur d’une épreuve : données sans règle.',
    input: z.object({
      competitionId: CompetitionId,
      details: z.strictObject({
        title: Text.min(1).optional(),
        date: z.string().optional(),
        location: Text.nullable().optional(),
        organizer: Text.nullable().optional(),
      }),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      competitionId: z.string(),
      changed: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'competition:write',
  }),

  saveArenaPlan: command({
    description:
      'Plan de salle du planificateur d’arène (salles, arènes, matériel) enregistré sur l’épreuve ; « plan: null » l’efface (docs/adr/0025). Sans journal.',
    input: z.object({
      competitionId: CompetitionId,
      plan: ArenaPlanSchema.nullable(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), competitionId: z.string(), revision: Revision }),
    permission: 'competition:write',
  }),

  updateCompetitionSettings: command({
    description:
      'Arme, sexe, catégorie, format par équipes et réglages (fusion de premier niveau ; clé inconnue ou valeur invalide refusées à l’entrée). ' +
      'Arme, format par équipes, mode spécial et formule à la carte figés (« draw_done ») après le tirage. ' +
      '`settings.formula` jugée comme par updateCompetitionFormula (bornes, S1 à S6, contrôles d’équipe ; « invalid_settings »). ' +
      'Épreuve par équipes en relais FIE à formule d’équipe : réglage plat reporté dans la formule et jugé ; réglage de structure qui la retirerait refusé (« invalid_settings », passer par updateCompetitionFormula). Tablettes prévenues.',
    input: z.object({
      competitionId: CompetitionId,
      weapon: WeaponEnum.optional(),
      gender: GenderEnum.optional(),
      category: CategoryEnum.optional(),
      isTeamEvent: z.boolean().optional(),
      settings: SettingsPatch.optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      competitionId: z.string(),
      changed: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'competition:write',
  }),

  deleteCompetition: command({
    description:
      'Supprime une épreuve et toutes ses données (RGPD) ; sa saisie distante est arrêtée. Résultats déjà versés au classement de saison conservés.',
    input: z.object({
      competitionId: CompetitionId,
      dryRun: DryRun,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), competitionId: z.string() }),
    permission: 'competition:write',
  }),

  includeInSeason: command({
    description:
      'Verse une épreuve au classement de saison (ou la reverse) : classement Quest calculé par le moteur sur les poules du tour courant. Refus (« no_pools ») sans poules.',
    input: z.object({ competitionId: CompetitionId, dryRun: DryRun, commandId: CommandId }),
    output: z.object({
      dryRun: z.boolean(),
      competitionId: z.string(),
      fencers: z.number().int(),
    }),
    permission: 'competition:write',
  }),

  excludeFromSeason: command({
    description:
      'Retire une épreuve du classement de saison (même supprimée depuis). Refus (« not_in_season ») si elle n’y est pas.',
    input: z.object({ competitionId: Id, dryRun: DryRun, commandId: CommandId }),
    output: z.object({ dryRun: z.boolean(), competitionId: z.string() }),
    permission: 'competition:write',
  }),

  resetSeason: command({
    description: 'Vide le classement de saison (toutes les épreuves versées).',
    input: z.object({ dryRun: DryRun, commandId: CommandId }),
    output: z.object({ dryRun: z.boolean(), competitions: z.number().int() }),
    permission: 'competition:write',
  }),

  registerFencers: command({
    description:
      'Inscrit un ou plusieurs tireurs (docs/adr/0018). Statut initial : non pointé (défaut) ou pointé. ' +
      'Doublons (même licence, sinon mêmes nom et prénom) signalés dans « duplicates », pas refusés.',
    input: z.object({
      competitionId: CompetitionId,
      fencers: z
        .array(
          z.object({
            lastName: Text.min(1),
            firstName: Text.min(1),
            ...FencerDetailsShape,
            ranking: z.number().int().min(1).nullable().optional(),
            status: z.enum(['N', 'P']).optional(),
          })
        )
        .min(1)
        .max(2000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      fencers: z.array(FencerSchema),
      duplicates: z.array(z.object({ index: z.number().int(), fencerId: z.string() })),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  updateFencerDetails: command({
    description:
      'Identité d’un tireur : nom, prénom, naissance, sexe, nation, ligue, club, licence, latéralité, photo. ' +
      'Jamais le statut, le classement ni un score (docs/adr/0018).',
    input: z.object({
      competitionId: CompetitionId,
      fencerId: Id,
      // Strict : statut, classement ou score refusés à l'entrée (docs/adr/0018)
      details: z.strictObject({
        lastName: Text.min(1).optional(),
        firstName: Text.min(1).optional(),
        ...FencerDetailsShape,
      }),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), fencer: FencerSchema, revision: Revision }),
    permission: 'fencers:write',
  }),

  setFencerRankings: command({
    description:
      'Classement d’entrée des tireurs (null : sans classement). Refusé (« draw_done ») une fois les poules tirées ou le tableau généré.',
    input: z.object({
      competitionId: CompetitionId,
      rankings: z
        .array(z.object({ fencerId: Id, ranking: z.number().int().min(1).nullable() }))
        .min(1)
        .max(5000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      updated: z.number().int(),
      unknown: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  unregisterFencers: command({
    description:
      'Désinscrit des tireurs (« fencerIds ») ou tous (« all »). Avant le tirage seulement ; après, retirer le tireur (withdrawFencer).',
    input: z.object({
      competitionId: CompetitionId,
      fencerIds: z.array(Id).max(5000).optional(),
      all: z.boolean().optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      removed: z.array(z.string()),
      unknown: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
  }),

  registerReferees: command({
    description:
      'Inscrit un ou plusieurs arbitres, non pointés (docs/adr/0018). Doublons (licence, ou nom et prénom) signalés dans « duplicates », pas refusés.',
    input: z.object({
      competitionId: CompetitionId,
      referees: z
        .array(z.object({ lastName: Text.min(1), ...RefereeDetailsShape }))
        .min(1)
        .max(1000),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      referees: z.array(RefereeSchema),
      duplicates: z.array(z.object({ index: z.number().int(), refereeId: z.string() })),
      revision: Revision,
    }),
    permission: 'referees:write',
  }),

  updateRefereeDetails: command({
    description:
      'Identité d’un arbitre : nom, prénom, sexe, nation, club, licence, niveau. Jamais sa disponibilité (setRefereeAvailability).',
    input: z.object({
      competitionId: CompetitionId,
      refereeId: Id,
      details: z.strictObject({ lastName: Text.min(1).optional(), ...RefereeDetailsShape }),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), referee: RefereeSchema, revision: Revision }),
    permission: 'referees:write',
  }),

  setRefereeAvailability: command({
    description:
      'Pointage des arbitres : disponibles (« available: true ») ou non pointés. Même effet que l’appel distant.',
    input: z.object({
      competitionId: CompetitionId,
      refereeIds: z.array(Id).min(1).max(1000),
      available: z.boolean(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      status: z.enum(['available', 'unavailable']),
      updated: z.number().int(),
      unknown: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'referees:write',
  }),

  unregisterReferee: command({
    description: 'Désinscrit un arbitre. Refusé (« referee_busy ») s’il arbitre un match en cours.',
    input: z.object({
      competitionId: CompetitionId,
      refereeId: Id,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), refereeId: z.string(), revision: Revision }),
    permission: 'referees:write',
  }),

  withdrawFencer: command({
    description:
      'Retire un tireur de l’épreuve : abandon (médical), forfait ou exclusion (« blackCard » : carton noir). ' +
      'À l’appel : statut seul. En poules : ses matchs non disputés sont perdus (DNS s’il n’a commencé aucun match). ' +
      'Au tableau : son match en cours est perdu, l’adversaire passe. Refus si le tableau est terminé ou si l’adversaire n’est pas encore connu. ' +
      'Épreuve par équipes : statut et motif seuls, rencontres inchangées (remplaçant : substitute_team_fencer). ' +
      '« dryRun: true » donne les matchs perdus sans rien écrire. Annulation : reinstate_fencer.',
    input: z.object({
      competitionId: CompetitionId,
      fencerId: Id.describe('Identifiant du tireur'),
      reason: z.enum(['abandon', 'forfait', 'exclusion']).describe('Motif du retrait'),
      blackCard: z.boolean().optional().describe('Exclusion sur carton noir (rapport fédéral)'),
      matchId: Id.optional().describe('Match où le retrait a lieu (carton, abandon sur la piste)'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      fencerId: z.string(),
      status: z.string(),
      exclusionReason: z.enum(['black_card', 'dns']).nullable(),
      phase: z.enum(['checkin', 'pools', 'tableau']),
      forfeitedMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
    mcp: { name: 'withdraw_fencer', title: 'Retirer un tireur', destructive: true },
  }),

  reinstateFencer: command({
    description:
      'Annule le retrait d’un tireur (abandon, forfait, exclusion) : statut et matchs d’avant le retrait. ' +
      'Refus si un match qui suit a été joué depuis, ou si le tableau a été tiré après un retrait en poules.',
    input: z.object({
      competitionId: CompetitionId,
      fencerId: Id.describe('Identifiant du tireur'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      fencerId: z.string(),
      status: z.string(),
      restoredMatchIds: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'fencers:write',
    mcp: { name: 'reinstate_fencer', title: 'Réintégrer un tireur' },
  }),

  setRefereeingSettings: command({
    description:
      'Réglages d’affectation des arbitres de l’épreuve (neutralité club / nation / ligue, équilibrage de la charge, rotation). Seuls les champs fournis changent ; les autres réglages de l’épreuve sont conservés.',
    input: z.object({
      competitionId: CompetitionId,
      neutrality: Neutrality.optional(),
      balance: z.boolean().optional().describe('Équilibrer la charge entre arbitres'),
      maxConsecutiveMatches: z.number().int().min(1).max(20).optional(),
      minRestTimeMinutes: z.number().int().min(0).max(240).optional(),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({ dryRun: z.boolean(), refereeing: ResolvedRefereeing, revision: Revision }),
    permission: 'referees:write',
    mcp: {
      name: 'set_refereeing_settings',
      title: 'Réglages d’affectation des arbitres',
      idempotent: true,
    },
  }),

  assignReferees: command({
    description:
      'Un arbitre principal par poule sans arbitre, parmi les arbitres pointés, par le même moteur que l’écran (affectation optimale, neutralité selon les réglages de l’épreuve ; un arbitre peut enchaîner plusieurs poules). Une poule sans arbitre neutre reste sans arbitre : « unassigned » donne les arbitres écartés et leurs raisons, « warnings » le résumé. « replace: true » réaffecte toutes les poules.',
    input: z.object({
      competitionId: CompetitionId,
      replace: z.boolean().optional().describe('Réaffecter toutes les poules'),
      includeUnchecked: z.boolean().optional().describe('Accepter les arbitres non pointés'),
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      assignments: z.array(
        z.object({ poolNumber: z.number(), referee: z.string(), refereeId: z.string() })
      ),
      unassigned: z.array(
        z.object({
          poolNumber: z.number(),
          conflicts: z.array(
            z.object({
              referee: z.string(),
              refereeId: z.string(),
              reasons: z.array(NeutralityCriterion),
            })
          ),
        })
      ),
      warnings: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'referees:write',
    mcp: { name: 'assign_referees', title: 'Arbitres des poules', idempotent: true },
  }),

  assignReferee: command({
    description:
      'Arbitre choisi à la main (docs/adr/0014), pour une poule (« poolNumber » : il remplace l’arbitre principal et passe sur les matchs de la poule) ou pour un match (« matchId » : poule ou tableau, ce match seulement). Un arbitre non neutre est accepté et signalé (« conflicts »). « refereeId: null » retire l’arbitre.',
    input: z
      .object({
        competitionId: CompetitionId,
        poolNumber: z.number().int().min(1).optional().describe('Numéro de la poule'),
        matchId: Id.optional().describe('Match de poule ou de tableau (list_matches)'),
        refereeId: Id.nullable().describe('Identifiant de l’arbitre (list_referees), ou null'),
        dryRun: DryRun,
        expectedRevision: ExpectedRevision,
        commandId: CommandId,
      })
      .refine(i => (i.poolNumber === undefined) !== (i.matchId === undefined), {
        message: 'poolNumber ou matchId, l’un des deux exactement',
      }),
    output: z.object({
      dryRun: z.boolean(),
      poolNumber: z.number().nullable(),
      matchId: z.string().nullable(),
      referee: z.string().nullable(),
      conflicts: z.array(NeutralityCriterion),
      warnings: z.array(z.string()),
      revision: Revision,
    }),
    permission: 'referees:write',
    mcp: { name: 'assign_referee', title: 'Arbitre à la main (poule ou match)', idempotent: true },
  }),

  listFencers: query({
    description: 'Tireurs inscrits à une épreuve, dans l’ordre des dossards (dates en ISO 8601).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(FencerSchema),
    permission: 'competition:read',
  }),

  getSeasonRanking: query({
    description:
      'Classement de saison : cumul par tireur (victoires, points Quest, touches) et épreuves versées.',
    input: z.object({}),
    output: z.object({
      ranking: z.array(
        z.object({
          fencerId: z.string(),
          fencerLastName: z.string(),
          fencerFirstName: z.string(),
          fencerClub: z.string().nullable(),
          totalVictories: z.number(),
          totalMatchesPlayed: z.number(),
          totalQuestPoints: z.number(),
          totalQuestV4: z.number(),
          totalQuestV3: z.number(),
          totalQuestV2: z.number(),
          totalQuestV1: z.number(),
          totalTouchesScored: z.number(),
          totalTouchesReceived: z.number(),
          totalRedCards: z.number(),
          competitionCount: z.number(),
          ratio: z.number(),
        })
      ),
      competitions: z.array(
        z.object({
          competitionId: z.string(),
          competitionTitle: z.string(),
          competitionDate: z.string(),
          fencerCount: z.number(),
          addedAt: z.string(),
        })
      ),
    }),
    permission: 'competition:read',
  }),

  getCompetition: query({
    description:
      'Une épreuve : identité, arme, catégorie, statut et réglages (dates en ISO 8601). Tireurs : listFencers ; arbitres : listReferees.',
    input: z.object({ competitionId: CompetitionId }),
    output: CompetitionSchema,
    permission: 'competition:read',
  }),

  getArenaPlan: query({
    description:
      'Plan de salle du planificateur d’arène enregistré sur l’épreuve ; null si aucun (docs/adr/0025).',
    input: z.object({ competitionId: CompetitionId }),
    output: ArenaPlanSchema.nullable(),
    permission: 'competition:read',
  }),

  listCompetitions: query({
    description:
      'Toutes les épreuves du poste, les plus récentes d’abord, avec leur nombre de tireurs.',
    input: z.object({}),
    output: z.array(CompetitionSchema),
    permission: 'competition:read',
  }),

  listReferees: query({
    description:
      'Arbitres d’une épreuve : identité, club, nationalité, niveau et disponibilité (« unavailable » : non pointé). Écran : choix de l’arbitre d’une poule ou d’un match.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(RefereeSchema),
    permission: 'competition:read',
  }),

  listRefereeMatches: query({
    description:
      'Matchs de poule d’une épreuve avec leur arbitre : historique des arbitrages (numéro, poule, tireurs, score, statut).',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        matchId: z.string(),
        matchNumber: z.number(),
        poolName: z.string().nullable(),
        fencerAName: z.string(),
        fencerBName: z.string(),
        scoreA: z.number().nullable(),
        scoreB: z.number().nullable(),
        status: z.string(),
        refereeId: z.string().nullable(),
        refereeName: z.string().nullable(),
      })
    ),
    permission: 'competition:read',
  }),

  getMatchTimeline: query({
    description:
      'Journal d’un match en ordre chronologique : changements de score (auteur, motif), touches, cartons, sorties d’arène.',
    input: z.object({ matchId: Id }),
    output: z.array(MatchEventEntrySchema),
    permission: 'competition:read',
  }),

  getCompetitionTimeline: query({
    description: 'Journal de tous les matchs d’une épreuve, en ordre chronologique.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(MatchEventEntrySchema),
    permission: 'competition:read',
  }),

  getPoolSignatures: query({
    description: 'Signatures de la feuille d’une poule (tablette) : une image par tireur.',
    input: z.object({ poolId: Id }),
    output: z.array(z.object({ fencerId: z.string(), signatureData: z.string() })),
    permission: 'competition:read',
  }),

  listFencerStats: query({
    description:
      'Statistiques de chaque tireur d’une épreuve : touches par zone, touches reçues, cartons, sorties d’arène, durée des matchs. Écran : onglet Statistiques, rapport de fin de tournoi.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(FencerStatsSchema),
    permission: 'competition:read',
  }),

  getFencerStats: query({
    description: 'Statistiques d’un tireur (null si le tireur n’existe pas).',
    input: z.object({ fencerId: Id }),
    output: FencerStatsSchema.nullable(),
    permission: 'competition:read',
  }),

  getFencerHistory: query({
    description:
      'Historique d’un tireur : ses matchs (adversaire, scores, durée), avec touches et cartons de chacun.',
    input: z.object({ fencerId: Id }),
    output: z.object({
      matches: z.array(
        z.object({
          matchId: z.string(),
          number: z.number(),
          opponentId: z.string().nullable(),
          opponentLastName: z.string().nullable(),
          opponentFirstName: z.string().nullable(),
          scoreA: z.string().nullable(),
          scoreB: z.string().nullable(),
          side: z.enum(['A', 'B']),
          status: z.string(),
          startTime: z.string().nullable(),
          endTime: z.string().nullable(),
          duration: z.number().nullable(),
          poolId: z.string().nullable(),
          tableId: z.string().nullable(),
          round: z.number().nullable(),
          touches: z.array(
            z.object({
              id: z.string(),
              zone: z.string(),
              points: z.number(),
              timestamp: z.string(),
              isValidInSuddenDeath: z.boolean(),
              isReversed: z.boolean(),
            })
          ),
          cards: z.array(
            z.object({
              id: z.string(),
              cardType: z.string(),
              reason: z.string(),
              cardGroup: z.number(),
              timestamp: z.string(),
              pointsAwarded: z.number(),
              resultingExclusion: z.boolean(),
            })
          ),
        })
      ),
    }),
    permission: 'competition:read',
  }),

  listRefereeStats: query({
    description:
      'Statistiques des arbitres d’une épreuve : matchs arbitrés, durée moyenne, cartons, appels au DT, repos moyen entre deux matchs.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        refereeId: z.string(),
        refereeName: z.string(),
        matchesCount: z.number(),
        averageDuration: z.number(),
        cardsYellow: z.number(),
        cardsRed: z.number(),
        cardsBlack: z.number(),
        dtCalls: z.number(),
        averageRestSeconds: z.number(),
      })
    ),
    permission: 'competition:read',
  }),

  listMatchTimings: query({
    description:
      'Horodatage des matchs d’une épreuve (début, fin, durée, piste, arbitre) pour les indicateurs d’organisation.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        matchId: z.string(),
        poolId: z.string().nullable(),
        tableId: z.string().nullable(),
        fencerAId: z.string().nullable(),
        fencerBId: z.string().nullable(),
        status: z.string(),
        strip: z.number().nullable(),
        refereeId: z.string().nullable(),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
        duration: z.number().nullable(),
      })
    ),
    permission: 'competition:read',
  }),

  listRemoteEvents: query({
    description:
      'Événements des saisies distantes d’une épreuve : appels au DT, déconnexions, synchronisations hors ligne, erreurs de synchronisation.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.array(
      z.object({
        id: z.string(),
        competitionId: z.string(),
        type: z.enum(['dt_call', 'disconnect', 'offline_sync', 'sync_error']),
        arenaId: z.string().nullable(),
        matchId: z.string().nullable(),
        refereeId: z.string().nullable(),
        detail: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    permission: 'competition:read',
  }),

  getMatchCards: query({
    description: 'Cartons d’un match, en ordre chronologique.',
    input: z.object({ matchId: Id }),
    output: z.array(MatchCard),
    permission: 'cards:read',
  }),

  getCardsByMatchIds: query({
    description: 'Cartons de plusieurs matchs (feuilles imprimées), en ordre chronologique.',
    input: z.object({ matchIds: z.array(z.string()).max(5000) }),
    output: z.array(z.object({ matchId: z.string(), fencerId: z.string(), cardType: z.string() })),
    permission: 'cards:read',
  }),

  getCompetitionEvents: query({
    description:
      'Journal d’une épreuve (#1980) : événements postérieurs à la révision « since » (resynchronisation, audit), auteur, source et heure. Identifiants seulement, pas de noms.',
    input: z.object({
      competitionId: CompetitionId,
      since: z.number().int().min(0).optional().describe('Dernière révision connue (0 : tout)'),
      limit: z.number().int().min(1).max(5000).optional().describe('Nombre maximum (1000)'),
    }),
    output: z.object({ revision: z.number(), events: z.array(JournalEventSchema) }),
    permission: 'competition:read',
    mcp: { name: 'get_competition_events', title: 'Journal d’une épreuve' },
  }),

  getCompetitionState: query({
    description:
      'État de l’épreuve tenu par le moteur (docs/adr/0017) : poules, tours, tableau, tableaux de classement, classements, phase. ' +
      '« revision » : révision du journal, à comparer au signal journal:appended pour savoir s’il faut relire. « preparedPools » : poules écrites en base par une version précédente (lecture seule), vide si l’état a des poules.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.object({
      revision: z.number().int(),
      /** Compteur de l'état de session (sauvegarde de l'écran, jusqu'à l'étape 4c de l'ADR-0017) */
      sessionRevision: z.number().int(),
      state: CompetitionStateSchema.nullable(),
      preparedPools: z.array(z.custom<Pool>()),
    }),
    permission: 'competition:read',
  }),
  getMatchHistory: query({
    description:
      'Historique d’un match dans le journal de l’épreuve : auteur, source, heure de chaque score passé par recordScore (écran, tablettes, appareils de piste, agent). ' +
      'Retraits et réintégrations de tireurs (abandon, forfait, exclusion, carton noir) compris. Corrections de poule après tirage du tableau comprises. Pas encore journalisés (ADR-0005) : épreuves par équipes, tableaux séparés.',
    input: z.object({ competitionId: CompetitionId, matchId: Id }),
    output: z.array(JournalEventSchema),
    permission: 'competition:read',
  }),

  onCompetitionEvents: subscription({
    description: 'Événements de données (tireurs, matchs, session…) d’une épreuve ou de toutes.',
    input: z.object({ competitionId: Id.optional() }),
    output: z.object({
      type: z.string(),
      competitionId: z.string().optional(),
      /** journal:appended : nouvelle révision du journal (#1980) */
      revision: z.number().optional(),
    }),
    permission: 'competition:read',
  }),
  // Espace « Vue DT » du serveur distant (docs/adr/0020)
  ...dtViewOperations,
  // Relevés : historique des scores, commentaires, signatures du tableau, chiffres de l'épreuve
  ...reportOperations,
  // Mode Club : données du poste, jamais sur le réseau (docs/adr/0022)
  ...clubOperations,
  // Poste : réglages, salles, thèmes, journée, RGPD, agent ; jamais sur le réseau (docs/adr/0022)
  ...formulaOperations,
  ...stationOperations,
  // Serveur distant : pilotage et avis, jamais sur le réseau (docs/adr/0022)
  ...remoteOperations,
  // Serveur d'entraînement : pilotage et avis, jamais sur le réseau (docs/adr/0022)
  ...trainingOperations,
  // Appareils de piste : salle, pilotes Cyrano et OPP2, jamais sur le réseau (docs/adr/0023)
  ...devicesOperations,
  // Fichiers de données (.bpm, .bpf, photos, .bpclub) en contenu, jamais sur le réseau (ADR-0021)
  ...fileOperations,
  // Événements simulés du remplissage automatique : données d'essai, sans journal
  ...simulationOperations,
  ...poolRoundOperations, // Clôture d'un tour de poules, ex aequo à la barre (docs/adr/0040)
  ...poolWavesOperations, // Tour en vagues : lancer, arrêter (docs/adr/0043)
  ...splitOperations, // Tableaux séparés : groupe extrait en épreuve séparée (docs/adr/0024)
  ...stripOperations, // Plan des pistes : départ, pistes indisponibles (docs/adr/0015)
  ...teamOperations, // Épreuves par équipes : inscription, poules, relais, tableau (docs/adr/0024)
} satisfies ApiContract;

// ─── Types dérivés ───────────────────────────────────────────────────────────

export type Contract = typeof contract;
export type OperationName = keyof Contract;
type OfKind<K extends OperationKind> = {
  [N in OperationName]: Contract[N]['kind'] extends K ? N : never;
}[OperationName];
export type CommandName = OfKind<'command'>;
export type QueryName = OfKind<'query'>;
export type SubscriptionName = OfKind<'subscription'>;
/** Entrée telle que l'appelant la fournit (champs optionnels compris) */
export type Input<N extends OperationName> = z.input<Contract[N]['input']>;
/** Entrée après validation (valeurs par défaut appliquées) */
export type ParsedInput<N extends OperationName> = z.output<Contract[N]['input']>;
export type Output<N extends OperationName> = z.output<Contract[N]['output']>;
