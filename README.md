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
- `sql/stats_player_period_stats.sql` : statistiques par joueuse et par période (y compris les prolongations).
- `sql/ffbb_lookup.sql` : recherche d'un match par ID FFBB.
- `sql/ffbb_upcoming.sql` : liste des matchs à venir (calendrier de l'appli principale), utilisée par le filtre « À venir ».

## Prolongations (U13 et +)
En plus de Q1…Q4, un match d'une équipe U13 ou plus (ou sans « U » dans le nom : senior) peut passer à une
prolongation OT1 de 5 minutes, puis OT2, etc., uniquement en cas d'égalité à la fin de la période (bouton « + »
de la période). Une prolongation est stockée comme une période de numéro supérieur au nombre de périodes
(Q4 → OT1 = période 5), donc sans changement de schéma ; `current_period` vaut `OT1`, `OT2`…
