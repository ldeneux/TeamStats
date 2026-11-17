-- =====================================================================================
-- TEAMSTATS : un admin ne voit pas les comptes superadmin. À exécuter APRÈS admin_01. Rejouable sans risque.
--  - la table des profils n'est plus lisible pour les lignes superadmin, sauf par le superadmin lui-même et par la personne concernée ;
--  - une fonction réservée aux admin donne les identifiants des superadmin (pour les retirer de la liste des comptes de l'écran Accès).
-- (L'appli filtre déjà ces comptes côté serveur ; ce script ajoute la protection au niveau de la base.)
-- =====================================================================================
DROP POLICY IF EXISTS app_profiles_read ON multisports.app_profiles;
CREATE POLICY app_profiles_read ON multisports.app_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR multisports.is_superadmin() OR (multisports.is_admin() AND role <> 'superadmin'));

CREATE OR REPLACE FUNCTION multisports.superadmin_user_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT p.user_id FROM multisports.app_profiles p
  WHERE p.role = 'superadmin' AND multisports.is_admin();
$$;
REVOKE ALL ON FUNCTION multisports.superadmin_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.superadmin_user_ids() TO authenticated;

NOTIFY pgrst, 'reload schema';
