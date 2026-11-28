# ADR-0045 — Le tableau se tire selon un mode réglé dans la formule (strict, par paires, par groupes, intégral), avec une graine enregistrée et un PV de tirage

- **Statut** : Proposée
- **Date** : 2026-11-28
- **Tickets** : #1948 (lot 1, étape G1 ; formule E1, mode « tableau sans poule ») ; précise [ADR-0036](0036-formule-v2-arbre-par-phase.md) (phase tableau), [ADR-0037](0037-deroule-genere-par-la-formule.md) (D1 : 0 tour, « les modes de tirage relèvent de #1948, lot 1 »), [ADR-0044](0044-equipes-formule-v2.md) (tableau d'équipes au rang d'entrée), [ADR-0041](0041-controles-structure-mode-expert.md) (S6) ; s'appuie sur [ADR-0002](0002-couches-et-dependances.md), [ADR-0007](0007-format-evenement.md), [ADR-0008](0008-nommage-contrat.md), [ADR-0017](0017-projections-etat-epreuve.md), [ADR-0021](0021-services-plateforme.md)

## Contexte

- Le tableau est toujours placé **strictement** au rang : tête de série 1 contre la dernière,
  par la grille `generateSeedingChart` (`planTableau`, `shared/domain/tableau`). En équipes,
  `generateTeamTableau` fait de même, au classement de poule ou au rang d'entrée
  (`teamTableauEntry`, ADR-0044).
- **Sans poule** (formule à 0 tour, ADR-0037 D1) : la commande `skipPools` (`PoolsSkipped`)
  range les tireurs pointés dans l'ordre fourni par l'écran. Les non classés y sont en queue,
  dans un ordre qui ne doit rien au hasard ; aucun ex aequo n'est départagé.
- **En individuel, l'écran planifie le tableau** (`planTableau`) et en envoie le placement
  (`generateTableau` avec `composition`, `useTableauGenerate`). Il le **régénère** quand le
  classement change. Un tableau tiré au sort ne peut pas être refait à chaque rendu.
- Le hasard du moteur est `Math.random`, injecté dans le domaine (ex aequo à la barre, tirage
  des poules) ; **aucune graine n'est gardée**. Seul `tournamentSimulator.ts` a un générateur
  déterministe (`createRng`, mulberry32), hors domaine.
- Le format **E1** (championnat national N1 par équipes) n'est pas réalisable : pas de poule,
  placement au classement, **tirage par paires**. L'épique veut un tirage **reproductible**
  (graine), **affichable** et **imprimable** (PV), le seul moyen de répondre à une contestation.
- Règlement FIE (o.97 à o.102, équipes) : placement au classement FIE, équipes non classées
  tirées au sort à la suite.
- Arbitrage du mainteneur, 2026-11-28 :
  - la séparation club / nation au tirage est **reportée** à un ticket ;
  - la graine est tirée par le moteur, rendue dès l'aperçu, et **rejouable** ;
  - les modes s'appliquent à **tout tableau**, individuel ou équipes, avec ou sans poules avant ;
    défaut : strict ;
  - les non classés sont **tirés au sort** à la suite des classés, avec la même graine.

## Décision

**Modes de tirage**

- On ajoute à la phase tableau de la formule v2 le réglage `draw` (`TableauPhase.draw`) :
  - `'strict'` : placement au rang, comme aujourd'hui ; absent vaut `'strict'` ;
  - `'pairs'` : par paires. Les rangs 1-2, 3-4, 5-6… forment des paires. Les deux membres
    d'une paire sont tirés au sort sur les deux emplacements de leur paire dans la grille ;
  - `'groups'` : par groupes. Les rangs 1 et 2 sont placés. Puis les rangs 3-4, 5-8, 9-16…
    sont tirés au sort sur les emplacements de leur groupe dans la grille ;
  - `'random'` : intégral. Tous les qualifiés sont tirés au sort sur les emplacements 1 à N.
- Le réglage vaut pour tout tableau de la formule : après des poules ou sans poule, en
  individuel ou en équipes, dans une branche de scission comme à la racine. Il ne touche ni la
  coupe (qualification, ex aequo à la barre, ADR-0040) ni la taille du tableau, ni les byes,
  ni les barrages de « toutes les places ».
