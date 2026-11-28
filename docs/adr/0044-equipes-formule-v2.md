# ADR-0044 — Les épreuves par équipes (relais FIE) suivent la formule v2 : règle de rencontre par phase, poules d'équipes, rang d'entrée (migration 55)

- **Statut** : Acceptée (validée par le mainteneur le 2026-11-27) ; amendée le 2026-11-27 (formule d'équipe reconnue par `general.teamMatch`, rangs saisis devant les rangs calculés, classement de poules au ratio V/M, remplaçant choisi ; validé par le mainteneur) ; amendée le 2026-11-27 (ordre FIE imposé à 3 titulaires en épée, fleuret et sabre, o.99.3 ; validé par le mainteneur) ; amendée le 2026-11-27 (réglage plat de structure refusé pour une formule d'équipe ; validé par le mainteneur) ; amendée le 2026-11-28 (tableau sans poule : rang égal et sans rang tirés au sort, ADR-0045 ; validé par le mainteneur)
- **Date** : 2026-11-27
- **Tickets** : #1948 (lot 0, étape G0), #1043 ; précise [ADR-0036](0036-formule-v2-arbre-par-phase.md) (phases), [ADR-0024](0024-tableaux-separes-equipes-moteur.md) (équipes par le moteur), [ADR-0040](0040-ex-aequo-a-la-barre.md) (coupe), [ADR-0041](0041-controles-structure-mode-expert.md) (contrôles) ; s'appuie sur [ADR-0007](0007-format-evenement.md), [ADR-0008](0008-nommage-contrat.md), [ADR-0011](0011-migrations-schema-3-0.md), [ADR-0028](0028-cartons-equipe-moteur.md)

## Contexte

- Une épreuve par équipes (`isTeamEvent`) se déroule par des commandes propres
  (`generateTeamPools`, `generateTeamTableau`, `recordRelayScore`…, `contractTeams.ts`),
  journalisées (ADR-0024). Le déroulé est **figé** :
  - **poules** : une seule poule, tous contre tous, dans l'ordre alphabétique (`planTeamPools`) ;
  - **tableau** : placé au classement de poule, sans petite finale (`teamTableau.ts`) ;
  - **phases de l'écran** : fixes (checkin, teams, teampool, teamtableau, teamranking).
- La formule v2 affichée pour une épreuve par équipes est la frise individuelle. **Personne ne
  la lit**, et `formulaV2Issues` n'a aucune règle propre aux équipes.
- La règle de rencontre est faite de réglages d'épreuve posés à la création :
  - `minTeamSize` (titulaires) ;
  - `teamReserveCount` (remplaçants, contrôlé seulement par l'écran) ;
  - `teamRelayStepSize` (palier) ;
  - `teamFormat` (`fie-relay` ou `laser-arena`).

  L'ordre des relais se déduit de l'arme et de la taille : ordre FIE o.99.3 à 3 titulaires en
  épée, fleuret et sabre, rotation sinon (`relayOrderFor`).

- **Pas de rang d'entrée d'équipe** : table `teams` (migration 13) sans colonne de rang ; les
  équipes sont triées par nom. Le carton noir P le relève (`teamCards.ts`). Le serpentin, le
  placement du tableau et le tirage par paires du N1 (lot 1) en ont besoin.
- **Classement final des équipes** : calculé par l'écran seulement (`computeTeamFinalRanking`,
  PDF et exports).
- L'**arène Sabre Laser** (`laser-arena`) est un format à part, au calendrier figé : poules
  A/B/C pour 8 ou 12 équipes, équipes assesseurs, évitement de revanche.
- Arbitrage du mainteneur, 2026-11-27 :
  - la formule s'appuie sur la table `teams` et les relais ; les binômes de l'ADR-0043 restent
    aux formules de type rapières ;
  - la règle de rencontre est générale, et chaque phase peut la surcharger ;
  - les poules d'équipes fonctionnent comme en individuel ;
  - le rang d'entrée est une colonne, avec un calcul de secours ;
  - l'arène reste hors formule.

## Décision

**Portée**

- On fait suivre la formule v2 aux épreuves par équipes en **relais FIE**
  (`teamFormat` ≠ `laser-arena`), toutes armes.
- Une épreuve en **arène Sabre Laser** garde son format figé. Sa formule reste celle d'un
  modèle fixe, non modifiable, et les commandes d'arène ne la lisent pas.
- `isTeamEvent` reste un réglage d'épreuve, figé après le tirage (inchangé).

**Règle de rencontre**

