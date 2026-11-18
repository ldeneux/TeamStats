-- =====================================================================================
-- TEAMSTATS : nouveau profil « consultant » : lit les équipes qui lui sont affectées, ne modifie RIEN.
-- À exécuter APRÈS admin_01 (et admin_04). Rejouable sans risque.
--   - lecture : exactement comme un coach (équipes affectées dans Administration > Accès) ;
--   - écriture : refusée par la base (politiques restrictives) sur matchs, événements, statistiques, équipes et joueuses TeamStats.
-- =====================================================================================
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
ALTER TABLE multisports.app_profiles
  ADD CONSTRAINT app_profiles_role_check CHECK (role IN ('superadmin', 'admin', 'coach', 'consultant'));

CREATE OR REPLACE FUNCTION multisports.is_consultant()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT EXISTS (SELECT 1 FROM multisports.app_profiles p WHERE p.user_id = auth.uid() AND p.role = 'consultant');
$$;
REVOKE ALL ON FUNCTION multisports.is_consultant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.is_consultant() TO authenticated;

-- Un admin gère aussi les comptes consultant.
DROP POLICY IF EXISTS app_profiles_write ON multisports.app_profiles;
CREATE POLICY app_profiles_write ON multisports.app_profiles
  FOR ALL TO authenticated
  USING (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('coach', 'consultant', 'admin')))
  WITH CHECK (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('coach', 'consultant', 'admin')));

-- Lecture seule : INSERT / UPDATE / DELETE refusés pour un consultant (la lecture n'est jamais touchée).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stats_teams', 'stats_players', 'stats_matches', 'stats_match_events', 'stats_player_game_stats', 'stats_player_period_stats']
  LOOP
    IF to_regclass('multisports.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS consultant_ro_insert ON multisports.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS consultant_ro_update ON multisports.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS consultant_ro_delete ON multisports.%I', t);
    EXECUTE format('CREATE POLICY consultant_ro_insert ON multisports.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT multisports.is_consultant())', t);
    EXECUTE format('CREATE POLICY consultant_ro_update ON multisports.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT multisports.is_consultant()) WITH CHECK (NOT multisports.is_consultant())', t);
    EXECUTE format('CREATE POLICY consultant_ro_delete ON multisports.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT multisports.is_consultant())', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
