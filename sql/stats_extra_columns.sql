-- Nouvelles statistiques saisies en match : interceptions, pertes de balle, contres, contres subis.
-- À exécuter dans l'éditeur SQL de Supabase. Sans danger si relancé.
-- (L'appli enregistre quand même le match si ce script n'a pas été exécuté : ces 4 colonnes
-- sont alors simplement absentes de la base, et se recalculent depuis l'historique à l'ouverture.)

ALTER TABLE multisports.stats_player_game_stats
  ADD COLUMN IF NOT EXISTS steals integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS turnovers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks_against integer NOT NULL DEFAULT 0;

ALTER TABLE multisports.stats_player_period_stats
  ADD COLUMN IF NOT EXISTS steals integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS turnovers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks_against integer NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
