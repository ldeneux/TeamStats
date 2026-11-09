-- =====================================================================================
-- SÉCURITÉ TEAMSTATS : profils (admin / analyst) et accès par équipe.
-- À exécuter dans l'éditeur SQL de Supabase. Ordre conseillé :
--   1) ce script, 2) ffbb_lookup.sql, 3) ffbb_upcoming.sql, 4) stats_extra_columns.sql.
--
-- Principe
--   * admin   : voit et gère toutes les équipes.
--   * analyst : ne voit que les équipes listées dans multisports.team_access ; peut tout faire
--               dessus (joueuses, matchs, statistiques) sauf créer ou supprimer une équipe.
--   * un compte sans profil, ou non connecté, n'a accès à rien.
-- Les règles sont appliquées par la base (RLS) : elles valent aussi pour qui appellerait
-- l'API directement avec la clé publique.
-- =====================================================================================

-- 1) Tables de sécurité --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS multisports.app_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'analyst')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS multisports.team_access (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES multisports.stats_teams (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);

-- 2) Comptes déjà existants = admin (pour que personne ne perde l'accès) -----------------
-- ATTENTION : à exécuter AVANT de créer les comptes analyst, sinon ils deviendraient admin.
-- Pour n'en garder que certains : remplacer par WHERE u.email IN ('vous@exemple.fr').
INSERT INTO multisports.app_profiles (user_id, role, display_name)
SELECT u.id, 'admin', u.email
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- 3) Fonctions d'autorisation (SECURITY DEFINER : lisent les tables de sécurité sans récursion RLS) --
CREATE OR REPLACE FUNCTION multisports.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM multisports.app_profiles p
    WHERE p.user_id = auth.uid() AND p.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION multisports.can_access_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT multisports.is_admin() OR EXISTS (
    SELECT 1
    FROM multisports.team_access a
    JOIN multisports.app_profiles p ON p.user_id = a.user_id
    WHERE a.user_id = auth.uid() AND a.team_id = p_team_id
  );
$$;

-- Les matchs ne référencent leurs équipes que par le NOM (team_home / team_away).
CREATE OR REPLACE FUNCTION multisports.can_access_team_name(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT multisports.is_admin() OR EXISTS (
    SELECT 1
    FROM multisports.team_access a
    JOIN multisports.app_profiles p ON p.user_id = a.user_id
    JOIN multisports.stats_teams t ON t.id = a.team_id
    WHERE a.user_id = auth.uid() AND t.name = p_name
  );
$$;

REVOKE ALL ON FUNCTION multisports.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION multisports.can_access_team(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION multisports.can_access_team_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION multisports.can_access_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION multisports.can_access_team_name(text) TO authenticated;

-- 4) On repart de zéro sur les politiques de ces tables (les anciennes étaient ouvertes à tous) --
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'multisports'
      AND tablename IN ('stats_teams', 'stats_players', 'stats_matches', 'stats_match_events',
                        'stats_player_game_stats', 'stats_player_period_stats', 'app_profiles', 'team_access')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE multisports.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.team_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_player_game_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_player_period_stats ENABLE ROW LEVEL SECURITY;

-- 5) Droits d'accès : plus rien pour l'anonyme ----------------------------------------------
GRANT USAGE ON SCHEMA multisports TO authenticated;
REVOKE ALL ON multisports.app_profiles, multisports.team_access,
              multisports.stats_teams, multisports.stats_players, multisports.stats_matches,
              multisports.stats_match_events, multisports.stats_player_game_stats,
              multisports.stats_player_period_stats FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON multisports.app_profiles, multisports.team_access,
              multisports.stats_teams, multisports.stats_players, multisports.stats_matches,
              multisports.stats_match_events, multisports.stats_player_game_stats,
              multisports.stats_player_period_stats TO authenticated;

-- 6) Politiques ------------------------------------------------------------------------------
-- Profils et accès : chacun lit les siens, seul l'admin modifie.
CREATE POLICY app_profiles_read ON multisports.app_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR multisports.is_admin());
CREATE POLICY app_profiles_admin_write ON multisports.app_profiles
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

