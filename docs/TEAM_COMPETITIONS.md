# Compétitions par équipes

## Principe général (règlement FIE)

Une compétition par équipes oppose des équipes de **N tireurs titulaires** (+ un nombre
configurable de réservistes). Un match d'équipe se dispute en **relais** : chaque
titulaire d'une équipe affronte chaque titulaire de l'équipe adverse exactement une
fois, soit **N² relais** au total (9 relais pour des équipes de 3, conformément au
règlement FIE).

**Ordre des relais** (`relayOrderFor`, `teamCalculations.ts`) :

| Arme                                                                                          | Ordre                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Épée, fleuret, sabre (3 titulaires)                                                           | Ordre officiel FIE (Règlement d'organisation, o.99.3) : 3-6, 1-5, 2-4, 1-6, 3-4, 2-5, 1-4, 2-6, 3-5 (équipe A = 1-2-3, équipe B = 4-5-6) |
| Sabre Laser (règlement ASL-FFE, relais et arène), arme à la carte, autre nombre de titulaires | Rotation diagonale : 1-4, 2-5, 3-6, 1-5, 2-6, 3-4, 1-6, 2-4, 3-5                                                                         |

Le choix est fait à la création des rencontres : les rencontres déjà générées gardent leur ordre.

Les relais sont **progressifs** : le score de la rencontre est le cumul des touches
(ou points) marqués par chaque équipe sur l'ensemble des relais déjà joués. Chaque
relais s'arrête dès que le cumul d'une équipe atteint le palier de ce relais
(5-10-15-…-45 pour des équipes de 3, par paliers de 5), ou à la fin du temps imparti.
L'équipe qui atteint la cible totale la première (45 pour des équipes de 3), ou qui a
le plus de touches à la fin du temps réglementaire, gagne la rencontre.

## Ce qui change selon l'arme

Le système ne traite pas toutes les armes de la même façon :

- **Épée** : pas de priorité — une touche double simultanée est possible et compte
  pour les deux équipes. Un bouton dédié « ⚔ double » permet de l'enregistrer.
- **Fleuret / Sabre** : priorité classique, une seule équipe marque par touche.
  Les cartons (pénalités) peuvent être enregistrés par tireur pendant un relais,
  avec l'escalade habituelle (blanc → jaune → rouge → noir selon le motif).
- **Sabre Laser** : arme spécifique à ce projet (zones A/B/C = 1/3/5 points), sans
  équivalent dans le règlement FIE. Deux modes sont possibles au choix de
  l'organisateur (voir plus bas) :
  - **Touches** (par défaut) : chaque touche compte pour 1, comme les autres armes.
  - **Points** : chaque touche compte pour la valeur de sa zone (1/3/5), avec un
    sélecteur de zone dédié lors de la saisie.

## Format arène Sabre Laser équipe (ASL-FFE)

Un second format, spécifique au Sabre Laser, est disponible en plus du relais
FIE ci-dessus : `competition.settings.teamFormat = 'laser-arena'` (défaut :
`'fie-relay'`, aucun changement de comportement). Il suit le règlement
épreuve par équipe transmis par l'ASL-FFE, structurellement différent du
relais FIE :

- **Assaut plafonné** : 5 touches valides cumulées (les deux côtés) ou 3
  minutes, quel que soit le numéro de l'assaut — pas de cible progressive
  5→10→…→45.
- **Score de rencontre** = total des points marqués sur les 9 (ou N²)
  assauts, pas le nombre d'assauts gagnés.
- **Classement de poule** trié par points marqués cumulés en premier critère
  (pas par nombre de victoires), puis ratio marqués/reçus, puis égalité
  signalée pour tirage au sort manuel (`tied`, jamais résolu par le
  logiciel).
- **Cartons d'équipe « E »** (blanc/jaune/rouge/noir) pour retard de
  désignation d'un combattant : persistés en base (table
  `team_match_cards`), cumulables sur les 9 assauts d'une rencontre —
  traçabilité uniquement, sans impact automatique sur le score (le club n'a
  pas encore tranché la valeur en points).
