# Guide des formules de compétition

Guide de l'organisateur. Il décrit ce que l'application fait aujourd'hui, rien de plus.

La formule dit comment se déroule une épreuve : combien de tours de poules, où placer le tableau, comment passer d'une phase à la suivante, si l'épreuve se scinde en plusieurs.

Le même éditeur sert à la création de l'épreuve et plus tard, dans **Organisation ▸ Formule**. Il fonctionne pour toutes les armes.

## Sommaire

- [Les principes](#les-principes)
- [Les modèles](#les-modèles)
- [Les briques](#les-briques)
  - [Tour de poules](#tour-de-poules)
  - [Tour Quest](#tour-quest)
  - [Tableau complet](#tableau-complet)
  - [Tableau arrêté à N](#tableau-arrêté-à-n)
  - [Scission en compétitions filles](#scission-en-compétitions-filles)
  - [Tour en vagues](#tour-en-vagues)
  - [Têtes de poule](#têtes-de-poule)
  - [Entrée en équipes (binômes)](#entrée-en-équipes-binômes)
  - [Classements filtrés](#classements-filtrés)
- [La qualification entre deux phases](#la-qualification-entre-deux-phases)
- [Les contrôles de structure](#les-contrôles-de-structure)
- [Le mode expert](#le-mode-expert)
- [Le relevé de cohérence et la simulation](#le-relevé-de-cohérence-et-la-simulation)
- [Exemples](#exemples)
- [Référence technique](#référence-technique)

## Les principes

- La formule est une **suite de phases** entre l'**Appel** et le **Classement final**. L'Appel et le Classement final sont toujours là : on ne les ajoute pas.
- L'éditeur affiche une **frise** : Appel, vos phases, Classement final. Entre deux cases, un bouton « + » propose seulement les briques permises à cet endroit. On ne peut donc pas construire une formule absurde.
- Chaque phase porte **ses propres réglages** : touches, durée, taille des poules. Le tour 2 peut avoir d'autres touches que le tour 1.
- Une phase **commencée** est protégée : voir [S6](#les-contrôles-de-structure).
- Une épreuve créée avant ces formules se déroule à l'identique. Rien n'est réécrit tant que vous ne modifiez pas sa formule.

## Les modèles

À la création, un modèle est présélectionné d'après l'arme, la catégorie et le type (individuel ou équipes). Un résumé tient sur une ligne, par exemple « Poules 5 touches → Tableau 15 touches ». **Personnaliser la formule** ouvre l'éditeur.

Modèles fournis :

- Épée, fleuret, sabre, Sabre Laser : **Standard**, **2 tours de poules + tableau**, **Poules seules**, pour chaque catégorie, en individuel et en équipes.
- Arme « Autre » : **Standard** et **Tournoi des rapières** (voir [exemple H](#h--le-tournoi-des-rapières)).

Un modèle fourni ne se modifie jamais. On le charge, on l'ajuste, puis **Enregistrer comme modèle** crée une copie personnelle. Les modèles personnels se renomment et se suppriment.

Un badge dit où vous en êtes :

| Badge | Sens |
|---|---|
| **Standard** | La formule est celle du modèle. |
| **Adaptée · N écart(s)** | Vous êtes parti d'un modèle et avez changé N réglages. **Revenir au standard** annule les écarts. |
| **Libre** | Formule composée à la main, sans modèle. |

## Les briques

### Tour de poules

Chaque tour de poules est une case de la frise. On peut en enchaîner jusqu'à **5**. Au-delà de 3, un avertissement vous invite à vérifier la durée de l'épreuve.

Zéro tour de poules est permis : le tableau se place alors directement d'après le classement d'entrée (voir [exemple D](#d--tableau-direct)).

Réglages courants :

- **taille des poules** : minimum et maximum de tireurs ;
- **touches** et **durée** d'un match ;
- **qualification** vers la phase suivante : voir [la qualification](#la-qualification-entre-deux-phases).

Réglages avancés (mode expert, dans « Réglages avancés ») :

- **répartition de ce tour** (à partir du tour 2) : d'après le classement du tour précédent, ou d'après le cumul des tours joués ;
- **ordre des matchs** : ordre FIE, ordre libre (rondes), vagues, vagues classiques (voir [tour en vagues](#tour-en-vagues)). L'ordre libre n'est pas proposé pour l'arme « Autre » ;
- **répartition dans les poules** : serpentin sur le classement, ou par niveau (voir [entrée en équipes](#entrée-en-équipes-binômes)) ;
- **barème à zones** (arme « Autre ») ;
- **ex aequo à la barre** (voir [la qualification](#la-qualification-entre-deux-phases)).

### Tour Quest

Réservé au **Sabre Laser**, en mode expert.

Le Tour Quest se place juste après l'Appel, ou après un seul tour de poules. Avec des poules préliminaires, vous réglez le **nombre de qualifiés des poules vers le Tour Quest**. Sans poules préliminaires, la formule est Tour Quest → Tableau.

Il ne se combine ni avec un tableau arrêté, ni avec une scission. Le déroulé complet du Sabre Laser est dans [PROCEDURE_SABRE_LASER.md](PROCEDURE_SABRE_LASER.md).

### Tableau complet

Le tableau va jusqu'à la finale. Rien ne peut le suivre : le classement final vient après lui.

Réglages courants : **touches** (0 = sans limite), **durée**, **match pour la 3ᵉ place**, **placement** ([ADR-0045](adr/0045-tirage-du-tableau.md)).

**Placement** (mode de tirage), en mode normal :

| Placement | Effet |
| --- | --- |
| **Strict** (défaut) | Au rang : tête de série 1 contre la dernière. |
| **Par paires** | Les rangs 1-2, 3-4, 5-6… sont tirés au sort sur les deux emplacements de leur paire. |
| **Par groupes** | Les rangs 1 et 2 sont placés ; les rangs 3-4, 5-8, 9-16… sont tirés au sort sur les emplacements de leur groupe. |
| **Intégral** | Tous les qualifiés sont tirés au sort sur les emplacements 1 à N. |

Le tirage n'attribue que des emplacements : le rang d'entrée (classement des éliminés d'un même tour) reste celui du classement ; taille, exemptions et barrages ne changent pas. Le moteur tire une graine (affichée sur l'écran du tableau avec le mode) ; la même graine redonne le même tableau. Le bouton **Imprimer le PV de tirage** édite le procès-verbal : épreuve, tableau, date et heure, mode, graine, et pour chaque qualifié son rang d'entrée, son club, son emplacement. Le placement vaut aussi pour une branche de scission et pour un tableau d'équipes. Une fois le tableau tiré, il ne change plus (S6). Sans formule enregistrée : strict.

Réglage avancé : **tous les classements** (les perdants de chaque tour forment un tableau de classement). Cette case reste visible hors mode expert.

Une formule contient un seul tableau. Pour poursuivre l'épreuve après lui, il faut l'[arrêter à N](#tableau-arrêté-à-n).

### Tableau arrêté à N

Mode expert. Le tableau s'arrête quand il reste **N tireurs** (2, 4, 8, 16, 32, 64 ou 128). Les tireurs restants passent à la phase suivante : un **tour de poules**, ou une [scission](#scission-en-compétitions-filles). Il faut au moins un tour de poules avant ce tableau.

Pendant l'épreuve :

- les matchs se jouent jusqu'à ce qu'il reste N tireurs ;
- un bandeau au-dessus du tableau propose **Passer à la phase suivante** une fois les tours joués. Une confirmation indique combien de tireurs passent et combien sont éliminés ;
- le tableau clos reste consultable en lecture seule ;
- les tours après l'arrêt ne se jouent pas : leur score est refusé.

Classement des éliminés du tableau : par tour atteint (le plus loin devant), puis, à tour égal, par rang d'entrée dans le tableau. Au classement final : les N restants selon la phase suivante, puis les éliminés du tableau, puis les éliminés des poules.

### Scission en compétitions filles

Mode expert. La scission est toujours la **dernière phase**. Elle suit un tour de poules ou un tableau arrêté, jamais un tableau complet. Il faut au moins deux branches.

Critères de répartition :

- **sexe** : une branche par sexe (Hommes, Dames) ;
- **catégorie** : une ou plusieurs catégories par branche ;
- **rang** : chaque branche prend un nombre ou un pourcentage de tireurs, dans l'ordre du classement. La dernière branche prend le reste. Les ex aequo à la borne se départagent comme à la [qualification](#la-qualification-entre-deux-phases) ;
- **manuelle** : vous affectez les tireurs un par un au lancement de la scission, d'après le classement d'entrée.

Ce qui se passe :

- quand la phase précédente est terminée, **Scinder l'épreuve** (depuis le classement) crée **une compétition fille par branche**, en une seule fois. Elle porte le titre de l'épreuve suivi du libellé de la branche. Les tireurs y sont copiés avec leur rang comme classement initial ;
- chaque branche se joue avec sa propre formule : poules, ou poules puis tableau, ou tableau. Pas de scission ni de Tour Quest dans une branche. Les réglages fins se font ensuite dans la compétition fille ;
- chaque fille a **son classement final**, numéroté depuis 1, publié à part. L'épreuve d'origine classe seulement les tireurs qui ne sont pas passés dans une branche ;
- un tireur sans sexe ou sans catégorie renseigné bloque la scission : l'écran liste les tireurs à compléter. La catégorie se saisit à l'Appel, ou se calcule avec **Calculer les catégories**.

**Compétition couplée.** Dans une scission par sexe, deux branches (Hommes, Dames) réduites chacune à un tableau, avec les mêmes réglages, peuvent **rester dans l'épreuve**. Elles se jouent en tableaux séparés, avec un classement par branche. Dans ce cas, rien n'est créé. Soit toutes les branches restent, soit aucune.

### Tour en vagues

Mode expert, ordre des matchs d'un tour de poules : **Vagues** ou **Vagues classiques**.

- Les matchs sont répartis en **vagues** : toutes les poules jouent leur première vague, puis la suivante. Les tablettes suivent la vague en cours.
- Poules de 2 à 10 tireurs en vagues. De 2 à 15 en vagues classiques : les poules de 10 à 15 suivent des tables fixes, les plus petites se jouent en vagues ordinaires.
- À l'écran : **Lancer la vague N**, imprimer les feuilles de la vague, **Terminer les vagues**. Une vague ne se lance que lorsque la précédente est saisie. Si vous terminez les vagues avant la fin, le classement se fait sur les matchs joués.
- Le tour est terminé quand toutes les vagues sont jouées ou arrêtées.

### Têtes de poule

Mode expert, mode de qualification **Têtes de poule, puis suivants**, vers le tableau qui suit le tour. Vous donnez un nombre de qualifiés : les premiers de chaque poule, puis les deuxièmes, et ainsi de suite jusqu'à ce nombre.

Exemple avec 4 qualifiés :

- une poule : les 4 premiers ;
- deux poules : A1, B1, A2, B2, donc au tableau A1 contre B2 et B1 contre A2 ;
- trois poules : les trois premiers et le meilleur deuxième ;
- quatre poules : les quatre premiers.

Si le tour compte plus de poules que de qualifiés, la formule est refusée. L'ex aequo au dernier rang de poule pris se règle avec **ex aequo à la barre**.

### Entrée en équipes (binômes)

Mode expert, réglage général de la formule : **Entrée des participants**.

- **Individuelle** (défaut) ou **équipes de 2 (binômes)**. Le binôme s'inscrit comme un tireur, sous un nom d'équipe, avec ses deux membres.
- Les **niveaux** vont du plus faible au plus fort, jusqu'à 10 libellés. Par défaut : Débutant, Intermédiaire, Expert. Vous pouvez saisir vos propres libellés.
- La **catégorie de l'équipe** est la moyenne des années de naissance des membres, arrondie au-dessus, la saison commençant au 1ᵉʳ septembre. Vous pouvez la corriger. Le sexe de l'équipe est celui des membres s'il est commun, sinon mixte.
- Le marqueur **HANDI** (équipe handisport) est distinct de la catégorie.
- Avec la répartition **par niveau**, les équipes de même niveau sont regroupées dans les poules, du plus faible au plus fort.
- L'import CSV / XLSX à colonnes fixes lit les membres et, dans la colonne Z « niveau » (facultative), le niveau : un libellé des niveaux de la formule (majuscules et accents ignorés) ou son rang (1 = le plus faible). Sans cette colonne, ou avec un niveau inconnu, l'équipe prend le premier niveau. Le modèle à télécharger porte cette colonne.
- Les exports de liste aux formats fédéraux (XML FIE, FFE) et CSV ne portent pas les membres.

### Classements filtrés

Mode expert, réglage général : **Filtres du classement final**. Critères au choix : catégorie, sexe, niveau, HANDI.

- L'écran, le PDF du classement, l'impression et l'export CSV proposent ces filtres. Un classement filtré est **renuméroté depuis 1**, égalités gardées.
- C'est un affichage. Il ne crée pas de compétition fille et ne change pas le classement publié : le livre PDF signé et les exports fédéraux restent complets.
- Le classement final compte les non-qualifiés après le tableau. Les éliminés des poules se classent d'après le classement de ce tour (FIE o.82.5).
- Un tireur exclu (y compris après son entrée au tableau) ou sanctionné d'un carton noir est inscrit au bas, sans rang. Ses résultats sont annulés, comme s'il n'avait pas participé (FIE o.74.3 et o.79.2). Les autres sont renumérotés.
- Des ex aequo derrière un exclu sont départagés par le classement de composition du tableau, c'est-à-dire leur rang de sortie des poules (FIE o.82.4).

## La qualification entre deux phases

Chaque tour de poules dit combien de tireurs passent à la phase suivante (tour de poules, tableau ou scission). Le dernier tour sans suite n'en a pas.

| Mode | Effet |
|---|---|
| **Tous avancent** | Personne n'est éliminé à cette phase (FIE o.73.3). |
| **Top %** | Un pourcentage des tireurs, par exemple 80 %. |
| **Nombre fixe** | Un nombre, par exemple les 32 premiers. |
| **Tableau suivant** | La plus grande taille de tableau (puissance de 2) qui ne dépasse pas le nombre donné. |
| **Vainqueur de poule** | Seuls les premiers de poule. |
| **Têtes de poule, puis suivants** | Mode expert, voir [têtes de poule](#têtes-de-poule). |

Un aperçu affiche le nombre de qualifiés pour l'effectif simulé.

### Ex aequo à la barre

Quand plusieurs tireurs sont à égalité à la dernière place qualificative, le quota peut être dépassé. Le réglage **Ex aequo à la barre** (mode expert) dit quoi faire. Il s'applique au tour de poules, au tableau et à la scission par rang, dès qu'un nombre est fixé (pourcentage, nombre, tableau suivant, têtes de poule).

| Réglage | Effet |
|---|---|
| **Tous qualifiés** (défaut) | Tous les ex aequo passent, quitte à dépasser le quota. |
| **Départagés au classement d'entrée** | Le quota est tenu. Les ex aequo sont départagés par leur rang d'entrée dans le tour : classement initial au premier tour, place au tour précédent ensuite. |
| **Tirage au sort** | Le quota est tenu. Le tirage départage les ex aequo (FIE o.73.2.f). Il est fait une fois, au moment de la coupe, et n'est jamais retiré. |

Au moment de couper, l'écran liste les ex aequo avant de confirmer. Vous gardez le réglage de la formule, ou vous en choisissez un autre pour cette coupe seulement. La coupe retenue est ensuite figée.

Le **barrage** n'existe pas dans cette version : il est reporté. La règle FIE par défaut est « tous qualifiés » (o.73.3). Le barrage en 5 touches de la FIE (o.86.2) concerne la 16ᵉ place exemptée du tableau préliminaire, et le livret 2 du Sabre Laser n'en fixe ni le format ni le score.

## Les contrôles de structure

Ces contrôles tournent à chaque changement dans l'éditeur. Un contrôle **bloquant** s'affiche sur la carte de la phase fautive et grise **Enregistrer**. Le moteur refuse aussi la formule si elle est enregistrée autrement (agent MCP, par exemple), avec le même message.

| Contrôle | Règle en clair | Exemple de message |
|---|---|---|
| **S1** | Il faut au moins une phase de combat (tour de poules, Tour Quest ou tableau), dans la formule et dans chaque branche d'une scission. | « au moins une phase de combat (tour de poules, Tour Quest ou tableau) » |
| **S2** | Une phase ne suit un tableau que si ce tableau s'arrête avant la finale. Un tableau arrêté doit être suivi d'un tour de poules ou d'une scission, précédé d'un tour de poules, et sans Tour Quest. La scission reste en dernier. | « tours de poules après le tableau : arrêter le tableau à N tireurs » |
| **S3** | Quand la qualification fixe un nombre, il suffit à la phase suivante : au moins la taille minimale d'une poule, au moins 2 pour un tableau, plus de N pour un tableau arrêté à N. | « tour 1 : 3 qualifié(s) pour des poules de 4 tireurs au moins » |
| **S4** | Ce nombre est compatible avec la phase suivante : il se répartit en poules de la taille voulue. Dans une scission par rang, la somme des parts reste sous l'effectif. Avec « têtes de poule », il y a au plus autant de poules que de qualifiés. | « tour 1 : 8 qualifiés ne se répartissent pas en poules de 6 à 7 tireurs » |
| **S5** | Chaque branche d'une scission se termine par une phase qui classe : un tour de poules ou un tableau complet, jamais un tableau arrêté. | « se termine par un tableau arrêté à 8 : finir par un tour de poules ou un tableau complet » |
| **S6** | Une phase commencée ne se retire pas, ne change pas de nature, et rien ne s'insère avant elle. La règle de qualification qui sort d'un tour de poules clos, ou qui mène à une phase commencée, ne change plus : les éliminés d'un tour clos sont fixés dès la clôture, et le classement final relit la formule, la coupe doit rester celle du tirage. Un tableau arrêté clos n'est pas concerné. Le mode d'un tableau tiré (petite finale, « toutes les places », placement) ne change plus. | « phase déjà commencée (tableau) : elle ne se retire pas » |

Le contrôle S3 d'un pourcentage dépend de l'effectif : il ne bloque pas, il alimente les avertissements de la simulation.

**Avertissements** (non bloquants, dans l'aperçu à droite de l'éditeur) :

- plus de la moitié d'exempts au premier tour du tableau ;
- poules de moins de 4 tireurs ;
- moins de 4 qualifiés vers une phase de combat ;
- plus de 3 tours de poules.

## Le mode expert

Le mode expert se règle par la case **Mode expert**, en haut de l'éditeur. C'est une **préférence du poste**, éteinte par défaut. Elle ne change que ce que l'éditeur propose : une formule reste valide quel que soit le mode.

**Niveau simple** : tours de poules, tableau complet, réglages courants (taille des poules, touches, durées, qualification, petite finale, tous les classements).

**Le mode expert montre en plus :**

- les briques **Scission** et **Tour Quest** au bouton « + » ;
- le **tableau arrêté à N** ;
- la qualification **têtes de poule** ;
- **ex aequo à la barre** ;
- dans un tour de poules : répartition par cumul des tours, ordre des matchs libre ou en vagues, répartition par niveau, barème à zones ;
- dans le tableau : barème à zones (arme « Autre ») ;
- dans les réglages généraux : **compétition couplée**, **entrée en équipes**, **filtres du classement final**.

Une formule qui contient déjà une brique ou un réglage expert rallume le mode expert pour la durée de l'édition, même si votre préférence est éteinte. La case est alors grisée. Votre préférence ne change pas.

Ne confondez pas avec le réglage « mode expert » de l'épreuve, qui règle les pistes et les arbitres.

## Le relevé de cohérence et la simulation

**Relevé de cohérence.** Pour toutes les armes sauf « Autre », l'éditeur compare les touches de chaque phase à un référentiel par arme et catégorie. Un écart est signalé avec la valeur attendue, et **Appliquer** la met en place. Le relevé ne bloque jamais l'enregistrement.

**Simulation.** À droite de l'éditeur, saisissez un nombre de **tireurs simulés**. L'aperçu montre, phase par phase, les poules, les matchs, les qualifiés, la durée estimée et les avertissements.

## Exemples

Les exemples A à G viennent de la conception de la formule (#2013). A à D se construisent sans mode expert. E à G demandent le mode expert.

### A : Standard

Un tour de poules, puis le tableau.

```
Appel → Poules (80 % de qualifiés) → Tableau → Classement final
```

Réglez la qualification du tour de poules sur **Top %**, 80.

### B : deux tours de poules

```
Appel → Poules tour 1 (tous qualifiés) → Poules tour 2 (24 qualifiés) → Tableau → Classement final
```

Ajoutez un tour de poules avec « + », puis réglez la qualification du tour 2 sur **Nombre fixe**, 24. Les contrôles S3 et S4 vérifient que 24 qualifiés se répartissent dans la taille de poule du tour 2.

### C : poules seules

```
Appel → Poules → Classement final
```

Retirez le tableau. Le classement final est celui des poules.

### D : tableau direct

```
Appel → Tableau (placement au classement d'entrée) → Classement final
```

Retirez le tour de poules. À la sortie de l'Appel, le tableau est placé d'après le classement d'entrée, sans poules. Les tireurs à rang d'entrée égal sont départagés par tirage au sort, et les non classés sont tirés au sort à la suite des classés, avec la graine du tableau, quel que soit le placement (strict compris). Le PV de tirage porte la mention « non classé · tiré au sort » ou « départagé par tirage ».

### E : tableau intercalé, poule finale

```
Appel → Poules → Tableau arrêté à 8 → Poule finale de 8 → Classement final
```

Mode expert. Réglez le tableau sur **Quand il reste 8 tireurs** : un tour de poules est ajouté après. Réglez sa taille de poule sur 8. Les 8 restants se classent dans la poule finale, puis viennent les éliminés du tableau, puis ceux des poules.

### F : scission par rang, tableaux A et B

```
Appel → Poules (tous qualifiés) → Scission par rang
                                    ├─ Tableau A : rangs 1 à 16, tableau 15 touches
                                    └─ Tableau B : le reste, tableau 10 touches
```

Mode expert. Critère **rang**, branche A à 16 tireurs, branche B « le reste ». Chaque branche devient une compétition fille classée à part : classement A de 1 à 16, classement B numéroté depuis 1.

### G : scission par sexe

```
Appel → Poules mixtes → Scission par sexe
                          ├─ Hommes : tableau
                          └─ Dames : tableau
```

Mode expert. Deux façons de la jouer :

- **Compétition couplée** : cochez **Rester dans l'épreuve**. Les deux tableaux se jouent dans la même épreuve, avec un classement par sexe.
- **Compétitions filles** : sans cette case, chaque sexe devient une compétition fille.

### H : le Tournoi des rapières

Modèle fourni `bpm/C/rapieres`, arme « Autre ». Il se choisit à la création comme n'importe quel modèle.

```
Appel → Tour en vagues (binômes, par niveau) → Tableau → Classement final
```

Ce que contient le modèle :

- **règles modernes** ;
- **un tour en vagues**, poules de 2 à 10, répartition **par niveau**, 5 touches et 180 secondes par défaut ;
- **entrée en binômes**, niveaux Débutant, Intermédiaire, Expert ;
- tous les binômes sont qualifiés pour le **tableau** (15 touches, 180 secondes, match pour la 3ᵉ place) ;
- **filtres du classement** : catégorie, sexe, niveau, HANDI ;
- départage d'une égalité en fin de temps par la victoire.

Le **mode de tableau** est un réglage de la formule, modifiable tant que le tableau n'est pas tiré :

| Mode | Réglage dans la formule |
|---|---|
| Normal | Tous qualifiés |
| 3ᵉ place | Match pour la 3ᵉ place |
| Toutes les places | Tous les classements |
| Demi-finales | Têtes de poule, 4 qualifiés, et match pour la 3ᵉ place |

Une épreuve de rapières enregistrée avant ces formules se rejoue et s'affiche à l'identique.

## Référence technique

Pour le code, les contrats et les décisions :

- [ADR-0036](adr/0036-formule-v2-arbre-par-phase.md) : le modèle de formule (arbre de phases, lecture par phase, stockage).
- [ADR-0037](adr/0037-deroule-genere-par-la-formule.md) : déroulé généré par la formule, zéro tour de poules, tableau arrêté à N.
- [ADR-0039](adr/0039-scission-competitions-filles.md) : scission, compétitions filles, compétition couplée, catégorie du tireur.
- [ADR-0040](adr/0040-ex-aequo-a-la-barre.md) : ex aequo à la barre (`all`, `initial_ranking`, `draw` ; barrage reporté).
- [ADR-0041](adr/0041-controles-structure-mode-expert.md) : contrôles S1 à S6 et mode expert.
- [ADR-0042](adr/0042-moteur-formules-multi-tours.md) : le moteur pilote les formules à plusieurs tours.
- [ADR-0043](adr/0043-rapieres-briques-generiques.md) : tour en vagues, têtes de poule, binômes, classements filtrés, fin du mode spécial.
- [API_CONTRACT.md](API_CONTRACT.md) et [MCP.md](MCP.md) : commandes et outils de l'agent (`updateCompetitionFormula`, `splitCompetition`, `closeTableauStage`, `launchPoolWave`…).

Le code de référence est dans `src/shared/domain/formula/` (règles) et `src/renderer/components/formula/` (éditeur).
