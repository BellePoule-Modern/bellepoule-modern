# Agent IA — serveur MCP intégré (#1880)

BPM - Escrime (Base de Poules et Management) expose un serveur [MCP](https://modelcontextprotocol.io) dans le process main,
**en lecture** et, sur autorisation, en **écriture** (administrative et sportive) : un agent (Claude Code avec le plugin `plugins/bpm-escrime`, ou tout client MCP)
interroge la salle en langage naturel, prépare une journée, tire les poules, saisit des scores, construit le tableau et exporte les résultats.

## Activation et sécurité

- **Désactivé par défaut.** Paramètres → Système → **Agent IA (MCP)** : activer, choisir le port
  (8067 par défaut), copier la configuration `.mcp.json`.
- Écoute sur `127.0.0.1` uniquement ; `Host` et `Origin` limités à la boucle locale (DNS rebinding).
- Jeton `Authorization: Bearer …` obligatoire (256 bits), stocké dans `<userData>/mcp-token.bin`,
  chiffré par `safeStorage` ; « Nouveau jeton » invalide l'ancien.
- Réglages : `<userData>/mcp-settings.json`. Fonctionne aussi en `--headless`.
- Un jeton enregistré mais illisible (autre trousseau : service, SSH, session sans bureau) n'est
  jamais remplacé en silence : le serveur ne démarre pas (erreur `token_unreadable`), l'opérateur
  crée un nouveau jeton (Paramètres, ou `--mcp-new-token`).
- **Dossiers accessibles à l'agent** (Paramètres → Système → Agent IA ; par défaut Documents,
  Téléchargements et Bureau) : les fichiers d'import ne sont lus, et les exports écrits, que dans
  ces dossiers (chemin réel contrôlé). L'agent ne peut pas modifier cette liste.
- Rendu PDF (`export_results`) dans une session isolée : ni fichier local ni réseau ; données échappées.
- Journal des derniers appels (outil, durée, succès) : Paramètres → Système → Agent IA (MCP), opération `listMcpLog` du contrat (ADR-0022).
- Lots JSON-RPC : 20 messages au plus, traités l'un après l'autre.
- Données personnelles minimales : ni date de naissance, ni licence, ni photo (RGPD, `docs/RGPD.md`).

## Plugin Claude Code