- **Calendriers de poule figés** pour 8 ou 12 équipes (3 poules A/B/C de 4
  ou 2 poules de 4), avec désignation d'équipe(s) assesseur(s) par round,
  transcrits du règlement.
- **Évitement de revanche** au 1er tour du tableau : si les équipes classées
  5/6 ou 7/8 tombent contre une équipe déjà rencontrée en poule, échange de
  leurs places.
- **Saisie temps réel** sur tablette : `http://IP:8066/equipe{N}` (affichage
  arène) et `http://IP:8066/equipe{N}/arbitre` (tablette arbitre — compteur
  de touches déclenchant automatiquement le passage au relais suivant,
  boutons cartons E, minuteur 3 min).

Fichiers clés : `src/features/teams/utils/laserArenaCalculations.ts`
(score/plafond/classement), `laserArenaPoolSchedules.ts` (calendriers
figés), `laserArenaBracketRules.ts` (évitement de revanche),
`teamCardEscalation.ts` (échelle blanc→jaune), `src/remote/teamArena.html` /
`teamReferee.html` (interfaces distantes).

## Activer une compétition par équipes

Une compétition devient une compétition par équipes en positionnant
`competition.isTeamEvent = true` (case à cocher lors de la création). Les options
suivantes, dans `competition.settings`, ajustent le format :

| Champ               | Défaut        | Effet                                                                                                                      |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `minTeamSize`       | `3`           | Nombre de titulaires par équipe (généralise le format FIE 3v3)                                                             |
| `teamReserveCount`  | `1`           | Nombre de réservistes autorisés par équipe                                                                                 |
| `laserTeamMode`     | `'touches'`   | Sabre Laser uniquement : `'touches'` ou `'points'` (zones)                                                                 |
| `teamRelayStepSize` | `5`           | Palier de progression par relais (avancé — laisser à 5 sauf besoin spécifique)                                             |
| `teamFormat`        | `'fie-relay'` | Sabre Laser + équipe uniquement : `'fie-relay'` (défaut, ci-dessus) ou `'laser-arena'` (règlement ASL-FFE, voir plus haut) |

La cible totale de la rencontre se déduit automatiquement (relais FIE uniquement) :
`teamRelayStepSize × minTeamSize²` (45 pour le format FIE par défaut : 5×3²).

## Utilisation

Quand `isTeamEvent` est actif, la navigation des phases devient
**Appel → Équipes → Poule équipes → Tableau équipes → Classement équipes** (les
phases individuelles poules/tableau disparaissent). Après l'appel, « Composer les
équipes » ouvre la phase Équipes. Chaque phase propose « Exporter PDF ».