CREATE POLICY team_access_read ON multisports.team_access
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR multisports.is_admin());
CREATE POLICY team_access_admin_write ON multisports.team_access
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

-- Équipes : lecture et modification sur les équipes autorisées ; création et suppression réservées à l'admin.
CREATE POLICY stats_teams_read ON multisports.stats_teams
  FOR SELECT TO authenticated USING (multisports.can_access_team(id));
CREATE POLICY stats_teams_insert ON multisports.stats_teams
  FOR INSERT TO authenticated WITH CHECK (multisports.is_admin());
CREATE POLICY stats_teams_update ON multisports.stats_teams
  FOR UPDATE TO authenticated USING (multisports.can_access_team(id)) WITH CHECK (multisports.can_access_team(id));
CREATE POLICY stats_teams_delete ON multisports.stats_teams
  FOR DELETE TO authenticated USING (multisports.is_admin());

-- Joueuses : tout sur les équipes autorisées.
CREATE POLICY stats_players_all ON multisports.stats_players
  FOR ALL TO authenticated
  USING (multisports.can_access_team(team_id)) WITH CHECK (multisports.can_access_team(team_id));

-- Matchs : tout dès que l'une des deux équipes (domicile ou extérieur) est autorisée.
CREATE POLICY stats_matches_all ON multisports.stats_matches
  FOR ALL TO authenticated
  USING (multisports.can_access_team_name(team_home) OR multisports.can_access_team_name(team_away))
  WITH CHECK (multisports.can_access_team_name(team_home) OR multisports.can_access_team_name(team_away));

-- Événements et statistiques : suivent les matchs visibles (la RLS de stats_matches s'applique dans la sous-requête).
CREATE POLICY stats_match_events_all ON multisports.stats_match_events
  FOR ALL TO authenticated
  USING (match_id IN (SELECT m.id FROM multisports.stats_matches m))
  WITH CHECK (match_id IN (SELECT m.id FROM multisports.stats_matches m));
CREATE POLICY stats_player_game_stats_all ON multisports.stats_player_game_stats
  FOR ALL TO authenticated
  USING (match_id IN (SELECT m.id FROM multisports.stats_matches m))
  WITH CHECK (match_id IN (SELECT m.id FROM multisports.stats_matches m));
CREATE POLICY stats_player_period_stats_all ON multisports.stats_player_period_stats
  FOR ALL TO authenticated
  USING (match_id IN (SELECT m.id FROM multisports.stats_matches m))
  WITH CHECK (match_id IN (SELECT m.id FROM multisports.stats_matches m));

NOTIFY pgrst, 'reload schema';

-- =====================================================================================
-- MODE D'EMPLOI : créer un compte analyst et lui ouvrir des équipes
--   1. Supabase > Authentication > Users > Add user (e-mail + mot de passe).
--   2. Exécuter (en remplaçant l'e-mail et les noms d'équipes) :
--
--   INSERT INTO multisports.app_profiles (user_id, role, display_name)
--   SELECT id, 'analyst', 'Prénom' FROM auth.users WHERE email = 'analyste@exemple.fr';
--
--   INSERT INTO multisports.team_access (user_id, team_id)
--   SELECT u.id, t.id
--   FROM auth.users u, multisports.stats_teams t
--   WHERE u.email = 'analyste@exemple.fr'
--     AND t.name IN ('SATHONAY U15F - 2026/2027');
--
-- Retirer une équipe :  DELETE FROM multisports.team_access WHERE user_id = '...' AND team_id = '...';
-- Retirer tout accès :  DELETE FROM multisports.app_profiles WHERE user_id = '...';
-- Vérifier ce que voit chaque compte :
--   SELECT u.email, p.role, t.name
--   FROM multisports.app_profiles p
--   JOIN auth.users u ON u.id = p.user_id
--   LEFT JOIN multisports.team_access a ON a.user_id = p.user_id
--   LEFT JOIN multisports.stats_teams t ON t.id = a.team_id
--   ORDER BY u.email, t.name;
-- =====================================================================================
