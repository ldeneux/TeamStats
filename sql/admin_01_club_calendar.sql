-- =====================================================================================
-- TEAMSTATS : profil « superadmin », équipes du club par saison, phases, calendriers, classements.
-- À exécuter dans l'éditeur SQL de Supabase APRÈS security_01_profiles_and_rls.sql.
-- Rejouable sans risque (IF NOT EXISTS / OR REPLACE) et sans suppression de données.
--
-- Rôles
--   superadmin : accès illimité (tout ce que fait admin + gestion des comptes admin / superadmin).
--   admin      : voit et gère toutes les équipes ; gère les comptes « coach » et « admin » (pas les superadmin).
--   coach    : ne voit que les équipes qui lui sont affectées (multisports.team_access).
-- =====================================================================================

-- 1) Rôle superadmin ------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'multisports.app_profiles'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE multisports.app_profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
UPDATE multisports.app_profiles SET role = 'coach' WHERE role = 'analyst';  -- ancien nom du profil
ALTER TABLE multisports.app_profiles
  ADD CONSTRAINT app_profiles_role_check CHECK (role IN ('superadmin', 'admin', 'coach'));

-- is_admin() reste la porte d'entrée de TOUTES les règles existantes : superadmin la passe aussi.
CREATE OR REPLACE FUNCTION multisports.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM multisports.app_profiles p
    WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'superadmin')
  );
$$;

CREATE OR REPLACE FUNCTION multisports.is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM multisports.app_profiles p
    WHERE p.user_id = auth.uid() AND p.role = 'superadmin'
  );
$$;

REVOKE ALL ON FUNCTION multisports.is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.is_superadmin() TO authenticated;

-- Profils : un admin peut créer / modifier / supprimer des comptes « coach » et « admin », mais jamais
-- toucher un superadmin ni donner ce rôle. Le superadmin peut tout.
DROP POLICY IF EXISTS app_profiles_admin_write ON multisports.app_profiles;
DROP POLICY IF EXISTS app_profiles_write ON multisports.app_profiles;
CREATE POLICY app_profiles_write ON multisports.app_profiles
  FOR ALL TO authenticated
  USING (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('coach', 'admin')))
  WITH CHECK (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('coach', 'admin')));

-- 2) Équipes du club, par saison ----------------------------------------------------------
-- Une ligne par équipe (U15F, U13M, U15F-2...) et par saison. Chaque équipe du club est liée à
-- une équipe TeamStats (stats_teams, « SATHONAY U15F - 2026/2027 ») : affecter un coach à
-- l'équipe = lui ouvrir cette équipe TeamStats (team_access), donc le direct, les stats et le calendrier.
CREATE TABLE IF NOT EXISTS multisports.stats_club_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season text NOT NULL,                       -- « 2026-2027 »
  code text NOT NULL,                         -- « U15F », « U15F-2 »
  label text NOT NULL,                        -- « U15 F »
  category text,                              -- « U15 », « Seniors »
  sexe text CHECK (sexe IN ('F', 'M', 'X')),
  team_number integer,
  logo_asset text,                            -- image FFBB du niveau (api.ffbb.com/assets/<id>)
  stats_team_id uuid REFERENCES multisports.stats_teams (id) ON DELETE SET NULL,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, code)
);

-- Une ligne par phase (compétition + poule) d'une équipe.
CREATE TABLE IF NOT EXISTS multisports.stats_club_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_team_id uuid NOT NULL REFERENCES multisports.stats_club_teams (id) ON DELETE CASCADE,
  phase_number integer NOT NULL DEFAULT 1,
  competition_id text,                        -- identifiant FFBB de la phase (paramètre « phase= »)
  competition_name text,
  competition_code text,                      -- « dfu15-2 » (dans l'adresse competitions.ffbb.com)
  competition_url text,
  poule_id text NOT NULL,                     -- identifiant FFBB de la poule (paramètre « poule= »)
  poule_label text,                           -- « Poule C »
  engagement_id text,                         -- identifiant FFBB de NOTRE équipe dans la poule
  our_team_name text,
  logo_asset text,
  starts_on date,
  ends_on date,
  matches_count integer NOT NULL DEFAULT 0,
  cache_fetched_at timestamptz,
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_team_id, poule_id)
);

