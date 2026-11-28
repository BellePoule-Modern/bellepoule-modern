# ADR-0041 — Contrôles de structure de la formule (S1 à S6) en direct, mode expert de l'éditeur

- **Statut** : Acceptée (validée par le mainteneur le 2026-11-26) ; amendée le 2026-11-27 (S6 : qualification menant à une phase commencée verrouillée, validé par le mainteneur) ; amendée le 2026-11-27 (S6 : qualification sortant d'un tour de poules clos verrouillée, validé par le mainteneur) ; amendée le 2026-11-27 (S6 : mode d'un tableau tiré verrouillé, verrou aussi par les réglages plats, validé par le mainteneur) ; amendée le 2026-11-28 (S6 : avancement d'une épreuve par équipes lu dans les rencontres d'équipe, validé par le mainteneur) ; amendée le 2026-11-28 (S6 : mode de tirage d'un tableau tiré verrouillé, ADR-0045 ; validé par le mainteneur)
- **Date** : 2026-11-26
- **Tickets** : #2013 (étape F, lot F2 ; questions Q17, S1 à S6), #1948 ; précise [ADR-0036](0036-formule-v2-arbre-par-phase.md) (grammaire de la frise), [ADR-0032](0032-formule-interface-unique-apercu.md) (éditeur unique, aperçu), [ADR-0012](0012-formule-domaine.md) (validation)

## Contexte

- Le domaine juge la formule (`formulaV2Issues`) ; le moteur refuse une formule fautive à
  l'écriture (`writeFormula`, `invalid_settings`). L'écran ne montre ce refus qu'à
  l'enregistrement, par une notification ; seule la scission affiche ses erreurs en direct.
- État des contrôles de #2013 : S2 fait ; S1 et S5 partiels (dernière phase non retirable,
  une phase par branche) ; S3, S4 et S6 absents. Avertissements : exempts > 50 % fait ; poules
  de moins de 4 (seuil actuel : 3), moins de 4 qualifiés absent, plus de 3 tours affiché
  seulement dans l'ancien onglet.
- L'éditeur n'a pas de niveaux : scission, Tour Quest et tableau arrêté sont proposés à tous.
  Le réglage d'épreuve `expertMode` ne règle que pistes et arbitres.
- Arbitrage du 2026-11-26 : contrôles en direct sur la phase fautive ; mode expert selon le
  tableau de #2013, préférence du poste (Q17).

## Décision

**Contrôles de structure, dans le domaine**

