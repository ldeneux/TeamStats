-- Mise à jour pour qui a déjà exécuté admin_01_club_calendar.sql :
-- un admin peut désormais gérer les comptes « analyst » ET « admin » (jamais un superadmin).
DROP POLICY IF EXISTS app_profiles_write ON multisports.app_profiles;
CREATE POLICY app_profiles_write ON multisports.app_profiles
  FOR ALL TO authenticated
  USING (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('analyst', 'admin')))
  WITH CHECK (multisports.is_superadmin() OR (multisports.is_admin() AND role IN ('analyst', 'admin')));
NOTIFY pgrst, 'reload schema';