Dans Claude Code : `/plugin install bpm-escrime --marketplace BPM-Escrime/BPM-Escrime`
(depuis un clone : `claude --plugin-dir plugins/bpm-escrime`), puis `/plugin configure bpm-escrime`
et `/reload-plugins`. Options (`userConfig`, #1947) :

| Option      | Rangement                    | Repli si non renseignée            |
| ----------- | ---------------------------- | ---------------------------------- |
| `mcp_token` | Stockage sécurisé du système | `BPM_ESCRIME_MCP_TOKEN`            |
| `mcp_port`  | `settings.json`              | `BPM_ESCRIME_MCP_PORT`, sinon 8067 |

Le repli passe par la valeur par défaut des options (`${BPM_ESCRIME_MCP_TOKEN:-}`), développée
par Claude Code après `${user_config.…}`. Une variable exportée dans `~/.zshrc` ou `~/.bashrc`
n'atteint pas un Claude Code lancé depuis VS Code ou un lanceur graphique : préférer
`/plugin configure`. Après « Nouveau jeton », le reconfigurer. Un jeton absent ou périmé donne
HTTP 401 (`Jeton invalide`), affiché par Claude Code comme `AUTH_HEADER_REJECTED`.

Commandes : `/bp-etat` (état de la salle, lecture seule), `/bp-journee <dossier>` (préparer une journée), `/bp-epreuve <épreuve>`
(conduire une épreuve). Le test `src/main/mcp/plugin.test.ts` vérifie que chaque outil cité par
la skill et les commandes existe.

## Sans écran (ligne de commande)

```bash
bpm-escrime --headless --mcp                # MCP activé pour cette exécution (réglages enregistrés inchangés)
bpm-escrime --headless --mcp --mcp-write    # idem, outils d'écriture autorisés
bpm-escrime --headless --mcp-port=18067     # idem, sur un autre port
bpm-escrime --mcp-print-config              # affiche le bloc .mcp.json (URL, jeton) puis s'arrête
bpm-escrime --mcp-new-token                 # crée un nouveau jeton, puis l'affiche de la même façon
bpm-escrime --batch-import journee.json [--dry-run]   # import d'une journée, rapport JSON, code 0 / 1
```

`--batch-import` prend un manifeste de la forme des arguments d'`import_day` (ci-dessous) ; ses
chemins `fencersFile` / `refereesFile` peuvent être relatifs au manifeste. Lancé par l'opérateur,
il n'est pas limité aux dossiers de l'agent.

## Transport

« Streamable HTTP », réponses JSON : `POST http://127.0.0.1:<port>/mcp`. Méthodes : `initialize`,
`ping`, `tools/list`, `tools/call` ; notifications acceptées (202). Versions du protocole :
2025-06-18, 2025-03-26, 2024-11-05.

## Outils (lecture)

| Outil               | Arguments                                                               | Rend                                                                                                            |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `list_competitions` | —                                                                       | Épreuves : titre, date, arme, sexe, catégorie, journée, phase en cours                                          |
| `get_competition`   | `competitionId`                                                         | Détail, réglages, phases, nombre de tireurs et de poules                                                        |
| `list_fencers`      | `competitionId`                                                         | Tireurs : nom, club, statut de pointage, classement                                                             |
| `get_pool_ranking`  | `competitionId`, `poolId?`                                              | Classement de chaque poule, matchs joués / total                                                                |
| `get_bracket`       | `competitionId`, `group?`                                               | Matchs du tableau : tour, tireurs, score, vainqueur ; tableaux séparés : groupe de chaque match, filtre `group` |
| `list_referees`     | `competitionId`                                                         | Arbitres : nom, club, catégorie, statut                                                                         |
| `day_overview`      | `dayId?`                                                                | Journées ; avec `dayId` : arbitres partagés, conflits                                                           |
| `strip_occupation`  | `dayId`                                                                 | Pistes de la journée : occupée, libre, réservée                                                                 |
| `server_status`     | —                                                                       | Serveurs distants : URL, séance, arènes, écrans connectés                                                       |
| `cyrano_status`     | —                                                                       | Appareils de piste Cyrano : port, pistes, statut, alertes                                                       |
| `list_matches`      | `competitionId`, `poolNumber?`, `state?` (`pending` / `ready` / `done`) | Matchs de poule et de tableau : `matchId`, tireurs, score, état, piste                                          |
| `get_settings`      | —                                                                       | Paramètres du poste (langue, thème, HTTPS et interface du serveur distant), pistes de la salle par défaut       |
| `list_venues`       | —                                                                       | Salles déclarées et leurs pistes                                                                                |

## Outils d'écriture (lot 2)

Proposés seulement si **« Autoriser l'écriture »** est coché (désactivé par défaut) ; sinon refusés.
Chaque outil accepte `dryRun: true` (rapport sans écriture). Toute écriture prévient l'écran
(`onCompetitionEvents` : `competitions:changed`, `fencers:changed`), qui se recharge.

| Outil                 | Arguments                                                                                                                               | Effet                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `import_day`          | `name`, `date`, `stripCount?`, `location?`, `competitions[]` (`title`, `weapon`, `gender`, `category`, `fencersFile?`), `refereesFile?` | Journée multi-épreuves complète ; **idempotent** : journée retrouvée par nom + date, épreuve par titre, tireurs et arbitres dédoublonnés |
| `create_competition`  | `title`, `date`, `weapon` (E/F/S), `gender` (M/F/X), `category`, `location?`                                                            | Épreuve créée avec les réglages par défaut de la fenêtre « Nouvelle compétition » (`buildDefaultCompetitionSettings`)                    |
| `import_fencers`      | `competitionId`, `path` (absolu ; `.xml` `.cotcot` `.txt` `.csv` `.fff` `.xlsx`, 5 Mo max)                                              | Format détecté (XML FFE / cotcot, FFF, CSV, classeur Excel, TXT) ; doublons ignorés (même licence, ou même nom et prénom)                |
| `check_in`            | `competitionId`, `fencers` (ids ou dossards), `present`                                                                                 | Pointage ; abandons, exclusions, forfaits laissés tels quels                                                                             |
| `import_referees`     | `path`, et `competitionId` ou `dayId` (+ `weapons[]`)                                                                                   | Arbitres (Engarde, ou XML `<Arbitres>`) d'une épreuve, ou du groupe d'une journée puis reportés dans ses épreuves ; doublons ignorés     |
| `start_remote_server` | `competitionId`, `port?`                                                                                                                | Serveur des tablettes et écrans (HTTPS et interface : paramètres du poste)                                                               |
| `stop_remote_server`  | `competitionId`                                                                                                                         | ⚠️ Arrêt : tablettes et écrans déconnectés                                                                                               |
| `delete_competition`  | `competitionId`, `confirmTitle`                                                                                                         | ⚠️ Suppression définitive ; titre exact exigé                                                                                            |

## Orchestration sportive (lot 3)

Mêmes fonctions que l'écran (`src/shared/utils/poolOrchestration.ts`, calcul du tableau), exécutées
dans le main (`src/main/engine/commands/sport.ts`). Chaque écriture met à jour les tables **et** l'état de
session, puis prévient l'écran (`onCompetitionEvents` : `session:changed`), qui le relit. L'état de
session porte une révision : une sauvegarde de l'écran faite sur un état périmé est refusée, puis relue.

| Outil             | Arguments                                                                                                         | Effet                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate_pools`  | `competitionId`, `poolCount?`, `minPerPool?`, `maxPerPool?`, `separation?`, `composition?`, `replace?`, `dryRun?` | Tirage sur les tireurs pointés (serpentin, clubs et régions séparés), ou composition préparée (`composition`) ; poules lancées, poule n sur la piste n ; `PoolsGenerated` au journal. ⚠️ `replace` efface des poules jouées ou un tableau |
| `assign_referees` | `competitionId`, `replace?`, `includeUnchecked?`                                                                  | Un arbitre principal par poule, pointé, hors club des tireurs, charge équilibrée                                                                                                                                                          |
| `record_score`    | `competitionId`, `matchId`, `scoreA`, `scoreB`, `winner?`, `specialStatus?`, `priority?`, `dryRun?`               | Score de poule ou de tableau, contrôles de l'écran (score max, égalité, abandon / forfait / exclusion propagés) ; `dryRun` contrôle sans écrire                                                                                           |
| `build_bracket`   | `competitionId`, `thirdPlaceMatch?`, `composition?`, `replace?`, `dryRun?`                                        | Tableau depuis le classement après poules, ou placement donné (`composition`) ; `TableauGenerated` au journal. ⚠️ `replace` efface un tableau joué                                                                                        |
| `export_results`  | `competitionId`, `format` (`xml` / `fff` / `csv` / `html` / `pdf`), `path`, `overwrite?`                          | Fichier de résultats dans un dossier accessible à l'agent                                                                                                                                                                                 |

Formats pilotables : épreuve individuelle, tous les tours de poules d'une formule, tableau simple avec ou sans petite
finale, tableau arrêté à N tireurs ([ADR-0037](adr/0037-deroule-genere-par-la-formule.md)). Après
`close_pool_round` (ou `close_tableau_stage`), `generate_pools` tire le tour suivant sans `composition`, comme
l'écran : tireurs pointés répartis sur le classement du tour précédent (ou le cumul des tours, réglage `cumulative` du tour ;
rang d'entrée au tableau après un tableau arrêté), tailles et score maximum du tour lus dans la formule (`minPerPool` / `maxPerPool` priment) ;
`build_bracket` prend le classement de tous les tours ; `assign_referees` suit le tour courant
([ADR-0042](adr/0042-moteur-formules-multi-tours.md)). Une fois le tableau arrêté clos, plus de tableau :
`build_bracket` refuse (`no_direct_elimination`). « Tirer toutes les places » se tire sans `composition`, comme l'écran
(barrages, petite finale imposée, tableaux de classement créés au fil de `record_score`). Les épreuves par équipes (relais)
restent à l'écran (erreur `unsupported_format`) pour `generate_pools` et `build_bracket` sans `composition`, et pour `assign_referees` ;
le Tournoi des rapières, formule en briques (tour en vagues par niveau, binômes, [ADR-0043](adr/0043-rapieres-briques-generiques.md)),
est piloté comme toute formule, vagues comprises (`launch_pool_wave`, `end_pool_waves`).
`record_score` accepte aussi les tours multiples (tour courant ; tour terminé figé : `round_closed`),
les rapières et « toutes les places » (barrages, tableaux de classement listés par `list_matches`
avec leur nom dans `bracket`) et les tableaux séparés après les poules (un tableau par groupe, identifiants préfixés `F:32-0`). Refusées : épreuves par équipes, qui ont leurs outils
([ADR-0024](adr/0024-tableaux-separes-equipes-moteur.md)) : `generate_team_pools`,
`generate_team_tableau`, `record_relay_score` (score de chaque relais, dans l'ordre ; vainqueur
de la rencontre et rencontre suivante du tableau calculés), `reopen_relay` (dernier relais
terminé), `substitute_team_fencer` (remplaçant), même droit d'écriture sportive.

## Paramétrage du poste et salles

Table `app_settings` (langue, thème, logo, HTTPS et interface du serveur distant, dossiers de
l'agent) et salles (`venues`, `venue_strips`) : lisibles en `--headless`. Les réglages de l'écran
(`localStorage`) y sont recopiés ; une modification par l'agent (`update_settings`) est appliquée à
l'écran ouvert (langue, thème). Au premier démarrage, les pistes déjà déclarées (journées, clubs)
deviennent la salle par défaut.

La salle par défaut fournit ses pistes aux nouvelles journées, aux nouveaux clubs et au nombre
d'arènes proposé par le serveur distant ; chaque piste peut porter un libellé et un appareil Cyrano
(IP, port, mode), repris par Cyrano tant que l'épreuve ou sa journée n'a pas sa propre table
(Paramètres → Salles et pistes).

| Outil               | Arguments                                                 | Effet                                                               |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `update_settings`   | `language?`, `theme?`, `remoteHttps?`, `remoteInterface?` | Paramètres du poste (liste fermée : ni MCP, ni dossiers de l'agent) |
| `upsert_venue`      | `name`, `id?`, `stripCount?`, `isDefault?`                | Salle et ses pistes ; la première devient la salle par défaut       |
| `set_default_venue` | `venueId`                                                 | Salle par défaut                                                    |

## Séances du club (Mode Club, #1872)

Mêmes dépôts que l'onglet Séances (`db.club`). Lecture : `list_clubs`, `list_club_sessions`,
`get_club_session` (présents et encadrement par nom, plan, notes, bilan). Écriture, sur autorisation :

| Outil                   | Effet                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `create_club_session`   | Séance du club : date, intitulé, arme, pistes, maîtres d'armes, objectifs, tranche d'âge ; `planned: true` la prépare sans l'ouvrir |
| `start_club_session`    | Ouvre une séance préparée                                                                                                           |
| `close_club_session`    | Ferme une séance ouverte : combats non terminés annulés, séance déliée du serveur d'entraînement                                    |
| `reopen_club_session`   | Rouvre une séance fermée                                                                                                            |
| `update_club_session`   | Modifie les champs fournis, dont le bilan (`feedback` : `rating` 1 à 5, `wentWell`, `toImprove`) et les notes                       |
| `check_in_club_members` | Pointe (`present: true`) ou dépointe des membres (200 au plus par appel)                                                            |

Pas de suppression de séance par l'agent, ni de saisie de combats : à l'écran. Pas de données
personnelles au-delà des noms (ni licence, ni date de naissance). Aucune notification n'est
encore envoyée à l'écran du club après une écriture de l'agent.

| Fichier                                          | Rôle                                                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/mcp/mcpTools.ts`                       | Outils en lecture                                                                                                                                                                                         |
| `src/main/mcp/mcpWriteTools.ts`                  | Outils d'écriture (lot 2)                                                                                                                                                                                 |
| `src/main/mcp/mcpAdminTools.ts`                  | Paramétrage, salles, arbitres, serveur distant, suppression                                                                                                                                               |
| `src/main/mcp/mcpSportTools.ts`                  | Orchestration sportive (lot 3)                                                                                                                                                                            |
| `src/main/mcp/mcpClubTools.ts`                   | Séances du Mode Club                                                                                                                                                                                      |
| `src/main/engine/commands/`                      | Commandes du moteur (ADR-0003, ex-`src/main/domain`) : `sport.ts` (poules, scores, tableau), `exportResults.ts`, `settings.ts`, `files.ts`                                                                |
| `src/main/batchImport.ts`, `src/main/cliArgs.ts` | `--batch-import`, `--mcp*`                                                                                                                                                                                |
| `src/main/mcp/mcpServer.ts`                      | Serveur HTTP JSON-RPC, jeton, contrôle Host / Origin                                                                                                                                                      |
| `src/main/mcp/mcpSettings.ts`                    | Réglages et jeton chiffré                                                                                                                                                                                 |
| `src/main/mcp/mcpController.ts`                  | Contrôleur du serveur (réglages, jeton, journal), démarrage à l'ouverture de la base ; opérations `getMcpStatus`, `updateMcpSettings`, `regenerateMcpToken`, `listMcpLog` par le port du poste (ADR-0022) |
| `src/renderer/components/McpSettingsSection.tsx` | Section des Paramètres                                                                                                                                                                                    |
| `plugins/bpm-escrime/`                           | Plugin Claude Code : `.mcp.json`, skill, commandes `/bp-etat`, `/bp-journee`, `/bp-epreuve` ; marketplace `.claude-plugin/marketplace.json`                                                               |

## Suite (épique #1880)

L'écran garde son propre état : la source de vérité unique dans le main (tablettes et Cyrano
compris) reste à faire, de même que le calcul du tableau déplacé de `src/renderer` vers
`src/shared`, les cartons dans `record_score` et l'affectation des arbitres par `refereeManager`.

