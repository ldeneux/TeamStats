# Sathonay Basket

Application de suivi de match en direct (Next.js 14 + Supabase + Tailwind).

## Démarrage local
```
npm install
npm run dev
```

## Variables d'environnement
Renseigner dans `.env.local` (en local) ou dans les Environment Variables du projet Vercel :
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY : **serveur uniquement** (ne jamais préfixer par NEXT_PUBLIC_). Sert à lister / créer les comptes dans
  Administration > Accès (Supabase > Project Settings > API > `service_role`).
- NEXT_PUBLIC_FFBB_EXE_URL (facultatif) : adresse de téléchargement de MiseAJourFFBB_Club.exe affichée dans l'administration.

## Scripts SQL (à exécuter dans l'éditeur SQL de Supabase)
Ordre conseillé pour une base à jour :
1. `sql/stats_player_period_stats.sql` : statistiques par joueuse et par période.
2. `sql/security_01_profiles_and_rls.sql` : profils (admin / coach), accès par équipe, règles RLS. **À lire avant d'exécuter.**
3. `sql/ffbb_lookup.sql` : recherche d'un match par ID FFBB (comptes connectés uniquement).
4. `sql/ffbb_upcoming.sql` : matchs à venir de NOS équipes (filtrés selon les équipes autorisées).
5. `sql/stats_extra_columns.sql` : colonnes des nouvelles statistiques (interceptions, balles perdues, contres, contres subis).
6. `sql/admin_01_club_calendar.sql` : profil **superadmin**, équipes du club par saison, phases, calendriers, classements (menus
   Calendrier et Administration). Dernière étape du script : désigner le superadmin.
7. `sql/admin_02_admin_manage_admins.sql` : uniquement si `admin_01` a déjà été exécuté avant cette mise à jour (un admin peut gérer les autres admin).
8. `sql/security_02_lock_main_app_OPTIONAL.sql` : ferme l'appli principale aux comptes sans profil admin (voir ci-dessous).

## Connexion et profils
- L'appli demande une connexion (Supabase Auth, e-mail + mot de passe) avant tout affichage. Les comptes se créent dans
  Supabase > Authentication > Users > Add user. Pensez à **désactiver l'inscription libre** (Authentication > Sign In / Providers).
- `multisports.app_profiles` donne un profil à un compte : `admin` (toutes les équipes) ou `coach`.
- `multisports.team_access` liste les équipes ouvertes à un compte. Un coach ne voit que ces équipes, peut tout faire dessus
  (joueuses, matchs, statistiques) sauf créer ou supprimer une équipe. Un compte sans profil n'a accès à rien.
- Les règles sont appliquées par la base (RLS) : une simple page de login ne protégerait pas des appels directs à l'API.
- Le compte Supabase est partagé avec l'appli principale : voir `security_02_lock_main_app_OPTIONAL.sql`.

## Mode hors ligne (salles sans réseau)
- Préparer avec du réseau : équipes, joueuses, matchs à venir et clubs sont synchronisés à chaque ouverture et avec le bouton
  « Synchroniser » (copie locale par compte). Le match en préparation et en cours est gardé en continu sur l'appareil (brouillon
  local, repris automatiquement après une fermeture). Bouton « Nouveau » (Configuration > Match) pour repartir de zéro.
- Enregistrer sans réseau : la disquette met le match de côté sur l'appareil (file d'envoi). L'envoi est automatique au retour du
  réseau (événement « online », puis toutes les 30 s), ou à la demande en touchant la pastille d'état. Chaque envoi réécrit
  tout le match : il est sans risque de le rejouer.
- Ouverture sans réseau : `public/sw.js` (service worker) garde l'application ; `public/manifest.webmanifest` permet de l'installer
  sur l'écran d'accueil. Ouvrir l'appli une fois avec du réseau après chaque mise à jour. Le service worker n'est actif qu'en production.
- Le profil (admin / coach) est mémorisé sur l'appareil pour pouvoir entrer sans réseau ; il est relu à chaque ouverture avec du réseau.
- Nécessite du réseau : créer ou modifier une équipe, chercher un match par ID FFBB, rouvrir un match déjà enregistré.