-- Tous les matchs de la poule (pas seulement les nôtres : « Toute la poule »).
CREATE TABLE IF NOT EXISTS multisports.stats_club_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES multisports.stats_club_phases (id) ON DELETE CASCADE,
  ffbb_rencontre_id text NOT NULL,
  numero_journee text,
  match_date timestamptz,                     -- heure de Paris telle quelle, étiquetée UTC (comme Multisports)
  status text NOT NULL DEFAULT 'a_venir' CHECK (status IN ('a_venir', 'joue')),
  team1_name text, team1_score integer, team1_logo_asset text, team1_engagement_id text,
  team2_name text, team2_score integer, team2_logo_asset text, team2_engagement_id text,
  us_is_team1 boolean,                        -- NULL = match ne concernant pas notre équipe
  location text,
  UNIQUE (phase_id, ffbb_rencontre_id)
);
CREATE INDEX IF NOT EXISTS stats_club_matches_phase_idx ON multisports.stats_club_matches (phase_id);

CREATE TABLE IF NOT EXISTS multisports.stats_club_standings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES multisports.stats_club_phases (id) ON DELETE CASCADE,
  engagement_id text NOT NULL,
  engagement_nom text,
  position integer, points integer, matches_joues integer, gagnes integer, perdus integer,
  is_us boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phase_id, engagement_id)
);

-- 3) Droits ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION multisports.can_access_club_team(p_club_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT multisports.is_admin() OR EXISTS (
    SELECT 1 FROM multisports.stats_club_teams t
    WHERE t.id = p_club_team_id AND t.stats_team_id IS NOT NULL
      AND multisports.can_access_team(t.stats_team_id)
  );
$$;
REVOKE ALL ON FUNCTION multisports.can_access_club_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.can_access_club_team(uuid) TO authenticated;

ALTER TABLE multisports.stats_club_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_club_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_club_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE multisports.stats_club_standings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON multisports.stats_club_teams, multisports.stats_club_phases,
              multisports.stats_club_matches, multisports.stats_club_standings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON multisports.stats_club_teams, multisports.stats_club_phases,
              multisports.stats_club_matches, multisports.stats_club_standings TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'multisports'
             AND tablename IN ('stats_club_teams', 'stats_club_phases', 'stats_club_matches', 'stats_club_standings')
  LOOP
    EXECUTE format('DROP POLICY %I ON multisports.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Lecture : admin = tout ; coach = équipes qui lui sont affectées. Écriture : admin seulement.
CREATE POLICY club_teams_read ON multisports.stats_club_teams
  FOR SELECT TO authenticated USING (multisports.can_access_club_team(id));
CREATE POLICY club_teams_write ON multisports.stats_club_teams
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

CREATE POLICY club_phases_read ON multisports.stats_club_phases
  FOR SELECT TO authenticated USING (multisports.can_access_club_team(club_team_id));
CREATE POLICY club_phases_write ON multisports.stats_club_phases
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

CREATE POLICY club_matches_read ON multisports.stats_club_matches
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM multisports.stats_club_phases p WHERE p.id = phase_id));
CREATE POLICY club_matches_write ON multisports.stats_club_matches
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

CREATE POLICY club_standings_read ON multisports.stats_club_standings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM multisports.stats_club_phases p WHERE p.id = phase_id));
CREATE POLICY club_standings_write ON multisports.stats_club_standings
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

-- 4) Cache FFBB : réservé aux admins (il contient les pages brutes de toutes les poules) -------
-- Le programme MiseAJourFFBB_Club.exe s'y connecte avec un compte de profil admin : rien ne change pour lui.
DO $$
BEGIN
  IF to_regclass('multisports.ffbb_poule_cache') IS NOT NULL THEN
    DROP POLICY IF EXISTS "authenticated_full_access" ON multisports.ffbb_poule_cache;
    DROP POLICY IF EXISTS ffbb_poule_cache_admin ON multisports.ffbb_poule_cache;
    CREATE POLICY ffbb_poule_cache_admin ON multisports.ffbb_poule_cache
      FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================================
-- DERNIÈRE ÉTAPE (à faire une fois, à la main) : désigner le superadmin.
--   UPDATE multisports.app_profiles SET role = 'superadmin'
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'vous@exemple.fr');
-- =====================================================================================
