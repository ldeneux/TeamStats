# Checklist TeamStats (à jour au 17/11/2026)

| # | Sujet | État |
|---|-------|------|
| 2 | Phases manquantes (ex. U13 F : 1 phase alors que le site en montre 2) | **Corrigé côté script** : `MiseAJourFFBB_Club.exe` cherche maintenant les autres phases de la compétition (à tester ; si une phase manque encore, envoyer le dossier `diagnostic` du programme) |
| 2 bis | Erreur « HTTP 404 » sur une compétition régionale (RM2) | **Corrigé** : chemin du lien lu tel quel (comité ou ligue), repli sur plusieurs adresses |
| 3 | Affichage de la compétition : « Phase 2 : Départementale féminine U15 - poule B » (étiquette jaune conservée) | **Fait** (le suffixe « - Phase N » est retiré ; la division est ajoutée depuis le code quand il se termine par -N) |
| 5 | Chrono : en changeant de période avec +, repartir au temps max si la période est vierge, sinon temps restant d'après les stats | **Fait** |
| 1 | Mode d'emploi : aucune donnée réelle de licenciée | **Fait** (prénoms seuls, licences et dates fictives) |
| 4 | Historiser les saisons + consultation ; données verrouillées (seul le superadmin modifie, directement en base) | **Fait** (`sql/admin_05_season_lock.sql`, testé sur PostgreSQL) |
| 6 | Connexion : changer son mot de passe ; admin / superadmin peut se connecter « en tant que coach » (test de profil, sans mot de passe) | **Fait** (bouton 👤 ; à tester sur le site réel) |
| 7 | Accès de secours « quoi qu'il arrive » (superadmin supprimé de la base) | **Fait** (`sql/admin_06_last_superadmin.sql` testé sur PostgreSQL + route `/api/emergency` ; à configurer sur Vercel) |
| 8 | `MiseAJourFFBB_Club.exe` : rejets du 16/11 (3 équipes en erreur) + dépôts inutiles | **Corrigé dans `push_ffbb_club.py`** (testé sur un site simulé ; à relancer pour vérifier, 404 « CRMLSM » à confirmer) |
| 9 (a) | Nouveau profil **consultant** : lit les infos des équipes qui lui sont affectées, ne modifie rien | **Fait** (`sql/admin_09_role_consultant.sql` testé sur PostgreSQL) |
| 10 (b1) | Direct : afficher la date et l'heure du match, en petit, au-dessus du score | **Fait** |
| 11 (b2) | Périodes / durée par défaut selon la catégorie de l'équipe choisie | **Fait** |
| 12 (b3) | Effectifs : retrouver Clara (perdue au chargement) ; case « Coach » pour l'encadrement | **Case Coach faite** (`sql/admin_08_roster_coach.sql`) ; **Clara : non reproduite** (mon analyse du PDF la lit bien) → ajout d'un contrôle après import qui nomme toute personne non enregistrée ; à re-tester avec le PDF |
| 13 (b4) | Badge « surclassée » calculé (âge / niveau de l'équipe, si une équipe plus jeune existe) | **Fait** |
| 14 (c) | Feuille de match : joueuses d'une autre équipe (renfort), fond vert + provenance, vert aussi dans le Direct si possible | **Fait** + fusion des fiches (`sql/admin_10_merge_roster.sql` testé sur PostgreSQL) |
| 15 (d) | Accès : un admin ne doit pas voir les comptes superadmin | **Fait** (`sql/admin_07_hide_superadmin.sql` testé sur PostgreSQL + filtrage serveur) |
| 16 (e) | Libellés de phase : ne pas afficher « Phase 1 » quand seule la phase 2 existe | **Fait** (relancer « Charger les équipes depuis le cache » pour mettre à jour les phases déjà chargées) |
| 17 (f) | `MiseAJourFFBB_Club.exe` aussi dans le dossier `public/` de TeamStats | À faire (attend l'exe construit par GitHub : à me fournir ou à copier dans `public/`) |
| 18 (g) | Mise à jour du mode d'emploi (**en tout dernier**, après les points ci-dessus) | **Fait** (18 pages ; étape 13, renforts à l'étape 3, annexe A refondue). Reste à jour si f) ou de nouveaux changements |

| 19 | Commande vocale (Direct) : actions sans validation, démarrer le match, lancers francs visibles à l'écran, sélection de joueuse, aide à jour, étape 14 + annexe B du guide ; ajout d'une joueuse enregistré aussitôt dans l'effectif | **Fait** (`npm run test:voice` ; micro, synthèse vocale et relance de l'écoute à tester sur la tablette) |

## Notes pour 6 et 7
- 6 : réalisé comme une **vraie connexion** au compte coach (jeton à usage unique généré par le serveur) : on voit exactement ce que voit ce coach, droits réels (RLS) compris ; un bandeau permet de revenir à son compte.
- 7 : on évite un jeton secret codé en dur dans l'appli (n'importe qui le retrouverait). Piste : récupération par la clé `service_role` côté serveur (variable Vercel) protégée par un secret d'urgence, ou simple procédure SQL documentée pour se redonner le profil superadmin.

## Point 8 : analyse du journal du 16/11 (69 poules déposées, 3 équipes en erreur)
Ce qui marche : RM2, PRM et DM3 (plus de 404) ; la découverte des autres phases (U13 F, U15, U18, U9... ont maintenant leurs deux phases).