- `formulaV2Issues(formula, scope, progress?)` rend des remarques **situées** :
  `{ code, phase, message }` (`phase` : clé de la frise, `pool-0`, `tableau`, `split`…, ou
  `null` pour la formule entière), bloquantes. Le moteur les applique comme aujourd'hui
  (`invalid_settings`), l'écran les affiche sur la carte de la phase, le MCP les reçoit dans
  le message de refus.
  - **S1** : au moins une phase de combat (tour de poules, Tour Quest ou tableau) dans la
    formule et dans chaque branche.
  - **S2** : inchangé (tableau arrêté suivi, tableau complet jamais suivi, place de la
    scission).
  - **S3** : quand la règle de qualification fixe un nombre (`fixed_count`, `fixed_bracket`,
    `take` d'une branche), ce nombre suffit à la phase suivante : au moins `sizeMin` pour un
    tour de poules, au moins 2 pour un tableau, plus de `stopAt` pour un tableau arrêté. Un
    pourcentage dépend de l'effectif : avertissement de la simulation, pas de blocage.
  - **S4** : ce nombre est compatible avec la phase suivante : il se répartit en poules de
    `sizeMin` à `sizeMax` ; la somme des `take` d'une scission par rang reste sous l'effectif
    connu.
  - **S5** : chaque branche se termine par une phase qui classe (tour de poules ou tableau
    complet), jamais par un tableau arrêté.
  - **S6** : avec `progress` (tours joués, tableau tiré, étapes closes, scission faite, lu dans
    l'état de session par le moteur et par l'écran ; pour une épreuve par équipes, dans les
    rencontres d'équipe tirées, poules et tableau, par le même calcul côté moteur et côté écran,
    [ADR-0024](0024-tableaux-separes-equipes-moteur.md), [ADR-0044](0044-equipes-formule-v2.md) ;
    _amendé le 2026-11-28 : remplace « lu dans l'état de session par le moteur et par l'écran) »_),
    une phase commencée ne se retire pas, ne
    change pas de nature, et rien ne s'insère avant elle ; la règle de qualification qui sort
    d'un tour de poules clos (`closePoolRound`), ou qui mène à une phase commencée, ne change
    plus ; le mode d'un tableau tiré (petite finale, « toutes les places », mode de tirage, [ADR-0045](0045-tirage-du-tableau.md)) non plus. Ses autres
    réglages restent soumis aux règles actuelles (Q15), par la formule comme par les réglages
    plats (`updateCompetitionSettings`). _(Amendé le 2026-11-27 :
    remplace « Ses réglages restent soumis aux règles actuelles (Q15). » ; le classement final
    relit la formule, la coupe doit rester celle du tirage. Amendé à nouveau le 2026-11-27 :
    remplace « la règle de qualification qui mène à une phase commencée ne change plus » ; les
    éliminés d'un tour clos sont fixés dès la clôture. Un tableau arrêté clos n'est pas
    concerné. Amendé une troisième fois le 2026-11-27 : remplace « ne change plus. Ses autres réglages
    restent soumis aux règles actuelles (Q15). » ; le mode d'un tableau tiré suit l'ADR-0043 (F4b :
    modifiable tant que le tableau n'est pas tiré, pour toutes les épreuves), et les réglages
    plats ne contournent pas le verrou. Amendé le 2026-11-28 : remplace « (petite finale, « toutes les
    places ») » ; le mode de tirage de l'ADR-0045 est un mode du tableau.)_
- **Avertissements**, non bloquants, rendus par la simulation (`simulateFormula`) et affichés
  dans l'aperçu : plus de la moitié d'exempts au premier tour du tableau, poules de moins de 4,
  moins de 4 qualifiés, plus de 3 tours de poules.

**Écran**

- L'éditeur juge la formule à chaque changement par les mêmes fonctions ; une remarque
  bloquante s'affiche sur la carte de sa phase (ou en tête pour la formule entière) et grise
  « Enregistrer ». Le refus du moteur reste le dernier rempart.

**Mode expert de l'éditeur (Q17)**

- Préférence du poste `formulaExpert` (réglages du poste, `updateStationSettings`), éteinte
  par défaut. Elle ne change que ce que l'éditeur propose ; une formule reste valide quel que
  soit le mode.
- Niveau simple : tours de poules, tableau complet, réglages courants (taille des poules,
  scores, durées, qualification, petite finale).
- Mode expert, en plus : scission, Tour Quest, tableau arrêté, réglages avancés (ex aequo à la
  barre, répartition par cumul des tours, ordre des matchs, barème à zones).
- Une formule ouverte qui contient une brique ou un réglage expert rallume le mode expert pour
  cette édition, sans changer la préférence.
- Le réglage d'épreuve `expertMode` (pistes, arbitres) reste distinct.

## Conséquences

- Lot F2 : domaine (S1, S3 à S6, remarques situées), simulation (avertissements), éditeur
  (affichage en direct, mode expert), réglage du poste, MCP (messages). Pas de migration, pas
  d'événement.
- Le message de refus du moteur change de forme (une ligne par remarque, clé de phase) : la
  référence MCP est régénérée (`npm run docs:mcp`).
- Chaque PR en draft, sans auto-merge (ticket `refactor`).

## Alternatives écartées

- **Contrôles à l'enregistrement seulement** : l'organisateur découvre l'erreur après coup,
  sans savoir quelle phase corriger.
- **Fusion avec `expertMode` de l'épreuve** : mêle pistes, arbitres et formule ; contraire à
  Q17 (préférence du poste).
- **Pas de niveaux** : l'éditeur montre d'emblée scission, Tour Quest et tableau arrêté, rares
  et sources d'erreurs pour un club.
