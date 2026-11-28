/**
 * BPM - Escrime - Briques du contrat d'API (#1981) : forme d'une opération, droits,
 * constructeurs command / query / subscription, schémas communs. Partagées par contract.ts et
 * les groupes d'opérations déclarés à part (contractDtView.ts).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import { FENCER_CATEGORIES } from '../domain/fencers/fencerCategory';

/** Droits (utilisés par le sous-ticket 4, rôles et permissions) */
export type Permission =
  | 'competition:read'
  | 'competition:write'
  | 'fencers:write'
  | 'score:write'
  | 'cards:read'
  | 'referees:write'
  | 'club:read'
  | 'club:write'
  | 'station:admin'
  | 'remote:admin';

/**
 * Droits des fonctions du poste (docs/adr/0022) : jamais servis sur le réseau, jamais journalisés
 * (ce ne sont pas des faits de l'épreuve), hors de la transaction du journal (runCommand).
 */
export const STATION_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'club:read',
  'club:write',
  'station:admin',
  'remote:admin',
]);

export type OperationKind = 'command' | 'query' | 'subscription';

/** Exposition comme outil MCP : écriture pour une commande, lecture pour une requête */
export interface McpExposure {
  name: string;
  title: string;
  destructive?: boolean;
  idempotent?: boolean;
}

export interface OperationDef<
  K extends OperationKind = OperationKind,
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  kind: K;
  /** Description (documentation, outil MCP) */
  description: string;
  input: I;
  output: O;
  permission: Permission;
  mcp?: McpExposure;
}

type Def<K extends OperationKind, I extends z.ZodType, O extends z.ZodType> = Omit<
  OperationDef<K, I, O>,
  'kind'
>;

export const command = <I extends z.ZodType, O extends z.ZodType>(d: Def<'command', I, O>) => ({
  kind: 'command' as const,
  ...d,
});
export const query = <I extends z.ZodType, O extends z.ZodType>(d: Def<'query', I, O>) => ({
  kind: 'query' as const,
  ...d,
});
export const subscription = <I extends z.ZodType, O extends z.ZodType>(
  d: Omit<Def<'subscription', I, O>, 'mcp'>
) => ({ kind: 'subscription' as const, ...d });

export type ApiContract = Record<string, OperationDef>;

// ─── Schémas communs ─────────────────────────────────────────────────────────

export const Id = z.string().trim().min(1).max(200);
export const CompetitionId = Id.describe('Identifiant de la compétition (list_competitions)');
/** Tableaux séparés après les poules (docs/adr/0024) : groupe d'un tableau */
export const SplitGroup = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .optional()
  .describe(
    'Tableaux séparés après les poules : groupe du tableau (« F », « M »), exigé pour ce format'
  );
export const DryRun = z.boolean().optional().describe('Décrit le résultat sans rien écrire');
/** Ex aequo à la barre pour cette coupe seulement (docs/adr/0040) ; prime sur la formule */
export const TiesAtBarInput = z
  .enum(['all', 'initial_ranking', 'draw', 'barrage'])
  .optional()
  .describe(
    'Ex aequo à la barre, pour cette coupe seulement (prime sur la formule) : all = tous qualifiés, initial_ranking = départagés par le rang d’entrée du tour, draw = tirage au sort (FIE o.73.2.f) ; barrage pas encore disponible (refus invalid_settings)'
  );
/** Ex aequo à la barre au-delà du quota, rendus par la simulation (docs/adr/0040) */
export const TiedAtBarSchema = z.object({
  rank: z.number().int(),
  fencerIds: z.array(z.string()),
  places: z.number().int(),
});
export const ExpectedRevision = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    'Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées.'
  );
/** Révision du journal après la commande (absente si rien n'a été écrit) */
export const Revision = z.number().int().optional();
export const CommandId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau)'
  );

/** Tireur exposé par le contrat (listFencers, dates en ISO 8601) */
/** Catégorie d'âge du tireur (docs/adr/0039) : entrée des commandes d'inscription */
export const FencerCategoryField = z
  .enum(FENCER_CATEGORIES)
  .nullable()
  .optional()
  .describe('Catégorie d’âge (U9 … U20, SEN, V1 … V4 ; null : effacée, docs/adr/0039)');

/** Membre d'une équipe (entrée en binômes, docs/adr/0043) */
export const FencerMemberSchema = z.object({
  lastName: z.string().trim().max(200),
  firstName: z.string().trim().max(200),
  gender: z.enum(['M', 'F']).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('AAAA-MM-JJ'),
});

/** Membre lu (sortie) : indulgent sur la date, qui peut venir d'un import ancien */
const FencerMemberOutSchema = FencerMemberSchema.extend({ birthDate: z.string().optional() });

/** Entrée en équipes (docs/adr/0043) : champs optionnels des commandes d'inscription */
export const FencerTeamEntryShape = {
  members: z
    .array(FencerMemberSchema)
    .max(10)
    .nullable()
    .optional()
    .describe(
      'Équipe (binôme) : membres de l’équipe, le tireur porte le nom d’équipe ; null : effacés. Catégorie (moyenne des années de naissance) et sexe de l’équipe déduits quand ils ne sont pas donnés (docs/adr/0043)'
    ),
  level: z
    .number()
    .int()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe(
      'Niveau de l’équipe : indice (dès 1) dans les niveaux de la formule, du plus faible au plus fort'
    ),
  handicap: z.boolean().nullable().optional().describe('Marqueur « HANDI » de l’équipe'),
};

export const FencerSchema = z.object({
  id: z.string(),
  ref: z.number(),
  lastName: z.string(),
  firstName: z.string(),
  birthDate: z.string().nullable(),
  category: z.string().nullable(),
  gender: z.string(),
  nationality: z.string(),
  region: z.string().nullable(),
  department: z.string().nullable(),
  club: z.string().nullable(),
  license: z.string().nullable(),
  ranking: z.number().nullable(),
  handedness: z.enum(['R', 'L']).nullable(),
  status: z.string(),
  exclusionReason: z.string().nullable(),
  seedNumber: z.number().nullable(),
  initialRanking: z.number().nullable(),
  finalRanking: z.number().nullable(),
  members: z.array(FencerMemberOutSchema).nullable(),
  level: z.number().nullable(),
  handicap: z.boolean().nullable(),
  photo: z.string().nullable(),
});

/** Graine du tirage du tableau (docs/adr/0045) ; absente : tirée par le moteur */
export const TableauDrawSeed = z
  .number()
  .int()
  .min(0)
  .max(0xffffffff)
  .optional()
  .describe('Graine du tirage (0 à 2³² − 1) ; absente : tirée par le moteur');
/** Tirage rendu par generateTableau / generateTeamTableau, aperçu compris (docs/adr/0045) */
export const TableauDrawSummary = z.object({
  mode: z.enum(['strict', 'pairs', 'groups', 'random']),
  seed: z.number().int(),
});