## Prolongations (U13 et +)
En plus de Q1…Q4, un match d'une équipe U13 ou plus (ou sans « U » dans le nom : senior) peut passer à une
prolongation OT1 de 5 minutes, puis OT2, etc., uniquement en cas d'égalité à la fin de la période (bouton « + »
de la période). Une prolongation est stockée comme une période de numéro supérieur au nombre de périodes
(Q4 → OT1 = période 5), donc sans changement de schéma ; `current_period` vaut `OT1`, `OT2`…


## Menus Calendrier et Administration
- **Rôles** : `superadmin` (accès illimité, gère tous les comptes), `admin` (toutes les équipes, gère les comptes `coach` et `admin`, jamais un superadmin),
  `coach` (uniquement les équipes affectées). Le premier superadmin se désigne en SQL (dernière étape de `admin_01_club_calendar.sql`).
- **📅 Calendrier** (tous les comptes) : choix de l'équipe par image, saison (en cours par défaut), phase (en cours par défaut), puis
  « Calendrier & résultats » et « Classement ». Un coach ne voit que les équipes qui lui sont affectées.
- **🛠️ Administration** (admin et superadmin), bandeau d'icônes :
  - 🏀 *Équipes & calendriers* : le bouton « Charger les équipes depuis le cache » lit `multisports.ffbb_poule_cache` (rempli par
    `MiseAJourFFBB_Club.exe` lancé depuis un PC, le site FFBB bloquant les serveurs), garde les poules de la saison en cours, repère
    les équipes d'« OLYMPIC SATHONAY » (une vignette par équipe : U15F, U13M, U15F · équipe 2...), crée pour chacune une équipe TeamStats
    « SATHONAY U15F - 2026/2027 » (ou réutilise celle qui existe déjà avec ce nom) et enregistre phases, matchs et classements.
    Cliquer une équipe affiche ses phases (compétition, poule, n° de phase et de poule FFBB), cliquer une phase affiche son calendrier.
    Le chargement est rejouable à volonté : les matchs sont mis à jour sans suppression des équipes ni des données TeamStats.
  - 🔑 *Accès* : liste des comptes Supabase, création (e-mail + mot de passe), changement de rôle / nom / mot de passe, désactivation,
    suppression, et affectation des équipes **par saison** d'un clic sur les vignettes (ex. U13F en 2025-2026, U15F en 2026-2027).
    Affecter une équipe = ouvrir l'équipe TeamStats liée (`team_access`) : le coach la retrouve aussi dans le direct et les stats.
- Réglages du club (nom FFBB, nom court, comité) : `lib/clubTeams.ts`.

## Onglet Match et calendrier
- La liste « À VENIR » (loupe 🔍) et la recherche par **ID FFBB** lisent désormais le calendrier chargé dans TeamStats
  (tables `stats_club_*`), et non plus les tables de Multisports : toutes les équipes du club ont leurs rencontres, pas seulement
  celles des enfants suivis dans Multisports. `sql/ffbb_upcoming.sql` et `sql/ffbb_lookup.sql` ne sont plus utilisés.
- Quand une équipe est choisie dans la configuration du match, la loupe n'affiche d'abord que les matchs de cette équipe ; la recherche
  par ID choisit l'équipe, domicile/extérieur, adversaire et date.
- Un compte ne voit que les rencontres des équipes qui lui sont affectées (admin et superadmin : toutes).
- Images des équipes : si une vignette n'a pas d'image, Administration > Équipes > l'équipe > « Chercher dans les données FFBB »
  liste les images trouvées (avec miniature) ; un clic choisit la bonne.

## Protection des statistiques
Quand la date du match est antérieure à aujourd'hui, le bouton 💾 ouvre d'abord une fenêtre : le match est considéré comme joué et
l'enregistrement remplace ses statistiques. Le bouton **Valider** ne s'active qu'une fois le mot « confirmation » saisi. Un match daté
d'aujourd'hui ou du futur s'enregistre directement. Un match mis de côté hors ligne est confirmé au moment où l'on appuie sur 💾 ;
son envoi automatique au retour du réseau ne redemande rien.