<!-- outils-mcp:début (généré par npm run docs:mcp, ne pas éditer) -->

## Référence des outils (76)

Générée depuis les schémas des outils (`src/main/mcp/*Tools.ts`).

### En lecture (21)

### `list_competitions` — Lister les épreuves

*lecture.* Épreuves enregistrées : titre, date, arme, sexe, catégorie, journée, phase en cours.

Aucun argument.

### `get_competition` — Détail d’une épreuve

*lecture.* Détail d’une épreuve : réglages, phases, nombre de tireurs et de poules.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |

### `list_fencers` — Tireurs d’une épreuve

*lecture.* Tireurs d’une épreuve : nom, club, statut de pointage, classement.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |

### `get_pool_ranking` — Classement des poules

*lecture.* Classement de chaque poule (ou d’une poule) : victoires, indice, rang ; avancement des matchs.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `poolId` | string |  | Restreint à une poule (facultatif) |

### `get_bracket` — Tableau d’élimination directe

*lecture.* Matchs du tableau : tour, tireurs, score, vainqueur (exempts inclus). Tableaux séparés après les poules : tous les tableaux, chaque match avec son groupe, ou celui de « group ».

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `group` | string |  | Tableaux séparés après les poules : groupe du tableau (« F », « M ») ; facultatif |

### `list_referees` — Arbitres d’une épreuve

*lecture.* Arbitres d’une épreuve : nom, club, catégorie, statut.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |

### `day_overview` — Journée multi-épreuves

*lecture.* Sans dayId : journées enregistrées. Avec dayId : épreuves, statut des arbitres partagés et conflits.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `dayId` | string |  | Identifiant de la journée |

### `strip_occupation` — Occupation des pistes

*lecture.* Pistes de la journée : épreuve et match en cours, piste libre ou réservée.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `dayId` | string | oui | Identifiant de la journée |

### `server_status` — Serveur de saisie distante

*lecture.* Serveurs distants actifs : URL, séance ouverte, arènes (match, score, statut), écrans connectés, fin estimée de la phase en cours (durées de référence ajustées en direct).

Aucun argument.

### `cyrano_status` — Appareils de piste Cyrano

*lecture.* Serveur Cyrano : en marche, port, pistes déclarées et dernier statut reçu.

Aucun argument.

### `list_matches` — Lister les matchs

*lecture.* Matchs de poule et de tableau d’une épreuve avec leur identifiant (matchId pour record_score), tireurs, score, état (ready : à tirer, done : joué, pending : tireur attendu) et piste.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `poolNumber` | number |  | Matchs d’une poule seulement |
| `state` | `pending`, `ready`, `done` |  |  |

### `get_settings` — Paramètres du poste

*lecture.* Paramètres globaux du poste (langue, thème, HTTPS et interface du serveur distant) et nombre de pistes de la salle par défaut. Aucun secret.

Aucun argument.

### `list_venues` — Lister les salles

*lecture.* Salles déclarées et leurs pistes ; la salle par défaut fournit ses pistes aux journées.

Aucun argument.

### `list_clubs` — Lister les clubs

*lecture.* Clubs du Mode Club : identifiant, nom, nombre de pistes, arme par défaut.

Aucun argument.

### `list_club_sessions` — Lister les séances d’un club

*lecture.* Séances d’un club, les plus récentes d’abord : identifiant, date, intitulé, statut (planned : préparée ; open : ouverte ; closed : fermée), nombre de présents. Filtres facultatifs par période et par statut.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `clubId` | string | oui | Identifiant du club (list_clubs) |
| `from` | string |  | Date minimale AAAA-MM-JJ |
| `to` | string |  | Date maximale AAAA-MM-JJ |
| `status` | `planned`, `open`, `closed` |  |  |

### `get_club_session` — Détail d’une séance

*lecture.* Séance d’un club : date, intitulé, arme, statut, maîtres d’armes et présents (noms), plan de cours (titres et durées), objectifs, notes et bilan.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `sessionId` | string | oui | Identifiant de la séance (list_club_sessions) |

### `get_competition_events` — Journal d’une épreuve