- On ajoute à la formule un type `TeamMatchRule` :
  - `starters` : titulaires, de 2 à 4 ;
  - `reserves` : remplaçants, de 0 à 2 ;
  - `relayStep` : palier en touches ;
  - `relayOrder` : `'fie'` (o.99.3, 3 titulaires seulement) ou `'rotation'`. À 3 titulaires en
    épée, fleuret et sabre, l'ordre FIE est imposé et la rotation refusée (o.99.3 : ordre
    impératif dans les trois armes) ; la rotation reste possible pour le Sabre Laser, l'arme
    « Autre » et les équipes de 2 ou 4. _(Amendé le 2026-11-27 : remplace « `'fie'` (o.99.3, 3
    titulaires seulement) ou `'rotation'`. » seule.)_

  La cible d'une rencontre reste `relayStep × starters²`.

- **Où elle se règle** : `general.teamMatch` pour la formule entière. Un tour de poules ou un
  tableau peut la surcharger par `teamMatch`, champ par champ. Le domaine lit la règle d'une
  phase par `teamMatchRuleOf(formula, ref)`. Ce champ n'est lu que si l'épreuve est par équipes.
- **Formule d'équipe** : une formule enregistrée fait foi pour le déroulé par équipes si elle
  porte `general.teamMatch`. Le moteur le pose à toute écriture de la formule d'une épreuve par
  équipes en relais FIE, et à sa création. Une épreuve existante dont la formule ne le porte
  pas garde la poule unique jusqu'à la prochaine écriture de sa formule. _(Amendé le
  2026-11-27 : ajoute la reconnaissance d'une formule d'équipe ; l'ADR ne disait pas comment
  distinguer une formule « individuelle » enregistrée.)_