## Effectifs (Administration > Équipes & calendriers > une équipe > 👥 Effectif)
- Exécuter `sql/admin_03_roster.sql` (après `admin_01`).
- **📄 Importer un PDF extranet FFBB** : le trombinoscope (ex. `ARA0069106_U11_FILLES_1.pdf`) est lu dans le navigateur, sans envoi du fichier
  au serveur. Seuls nom, prénom, n° de licence, date de naissance, sexe et infos de licence sont gardés ; **les photos ne sont jamais lues ni
  enregistrées**.
- **Affectation** : à l'équipe indiquée dans le PDF (« U11 FILLES », n° 1 → U11F ; n° 2 → U11F-2) pour la saison du PDF. Si l'équipe n'est pas
  renseignée (ou inconnue), d'après la date de naissance : âge sportif = année de fin de saison − année de naissance, rattaché à la plus petite
  catégorie Uxx ≥ à cet âge, à sexe égal (10 ou 11 ans → U11, 12-13 → U13...), Seniors à partir de 19 ans.
- **Aperçu avant import** : chaque ligne peut être décochée, changée d'équipe ou de rôle. Les adultes (≥ 19 ans) d'une équipe de jeunes sont
  proposés en « encadrement ». Réimporter est sans risque (clé : équipe + n° de licence) ; l'option « retirer les absents du PDF » est décochée par défaut.
- `public/pdf.worker.min.js` est la copie du worker de `pdfjs-dist@3.11.174` (version à garder identique si vous mettez la bibliothèque à jour).