À corriger :
1. **Deux erreurs HTTP 403** (équipe 200000005351327 et « DMU11 ») : blocage anti-robot temporaire du site. Très probablement provoqué par le volume de pages lues
   (la découverte des phases lit chaque poule de chaque phase). Un nouveau lancement passe souvent ; à corriger en lisant UNE page par phase au lieu d'une par poule,
   en réessayant avec pause après un 403/429 et en augmentant légèrement la pause entre pages.
2. **Dépôts inutiles** : les décomptes sont identiques pour toutes les poules d'une même phase (ex. 5 poules « 150 matchs »), donc la page contient toute la phase et le
   club est « trouvé » dans toutes les poules : on dépose des poules où le club ne joue pas (sans conséquence dans TeamStats, qui les ignore, mais ça alourdit le cache et le
   chargement). À corriger : ne garder que la poule dont la liste de rencontres contient une équipe « OLYMPIC SATHONAY ».
3. **« CRMLSM » (HTTP 404)** : probablement une coupe régionale dont l'adresse n'est ni sous le comité ni sous `/ligues/ara/`. À corriger en journalisant les adresses essayées
   et en enregistrant une copie de la page de l'équipe pour chaque erreur (aujourd'hui une seule copie par lancement) ; à envoyer pour adapter.

## Détail des points 9 à 18 (ajoutés le 16/11)
**9 (a) Profil consultant** : lecture seule des équipes affectées (calendrier, classement, effectif, stats/PDF...). Il faudra : le rôle `consultant` en base, des règles qui
l'autorisent en lecture sans écriture (aujourd'hui un coach écrit sur ses équipes), et masquer dans l'appli tout ce qui enregistre. *À trancher : voit-il l'écran Direct / la
saisie ? (je propose non : seulement Calendrier, Statistiques, Historique et exports).*

**10 (b1)** Date et heure du match (celles lues dans le calendrier / saisies en configuration) en petit au-dessus du score du Direct.

**11 (b2) Valeurs par défaut** (vues sur ta capture : U15 F resté sur 8 périodes de 4 min) : U9 = 6 × 4 min ; U11 = 8 × 4 min ; U13 = 4 × 8 min ; U15 et plus = 4 × 10 min ;
prolongations toujours de 5 min ; pas de prolongation pour U11 et moins (le nul reste possible). Appliqué dès qu'on choisit l'équipe (ou un match du calendrier), puis modifiable.

**12 (b3) Effectifs** : (1) *Clara est absente de la liste après le chargement du PDF* (elle devrait apparaître entre LOCTIN et MARTEL) : à reproduire avec le PDF, car mes essais la lisaient bien ;
(2) case **Coach** pour l'encadrement : le premier de l'équipe est coché par défaut, on peut en cocher plusieurs ou changer.

**13 (b4) Badge « surclassée »** : une joueuse est surclassée si sa catégorie d'âge est plus jeune que l'équipe où elle joue **et** qu'une équipe plus jeune du club existe pour ce sexe et cette saison
(pas de badge en U11 F si U9 F n'existe pas). Remplace l'affichage actuel du code « D11 » de la fiche FFBB (qui serait conservé en information).

**14 (c) Renforts** : ajouter à la feuille de match des joueuses d'une autre équipe du club ; fond **vert** (au lieu du jaune) avec leur provenance entre parenthèses (ex. U13F-2) ;
vert aussi dans le Direct si ce n'est pas trop lourd. *Prérequis à cadrer : aujourd'hui l'effectif du club (import PDF) et la liste des joueuses du match (numéros de maillot) sont deux listes séparées.*

**15 (d)** Un compte admin ne doit pas voir les comptes superadmin dans Accès (filtrage côté serveur, pas seulement masquage à l'écran).

**16 (e)** Numéroter les phases d'après le libellé FFBB (« Saison régulière » = 1, « Phase 2 » = 2) et non d'après l'ordre chronologique des phases trouvées.

**17 (f)** Déposer `MiseAJourFFBB_Club.exe` dans `public/` (le lien de l'administration pointera alors vers TeamStats, `NEXT_PUBLIC_FFBB_EXE_URL` devient inutile). L'exe est celui
construit par GitHub Actions : à me fournir ou à copier à la main dans `public/`.

**18 (g)** Mode d'emploi : nouveau profil, valeurs par défaut des périodes, coach / surclassement dans les effectifs, renforts dans la feuille de match, historique des saisons, changement de mot de passe,
« voir comme un coach », plus tout changement décidé d'ici là.

### Point 8 : ce qui a été fait (17/11)
1. 403 : réessais automatiques avec pauses (20 s puis 60 s), pause entre pages portée à 0,6 s, **une seule page lue par phase** (au lieu d'une par poule), et seconde tentative automatique
   des équipes encore bloquées après 60 s.
2. Dépôts inutiles : une poule n'est déposée que si une de SES rencontres contient une équipe « OLYMPIC SATHONAY » (lecture structurée au lieu d'une recherche dans toute la page) ;
   les poules déjà visibles dans la page de la phase et sans le club ne coûtent plus aucune requête. Le nombre de matchs affiché est maintenant celui de la poule.
3. 404 : le message donne les adresses essayées ; une copie de la page de chaque équipe en erreur (8 au plus) est enregistrée dans le dossier `diagnostic`.
   **« CRMLSM » reste à confirmer** : si l'erreur persiste, envoyer le message complet et le dossier `diagnostic`.

### Correctif du 18/11 : coupes
Tours de coupe regroupés en une entrée, journée = tour (voir README). À vérifier sur ton cache réel (équipe Seniors M équipe 2).
