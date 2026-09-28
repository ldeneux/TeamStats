-- Statistiques par joueuse ET par période de match.
-- À exécuter dans l'éditeur SQL de Supabase.

CREATE TABLE IF NOT EXISTS multisports.stats_player_period_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  player_id character varying NOT NULL,
  player_number integer,
  player_name character varying,
  period integer NOT NULL,
  is_starter boolean NOT NULL DEFAULT false,
  playing_time_seconds integer NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  pts2_made integer NOT NULL DEFAULT 0,
  pts2_att integer NOT NULL DEFAULT 0,
  pts3_made integer NOT NULL DEFAULT 0,
  pts3_att integer NOT NULL DEFAULT 0,
  ft_made integer NOT NULL DEFAULT 0,
  ft_att integer NOT NULL DEFAULT 0,
  reb_off integer NOT NULL DEFAULT 0,
  reb_def integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  fouls integer NOT NULL DEFAULT 0,
  fouls_drawn integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stats_player_period_stats_pkey PRIMARY KEY (id),
  CONSTRAINT stats_player_period_stats_match_id_fkey FOREIGN KEY (match_id)
    REFERENCES multisports.stats_matches(id) ON DELETE CASCADE,
  CONSTRAINT stats_player_period_stats_unique UNIQUE (match_id, player_id, period)
);

CREATE INDEX IF NOT EXISTS stats_player_period_stats_match_idx
  ON multisports.stats_player_period_stats (match_id);

-- Mêmes droits que les autres tables stats_* (adapter si tu utilises des politiques RLS) :
GRANT ALL ON multisports.stats_player_period_stats TO anon, authenticated, service_role;

-- OPTIONNEL (phase de recette) : repartir de zéro en supprimant les matchs existants.
-- DELETE FROM multisports.stats_match_events;
-- DELETE FROM multisports.stats_player_game_stats;
-- DELETE FROM multisports.stats_matches;