## Sélecteur de matchs (loupe 🔍)
- **JOUÉ** liste les matchs enregistrés **et** les matchs déjà joués du calendrier, de **toutes les phases** de la saison, dont les stats ne sont pas encore
  saisies (mention « joué, stats non saisies », score FFBB) ; cliquer pré-remplit le match (la confirmation « confirmation » sera demandée à l'enregistrement).
- **À VENIR** : matchs à venir (et ceux des 7 derniers jours non encore mis à jour dans le cache FFBB).
- Effectif : le code « D11 » de la fiche FFBB est affiché en badge **Surclassement U11** (aucun réimport nécessaire : l'info était déjà enregistrée).

## Statistiques d'un match depuis le calendrier
Dans le menu 📅 Calendrier (et dans l'administration), un match dont les statistiques ont été saisies affiche l'icône **📊** sous son score ; un clic
télécharge le PDF des statistiques du match (même document que le bouton « Statistiques (PDF) » de l'onglet Stats). Les données sont relues en base
(matchs, événements, temps de jeu) : le match éventuellement en cours de saisie n'est pas modifié. Le lien se fait par le n° de rencontre FFBB.
Un compte ne voit l'icône que pour les matchs de ses équipes. Sans réseau, l'icône n'apparaît pas.


## Profil « coach » (ex-analyst) et écran Accès
- Le profil `analyst` s'appelle désormais `coach` : exécuter `sql/admin_04_role_coach.sql` (une fois, avant de déployer). L'appli lit encore « analyst » comme « coach » tant que la base n'est pas migrée.
- **Administration > Accès** : toucher une personne ouvre un formulaire unique (nom, profil, mot de passe facultatif) ; rien n'est enregistré avant le bouton
  **💾 Enregistrer**. Pour affecter des équipes : profil **coach** + Enregistrer, puis la liste « Équipes affectées » (saison + vignettes) apparaît.
- Les profils et affectations sont lus / écrits avec le jeton de l'utilisateur connecté (règles RLS) : aucun droit spécial n'est nécessaire sur le schéma
  `multisports` pour la clé service ; elle ne sert qu'aux comptes d'authentification (liste, création, mot de passe, suppression).
- Plus de longueur minimale imposée par l'appli pour les mots de passe (Supabase en impose 6 par défaut : Authentication > Policies).

## Mode d'emploi (PDF)
`public/mode-emploi-teamstats.pdf` est généré par `docs/build_mode_emploi.py` à partir de `docs/mode-emploi-base-v1.pdf` (pages d'origine conservées,
trois passages retouchés, nouvelles pages : programme, étape 12 Calendrier, annexe A administrateur) :
`cd docs && python3 build_mode_emploi.py mode-emploi-base-v1.pdf ../public/mode-emploi-teamstats.pdf` (polices Poppins et Carlito requises).

## Mise à jour de MiseAJourFFBB_Club.exe (correctifs du 16/11/2026)
Fichier fourni à part : `push_ffbb_club.py`, à remplacer dans le dépôt Multisports (`scripts/push_ffbb_club.py`). Le workflow GitHub « Construire les .exe FFBB »
(.github/workflows/build-exe.yml) se lance au push ; l'exe est à télécharger dans « Artifacts » puis à remplacer dans `public/MiseAJourFFBB_Club.exe`.
- Compétitions régionales (RM2...) : le chemin du lien est conservé (ligue ou comité) au lieu de forcer le comité, et plusieurs adresses sont essayées (fin des « HTTP 404 »).
- Phases manquantes : à partir d'une poule lue, le programme retrouve les autres phases de la même compétition et y dépose les poules où joue le club.
  Si la structure de la page ne le permet pas, une copie de la page est écrite dans le dossier « diagnostic » (à transmettre).

## Historique des saisons et verrouillage (`sql/admin_05_season_lock.sql`)
- Tout ce qui date d'**avant le 1er septembre de la saison en cours** est en **lecture seule pour tous les comptes de l'appli, y compris superadmin** : matchs, événements,
  statistiques, équipes TeamStats et joueuses d'une saison passée (saison lue dans le nom « … - 2025/2026 »), calendriers, classements et effectifs. Consultation, historique et export PDF restent possibles.
- Seule une modification **directe en base** (éditeur SQL Supabase) reste possible : c'est le moyen du superadmin pour corriger une saison clôturée.
- Réglage manuel (délai de grâce / clôture anticipée) : `INSERT INTO multisports.app_settings (key,value) VALUES ('lock_before','2026-08-01') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`
  (supprimer la ligne = règle automatique).
- Dans l'appli : 🔒 sur les matchs de saisons clôturées (sélecteur JOUÉ), bandeau « lecture seule », enregistrement et suppression refusés avec explication, saisons
  marquées « 🔒 historique » dans Calendrier et Administration, import d'effectif et changement d'image masqués.
- Technique : politiques **restrictives** en écriture, ajoutées aux règles existantes (non modifiées). Un UPDATE / DELETE visant une saison clôturée n'est pas une erreur mais ne
  modifie aucune ligne ; l'appli prévient l'utilisateur avant.

## Mon compte : mot de passe et « tester un coach » (bouton 👤)
- **Changer son mot de passe** : bouton 👤 (en haut, à côté de la déconnexion) > « Changer mon mot de passe ». Aucune règle imposée par l'appli (Supabase refuse moins de 6 caractères par défaut).
- **Après la connexion d'un admin / superadmin**, une fenêtre propose : *Continuer en admin* ou *tester un coach* (liste des comptes coach). Le même choix reste accessible via 👤.
- **Tester un coach** est une vraie connexion à son compte, sans son mot de passe : le serveur (route `/api/admin/impersonate`, clé `SUPABASE_SERVICE_ROLE_KEY` requise) génère un
  jeton à usage unique que le navigateur échange contre une session de ce coach. On voit donc exactement ses équipes et ses droits. Seuls les comptes **coach** sont ciblables
  (jamais un admin / superadmin) ; chaque test est tracé dans les journaux du serveur Vercel. La session de l'administrateur est gardée dans l'onglet ; le bandeau bleu
  « Revenir à mon compte » la restaure. **Utiliser un seul onglet** pendant un test (la session est partagée entre les onglets du navigateur). Ce qui est enregistré pendant un test l'est pour de vrai.

## Accès de secours (point 7) : ne plus jamais perdre l'accès
Deux protections complémentaires, sans jeton secret codé en dur :
1. **Anti-verrouillage** (`sql/admin_06_last_superadmin.sql`) : la base refuse de supprimer ou rétrograder le **dernier superadmin**, depuis l'appli, le tableau de bord Supabase ou le SQL
   (y compris en supprimant le compte). Pour l'outrepasser volontairement : `ALTER TABLE multisports.app_profiles DISABLE TRIGGER last_superadmin_guard;` (puis `ENABLE`).
2. **Accès de secours** (écran de connexion > « Accès de secours »), si malgré tout l'accès est perdu : le propriétaire saisit un **code de secours** et choisit un nouveau mot de passe ; le serveur
   recrée / répare son compte superadmin et le connecte. Configuration sur Vercel (Settings > Environment Variables, serveur uniquement) :
   - `EMERGENCY_SUPERADMIN_EMAIL` : l'adresse du propriétaire (la seule que cette procédure peut réparer) ;
   - `EMERGENCY_ACCESS_SECRET` : un code long, 24 caractères minimum (`openssl rand -base64 32`), à ranger dans un gestionnaire de mots de passe. Sans ces deux variables la procédure est désactivée.
   Ce n'est pas une porte d'accès aux données : elle ne fait que rétablir le compte du propriétaire, qui se connecte ensuite normalement. Comparaison à temps constant, 1 s d'attente par essai, chaque usage journalisé.
3. **Sans l'appli** (toujours possible avec votre compte Supabase) : Authentication > Users pour (re)créer le compte, puis la requête SQL en tête de `admin_06_last_superadmin.sql`.
Les données restent de toute façon lisibles dans le tableau de bord Supabase avec votre compte Supabase, indépendamment de l'appli.

### Correctifs de l'exe du 17/11 (point 8)
Réessais automatiques sur blocage 403 / 429, une page lue par phase, dépôt limité aux poules où joue le club, adresses essayées dans les messages 404, copie de page pour chaque équipe en erreur.
Même procédure de mise à jour que ci-dessus (remplacer `scripts/push_ffbb_club.py`, reconstruire l'exe, le déposer dans `public/`).

## Confort du Direct et des phases (17/11)
- **Date et heure** du match en petit au-dessus du score du Direct ; champ **Heure** dans la configuration (rempli automatiquement depuis le calendrier FFBB ou par la recherche d'ID).
- **Périodes par défaut selon la catégorie** de l'équipe choisie (modifiables ensuite) : U9 et moins 6 × 4 min ; U11 8 × 4 min ; U13 4 × 8 min ; U15 et plus (ou seniors) 4 × 10 min.
  Prolongations de 5 min à partir de U13 (pas de prolongation en U11 et moins : le nul reste possible). Les valeurs ne changent pas si un match est déjà en cours.
- **Accès** : un admin ne voit plus les comptes superadmin (retirés côté serveur ; `sql/admin_07_hide_superadmin.sql` ajoute la protection côté base).
- **Numéro de phase** : lu dans le libellé FFBB (« Phase 2 », « Saison régulière »), sinon dans le rang de la phase dans la compétition ; en dernier recours, une phase seule qui démarre après
  le 31 octobre est affichée « Phase 2 ». Relancer « Charger les équipes depuis le cache » pour mettre à jour les phases déjà chargées.

## Effectif : case Coach et badge « surclassement »
- **Coach** (`sql/admin_08_roster_coach.sql`, à exécuter après admin_03) : pour l'encadrement, une case « Coach » (plusieurs possibles). Au chargement d'un PDF, le premier encadrant d'une équipe qui n'a
  pas encore de coach est coché par défaut ; le choix déjà enregistré est conservé aux réimports. Badge vert « Coach » dans la liste.
- **Badge « Surclassement U13 »** calculé (plus d'après le code D11 de la fiche) : une joueuse est surclassée quand son équipe est d'une catégorie plus élevée que celle de son âge **et** qu'une équipe plus
  jeune existe pour elle dans le club (pas de badge en U11 F si U9 F n'existe pas). Le code de la fiche FFBB (ex. « D11 ») reste affiché en information.
- **Contrôle après import** : l'appli relit la base et nomme toute personne qui n'aurait pas été enregistrée (« 14 / 15 enregistrées »).

## Profil « consultant » (lecture seule) — `sql/admin_09_role_consultant.sql`
- Le consultant **lit** les équipes qui lui sont affectées (Administration > Accès, comme un coach) et **ne modifie rien** : la base refuse toute écriture sur matchs, événements, statistiques,
  équipes et joueuses TeamStats (politiques restrictives, testées).
- Dans l'appli il ne voit que le menu **📅 Calendrier** : calendrier, résultats, classement, **effectif** de l'équipe (onglet 👥, lecture seule) et PDF des statistiques des matchs enregistrés (icône 📊).
  Pas de Configuration, Direct, Statistiques en direct ni bouton Enregistrer.
- Un admin gère les comptes consultant ; « Tester un profil » (bouton 👤) fonctionne aussi pour un consultant. L'onglet 👥 Effectif du menu Calendrier est visible aussi des coachs (pour leurs équipes).
- À exécuter après admin_01 et admin_04 : il remplace la contrainte des profils par (superadmin, admin, coach, consultant).

## Fiche joueuse unique et renforts (`sql/admin_10_merge_roster.sql`)
- **Une seule table pour l'effectif** : `stats_players`. L'équipe chargée depuis le PDF et l'équipe TeamStats sont la même équipe ; la fiche cumule le **numéro de maillot** (TeamStats) et
  **licence, date de naissance, catégorie, rôle, coach** (PDF). L'import complète la joueuse déjà présente (même licence, sinon même nom « Léa MARTIN ») en **gardant son numéro**, sinon la crée (maillot 0).
  L'ancienne table `stats_club_roster` est conservée en sauvegarde (l'appli ne l'utilise plus). L'encadrement est dans la même table (`role = 'encadrement'`) et n'apparaît jamais dans les feuilles de match ;
  l'enregistrement d'une équipe TeamStats ne le supprime jamais. Dans Effectif, le **N° de maillot** se modifie directement.
- **Renforts** : dans la feuille de match, « ＋ Renfort d'une autre équipe » demande **d'abord l'équipe**, puis les joueuses. Équipes autorisées (même saison) : même sexe = même catégorie (autre numéro d'équipe),
  catégorie juste en dessous ou juste au-dessus parmi celles qui existent au club (U15 F : U13 F, U15 F équipe 2, U18 F) ; autre sexe = **uniquement en U9 et U11**, même catégorie (U11 F : U11 M ; plus U9 F et U13 F).
  Le renfort apparaît en **vert** avec son équipe d'origine entre parenthèses ; il reste vert dans le Direct (avec son équipe d'origine), dans le tableau des stats et le PDF. L'origine est enregistrée avec le nom (« Léa MARTIN (U13F) »)
  et retrouvée quand on rouvre le match. Un coach ne lit que nom et numéro des autres équipes (fonction `renfort_candidates`), pas leurs fiches.

## Coupes : un tour = un regroupement (correctif du 18/11)
Dans FFBB, chaque **tour** d\x27une coupe est une « compétition » distincte (« 2ème tour Coupe du Rhône… ») et le numéro de journée d\x27un match de coupe est un numéro de match (14, 10…), pas un tour.
- À la lecture du cache, le numéro de journée d\x27un match de coupe devient le **tour** (déduit du nom : sans mention = 1er tour). 
- À l\x27affichage, les tours d\x27une même coupe sont regroupés en **une seule entrée « Coupe »**, avec les sélecteurs « Un tour / Tous » et les titres « 1er tour », « 2e tour »…
  Chaque tour montre tous les matchs de la poule pour ce tour. Le classement affiché est celui du dernier tour. Dans Administration, chaque tour garde ses n° de phase et de poule FFBB.
- Les données déjà chargées sont corrigées à l\x27affichage sans rechargement ; relancer « Charger les équipes depuis le cache » met aussi à jour la base (liste « Joué / À venir » du Match : « T1 » au lieu de « J14 »).
