-- =====================================================================================
-- TEAMSTATS : le profil « analyst » devient « coach ».
-- À exécuter UNE FOIS (après admin_01), de préférence juste avant de déployer la nouvelle version de l'appli.
-- Les comptes existants gardent exactement les mêmes droits : seul le nom du profil change.
-- Rejouable sans risque.
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

UPDATE multisports.app_profiles SET role = 'coach' WHERE role = 'analyst';

ALTER TABLE multisports.app_profiles
  ADD CONSTRAINT app_profiles_role_check CHECK (role IN ('superadmin', 'admin', 'coach'));

-- Un admin gère les comptes « coach » et « admin » ; seul le superadmin touche aux superadmin.
DROP POLICY IF EXISTS app_profiles_write ON multisports.app_profiles;
CREATE POLICY app_profiles_write ON multisports.app_profiles
  FOR ALL TO authenticated
  USING (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('coach', 'admin')))
  WITH CHECK (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('coach', 'admin')));

NOTIFY pgrst, 'reload schema';
