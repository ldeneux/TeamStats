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

## Scripts SQL (à exécuter dans l'éditeur SQL de Supabase)
Ordre conseillé pour une base à jour :
1. `sql/stats_player_period_stats.sql` : statistiques par joueuse et par période.
2. `sql/security_01_profiles_and_rls.sql` : profils (admin / analyst), accès par équipe, règles RLS. **À lire avant d'exécuter.**
3. `sql/ffbb_lookup.sql` : recherche d'un match par ID FFBB (comptes connectés uniquement).
4. `sql/ffbb_upcoming.sql` : matchs à venir de NOS équipes (filtrés selon les équipes autorisées).
5. `sql/stats_extra_columns.sql` : colonnes des nouvelles statistiques (interceptions, balles perdues, contres, contres subis).
6. `sql/security_02_lock_main_app_OPTIONAL.sql` : ferme l'appli principale aux comptes sans profil admin (voir ci-dessous).

## Connexion et profils
- L'appli demande une connexion (Supabase Auth, e-mail + mot de passe) avant tout affichage. Les comptes se créent dans
  Supabase > Authentication > Users > Add user. Pensez à **désactiver l'inscription libre** (Authentication > Sign In / Providers).
- `multisports.app_profiles` donne un profil à un compte : `admin` (toutes les équipes) ou `analyst`.
- `multisports.team_access` liste les équipes ouvertes à un compte. Un analyst ne voit que ces équipes, peut tout faire dessus
  (joueuses, matchs, statistiques) sauf créer ou supprimer une équipe. Un compte sans profil n'a accès à rien.
- Les règles sont appliquées par la base (RLS) : une simple page de login ne protégerait pas des appels directs à l'API.
- Le compte Supabase est partagé avec l'appli principale : voir `security_02_lock_main_app_OPTIONAL.sql`.

## Prolongations (U13 et +)
En plus de Q1…Q4, un match d'une équipe U13 ou plus (ou sans « U » dans le nom : senior) peut passer à une
prolongation OT1 de 5 minutes, puis OT2, etc., uniquement en cas d'égalité à la fin de la période (bouton « + »
de la période). Une prolongation est stockée comme une période de numéro supérieur au nombre de périodes
(Q4 → OT1 = période 5), donc sans changement de schéma ; `current_period` vaut `OT1`, `OT2`…
