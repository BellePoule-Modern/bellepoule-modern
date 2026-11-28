# Décisions d'architecture (ADR)

Une ADR consigne **une** décision d'architecture : son contexte, ce qui est décidé, ce que cela coûte.
Elle est courte, datée, numérotée. Une phrase précisée, restreinte ou corrigée s'amende **sur
place**, après accord du mainteneur : statut daté avec l'objet, phrase réécrite avec la mention
« remplace « … » » ([ADR-0001](0001-processus-adr.md)). Une décision principale renversée fait
l'objet d'une nouvelle ADR, qui **remplace** l'ancienne (statut « Remplacée par ADR-00xx »).

Origine : #1979 (lot 1), épique #1978. Format et processus : [ADR-0001](0001-processus-adr.md).

## Index

| N°                                                  | Décision                                                                                                                                                                                  | Statut              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| [0001](0001-processus-adr.md)                       | Processus : ADR, revue du mainteneur, pas d'auto-merge pour l'architecture, amendement sur place                                                                                          | Acceptée (amendée)  |
| [0002](0002-couches-et-dependances.md)              | Couches, sens des dépendances, domaine pur dans `src/shared/domain`                                                                                                                       | Acceptée            |
| [0003](0003-main-domain-couche-application.md)      | `src/main/domain` devient la couche d'application (`src/main/engine/commands`)                                                                                                            | Acceptée            |
| [0004](0004-features-couche-interface.md)           | `src/features` est une couche d'interface                                                                                                                                                 | Acceptée            |
| [0005](0005-journal-un-fait-un-chemin.md)           | Journal : un fait, un chemin                                                                                                                                                              | Acceptée            |
| [0006](0006-expected-revision.md)                   | `expectedRevision` : contrôle dans la transaction, portée documentée                                                                                                                      | Acceptée            |
| [0007](0007-format-evenement.md)                    | Format d'événement du journal et migration 46                                                                                                                                             | Acceptée            |
| [0008](0008-nommage-contrat.md)                     | Nommage et forme des opérations du contrat                                                                                                                                                | Acceptée            |
| [0009](0009-codes-erreur.md)                        | Catalogue des codes d'erreur (`ApiError`, `DomainError`)                                                                                                                                  | Acceptée            |
| [0010](0010-bus-evenements.md)                      | Un seul bus : journal d'un côté, signaux de changement de l'autre                                                                                                                         | Acceptée            |
| [0011](0011-migrations-schema-3-0.md)               | Aucune migration de schéma sans ADR jusqu'à la 3.0                                                                                                                                        | Acceptée            |
| [0012](0012-formule-domaine.md)                     | Formule : modèle dans `shared/domain/formula`, validée par le moteur à chaque écriture                                                                                                    | Acceptée            |
| [0013](0013-troisieme-place-epreuves-2-0.md)        | 3ᵉ place des épreuves 2.0 migrées : nouveau comportement accepté                                                                                                                          | Acceptée            |
| [0014](0014-affectation-arbitres-moteur-unique.md)  | Un seul moteur d'affectation des arbitres, appelé par une commande                                                                                                                        | Acceptée (principe) |
| [0015](0015-plan-des-pistes-moteur.md)              | Le plan des pistes est une donnée du moteur (migration 50, journalisé)                                                                                                                    | Acceptée            |
| [0016](0016-retrait-reintegration-tireur.md)        | Retrait et réintégration d'un tireur : `withdrawFencer`, `reinstateFencer`                                                                                                                | Acceptée            |
| [0017](0017-projections-etat-epreuve.md)            | L'état de l'épreuve devient une projection du moteur (`session_state` en cache, `getCompetitionState`, journal source de vérité par paliers)                                              | Acceptée (amendée)  |
| [0019](0019-plan-arene-salle.md)                    | Disposition d'arène rattachée à la salle, salle liée à la compétition                                                                                                                     | Remplacée par 0025  |
| [0018](0018-commandes-inscription.md)               | Commandes d'inscription : tireurs, arbitres, épreuves, saison (pas de patch libre, pas de journal)                                                                                        | Acceptée            |
| [0020](0020-transport-websocket-contrat.md)         | Le contrat passe aussi par Socket.IO (`/api`, `WsClient`), en lecture seule jusqu'à #1982                                                                                                 | Acceptée            |
| [0021](0021-services-plateforme.md)                 | Fonctions propres à Electron (fichiers, impression, liens) derrière `PlatformServices`, en contenu et non en chemin                                                                       | Acceptée            |
| [0022](0022-fonctions-du-poste-contrat.md)          | Fonctions du poste (serveur distant, Mode Club, appareils, réglages, publication GREG / FTP) dans le contrat, sans journal et jamais sur le réseau                                        | Acceptée            |
| [0023](0023-appareils-de-piste-salle.md)            | Appareils de piste déclarés sur les pistes de la salle ; l'épreuve ne fait que passer une piste en manuel                                                                                 | Acceptée            |
| [0024](0024-tableaux-separes-equipes-moteur.md)     | Tableaux séparés (un tableau par groupe) et épreuves par équipes (relais) passent par le moteur ; fin de `persistLocally`                                                                 | Acceptée (amendée)  |
| [0025](0025-plan-de-salle-epreuve.md)               | Le plan de salle du planificateur est enregistré sur l'épreuve (`competitions.arena_plan`, migration 48)                                                                                  | Acceptée            |
| [0026](0026-recherche-de-lieu.md)                   | La recherche de lieu passe par le poste (`listPlaceSuggestions`), sur Photon puis la Géoplateforme IGN, gratuits sans clé                                                                 | Acceptée            |
| [0027](0027-choregraphies-document-bibliotheque.md) | Une chorégraphie est un document versionné de la bibliothèque du poste (table `choreographies`, migration 51), compatible `.chore`                                                        | Proposée            |
| [0028](0028-cartons-equipe-moteur.md)               | Les cartons des épreuves par équipes (carton E, cartons des relais) passent par le moteur : `giveTeamCard`, `giveRelayCard`, journalisés                                                  | Acceptée            |
| [0029](0029-multi-poste-roles-bail.md)              | Multi-poste : comptes par fonction, droits `checkin:write` et `structure:write`, bail par épreuve en mémoire du moteur                                                                    | Proposée            |
| [0030](0030-services-de-bureau.md)                  | Fonctions de l'application de bureau (menu, mise à jour, fenêtre, langue, impression native, choix de dossier) derrière `PlatformServices.desktop`, absent dans le navigateur             | Acceptée            |
| [0031](0031-zones-de-touche-combats-club.md)        | Les zones de touche des combats du Mode Club sont enregistrées sur le combat (`club_bouts.zones_a` / `zones_b`, migration 51)                                                             | Acceptée            |
| [0032](0032-formule-interface-unique-apercu.md)     | Formule : interface unique derrière un réglage expérimental du poste (`formulaPreview`), lu par l'écran seulement                                                                         | Acceptée            |
| [0033](0033-modeles-de-formule.md)                  | Modèles de formule (catalogue fourni, modèles du poste) et formule d'une épreuve par le contrat : `getCompetitionFormula`, `applyFormulaTemplate`, `updateCompetitionFormula`, outils MCP | Acceptée            |
| [0034](0034-surnom-membres-club.md)                 | Les membres du Mode Club ont un surnom (`club_members.nickname`, migration 52)                                                                                                            | Acceptée            |
| [0035](0035-durees-de-match-mcp.md)                 | Durées de match de référence lisibles par l'agent MCP (`get_match_durations`) ; fin estimée de la phase dans `server_status`                                                              | Proposée            |
| [0036](0036-formule-v2-arbre-par-phase.md)          | Formule v2 : arbre de phases pour toutes les armes (`settings.formula`), lu par phase par le moteur, sans migration de schéma                                                             | Acceptée (amendée)  |
| [0037](0037-deroule-genere-par-la-formule.md)       | Déroulé généré par la formule v2 : navigation, 0 tour, tableau arrêté à N (`closeTableauStage`, `TableauStageClosed`), phase après un tableau                                             | Acceptée (amendée)  |
| [0038](0038-cyrano-sans-hello-saint-george.md)      | Appareil Cyrano sans `HELLO` (`hello: false`, profil Saint-George) ; envoi des HELLO choisi au démarrage du pilote (`device`, `always`, `never`)                                          | Acceptée            |
| [0039](0039-scission-competitions-filles.md)        | Scission dans la formule : chaque branche devient une compétition fille classée à part (`splitCompetition`) ; catégorie du tireur (`fencers.category`, migration 53)                      | Acceptée (amendée)  |
| [0040](0040-ex-aequo-a-la-barre.md)                 | Ex aequo à la barre de qualification : réglage `ties` (`all`, `initial_ranking`, `draw`, `barrage`), une seule coupe dans le domaine, proposition à l'exécution                           | Acceptée (amendée)  |
| [0041](0041-controles-structure-mode-expert.md)     | Contrôles de structure S1 à S6 dans le domaine, affichés en direct sur la phase ; mode expert de l'éditeur, préférence du poste                                                           | Acceptée (amendée)  |
| [0042](0042-moteur-formules-multi-tours.md)         | Le moteur tire les tours suivants et le tableau après plusieurs tours ; formules à plusieurs tours ouvertes au MCP                                                                        | Acceptée (amendée)  |
| [0043](0043-rapieres-briques-generiques.md)         | Tournoi des rapières en briques génériques (vagues, têtes de poule, binômes, classements filtrés), fin du mode spécial ; migration 54                                                     | Acceptée (amendée)  |
| [0044](0044-equipes-formule-v2.md)                  | Les épreuves par équipes (relais FIE) suivent la formule v2 : règle de rencontre par phase, poules d'équipes, rang d'entrée (migration 55)                                                | Acceptée (amendée)  |
| [0045](0045-tirage-du-tableau.md)                   | Le tableau se tire selon un mode réglé dans la formule (strict, par paires, par groupes, intégral), graine enregistrée et rejouable, PV de tirage                                         | Proposée            |

**Acceptée** : tranchée par le mainteneur le 2026-11-20 (revue de #2020, #2022 et #2023, commentaire sur #1979 ; arbitrages de la PR #2029).
**Proposée** : acceptée au merge de la PR qui l'introduit, ou amendée en revue.

## Modèle

```markdown
# ADR-00xx — Titre à l'indicatif (« X devient Y », « On fait Z »)

- **Statut** : Proposée | Acceptée | Acceptée ; amendée le AAAA-MM-JJ (objet, validé par le mainteneur) | Remplacée par ADR-00yy
- **Date** : AAAA-MM-JJ
- **Tickets** : #…

## Contexte

Le problème, les faits (fichiers, chiffres), la contrainte. Pas la solution.

## Décision

Ce qui est décidé, en phrases qui commencent par « On ». Vérifiable dans le code.

## Conséquences

Ce que ça coûte, ce que ça interdit, ce qui reste à faire (lot, ticket).

## Alternatives écartées

Option — raison du refus.
```