*lecture.* Journal d’une épreuve (#1980) : événements postérieurs à la révision « since » (resynchronisation, audit), auteur, source et heure. Identifiants seulement, pas de noms.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `since` | integer |  | Dernière révision connue (0 : tout) |
| `limit` | integer |  | Nombre maximum (1000) |

### `get_competition_formula` — Lire la formule d’une épreuve

*lecture.* Formule d’une épreuve : phases de la frise (clés pool-0, pool-1…, quest, tableau), réglages, briques autorisées à chaque position (insertOptions[i] : avant la phase i ; dernier : en fin), origine, état standard / adapted / free et écarts au modèle, relevé de cohérence avec la catégorie.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |

### `get_match_durations` — Durées de match de référence

*lecture.* Durées de match de référence du poste par arme, phase, score, sexe et catégorie : référence effective, historique mesuré, réglage du DT, changement de piste.

Aucun argument.

### `list_formula_templates` — Lister les modèles de formule

*lecture.* Modèles de formule : fournis par l’application (lecture seule) puis personnels du poste. Filtres facultatifs : arme, catégorie, épreuve par équipes, texte. « standardId » : modèle standard du contexte (arme donnée).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `weapon` | `E`, `F`, `S`, `L`, `C` |  |  |
| `category` | `U9`, `U11`, `U13`, `U15`, `U17`, `U20`, `SEN`, `V1`, `V2`, `V3`, `V4` |  |  |
| `isTeamEvent` | boolean |  |  |
| `text` | string |  |  |

### `get_strip_plan` — Plan des pistes

*lecture.* Plan des pistes de l’épreuve : première piste et pistes indisponibles (plan par défaut : piste 1, aucune indisponible ; updatedAt null).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |

### En écriture, sur autorisation (55)

### `create_competition` — Créer une épreuve

*écriture.* Crée une épreuve avec les réglages par défaut de l’application (identiques à la fenêtre « Nouvelle compétition »), ou ceux d’un modèle de formule (« templateId », voir list_formula_templates). Armes : E épée, F fleuret, S sabre, L Sabre Laser, C autre.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `title` | string | oui |  |
| `date` | string | oui | AAAA-MM-JJ |
| `weapon` | `E`, `F`, `S`, `L`, `C` | oui |  |
| `gender` | `M`, `F`, `X` | oui |  |
| `category` | `U9`, `U11`, `U13`, `U15`, `U17`, `U20`, `SEN`, `V1`, `V2`, `V3`, `V4` | oui |  |
| `location` | string |  |  |
| `templateId` | string |  | Modèle de formule (list_formula_templates) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `import_fencers` — Importer des tireurs

*écriture, idempotent.* Importe un fichier de tireurs (XML FFE / cotcot, FFF, CSV, TXT) dans une épreuve. Doublons (même licence, ou même nom et prénom) ignorés.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui |  |
| `path` | string | oui | Chemin absolu du fichier sur le poste DT |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `import_day` — Préparer une journée

*écriture, idempotent.* Crée (ou complète) une journée multi-épreuves à partir d’un manifeste : épreuves, fichiers de tireurs, fichier d’arbitres (Engarde). Relancer le même manifeste ne crée aucun doublon (journée par nom + date, épreuve par titre, tireurs et arbitres dédoublonnés).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `name` | string | oui |  |
| `date` | string | oui | AAAA-MM-JJ |
| `stripCount` | number |  |  |
| `location` | string |  |  |
| `competitions` | object[] | oui |  |
| `refereesFile` | string |  | Fichier d’arbitres Engarde (.txt / .csv) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `update_settings` — Modifier les paramètres du poste

*écriture, idempotent.* Modifie des paramètres globaux validés par schéma. Les réglages du serveur MCP et les dossiers accessibles à l’agent ne se changent que dans l’application.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `language` | `fr`, `en`, `br`, `ca`, `de`, `es`, `pt`, `it`, `ru`, `zh-HK` |  |  |
| `theme` | string |  |  |
| `remoteHttps` | boolean |  | Serveur distant en HTTPS |
| `remoteInterface` | string |  | Interface d’écoute du serveur distant (0.0.0.0 = toutes) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `upsert_venue` — Déclarer une salle

*écriture, idempotent.* Crée ou remplace une salle et ses pistes. La première salle devient la salle par défaut ; ses pistes sont reprises par les nouvelles journées.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `id` | string |  | Salle existante à remplacer (absent = création) |
| `name` | string | oui |  |
| `stripCount` | number |  | Nombre de pistes numérotées 1…n |
| `isDefault` | boolean |  | Salle par défaut |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `set_default_venue` — Salle par défaut

*écriture, idempotent.* Choisit la salle utilisée par défaut (list_venues).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `venueId` | string | oui |  |

### `import_referees` — Importer des arbitres

*écriture, idempotent.* Importe un fichier d’arbitres (Engarde .txt / .csv, ou XML avec <Arbitres>) dans une épreuve (« competitionId »), ou dans le groupe d’une journée (« dayId », avec leurs armes d’arbitrage) puis les reporte dans ses épreuves. Doublons ignorés.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string |  | Identifiant de la compétition (list_competitions) |
| `dayId` | string |  | Journée (day_overview) : arbitres partagés |
| `path` | string | oui | Chemin absolu du fichier sur le poste DT |
| `weapons` | `E`, `F`, `S`[] |  | Armes d’arbitrage (journée) ; vide = toutes |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `start_remote_server` — Démarrer le serveur distant

*écriture.* Démarre le serveur des tablettes d’arbitre et écrans d’arène d’une épreuve (HTTPS et interface : paramètres du poste ; une arène par poule, sinon par piste de la journée ou de la salle). Il écoute sur le réseau local : accord du DT indispensable.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `port` | number |  | Port (défaut 8066) |

### `stop_remote_server` — Arrêter le serveur distant

*⚠️ écriture, destructif, idempotent.* Arrête le serveur distant d’une épreuve : tablettes et écrans déconnectés. Accord du DT indispensable.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |

### `delete_competition` — Supprimer une épreuve

*⚠️ écriture, destructif.* Supprime définitivement une épreuve et toutes ses données. Exige son titre exact (« confirmTitle ») et l’accord du DT.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `confirmTitle` | string | oui |  |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `export_results` — Exporter les résultats

*écriture, idempotent.* Écrit les résultats dans un fichier d’un dossier accessible à l’agent : xml (BPM - Escrime / FFE), fff (classement FFE), csv (classement après poules), html ou pdf (classement final). « overwrite: true » pour remplacer un fichier existant.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `format` | `xml`, `fff`, `csv`, `html`, `pdf` | oui |  |
| `path` | string | oui | Chemin absolu du fichier à écrire |
| `overwrite` | boolean |  | Remplacer un fichier existant |

### `create_club_session` — Créer une séance

*écriture.* Crée une séance d’un club : date, intitulé, arme, pistes, maîtres d’armes, objectifs, tranche d’âge du cours. « planned: true » la prépare sans l’ouvrir (start_club_session l’ouvre ensuite) ; sinon elle est ouverte tout de suite.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `clubId` | string | oui | Identifiant du club (list_clubs) |
| `date` | string | oui | Date AAAA-MM-JJ |
| `label` | string |  | Intitulé de la séance |
| `weapon` | `E`, `F`, `S`, `L` |  | Arme (règles de la saisie distante) |
| `stripCount` | number |  | Nombre de pistes |
| `coachIds` | string[] |  | Maîtres d’armes encadrant (identifiants du club) |
| `objectives` | string |  |  |
| `planned` | boolean |  | Séance préparée, non ouverte |
| `ageFrom` | string |  | Catégorie d’âge de début du cours (U9 … V4) |
| `ageTo` | string |  | Catégorie d’âge de fin du cours (U9 … V4) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `start_club_session` — Ouvrir une séance préparée

*écriture.* Ouvre une séance préparée (statut planned). Les autres séances ouvertes restent ouvertes.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `sessionId` | string | oui | Identifiant de la séance (list_club_sessions) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `close_club_session` — Fermer une séance

*écriture.* Ferme une séance ouverte. Les combats non terminés sont annulés et la séance est déliée du serveur d’entraînement. Réouverture possible (reopen_club_session).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `sessionId` | string | oui | Identifiant de la séance (list_club_sessions) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `reopen_club_session` — Rouvrir une séance

*écriture.* Rouvre une séance fermée.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `sessionId` | string | oui | Identifiant de la séance (list_club_sessions) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `update_club_session` — Modifier une séance

*écriture, idempotent.* Modifie une séance : date, intitulé, arme, pistes, maîtres d’armes, objectifs, notes, tranche d’âge, bilan (note 1 à 5, points forts, à améliorer). Seuls les champs fournis changent.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `sessionId` | string | oui | Identifiant de la séance (list_club_sessions) |
| `date` | string |  | Date AAAA-MM-JJ |
| `label` | string |  |  |
| `weapon` | `E`, `F`, `S`, `L` |  |  |
| `stripCount` | number |  |  |
| `coachIds` | string[] |  |  |
| `objectives` | string |  |  |
| `notes` | string |  | Compte rendu du maître d’armes |
| `feedback` | object |  | Bilan : rating (1 à 5), wentWell, toImprove |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `check_in_club_members` — Pointer les membres d’une séance

*écriture, idempotent.* Pointe (present: true) ou dépointe (present: false) des membres du club pour une séance. Les identifiants viennent de list_members côté écran ; get_club_session donne les présents.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `sessionId` | string | oui | Identifiant de la séance (list_club_sessions) |
| `memberIds` | string[] | oui | Identifiants des membres (200 au plus) |
| `present` | boolean | oui | true : pointer ; false : dépointer |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |

### `check_in` — Pointer des tireurs

*écriture, idempotent.* Pointe (présent) ou dépointe des tireurs d’une épreuve, par identifiant ou numéro de dossard (ref).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `fencers` | string / integer[] | oui | Identifiants ou numéros (ref) |
| `present` | boolean | oui | true : présent ; false : absent |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `record_score` — Saisir un score

*écriture, idempotent.* Score d’un match de poule (tour courant) ou de tableau, tableaux de classement compris (matchId : list_matches), mêmes contrôles que l’écran : score maximum, égalité tranchée par « winner » (ou « priority » en poule), statut spécial du perdant. Classements recalculés ; au tableau, le vainqueur passe au tour suivant. Ne saisir que des scores donnés par le DT ; « dryRun: true » contrôle le score sans l’écrire.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant du match (list_matches) |
| `scoreA` | integer | oui | Touches du tireur A |
| `scoreB` | integer | oui | Touches du tireur B |
| `winner` | `A`, `B` |  | Vainqueur imposé |
| `specialStatus` | `abandon`, `forfait`, `exclusion` |  | Statut du perdant |
| `blackCard` | boolean |  | Exclusion sur carton noir (motif du rapport fédéral) |
| `correction` | object |  | Correction d’un score de poule après le tirage du tableau (#1996) |
| `priority` | `A`, `B` |  | Égalité en poule : prioritaire |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `generate_pools` — Générer les poules

*⚠️ écriture, destructif.* Poules du tour courant, lancées (phase Poules). Sans « composition » : tirage sur les tireurs pointés par la même fonction que l’écran (serpentin sur le classement, puis clubs et régions séparés, ou les critères de « separation »), poule n sur la piste n ; épreuve individuelle. Tour suivant (après « closePoolRound » ou « closeTableauStage ») : tireurs pointés répartis sur le classement du tour précédent (ou le cumul des tours si le tour est réglé « cumulative »), ou sur le rang d’entrée au tableau après un tableau arrêté, tailles et score maximum du tour lus dans la formule (« minPerPool » et « maxPerPool » priment), comme l’écran (docs/adr/0042). Avec « composition » : poules et ordre des matchs retenus par le DT à la préparation, tels quels (tous formats individuels, tours multiples compris). « replace: true » efface des poules déjà jouées ou un tableau : accord du DT indispensable.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `poolCount` | integer |  | Nombre de poules (défaut : optimal) |
| `minPerPool` | integer |  | Tireurs par poule, minimum (défaut 5) |
| `maxPerPool` | integer |  | Tireurs par poule, maximum (défaut 7) |
| `separation` | `byRanking`, `byClub`, `byRegion`, `byNation`[] |  | Critères actifs, par priorité (comme l’écran) : avant « byRanking », ils priment sur le classement ; après, échanges dans le chapeau. Défaut : ["byRanking", "byClub", "byRegion"] |
| `composition` | object[] |  | Poules préparées par le DT (écran) : pas de tirage |
| `replace` | boolean |  | Remplacer des poules ou un tableau existants |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `add_pool_fencer` — Ajouter un tireur à une poule

*écriture.* Ajoute un tireur à une poule lancée (tireur arrivé en retard) : un match contre chaque tireur de la poule, à la suite des matchs existants. Refus si le tableau est tiré ou si le tireur est déjà placé.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `poolId` | string | oui | Identifiant de la poule |
| `fencerId` | string | oui | Identifiant du tireur |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `build_bracket` — Construire le tableau

*⚠️ écriture, destructif.* Tableau d’élimination directe. Sans « composition » : construit depuis le classement après poules (tireurs éliminés, abandons, forfaits et exclus écartés), avec ou sans petite finale (épreuve individuelle, tableau simple), ou « tirer toutes les places » (barrages, petite finale imposée, tableaux de classement créés au fil des scores, même planification que l’écran) : après plusieurs tours de poules, classement de tous les tours (docs/adr/0042) ; refus « no_direct_elimination » une fois le tableau arrêté clos, les tours de poules qui suivent terminent l’épreuve (docs/adr/0037). Avec « composition » : placement calculé par l’écran (barrages, exemptions, rangs de sortie de poules), tel quel. « replace: true » efface un tableau déjà joué : accord du DT indispensable. Tableaux séparés après les poules : un tableau par groupe (« group » exigé), identifiants de match préfixés par le groupe (« F:32-0 »). Sans « composition » : « tiedAtBar » liste les ex aequo à la barre de qualification au-delà du quota, « ties » choisit leur sort pour ce tableau (docs/adr/0040). Tirage (docs/adr/0045) : mode de la phase tableau de la formule (« draw » : strict, pairs, groups, random ; strict sans formule) ; tableau au rang d’entrée (sans poule) : ex aequo et non classés tirés au sort, quel que soit le mode. Le moteur tire la graine (0 à 2³² − 1) sauf « seed » ; « draw » rend { mode, seed }, aperçu compris : rejouer avec la graine de l’aperçu donne le même tableau. « composition » refusée (invalid_composition) pour un mode autre que strict ou un tableau au rang d’entrée. Le rang d’entrée (seedA, seedB) reste celui du classement.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `thirdPlaceMatch` | boolean |  | Match pour la 3e place |
| `composition` | object[] |  | Placement calculé par l’écran : pas de planification |
| `group` | string |  | Tableaux séparés après les poules : groupe du tableau (« F », « M »), exigé pour ce format |
| `replace` | boolean |  | Remplacer un tableau existant |
| `ties` | `all`, `initial_ranking`, `draw`, `barrage` |  | Ex aequo à la barre, pour cette coupe seulement (prime sur la formule) : all = tous qualifiés, initial_ranking = départagés par le rang d’entrée du tour, draw = tirage au sort (FIE o.73.2.f) ; barrage pas encore disponible (refus invalid_settings) |
| `seed` | integer |  | Graine du tirage (0 à 2³² − 1) ; absente : tirée par le moteur |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `clear_score` — Annuler un score

*⚠️ écriture, destructif.* Annule le score d’un match : match de poule remis à jouer (classements recalculés), ou match de tableau rouvert (vainqueur retiré du tour suivant). Refus si le tour suivant est joué, ou pour une poule une fois le tableau tiré.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant du match (list_matches) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `assign_matches` — Arbitres et pistes des poules et des matchs

*écriture, idempotent.* Arbitres et pistes : d’une poule (« pools » : piste, arbitres principal en tête, l’arbitre principal passant sur les matchs de la poule) ou d’un match (« matches » : arbitre principal ; piste pour un match de tableau). Seuls les champs fournis changent.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `pools` | object[] |  |  |
| `matches` | object[] |  |  |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `adjust_ranking` — Ajuster le classement après poules

*⚠️ écriture, destructif.* Classement après poules ajusté par le DT : rang (et points Quest) de chaque tireur, répercutés dans les classements de poule. Le classement complet est fourni, dans l’ordre.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `ranking` | object[] | oui |  |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `skip_pools` — Passer les poules

*⚠️ écriture, destructif.* Épreuve sans poules : classement initial sur les tireurs pointés (« fencerIds » : tireurs choisis, sinon tous les pointés), rangés par classement d’entrée puis par nom ; les ex aequo et les non classés sont tirés au sort au tirage du tableau (docs/adr/0045), puis tableau.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `fencerIds` | string[] |  | Tireurs du classement initial (l’ordre ne compte pas) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `clear_tableau` — Retirer le tableau

*⚠️ écriture, destructif.* Retire le tableau (et les tableaux de classement) : il est refait sur le classement courant à l’ouverture de l’onglet Tableau. Accord du DT indispensable si des matchs sont joués. Tableaux séparés : tableau du groupe « group ».

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `group` | string |  | Tableaux séparés après les poules : groupe du tableau (« F », « M »), exigé pour ce format |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `rebuild_competition_state` — Vérifier et réparer l’état d’une épreuve

*⚠️ écriture, destructif.* Maintenance (docs/adr/0017) : rejoue le journal de l’épreuve et le compare à son état. « dryRun: true » (conseillé d’abord) rend les écarts sans rien écrire. Sinon l’état est aligné sur le journal pour les faits rejouables : statuts des tireurs, scores de poule du tour courant, décisions du tableau et des tableaux de classement, vagues d’un tour en vagues ; classements et classement final recalculés. Les écarts de structure (poules, tours, placement du tableau) et les abandons sans touches restent dans « remaining ». Journal incomplet (épreuve antérieure) : statuts seuls.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `withdraw_fencer` — Retirer un tireur

*⚠️ écriture, destructif.* Retire un tireur de l’épreuve : abandon (médical), forfait ou exclusion (« blackCard » : carton noir). À l’appel : statut seul. En poules : ses matchs non disputés sont perdus (DNS s’il n’a commencé aucun match). Au tableau : son match en cours est perdu, l’adversaire passe. Refus si le tableau est terminé ou si l’adversaire n’est pas encore connu. Épreuve par équipes : statut et motif seuls, rencontres inchangées (remplaçant : substitute_team_fencer). « dryRun: true » donne les matchs perdus sans rien écrire. Annulation : reinstate_fencer.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `fencerId` | string | oui | Identifiant du tireur |
| `reason` | `abandon`, `forfait`, `exclusion` | oui | Motif du retrait |
| `blackCard` | boolean |  | Exclusion sur carton noir (rapport fédéral) |
| `matchId` | string |  | Match où le retrait a lieu (carton, abandon sur la piste) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `reinstate_fencer` — Réintégrer un tireur

*écriture.* Annule le retrait d’un tireur (abandon, forfait, exclusion) : statut et matchs d’avant le retrait. Refus si un match qui suit a été joué depuis, ou si le tableau a été tiré après un retrait en poules.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `fencerId` | string | oui | Identifiant du tireur |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `set_refereeing_settings` — Réglages d’affectation des arbitres

*écriture, idempotent.* Réglages d’affectation des arbitres de l’épreuve (neutralité club / nation / ligue, équilibrage de la charge, rotation). Seuls les champs fournis changent ; les autres réglages de l’épreuve sont conservés.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `neutrality` | object |  |  |
| `balance` | boolean |  | Équilibrer la charge entre arbitres |
| `maxConsecutiveMatches` | integer |  |  |
| `minRestTimeMinutes` | integer |  |  |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `assign_referees` — Arbitres des poules

*écriture, idempotent.* Un arbitre principal par poule sans arbitre, parmi les arbitres pointés, par le même moteur que l’écran (affectation optimale, neutralité selon les réglages de l’épreuve ; un arbitre peut enchaîner plusieurs poules). Une poule sans arbitre neutre reste sans arbitre : « unassigned » donne les arbitres écartés et leurs raisons, « warnings » le résumé. « replace: true » réaffecte toutes les poules.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `replace` | boolean |  | Réaffecter toutes les poules |
| `includeUnchecked` | boolean |  | Accepter les arbitres non pointés |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `assign_referee` — Arbitre à la main (poule ou match)

*écriture, idempotent.* Arbitre choisi à la main (docs/adr/0014), pour une poule (« poolNumber » : il remplace l’arbitre principal et passe sur les matchs de la poule) ou pour un match (« matchId » : poule ou tableau, ce match seulement). Un arbitre non neutre est accepté et signalé (« conflicts »). « refereeId: null » retire l’arbitre.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `poolNumber` | integer |  | Numéro de la poule |
| `matchId` | string |  | Match de poule ou de tableau (list_matches) |
| `refereeId` | string / null | oui | Identifiant de l’arbitre (list_referees), ou null |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `apply_formula_template` — Appliquer un modèle de formule

*écriture.* Applique un modèle de formule (list_formula_templates) compatible avec l’arme, la catégorie et le type de l’épreuve ; l’origine est enregistrée. Formule de l’arme « Autre » figée après le tirage (draw_done).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `templateId` | string | oui | Modèle de formule (list_formula_templates) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `update_competition_formula` — Modifier la formule d’une épreuve

*écriture.* Modifie la formule d’une épreuve par une liste d’opérations appliquées dans l’ordre, tout ou rien : insertPhase (brique pool | quest | tableau | split, position « at » comme insertOptions ; split : scission, toujours en dernier, après un tour de poules ou un tableau arrêté, docs/adr/0039), removePhase (clé de phase), setPhase (clé, réglages de cette phase seule : tour de poules sizeMin, sizeMax, maxScore, timerSeconds, qualification { mode all | percentage | fixed_count | fixed_bracket | pool_winner | pool_heads, count, percentage } ou qualifiers ; pool_heads, têtes de poule puis suivants jusqu’à count (premiers de chaque poule, puis deuxièmes… ; ordre d’entrée au tableau : au moins deux rangs de poule pris en entier, rang par rang, chacun dans l’ordre des poules (A1, B1, A2, B2), sinon tous les qualifiés dans l’ordre du classement général ; réglage avancé, avant un tableau ; plus de poules que de qualifiés refusé ; ex aequo à la barre sur le dernier rang pris ; docs/adr/0043), seeding previous_round | cumulative, boutOrder fie | free | waves | waves_classic (réglage avancé ; vagues : poules de 2 à 10, vagues classiques de 2 à 15, docs/adr/0043), distribution serpentine | byLevel (expert : équipes de même niveau regroupées, du plus faible au plus fort ; null : serpentin, docs/adr/0043), scoring, teamMatch ; tableau maxScore, timerSeconds, thirdPlace, allPlaces, scoring, draw strict | pairs | groups | random (mode de tirage : strict au rang, par paires 1-2, 3-4…, par groupes 3-4, 5-8, 9-16…, intégral ; null : strict ; figé une fois le tableau tiré, docs/adr/0045), teamMatch ; Tour Quest qualifiersCount ; scission criterion gender | category | rank | manual, branches [{ label, phases, gender, categories, take, stayInCompetition }] ; stayInCompetition : scission par sexe, toutes les branches réduites à un tableau ou aucune (compétition couplée, tableaux séparés dans l’épreuve) ; « tableau » règle alors le tableau des branches restées), setGeneral (restTimeSeconds, ruleSet, entry { kind individual } ou { kind team, size 2, levels [du plus faible, niveau 1, au plus fort] } (binômes, expert ; null : individuelle, docs/adr/0043) ; rankingFilters [category | gender | level | handicap] (expert : filtres proposés pour le classement final affiché, les PDF et le CSV ; renumérote depuis 1, un affichage sans compétition fille ni publication distincte ; null ou liste vide : aucun filtre, docs/adr/0043) ; tieBreakByVictory (arme « Autre » : une égalité en fin de temps se tranche par un vainqueur désigné, tirage au sort puis minute supplémentaire, comme l’épée, le fleuret, le sabre et le Sabre Laser ; true ou null : selon l’arme, docs/adr/0043) ; teamMatch { starters 2-4, reserves 0-2, relayStep, relayOrder fie | rotation } (épreuve par équipes en relais FIE : règle de rencontre de la formule, surchargée champ par champ par le teamMatch d’un tour de poules ou du tableau ; fie à 3 titulaires seulement, imposé à 3 titulaires en épée, fleuret et sabre (rotation refusée, o.99.3) ; null : réglages d’épreuve ; briques admises : un tour de poules puis un tableau, ou un tableau seul, sinon team_brick_unsupported, docs/adr/0044); postPoolSplitCriteria : gender pose la compétition couplée, scission par sexe dont les deux branches restent, null la retire). Les anciens noms poolMaxScore, poolTimerSeconds, poolSizeMin, poolSizeMax, poolBoutOrder s’appliquent à tous les tours. Bornes jugées tour par tour, structure contrôlée (au moins une phase de combat, nombre de qualifiés suffisant et réparti en poules, branche terminée par une phase qui classe, phases déjà commencées de l’épreuve conservées, avec la règle de qualification qui y mène ou qui sort d’un tour de poules clos, docs/adr/0041) ; refus : invalid_settings, une remarque par ligne avec la clé de la phase en cause ([pool-0], [tableau], [split], [formule] pour la formule entière), draw_done.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `operations` | valeur[] | oui |  |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `close_tableau_stage` — Clore le tableau arrêté

*⚠️ écriture, destructif.* Clôt un tableau arrêté à N tireurs (formule enregistrée, docs/adr/0037) : quand tous les matchs avant l’arrêt sont joués, les N restants passent à la phase suivante (classement = rang d’entrée), les éliminés sortent (classés par tour atteint puis rang d’entrée). Refus : invalid_settings (formule sans tableau arrêté suivi d’une phase), tableau_stage_not_complete.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `close_pool_round` — Clore le tour de poules

*⚠️ écriture, destructif.* Clôt le tour de poules courant (toutes les poules terminées) : qualifiés selon le classement du tour (formule, puis réglage du nombre de qualifiés, ou « qualifierCount »), non-qualifiés éliminés, tour archivé ; le tour suivant se pointe puis se tire. « dryRun: true » donne le nombre de qualifiés et d’éliminés, et les ex aequo à la barre au-delà du quota (« tiedAtBar »), sans rien écrire. « ties » choisit le sort de ces ex aequo pour cette coupe (docs/adr/0040). Refus sous 4 qualifiés.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `qualifierCount` | integer |  | Nombre de qualifiés imposé |
| `ties` | `all`, `initial_ranking`, `draw`, `barrage` |  | Ex aequo à la barre, pour cette coupe seulement (prime sur la formule) : all = tous qualifiés, initial_ranking = départagés par le rang d’entrée du tour, draw = tirage au sort (FIE o.73.2.f) ; barrage pas encore disponible (refus invalid_settings) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `launch_pool_wave` — Lancer une vague

*écriture.* Tour en vagues (ordre des matchs « waves » ou « waves_classic » de la formule) : lance la vague « wave » (ses matchs deviennent ceux à tirer ; 0 = aucune vague lancée ; les tablettes suivent la vague tant que l’écran de l’épreuve est ouvert). Refus : unsupported_format hors tour en vagues, invalid_wave si la vague n’a aucun match.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `wave` | integer | oui | Vague à lancer (0 : aucune) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `end_pool_waves` — Arrêter ou reprendre les vagues

*écriture.* Tour en vagues : arrête les vagues avant leur terme (« ended: true », passage au classement sur les matchs joués) ou les reprend (« ended: false »).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `ended` | boolean | oui | true : vagues arrêtées ; false : reprises |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `split_off_group` — Extraire un groupe en épreuve séparée

*écriture.* Tableaux séparés après les poules : extrait un groupe (« F », « M ») dans une épreuve séparée. Dans une seule transaction : crée l’épreuve (mêmes réglages, sans le mode couplé), y copie les tireurs du groupe (pointés, rang après poules), y écrit le classement après poules du groupe (phase Classement), puis note l’épreuve séparée sur l’épreuve d’origine (le groupe n’y a plus de tableau). Refus : épreuve sans tableaux séparés (invalid_input), groupe absent du classement ou déjà extrait (split_group_not_found), tableau du groupe déjà tiré (bracket_exists).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `group` | string | oui | Groupe à extraire (« F », « M ») |
| `title` | string | oui | Titre de l’épreuve séparée |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve d’origine : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `split_competition` — Scinder l’épreuve en compétitions filles

*écriture.* Scission de la formule (dernière phase, docs/adr/0039) : quand la phase qui la précède est close (tour de poules terminé, tableau arrêté clos), répartit son classement entre les branches (sexe ou catégorie du tireur ; rang : nombre ou pourcentage de l’effectif entrant, ex aequo à la borne selon « take.ties » de la branche ou « ties » (tous gardés par défaut, docs/adr/0040), la dernière branche prend le reste ; manuelle : « assignments »). Dans une seule transaction, chaque branche devient une compétition fille (titre « titre d’origine – libellé », formule de la branche, tireurs copiés avec leur rang dans la branche) ; l’épreuve d’origine garde les autres tireurs. « dryRun: true » rend la répartition, les tireurs sans valeur pour le critère, les ex aequo à une borne au-delà du nombre (« tiedAtBar ») et le classement d’entrée (« entrants »), sans refus. Toutes les branches partent en compétitions filles (« stayInCompetition » vaut false) ; scission par sexe dont toutes les branches restent dans l’épreuve (compétition couplée, tableaux séparés) : refus invalid_settings. Refus : invalid_settings (pas de scission en dernière phase), pools_not_complete, tableau_stage_not_complete, split_value_missing (tireur sans sexe, sans catégorie ou non affecté), split_group_not_found (épreuve déjà scindée), not_enough_fencers (branche vide).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `assignments` | object[] |  | Scission manuelle : branche de chaque tireur (libellé) |
| `ties` | `all`, `initial_ranking`, `draw`, `barrage` |  | Ex aequo à la barre, pour cette coupe seulement (prime sur la formule) : all = tous qualifiés, initial_ranking = départagés par le rang d’entrée du tour, draw = tirage au sort (FIE o.73.2.f) ; barrage pas encore disponible (refus invalid_settings) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. Les écritures qui ne passent pas encore par le contrat (écran, tablettes) ne sont pas détectées. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `set_strip_start` — Piste de départ de l’épreuve

*écriture, idempotent.* Plan des pistes : première piste de l’épreuve (les pistes inférieures, d’autres épreuves de la journée, sont masquées aux écrans ; une poule sans piste attend dans l’intervalle). Journal : StripStartChanged.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `start` | integer | oui | Première piste, de 1 à 999 |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `set_strip_availability` — Piste disponible ou non

*écriture, idempotent.* Plan des pistes : marque une piste indisponible (panne) ou la remet en service. Exactement un de « competitionId » (une épreuve) ou « eventDayId » (toutes les épreuves de la journée, tout ou rien : panne de la salle ; « commandId » commun, « expectedRevision » refusé). La répartition des poules et du tableau, les tablettes et l’affectation des pistes de la journée l’évitent. Refus : competition_not_found, event_day_not_found, invalid_input, revision_conflict, command_already_applied. Journal : StripAvailabilityChanged (une épreuve déjà dans l’état demandé n’en reçoit pas).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string |  | Identifiant de la compétition (list_competitions) |
| `eventDayId` | string |  | Identifiant de la journée (listEventDays) |
| `strip` | integer | oui | Numéro de piste, de 1 à 999 |
| `available` | boolean | oui | false : piste indisponible ; true : remise en service |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal de l’épreuve (revision_conflict sinon) ; refusée avec « eventDayId » (une révision par épreuve) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `update_team` — Modifier une équipe

*écriture.* Épreuve par équipes : modifie le nom, le club ou le rang d’entrée d’une équipe (ranking null : rang retiré, rang calculé sur les classements des titulaires puis le nom, docs/adr/0044). Sans journal (docs/adr/0018). Refus : épreuve individuelle (unsupported_format), équipe inconnue (team_not_found), après le tirage (draw_done).

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `teamId` | string | oui | Identifiant de l’équipe |
| `name` | string |  | Nouveau nom |
| `club` | string |  | Nouveau club |
| `ranking` | integer / null |  |  |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `generate_team_pools` — Tirer les poules d’équipes

*⚠️ écriture, destructif.* Épreuve par équipes : tire les poules d’équipes et crée leurs rencontres, chacune avec ses relais fixés (titulaires par ordre, ordre des relais de la règle de rencontre du tour : FIE o.99.3 à 3 titulaires ou rotation). Relais FIE avec une formule d’équipe (general.teamMatch, docs/adr/0044) : poules du tour de la formule comme en individuel (taille de poule, nombre optimal ou « poolCount », serpentin au rang d’entrée effectif des équipes, clubs séparés, ordre officiel des rencontres, positions tirées au sort), relais et palier de la règle du tour ; sans formule d’équipe : poule unique tous contre tous dans l’ordre des noms (« poolCount » refusé, invalid_pool_count). Arène Sabre Laser : calendrier figé du règlement, 8 ou 12 équipes seulement. Refus : épreuve individuelle (unsupported_format), moins de 2 équipes ou arène hors 8/12 (invalid_composition), titulaires manquants (team_incomplete), formule sans tour de poules (no_pools), plus de poules que la moitié des équipes (invalid_pool_count), poules déjà tirées sans « replace » (draw_done), relais déjà joués (pools_have_scores), tableau d’équipes créé (bracket_exists). Journal : TeamPoolsGenerated, puis un TeamMatchScheduled par rencontre.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `poolCount` | integer |  | Nombre de poules (formule d’équipe seulement ; défaut : nombre optimal ; docs/adr/0044) |
| `replace` | boolean |  | Remplacer des poules déjà tirées dont aucun relais n’est joué |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `generate_team_tableau` — Tirer le tableau d’équipes

*⚠️ écriture, destructif.* Épreuve par équipes : tire le tableau d’équipes sur le classement de poule (arène Sabre Laser : évitement de revanche au premier tour, 5↔6 et 7↔8) et crée les rencontres dont les deux équipes sont connues, avec leurs relais. Tour = nombre de rencontres du tour (taille / 2 au premier, 1 en finale) ; identifiants `${competitionId}-t${tour}-${position}`. Refus : épreuve individuelle (unsupported_format), moins de 2 équipes (invalid_composition), titulaires manquants (team_incomplete), rencontres de poule non terminées (pools_not_complete), tableau déjà créé sans « replace » (bracket_exists), relais du tableau déjà joués (bracket_has_scores). Tirage (docs/adr/0045) : mode de la phase tableau de la formule (« draw » : strict, pairs, groups, random ; arène Sabre Laser : strict) ; tableau sans poule : équipes à rang effectif égal et sans rang tirées au sort (ADR-0044). Le moteur tire la graine (0 à 2³² − 1) sauf « seed » ; « draw » rend { mode, seed }, aperçu compris : rejouer avec la graine de l’aperçu donne le même tableau. Journal : TeamTableauGenerated (tirage compris), puis un TeamMatchScheduled par rencontre.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `replace` | boolean |  | Remplacer un tableau d’équipes dont aucun relais n’est joué |
| `seed` | integer |  | Graine du tirage (0 à 2³² − 1) ; absente : tirée par le moteur |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `record_relay_score` — Saisir le score d’un relais

*écriture.* Épreuve par équipes : enregistre le score d’un relais (le score du relais, pas le cumul) et le termine. Le cumul, le vainqueur du relais et celui de la rencontre se calculent. Dernier relais : rencontre terminée ; égalité au tableau → « winner » requis (minute avec priorité), en poule → égalité. Au tableau, la rencontre suivante est créée dès que ses deux équipes sont connues. Refus : rencontre inconnue (match_not_found), relais déjà terminé ou précédents non terminés (relay_out_of_order), cumul au-delà du palier du relais FIE (armes olympiques : d’autant de touches que de cartons rouges adverses du relais, t.41.1 ; Sabre Laser en points : de 4 points) ou assaut au-delà du plafond en arène (score_above_max), égalité sans vainqueur au tableau (draw_needs_winner), vainqueur contraire au score (winner_contradicts_score), équipe retirée ou exclue (team_withdrawn). Journal : RelayScoreRecorded, puis TeamMatchDecided et TeamMatchScheduled selon le cas.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `relay` | integer | oui | Ordre du relais dans la rencontre (dès 1) |
| `scoreA` | integer | oui | Touches de l’équipe A dans ce relais |
| `scoreB` | integer | oui | Touches de l’équipe B dans ce relais |
| `winner` | `A`, `B` |  | Vainqueur de la rencontre en cas d’égalité au dernier relais (minute avec priorité) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `reopen_relay` — Rouvrir le dernier relais

*⚠️ écriture, destructif.* Épreuve par équipes : rouvre le dernier relais terminé d’une rencontre pour correction (son score est gardé comme score en cours). La rencontre repasse en cours ; au tableau, la rencontre suivante pas encore commencée est retirée. Refus : rencontre inconnue (match_not_found), aucun relais terminé (relay_out_of_order), rencontre suivante du tableau commencée (next_match_played), équipe retirée ou exclue (team_withdrawn). Journal : RelayReopened.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `substitute_team_fencer` — Faire entrer le remplaçant

*écriture.* Épreuve par équipes : le remplaçant de l’équipe prend la place du tireur sortant dans les relais non terminés de la rencontre (o.99.5, o.99.6). Un seul remplaçant par équipe et par rencontre. Remplaçant choisi par « inFencerId » (facultatif ; absent : le premier remplaçant ; remplaçants admis par la règle de rencontre de la phase, docs/adr/0044). Refus : rencontre inconnue (match_not_found), équipe absente de la rencontre (team_not_found), tireur absent de la rencontre (fencer_not_found), pas de remplaçant (no_reserve), « inFencerId » qui n’est pas un remplaçant de l’équipe (invalid_composition), remplaçant déjà entré (reserve_used), plus aucun relais à tirer pour ce tireur (no_later_relay). Journal : TeamFencerSubstituted.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `teamId` | string | oui | Équipe du tireur sortant |
| `outFencerId` | string | oui | Tireur sortant |
| `inFencerId` | string |  | Remplaçant qui entre (défaut : le premier remplaçant de l’équipe, docs/adr/0044) |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal : refus « revision_conflict » si une autre commande du contrat a écrit entre-temps. |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |

### `give_team_card` — Donner un carton E

*écriture.* Arène Sabre Laser : carton E (désignation tardive) à une équipe de la rencontre ; sans « type », blanc puis jaune. Noir toujours accepté. Refus : unsupported_format, match_not_found, team_not_in_match, team_withdrawn, match_finished (rencontre suivante commencée). Journal : TeamCardGiven.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |
| `teamId` | string | oui | Équipe sanctionnée |
| `type` | `white`, `yellow`, `red`, `black` |  | Type choisi ; absent : escalade |

### `give_relay_card` — Donner un carton dans un relais

*écriture.* Épreuve par équipes : carton au tireur du côté A ou B dans un relais, en cours ou dernier terminé (rencontre suivante pas commencée). Exactement un de « reason » (type par l’escalade sur la rencontre) ou « type » (appareil de piste). Noir : tireur exclu (FencerWithdrawn) ; armes olympiques : rencontre perdue et équipe exclue (TeamMatchDecided, TeamWithdrawn, o.99.7.b). Sabre Laser : tireur seul. Refus : invalid_input, match_not_found, relay_not_found, relay_out_of_order, match_finished, team_withdrawn, already_withdrawn. Journal : RelayCardGiven.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |
| `relayId` | string | oui | Relais (bouts[].id) |
| `side` | `A`, `B` | oui | Côté du tireur sanctionné |
| `reason` | `early_start`, `late_stop`, `body_contact`, `counter_attack`, `target_substitution`, `voluntary_drop`, `time_wasting`, `non_compliant_gear`, `estoc`, `unarmed_hand`, `voluntary_exit`, `heavy_hit`, `brutality`, `dangerous`, `refusal`, `unsportsmanlike`, `cheating`, `fie_leaving_piste`, `fie_body_contact`, `fie_turning_back`, `fie_covering_target`, `fie_touching_equipment`, `fie_lateral_exit`, `fie_unjustified_stop`, `fie_non_compliant_equipment`, `fie_straightening_blade`, `fie_point_on_piste`, `fie_sabre_forward_cross`, `fie_disobedience`, `fie_non_compliant_hair`, `fie_jostling`, `fie_abnormal_movement`, `fie_unjustified_appeal`, `fie_unarmed_arm`, `fie_medical_pretext`, `fie_missing_control_mark`, `fie_dropping_weapon`, `fie_hit_off_target`, `fie_violent_act`, `fie_disorder`, `fie_unfair_fight`, `fie_advertising`, `fie_unsporting`, `fie_electronic_device`, `fie_fraud`, `fie_tampered_equipment`, `fie_refusal_to_fence`, `fie_sporting_spirit`, `fie_refusal_to_salute`, `fie_collusion`, `fie_violence` |  | Motif (écran, tablette, MCP) |
| `type` | `WHITE`, `YELLOW`, `RED`, `BLACK` |  | Type imposé (appareil de piste) |

### `give_passivity_card` — Donner un carton P (non-combativité)

*écriture.* Relais FIE (épée, fleuret, sabre) : carton P (non-combativité, t.124) donné aux deux équipes, escalade sur la rencontre : jaune P, rouge P, noir P. Le rouge P n’écrit pas de touche (elle est dans le score du relais). Noir P : la rencontre est décidée pour l’équipe au score supérieur des relais terminés (enregistrer d’abord le relais en cours), à égalité au meilleur classement (tableau : rang du tableau ; poule : classement de poule) — TeamMatchDecided. Aucun carton P à une touche de la cible finale des deux côtés (44:44, t.124.3) : score cumulé des relais enregistrés, ou liveScore (relais en cours compris). Refus : unsupported_format (Sabre Laser, arme à la carte, épreuve individuelle), match_not_found, team_withdrawn, match_finished (noir P déjà donné, rencontre décidée ou suivante commencée, noir P contraire au résultat), passivity_at_last_touch, draw_needs_winner. Journal : PassivityCardGiven.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |
| `liveScore` | object |  | Score cumulé affiché (relais en cours compris), lu par la tablette ou l’appareil ; sans lui, cumul des relais enregistrés |

### `cancel_team_card` — Annuler un carton E

*⚠️ écriture, destructif.* Directoire technique (écran, MCP) : annule un carton E, ou un carton P jaune ou rouge (le noir P a décidé la rencontre). Refus : permission_denied (tablette, appareil), match_not_found, card_not_found, match_finished (noir P). Journal : TeamCardCancelled.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |
| `cardId` | string | oui | Carton E ou carton P (teamCards[].id, passivityCards[].id) |

### `cancel_relay_card` — Annuler un carton de relais

*⚠️ écriture, destructif.* Directoire technique (écran, MCP) : annule un carton individuel d’un relais. Le noir ne s’annule pas ainsi (reinstateFencer). Refus : permission_denied (tablette, appareil), match_not_found, card_not_found, already_withdrawn (noir). Journal : RelayCardCancelled.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |
| `cardId` | string | oui | Carton (bouts[].cards[].id) |

### `withdraw_team` — Retirer une équipe

*⚠️ écriture, destructif.* Relais par équipes : équipe incomplète qui abandonne (o.99.7.a). Rencontre perdue, l’équipe se retire et garde sa place (« N’a pas terminé ») ; ses rencontres de poule ne comptent plus (o.99.8). Refus : unsupported_format (arène), match_not_found, team_not_in_match, match_finished, team_withdrawn. Journal : TeamMatchDecided, TeamWithdrawn.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `competitionId` | string | oui | Identifiant de la compétition (list_competitions) |
| `matchId` | string | oui | Identifiant de la rencontre (getCompetitionState, bloc « teams ») |
| `dryRun` | boolean |  | Décrit le résultat sans rien écrire |
| `expectedRevision` | integer |  | Révision attendue du journal (revision_conflict sinon) |
| `commandId` | string |  | Identifiant de la commande, choisi par l’appelant (UUID) : une commande rejouée avec le même identifiant n’écrit rien et est refusée par « command_already_applied » (renvoi après une coupure réseau) |
| `teamId` | string | oui | Équipe qui abandonne |
| `reason` | string | oui |  |

<!-- outils-mcp:fin -->
