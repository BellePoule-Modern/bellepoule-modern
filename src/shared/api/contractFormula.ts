/**
 * BPM - Escrime - Contrat : formule d'une épreuve (#2013 étape B2, docs/adr/0033)
 * getCompetitionFormula, applyFormulaTemplate, updateCompetitionFormula : grammaire de la
 * frise et validation du domaine ; écriture des réglages sans événement du journal (ADR-0018).
 * Licensed under GPL-3.0
 */
import { z } from 'zod';
import {
  command,
  CommandId,
  CompetitionId,
  DryRun,
  ExpectedRevision,
  query,
  Revision,
} from './contractDef';
import { Category, Weapon, type CustomFormulaConfig } from '../types';
import type { FormulaDraft } from '../domain/formula/formulaDraft';
import type { FormulaV2 } from '../domain/formula/formulaV2';
import type { CoherenceIssue } from '../utils/formulaCoherence';

const WeaponEnum = z.enum(Weapon);
const CategoryEnum = z.enum(Category);
/** Modèle de formule (docs/adr/0033) */
export const TemplateId = z
  .string()
  .min(1)
  .max(200)
  .describe('Modèle de formule (list_formula_templates)');

export const formulaOperations = {
  // ── Formule d'une épreuve (docs/adr/0033) : grammaire de la frise, validée par le moteur ──
  getCompetitionFormula: query({
    description:
      'Formule d’une épreuve : phases de la frise (clés pool-0, pool-1…, quest, tableau), réglages, briques autorisées à chaque position (insertOptions[i] : avant la phase i ; dernier : en fin), origine, état standard / adapted / free et écarts au modèle, relevé de cohérence avec la catégorie.',
    input: z.object({ competitionId: CompetitionId }),
    output: z.object({
      competitionId: z.string(),
      weapon: WeaponEnum,
      category: CategoryEnum,
      isTeamEvent: z.boolean(),
      model: z.enum(['draft', 'custom']),
      phases: z.array(
        z.object({ kind: z.string(), key: z.string(), round: z.number().optional() })
      ),
      insertOptions: z.array(z.array(z.enum(['pool', 'quest', 'tableau', 'split']))),
      formula: z
        .custom<FormulaV2>()
        .describe('Formule v2 (docs/adr/0036) : phases et réglages de chaque tour'),
      draft: z.custom<FormulaDraft>().optional(),
      customFormula: z.custom<CustomFormulaConfig>().optional(),
      coherence: z.array(z.custom<CoherenceIssue>()),
      origin: z.object({ templateId: z.string(), season: z.string().optional() }).nullable(),
      originName: z.string().nullable(),
      state: z.enum(['standard', 'adapted', 'free']),
      deviations: z.array(
        z.object({ field: z.string(), expected: z.unknown(), actual: z.unknown() })
      ),
    }),
    permission: 'competition:read',
    mcp: { name: 'get_competition_formula', title: 'Lire la formule d’une épreuve' },
  }),

  applyFormulaTemplate: command({
    description:
      'Applique un modèle de formule (list_formula_templates) compatible avec l’arme, la catégorie et le type de l’épreuve ; l’origine est enregistrée. Formule de l’arme « Autre » figée après le tirage (draw_done).',
    input: z.object({
      competitionId: CompetitionId,
      templateId: TemplateId,
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
    mcp: { name: 'apply_formula_template', title: 'Appliquer un modèle de formule' },
  }),

  updateCompetitionFormula: command({
    description:
      'Modifie la formule d’une épreuve par une liste d’opérations appliquées dans l’ordre, tout ou rien : insertPhase (brique pool | quest | tableau | split, position « at » comme insertOptions ; split : scission, toujours en dernier, après un tour de poules ou un tableau arrêté, docs/adr/0039), removePhase (clé de phase), setPhase (clé, réglages de cette phase seule : tour de poules sizeMin, sizeMax, maxScore, timerSeconds, qualification { mode all | percentage | fixed_count | fixed_bracket | pool_winner | pool_heads, count, percentage } ou qualifiers ; pool_heads, têtes de poule puis suivants jusqu’à count (premiers de chaque poule, puis deuxièmes… ; ordre d’entrée au tableau : au moins deux rangs de poule pris en entier, rang par rang, chacun dans l’ordre des poules (A1, B1, A2, B2), sinon tous les qualifiés dans l’ordre du classement général ; réglage avancé, avant un tableau ; plus de poules que de qualifiés refusé ; ex aequo à la barre sur le dernier rang pris ; docs/adr/0043), seeding previous_round | cumulative, boutOrder fie | free | waves | waves_classic (réglage avancé ; vagues : poules de 2 à 10, vagues classiques de 2 à 15, docs/adr/0043), distribution serpentine | byLevel (expert : équipes de même niveau regroupées, du plus faible au plus fort ; null : serpentin, docs/adr/0043), scoring, teamMatch ; tableau maxScore, timerSeconds, thirdPlace, allPlaces, scoring, draw strict | pairs | groups | random (mode de tirage : strict au rang, par paires 1-2, 3-4…, par groupes 3-4, 5-8, 9-16…, intégral ; null : strict ; figé une fois le tableau tiré, docs/adr/0045), teamMatch ; Tour Quest qualifiersCount ; scission criterion gender | category | rank | manual, branches [{ label, phases, gender, categories, take, stayInCompetition }] ; stayInCompetition : scission par sexe, toutes les branches réduites à un tableau ou aucune (compétition couplée, tableaux séparés dans l’épreuve) ; « tableau » règle alors le tableau des branches restées), setGeneral (restTimeSeconds, ruleSet, entry { kind individual } ou { kind team, size 2, levels [du plus faible, niveau 1, au plus fort] } (binômes, expert ; null : individuelle, docs/adr/0043) ; rankingFilters [category | gender | level | handicap] (expert : filtres proposés pour le classement final affiché, les PDF et le CSV ; renumérote depuis 1, un affichage sans compétition fille ni publication distincte ; null ou liste vide : aucun filtre, docs/adr/0043) ; tieBreakByVictory (arme « Autre » : une égalité en fin de temps se tranche par un vainqueur désigné, tirage au sort puis minute supplémentaire, comme l’épée, le fleuret, le sabre et le Sabre Laser ; true ou null : selon l’arme, docs/adr/0043) ; teamMatch { starters 2-4, reserves 0-2, relayStep, relayOrder fie | rotation } (épreuve par équipes en relais FIE : règle de rencontre de la formule, surchargée champ par champ par le teamMatch d’un tour de poules ou du tableau ; fie à 3 titulaires seulement, imposé à 3 titulaires en épée, fleuret et sabre (rotation refusée, o.99.3) ; null : réglages d’épreuve ; briques admises : un tour de poules puis un tableau, ou un tableau seul, sinon team_brick_unsupported, docs/adr/0044); postPoolSplitCriteria : gender pose la compétition couplée, scission par sexe dont les deux branches restent, null la retire). Les anciens noms poolMaxScore, poolTimerSeconds, poolSizeMin, poolSizeMax, poolBoutOrder s’appliquent à tous les tours. Bornes jugées tour par tour, structure contrôlée (au moins une phase de combat, nombre de qualifiés suffisant et réparti en poules, branche terminée par une phase qui classe, phases déjà commencées de l’épreuve conservées, avec la règle de qualification qui y mène ou qui sort d’un tour de poules clos, docs/adr/0041) ; refus : invalid_settings, une remarque par ligne avec la clé de la phase en cause ([pool-0], [tableau], [split], [formule] pour la formule entière), draw_done.',
    input: z.object({
      competitionId: CompetitionId,
      operations: z
        .array(
          z.discriminatedUnion('op', [
            z.strictObject({
              op: z.literal('insertPhase'),
              brick: z.enum(['pool', 'quest', 'tableau', 'split']),
              at: z.number().int().min(0).max(20),
            }),
            z.strictObject({ op: z.literal('removePhase'), phase: z.string().max(40) }),
            z.strictObject({
              op: z.literal('setPhase'),
              phase: z.string().max(40),
              settings: z.record(z.string(), z.unknown()),
            }),
            z.strictObject({
              op: z.literal('setGeneral'),
              settings: z.record(z.string(), z.unknown()),
            }),
          ])
        )
        .min(1)
        .max(50),
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
    mcp: { name: 'update_competition_formula', title: 'Modifier la formule d’une épreuve' },
  }),

  closeTableauStage: command({
    description:
      'Clôt un tableau arrêté à N tireurs (formule enregistrée, docs/adr/0037) : quand tous les matchs avant l’arrêt sont joués, les N restants passent à la phase suivante (classement = rang d’entrée), les éliminés sortent (classés par tour atteint puis rang d’entrée). Refus : invalid_settings (formule sans tableau arrêté suivi d’une phase), tableau_stage_not_complete.',
    input: z.object({
      competitionId: CompetitionId,
      dryRun: DryRun,
      expectedRevision: ExpectedRevision,
      commandId: CommandId,
    }),
    output: z.object({
      dryRun: z.boolean(),
      stopAt: z.number().int(),
      qualified: z.number().int(),
      eliminated: z.number().int(),
      revision: Revision,
    }),
    permission: 'score:write',
    mcp: { name: 'close_tableau_stage', title: 'Clore le tableau arrêté', destructive: true },
  }),
};
