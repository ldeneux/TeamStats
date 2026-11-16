-- =====================================================================================
-- TEAMSTATS : historique des saisons et verrouillage des saisons terminées.
-- À exécuter APRÈS admin_01 (et admin_03 si l'effectif est utilisé). Rejouable sans risque.
--
-- RÈGLE : tout ce qui date d'AVANT le 1er septembre de la saison en cours est en LECTURE SEULE pour tous
-- les comptes de l'application, y compris admin et superadmin : matchs, événements, statistiques, équipes
-- TeamStats et joueuses d'une saison passée, calendriers, classements et effectifs de la saison.
-- La lecture, l'historique et les exports PDF restent disponibles.
-- Seule une modification DIRECTE EN BASE (éditeur SQL Supabase, rôle postgres / service_role) reste possible :
-- c'est le seul moyen pour le superadmin de corriger une saison clôturée.
--
-- Technique : des politiques RESTRICTIVES (en écriture seulement) s'ajoutent aux règles existantes, qui ne sont pas modifiées.
--
-- Réglage manuel de la date de verrouillage (délai de grâce, clôture anticipée), dans l'éditeur SQL :
--   INSERT INTO multisports.app_settings (key, value) VALUES ('lock_before', '2026-08-01')
--     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--   (supprimer la ligne remet la règle automatique : 1er septembre de la saison en cours)
-- =====================================================================================

CREATE TABLE IF NOT EXISTS multisports.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE multisports.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON multisports.app_settings FROM anon, authenticated;   -- modifiable uniquement en base

-- Date avant laquelle tout est verrouillé.
CREATE OR REPLACE FUNCTION multisports.locked_before()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT COALESCE(
    (SELECT value::date FROM multisports.app_settings WHERE key = 'lock_before'),
    make_date(
      CASE WHEN EXTRACT(MONTH FROM (now() AT TIME ZONE 'Europe/Paris')) >= 9
           THEN EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Paris'))::int
           ELSE EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Paris'))::int - 1 END, 9, 1));
$$;

CREATE OR REPLACE FUNCTION multisports.is_locked_date(d date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT d IS NOT NULL AND d < multisports.locked_before(); $$;

-- « 2025-2026 » est verrouillée dès que le 1er septembre 2026 est atteint.
CREATE OR REPLACE FUNCTION multisports.is_locked_season(s text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT s ~ '^\d{4}-\d{4}$' AND make_date(split_part(s, '-', 2)::int, 9, 1) <= multisports.locked_before(); $$;

-- Équipe TeamStats : la saison est à la fin du nom (« SATHONAY U15F - 2025/2026 »). Sans saison dans le nom : jamais verrouillée.
CREATE OR REPLACE FUNCTION multisports.is_team_name_locked(n text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT n ~ '\d{4}/\d{4}\s*$' AND make_date(substring(n from '(\d{4})\s*$')::int, 9, 1) <= multisports.locked_before(); $$;

CREATE OR REPLACE FUNCTION multisports.is_team_id_locked(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT EXISTS (SELECT 1 FROM multisports.stats_teams t WHERE t.id = p_id AND multisports.is_team_name_locked(t.name)); $$;

CREATE OR REPLACE FUNCTION multisports.is_match_locked(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT EXISTS (SELECT 1 FROM multisports.stats_matches m WHERE m.id = p_id AND multisports.is_locked_date(m.match_date)); $$;

CREATE OR REPLACE FUNCTION multisports.is_club_team_locked(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT EXISTS (SELECT 1 FROM multisports.stats_club_teams t WHERE t.id = p_id AND multisports.is_locked_season(t.season)); $$;

CREATE OR REPLACE FUNCTION multisports.is_club_phase_locked(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = multisports, public
AS $$ SELECT EXISTS (SELECT 1 FROM multisports.stats_club_phases p WHERE p.id = p_id AND multisports.is_club_team_locked(p.club_team_id)); $$;

REVOKE ALL ON FUNCTION multisports.locked_before(), multisports.is_locked_date(date), multisports.is_locked_season(text),
  multisports.is_team_name_locked(text), multisports.is_team_id_locked(uuid), multisports.is_match_locked(uuid),
  multisports.is_club_team_locked(uuid), multisports.is_club_phase_locked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.locked_before(), multisports.is_locked_date(date), multisports.is_locked_season(text),
  multisports.is_team_name_locked(text), multisports.is_team_id_locked(uuid), multisports.is_match_locked(uuid),
  multisports.is_club_team_locked(uuid), multisports.is_club_phase_locked(uuid) TO authenticated;

-- Politiques restrictives : INSERT / UPDATE / DELETE refusés sur une saison clôturée (jamais la lecture).
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('stats_matches',             'NOT multisports.is_locked_date(match_date)'),
    ('stats_match_events',        'NOT multisports.is_match_locked(match_id)'),
    ('stats_player_game_stats',   'NOT multisports.is_match_locked(match_id)'),
    ('stats_player_period_stats', 'NOT multisports.is_match_locked(match_id)'),
    ('stats_teams',               'NOT multisports.is_team_name_locked(name)'),
    ('stats_players',             'NOT multisports.is_team_id_locked(team_id)'),
    ('stats_club_teams',          'NOT multisports.is_locked_season(season)'),
    ('stats_club_phases',         'NOT multisports.is_club_team_locked(club_team_id)'),
    ('stats_club_roster',         'NOT multisports.is_club_team_locked(club_team_id)'),
    ('stats_club_matches',        'NOT multisports.is_club_phase_locked(phase_id)'),
    ('stats_club_standings',      'NOT multisports.is_club_phase_locked(phase_id)')
  ) AS x(tbl, expr)
  LOOP
    IF to_regclass('multisports.' || v.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS season_lock_insert ON multisports.%I', v.tbl);
    EXECUTE format('DROP POLICY IF EXISTS season_lock_update ON multisports.%I', v.tbl);
    EXECUTE format('DROP POLICY IF EXISTS season_lock_delete ON multisports.%I', v.tbl);
    EXECUTE format('CREATE POLICY season_lock_insert ON multisports.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', v.tbl, v.expr);
    EXECUTE format('CREATE POLICY season_lock_update ON multisports.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', v.tbl, v.expr, v.expr);
    EXECUTE format('CREATE POLICY season_lock_delete ON multisports.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', v.tbl, v.expr);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