- **Réglage plat de structure** : pour une épreuve par équipes en relais FIE dont la formule porte
  `general.teamMatch`, un réglage plat de structure écrit sans `formula` (tours, tableau…) qui
  retirerait la formule d'équipe est refusé (`invalid_settings`, renvoi à
  `updateCompetitionFormula`), par exception à l'ADR-0036 (écriture). Un changement d'arme avant le
  tirage la retire toujours. _(Amendé le 2026-11-27 : ajoute cette exception ; sans elle,
  l'épreuve retomberait en poule unique sans le dire.)_
- **Formule absente** (épreuve existante) : la règle se lit dans les réglages d'épreuve
  actuels :
  - `minTeamSize` donne `starters` ;
  - `teamReserveCount` donne `reserves` (1 par défaut) ;
  - `teamRelayStepSize` donne `relayStep` (5 par défaut) ;
  - `relayOrderFor` donne `relayOrder`.

  **Une épreuve existante se rejoue à l'identique.** Les réglages plats restent écrits
  (`flatSettingsOf`, ADR-0036 amendée), depuis la règle générale.

- Les relais d'une rencontre sont figés à sa création, avec la règle de sa phase. Une
  rencontre déjà créée ne change pas si la formule change ensuite.
- **Rôle du moteur** : il contrôle les remplaçants (`reserves`) à l'inscription
  (`assignTeamFencer`) et au remplacement (`substituteTeamFencer`). Aujourd'hui, seul l'écran le
  fait. Le remplaçant qui entre se choisit (`inFencerId`, facultatif ; absent : le premier
  remplaçant). _(Amendé le 2026-11-27 : ajoute le choix du remplaçant.)_

**Phases d'une épreuve par équipes**

- **Briques admises** : un tour de poules, puis un tableau ; ou un tableau seul. Le Tour Quest,
  la scission, le tour en vagues, les têtes de poule et l'entrée en binômes sont refusés pour
  une épreuve par équipes : nouvelle remarque bloquante `team_brick_unsupported`, sur la phase.
  Plusieurs tours de poules d'équipes : refusés en G0 (même remarque), ouverts plus tard par
  amendement.
- **Tour de poules d'équipes**, avec les réglages du tour individuel :
  - taille de poule et nombre de poules ;
  - répartition en serpentin au **rang d'entrée** de l'équipe ;
  - séparation par club ;
  - ordre des rencontres (tables de l'ordre officiel pour la taille de poule) ;
  - qualification vers le tableau : tous, nombre, pourcentage, avec les ex aequo à la barre
    (`cutAtBar`, ADR-0040).

  Une poule unique tous contre tous en est le cas particulier : une poule de la taille de
  l'effectif.

- **Classement de poule**, toutes poules confondues : ratio victoires / rencontres, puis indice
  des relais, puis indice des touches. Une poule unique donne le classement d'aujourd'hui.
  _(Amendé le 2026-11-27 : remplace « inchangé (victoires, indice des relais, indice des
  touches) » ; avec des poules de tailles inégales, les victoires brutes désavantagent les
  petites poules.)_
- **Tableau d'équipes** : placé au classement d'entrée du tableau, c'est-à-dire le classement
  de poule ou, sans poule, le rang d'entrée. La petite finale (`thirdPlace`) se règle dans la
  formule. « Toutes les places » en équipes relève du lot 2 (G2) : refusé en G0
  (`team_brick_unsupported`).
- **Commandes** : `generateTeamPools` et `generateTeamTableau` lisent la formule par
  `phaseSettings`. Elles gardent leur nom, leur contrat et leurs événements
  (`TeamPoolsGenerated`, `TeamMatchScheduled`, `TeamTableauGenerated`). Leur charge porte déjà
  les identifiants de rencontre et d'équipe (ADR-0007) : la répartition est rejouée depuis
  l'événement, jamais recalculée. Un nouveau champ facultatif `poolCount` s'ajoute à
  `generateTeamPools`, comme pour `generatePools`.
- L'écran tire les phases d'une épreuve par équipes de la formule. La phase teampool n'apparaît
  que si la formule a un tour de poules.

**Rang d'entrée d'une équipe**

- **Migration 55**, additive : colonne `teams.ranking INTEGER NULL` (rang d'entrée, 1 = le
  meilleur), sans valeur par défaut.
- **Saisie et import** :
  - le rang se saisit à l'inscription et à la modification de l'équipe : champ facultatif
    `ranking` de `registerTeam` et nouvelle commande `updateTeam` (ADR-0018 : pas de journal,
    refusée après le tirage) ;
  - il s'importe quand le fichier fédéral le porte.
- **Rang effectif**, calculé par le domaine (`teamEntryRanking`) :
  1. `ranking` saisi ;
  2. à défaut, la somme des classements des titulaires, à condition que chacun en ait un ;
  3. puis le nom.

  Les équipes au rang saisi passent devant celles au rang calculé, chacune dans l'ordre de son
  rang ; puis les équipes sans rang, au nom. Les deux échelles ne se mélangent pas. _(Amendé le
  2026-11-27 : remplace « Les équipes classées passent devant les autres. ».)_ Le rang effectif
  sert au serpentin, au
  placement du tableau sans poule, et au carton noir P (au lieu du nom). Pour le placement du
  tableau sans poule, les équipes à rang effectif égal et les équipes sans rang ne suivent pas le
  nom : elles sont tirées au sort avec la graine du tableau ([ADR-0045](0045-tirage-du-tableau.md)).
  _(Amendé le 2026-11-28 : ajoute cette phrase ; l'ordre au nom reste celui de l'affichage, du
  serpentin et du carton noir P.)_

**Contrôles et classement final**

- `formulaV2Issues` reçoit `teamFormat` dans son scope et applique :
  - la remarque `team_brick_unsupported` ;
  - les bornes de `TeamMatchRule` ;
  - S3 et S4 sur l'effectif d'équipes : nombre de qualifiés suffisant, poules réalisables.
- Le classement final des équipes passe dans le domaine (`teamFinalRanking`, depuis
  `computeTeamFinalRanking`) et dans `getCompetitionState.teams`, pour l'écran, les PDF, les
  exports et le MCP. Le résultat reste celui d'aujourd'hui : perdants ex aequo par tour,
  départagés par le classement d'entrée du tableau.

## Conséquences

- Étape G0, en PR draft sans auto-merge (#1948, architecture) :
  - domaine : `TeamMatchRule`, `teamMatchRuleOf`, `teamEntryRanking`, `planTeamPools`
    généralisé, `teamFinalRanking`, contrôles ;
  - migration 55 ;
  - moteur : `generateTeamPools` et `generateTeamTableau` sur la formule, contrôle des
    remplaçants, `updateTeam` ;
  - éditeur : règle de rencontre, briques admises ;
  - écran des équipes : phases générées, saisie du rang ;
  - MCP : `update_team`, `poolCount` ; `npm run docs:mcp`.
- Rejeu : les événements d'équipe ne changent pas de forme. Les épreuves existantes, sans
  formule ou avec une formule « individuelle » enregistrée, sont relues avec la règle de leurs
  réglages et une poule unique. Un test sur une épreuve réelle le prouve.
- Restent hors G0 :
  - le tirage du tableau sans poule par paires ou par groupes FIE (G1) ;
  - toutes les places en équipes (G2) ;
  - plusieurs tours de poules d'équipes ;
  - l'arène dans la formule.

## Alternatives écartées

- **Règle de rencontre au niveau de l'épreuve seulement** : interdit un palier différent entre
  poules et tableau.
- **Équipes en tireurs-équipes (binômes)** : il faudrait reprendre le moteur de relais, les
  cartons d'équipe et les données existantes ; écarté par le mainteneur.
- **Rang d'équipe calculé seulement** : un classement national des équipes, qui existe à la
  FFE, ne pourrait pas être saisi.
- **Arène en briques de formule** : son calendrier figé n'a pas d'autre usage.