- **Le tirage attribue des emplacements, pas des rangs.** Le rang d'entrée enregistré sur le
  match (`seedA`, `seedB`, #1996) reste celui du classement. Il sert, comme aujourd'hui, au
  classement des éliminés d'un même tour.

**Non classés et ex aequo à l'entrée**

- Tableau au rang d'entrée (sans poule) :
  - les classés sont rangés par rang d'entrée ;
  - à rang d'entrée égal, ils sont départagés par tirage au sort ;
  - les non classés viennent ensuite, dans un ordre tiré au sort.
- Ce tirage se fait avec la graine du tableau, quel que soit le mode, `'strict'` compris.
- En individuel, est non classé un tireur sans rang (`ranking` absent). En équipes, une équipe
  sans rang saisi ni calculé (`teamEntryRanking`, ADR-0044).
- `skipPools` ne range plus les tireurs pointés dans l'ordre fourni par l'écran. Il les range
  par rang, puis par nom, et laisse au tirage du tableau le départage et l'ordre des non classés.
  Son entrée `fencerIds` ne sert plus qu'à choisir les tireurs.

**Graine et reproductibilité**

- Le tirage est une fonction pure du domaine (`shared/domain/tableau/tableauDraw.ts`,
  ADR-0002). Elle prend :
  - les qualifiés dans l'ordre d'entrée ;
  - le mode ;
  - une graine, entier de 0 à 2³² − 1.

  Elle rend les emplacements et l'ordre retenu. Le générateur (mulberry32) vit dans le domaine,
  sans état global. À graine, mode et qualifiés égaux, le tirage est identique.

- Le moteur tire la graine (`crypto.randomInt`), sauf si la commande en reçoit une.
  `generateTableau` et `generateTeamTableau` acceptent l'entrée facultative `seed`. Elles
  rendent `draw: { mode, seed }`, aperçu (`dryRun`) compris. Rejouer la commande avec la graine
  de l'aperçu donne le tableau de l'aperçu. Le serveur MCP reçoit le même champ (outils
  générés, `npm run docs:mcp`).
- **Le moteur tire, l'écran ne place plus.** Dans deux cas, `generateTableau` refuse une
  `composition` de l'écran (`invalid_composition`) et l'écran demande le tirage au moteur, sans
  placement :
  - un mode autre que `'strict'` ;
  - un tableau au rang d'entrée (sans poule).

  L'écran ne régénère pas un tableau tiré. Il le relit (`getCompetitionState`). Le placement
  strict après des poules garde le chemin actuel.

- **Journal** (ADR-0007) : `TableauGenerated` et `TeamTableauGenerated` portent en plus
  `draw: { mode, seed, order }`, où `order` est la liste des identifiants dans l'ordre d'entrée
  tiré. La charge reste faite d'identifiants et de nombres. La projection (ADR-0017) rejoue ce
  champ.
- **État** (JSON de session, sans migration de schéma) : chaque tableau garde son tirage dans
  `tableauDraw` : `{ mode, seed, at, order }`. Pour les tableaux séparés (ADR-0024), il est
  rangé avec le tableau de son groupe. Il est effacé avec le tableau (`clearTableau`). Un
  nouveau tirage tire une nouvelle graine, sauf si on lui en passe une.

**Affichage et PV de tirage**

- L'écran du tableau affiche le mode et la graine d'un tableau tiré.
- Un **PV de tirage** s'imprime par les services de plateforme (ADR-0021). Il est construit
  par une fonction du domaine (`tableauDrawReport`), à partir de l'état et des inscrits, et
  l'heure est injectée. Il porte :
  - l'épreuve, le tableau (et son groupe), la date et l'heure du tirage ;
  - le mode et la graine ;
  - pour chaque qualifié : rang d'entrée, nom, club (ou nation), emplacement, et la mention
    « non classé · tiré au sort » ou « départagé par tirage » le cas échéant.

**Éditeur et contrôles**

- L'éditeur de formule règle `draw` sur la carte du tableau (liste « Placement »), en mode
  normal.
- `draw` est un réglage de structure du tableau. Une fois le tableau tiré, il ne change plus
  (S6, comme la petite finale et « toutes les places »). Cette phrase demande un amendement de
  l'ADR-0041 (S6), soumis au mainteneur avec cette ADR.
- Aucun réglage plat ne porte `draw` : il ne vit que dans la formule (ADR-0036). Une épreuve
  sans formule enregistrée reste en placement strict.

**Hors de cette décision**

- La séparation club / nation au tirage fait l'objet d'un ticket à part.
- Le classement de toutes les places en équipes et l'export XML multi-`SuiteDeTableaux`
  relèvent du lot 2 (étape G2). Les exemptions et le tableau préliminaire relèvent du lot 3.

## Conséquences

- **Le format E1 devient réalisable** : 0 tour, tableau d'équipes par paires, graine et PV. Il
  manque seulement les places tirées en équipes (G2).
- **Une épreuve existante se rejoue à l'identique.** Sans `draw`, le placement reste strict, et
  les matchs enregistrés ne changent pas. Les événements antérieurs sans `draw` restent lisibles.
- **Changement de comportement** : sans poule, les non classés et les ex aequo d'entrée ne
  suivent plus l'ordre de l'écran. Ils sont tirés au sort, et le PV le dit.
- L'écran ne compose plus le tableau d'un tirage. Ce chemin de moins réduit les écarts entre
  l'écran et le moteur.
- `generateSeedingChart` (`shared/utils/tableCalculations.ts`) reste la grille unique. Le
  tirage ne fait que permuter les entrées sur ses emplacements.
- Tests attendus :
  - par mode, à graine fixe : emplacements attendus, et rangs de chaque groupe ou paire
    respectés ;
  - même graine, même tirage ;
  - non classés et ex aequo tirés ;
  - `seedA` et `seedB` égaux au rang d'entrée ;
  - refus de la `composition` ;
  - aperçu puis tirage avec la graine de l'aperçu ;
  - journal et projection ;
  - verrou S6 ;
  - PV.