1. **Équipes** : créer les équipes, affecter les tireurs (position 1..`minTeamSize`
   pour les titulaires, jusqu'à `teamReserveCount` réservistes).
2. **Poule** : « Générer la poule » tire les rencontres (commande `generateTeamPools`),
   toutes les équipes devant être complètes, avec leurs relais. La saisie se fait relais
   par relais (bouton « Scorer ») : seul le relais en cours se saisit ; « + » / « − »
   comptent les touches à l'écran (non enregistrées), avec les affordances de l'arme
   décrites ci-dessus. Le relais se termine au palier, ou par « Terminer le relais » :
   son score part au moteur (`recordRelayScore`). Le dernier relais terminé se rouvre
   pour correction (`reopenRelay`, score repris). « Faire entrer le remplaçant » remplace
   un tireur dans les relais à tirer (`substituteTeamFencer`). Égalité au dernier relais du
   tableau : l'écran demande le vainqueur (minute avec priorité, t.41.5). La tablette
   `/equipe{N}/arbitre` propose alors la priorité (équipe choisie ou tirage au sort), envoyée
   avec la fin du relais (`winner`) ; l'appareil de piste transmet sa priorité (`Prio`
   Cyrano, `priority` OPP2) : ACK et rencontre décidée, sans priorité NAK (#2191).
3. **Tableau** : rien n'est créé à l'ouverture. Les poules terminées, « Générer le
   tableau » le tire (`generateTeamTableau`, têtes de série = classement de poule coupé par la qualification de la formule, ou rang d'entrée sans poule, [ADR-0044](adr/0044-equipes-formule-v2.md) ; placement selon le mode de tirage de la formule, avec graine et PV de tirage, et, sans poule, équipes à rang égal et sans rang tirées au sort, [ADR-0045](adr/0045-tirage-du-tableau.md)). Les
   tours suivants se créent dans le moteur au fur et à mesure des résultats ; « Tirer de
   nouveau le tableau » le refait tant qu'aucun relais n'y est joué.
4. **Classement** : classement des équipes (victoires, relais individuels
   gagnés/perdus, touches cumulées), exportable en CSV et PDF.

## Limites connues

**Relais FIE (`teamFormat: 'fie-relay'`, défaut) :**

- **Saisie tablette** : « 📡 Arène » envoie la rencontre sur `/equipe{N}/arbitre`
  (affichage `/equipe{N}`). La tablette affiche le score d'équipe cumulé, le palier
  du relais en cours (5-10-15…, plafonné à la cible) et le chrono 3 min ; « Relais
  suivant » persiste le relais (vainqueur = équipe en tête au cumul). L'application
  se met à jour au rechargement de la phase.
- **Cartons individuels persistés** (table `team_bout_cards`) : saisis dans
  l'application ou depuis la tablette (motif + escalade sur la rencontre), ou montrés par
  l'appareil de piste (jaune, rouge : type seul, groupe à compléter). Pas d'impact
  automatique sur le score (la touche du rouge est dans le score saisi) ; noir : voir
  ci-dessous.

**Les deux formats :**

- Remplacement en cours de match : le remplaçant choisi entre (sinon le premier remplaçant de
  l'équipe), un seul par équipe et par rencontre (o.99.5, o.99.6).
- Passage au moteur en cours ([ADR-0024](adr/0024-tableaux-separes-equipes-moteur.md)) :
  inscription des équipes, composition et tirage des poules existent comme commandes du
  contrat (`registerTeam`, `assignTeamFencer`, `generateTeamPools`, outil MCP
  `generate_team_pools` ; lot E1), et `getCompetitionState` rend le bloc `teams`. Lot E2 :
  tableau d'équipes, score de chaque relais, réouverture du dernier relais et remplaçant
  par commandes (`generateTeamTableau`, `recordRelayScore`, `reopenRelay`,
  `substituteTeamFencer` ; outils MCP `generate_team_tableau`, `record_relay_score`,
  `reopen_relay`, `substitute_team_fencer`), journalisées et rejouées. Lot E3 : l'écran
  n'écrit plus que par ces commandes et lit le bloc `teams` (le moteur fait foi : totaux,
  classement, avancement du tableau) ; la composition est figée dès le tirage (refus
  `draw_done`). Lot E4 : la tablette `/equipe{N}/arbitre` et les appareils de piste (Cyrano,
  OPP2) passent par les mêmes commandes (fin de relais → `recordRelayScore`, PREV →
  `reopenRelay`, remplaçant → `substituteTeamFencer`), au journal sous la source `tablet`,
  `cyrano` ou `opp2`. Refus du moteur : rien d'écrit ; motif affiché sur la tablette, NAK
  sur l'appareil. Le compteur du relais en cours (touches, chrono) reste un état de
  l'arène. Cartons : voir ci-dessous ([ADR-0028](adr/0028-cartons-equipe-moteur.md)). Lot N : l'écran n'écrit plus aucun bloc de
  session ; l'état d'une épreuve par équipes existe dès sa création (bloc `teams` lu dans les
  tables), l'onglet rouvert est celui du poste. Abandon, forfait ou exclusion d'un tireur
  (appel) : `withdrawFencer`, statut et motif seuls, sans effet sur les rencontres (le
  remplaçant entre par `substituteTeamFencer`). Import fédéral : équipes par `registerTeam`
  et `assignTeamFencer`.
- Épreuve créée avant le lot E1 : équipes, rencontres et relais en base sont repris tels
  quels ; un relais en cours garde son score, qui devient le compteur de l'écran. Un
  tableau dont les poules sont finies mais pas encore créé se tire par le bouton. Le relais
  en cours est le premier non terminé : un relais terminé hors ordre par l'ancien écran se
  rouvre d'abord.
- Cartons par le moteur ([ADR-0028](adr/0028-cartons-equipe-moteur.md), lot C1) : commandes
  `giveRelayCard` (carton d'un tireur dans un relais : `reason`, type par l'escalade sur la
  rencontre, ou `type` imposé par l'appareil de piste), `giveTeamCard` (carton E, arène Sabre
  Laser), `cancelRelayCard` / `cancelTeamCard` (Directoire technique : écran et MCP, jamais la
  tablette ni l'appareil), `withdrawTeam` (abandon d'une équipe incomplète, o.99.7.a) ; outils
  MCP du même nom en snake_case ; journal `RelayCardGiven`, `TeamCardGiven`,
  `RelayCardCancelled`, `TeamCardCancelled`, `TeamWithdrawn`. Le bloc `teams` rend les cartons
  (`bouts[].cards`, `teamCards`) et les équipes retirées (`withdrawn`). Un carton se donne sur le
  relais en cours, ou sur le dernier relais terminé tant que le suivant n'a pas commencé ; le
  dernier relais d'une rencontre terminée le reçoit encore tant que la rencontre suivante de
  l'équipe n'a pas commencé (carton signalé après le END de l'appareil). Le carton n'écrit
  aucune touche : la touche du rouge est dans le score saisi. Lot C2 : l'écran lit les cartons
  dans le bloc `teams` et les écrit par ces commandes (succès affiché après la réponse du moteur,
  motifs FIE pour les armes olympiques, motifs Sabre Laser sinon ; points rendus par le moteur).
  Carton E : « Désignation tardive » (escalade du moteur) ou type choisi. Annulation : bouton sur
  le carton, après confirmation (sauf noir individuel : réintégration du tireur). Bouton
  « Abandon » (`withdrawTeam`) dans la rencontre ; équipe « Exclue » ou « N'a pas terminé »,
  rencontres de poule annulées, rencontres à tirer non saisissables.
- Tablette et appareils par les commandes (ADR-0028, lot C3) : `team_card` → `giveTeamCard`,
  `team_fencer_card` → `giveRelayCard` avec le motif, source `tablet` ; refus du moteur (équipe
  étrangère à la rencontre `team_not_in_match`, équipe exclue `team_withdrawn`, motif hors du
  règlement…) rendu par `team_arena_error` (`card_refused`), rien d'écrit. Le noir n'est plus
  refusé par le serveur : `blackCardEnabled` masque seulement le bouton de la tablette (#2186).
  Noir individuel : la tablette affiche l'issue (rencontre terminée, « équipe exclue »). Appareil
  (Cyrano, OPP2) : à chaque état reçu, chaque jaune ou rouge montré et pas encore enregistré pour
  le tireur dans la rencontre → `giveRelayCard` avec le type, source `cyrano` / `opp2`, **avant**
  le contrôle de la fin du relais : un relais fini au palier + 1 avec un rouge adverse est
  acquitté (ACK), sans rouge refusé (NAK). Un carton refusé est tracé et ne change pas la réponse
  à la fin du relais. Après chaque commande, l'arène relit la rencontre (cartons compris) et
  diffuse `team_arena_state`.
- Cartons P (non-combativité, t.124 ; ADR-0028, lot C4) : commande `givePassivityCard`
  (outil MCP `give_passivity_card`), relais FIE des armes olympiques seulement (le Sabre Laser
  n'a pas de carton P : `unsupported_format`). Le carton est donné **aux deux équipes** et
  s'escalade sur la rencontre : jaune P, rouge P, noir P ; aucune touche écrite (la touche du
  rouge P est dans le score saisi). Noir P : la rencontre est décidée (`TeamMatchDecided`, même
  commande) pour l'équipe au score supérieur des **relais terminés** (enregistrer d'abord le
  relais en cours), à égalité pour l'équipe au meilleur classement : rang du tableau (classement
  après les poules, qui est aussi le « tableau en cours » de la FFE dès M15) ; en poule, rang
  d'entrée de l'équipe (rang saisi ou importé, sinon somme des classements des titulaires, ADR-0044). Rencontre déjà
  tirée jusqu'au bout : noir P accepté s'il confirme le résultat (ou s'il départage une égalité
  de poule), refusé sinon (`match_finished`). Stockage : `team_match_cards`, `team_id` NULL,
  `type` `p_yellow` / `p_red` / `p_black` (migration 49) ; bloc `teams` : `passivityCards`.
  Annulation d'un jaune ou rouge P par `cancelTeamCard` (Directoire technique) ; le noir P ne
  s'annule pas ainsi. Appareil (Cyrano P-card, OPP2 `p_card`) : jaune P et rouge P enregistrés à
  l'état reçu (un rouge P montré d'emblée vaut jaune P puis rouge P) ; le noir P attend la fin
  du relais : ACK, relais enregistré, puis noir P qui décide la rencontre (au lieu d'un NAK).
  Boutons (#2227), relais FIE des armes olympiques seulement, jamais en Sabre Laser : tablette
  `/equipe{N}/arbitre`, bouton « Carton P » (`team_passivity_card` → `givePassivityCard`,
  source `tablet`) et cartons P de la rencontre (`passivityEnabled`, `passivityCards` de
  `team_arena_state`) ; verrou de l'appareil maître en ligne comme pour les autres cartons.
  Écran `TeamManagerView` (panneau « Saisir » de la rencontre) : même bouton, cartons P listés,
  annulation du jaune ou du rouge P (`cancelTeamCard`). Noir P : le moteur annonce le carton
  suivant par un essai à blanc (`dryRun`) ; au noir P, confirmation explicite (tablette :
  encadré « Confirmer le noir P », `team_passivity_black` puis `confirmBlack` ; écran : fenêtre
  de confirmation) avec le rappel d'enregistrer d'abord le relais en cours.
- Carton noir individuel : le tireur est exclu (`withdrawFencer`, carton noir) dans la même
  commande. Armes olympiques (o.99.7.b) : la rencontre est perdue et l'équipe exclue, sans
  classement ; abandon (`withdrawTeam`) : rencontre perdue, l'équipe garde sa place (« N'a pas
  terminé »). Dans les deux cas (o.99.8), ses rencontres de poule ne comptent plus et elle
  n'entre pas au tableau ; elle ne tire plus (`team_withdrawn`). Sabre Laser : aucune règle
  d'équipe (Livret 2 XII « A venir »), le tireur seul est retiré (VIII.7) ; le remplaçant entre
  par `substituteTeamFencer`.
- Palier du relais (#2188) : armes olympiques, chaque équipe peut le dépasser d'autant de touches
  que de cartons rouges reçus par l'adversaire dans ce relais (FIE t.41.1 : dernière touche
  valable et touche de pénalisation accordées ensemble ; t.162.2), jamais sans rouge. Sabre
  Laser en mode touches et arme à la carte : aucun dépassement (t.41.1 est une règle FIE ;
  arbitrage du Sabre Laser dans #2208). En Sabre Laser mode
  points, la dernière touche peut le dépasser de 4 points (cible C à 5 points depuis palier − 1,
  Livret 2 FFE) ; le compteur de l'écran est plafonné d'autant. En arène, plafond de l'assaut en
  points : 5 touches × 5 points.
- Moteur : une égalité au dernier relais est admise en poule (pas de vainqueur) ; au tableau,
  le vainqueur est donné (`winner`, minute avec priorité). Un relais de poule peut être
  rouvert après le tirage du tableau, qui garde son placement.

**Format arène Sabre Laser (`teamFormat: 'laser-arena'`) uniquement :**

- Les cartons d'équipe « E » n'ont **pas encore d'impact automatique sur le score** —
  traçabilité seule, en attendant que le club tranche la valeur en points.
- La génération automatique de la poule (calendrier figé + assesseurs) n'est
  disponible que pour **8 ou 12 équipes** ; pour tout autre effectif, aucune
  génération automatique n'est proposée (saisie manuelle des équipes).
- L'affectation aux poules A/B/C se fait dans l'ordre de création des équipes (pas
  de champ de poule explicite dans l'UI).
