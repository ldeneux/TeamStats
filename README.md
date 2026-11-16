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
