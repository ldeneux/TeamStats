-- =====================================================================================
-- TEAMSTATS : protection contre le verrouillage (« perdre l'accès quoi qu'il arrive »).
-- À exécuter APRÈS admin_01. Rejouable sans risque.
--
-- 1) La base REFUSE de supprimer ou de rétrograder le DERNIER superadmin (via l'appli, le tableau de bord Supabase
--    ou le SQL), y compris par suppression du compte (la suppression en cascade du profil est bloquée aussi).
--    Pour l'outrepasser volontairement :  ALTER TABLE multisports.app_profiles DISABLE TRIGGER last_superadmin_guard;
--    (puis ré-activer avec ENABLE TRIGGER).
-- 2) Droits nécessaires à la procédure d'accès de secours de l'appli (route /api/emergency, clé service_role),
--    limités à la table des profils.
--
-- Procédure de dernier recours SANS l'appli (éditeur SQL Supabase, toujours possible avec votre compte Supabase) :
--   -- a) créer / retrouver le compte dans Authentication > Users (mot de passe au choix), puis :
--   INSERT INTO multisports.app_profiles (user_id, role, display_name)
--   SELECT id, 'superadmin', email FROM auth.users WHERE email = 'vous@exemple.fr'
--   ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin';
-- =====================================================================================

CREATE OR REPLACE FUNCTION multisports.guard_last_superadmin()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'superadmin' AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'superadmin') THEN
    IF NOT EXISTS (SELECT 1 FROM multisports.app_profiles p WHERE p.role = 'superadmin' AND p.user_id <> OLD.user_id) THEN
      RAISE EXCEPTION 'Impossible : ce compte est le dernier superadmin (créez-en un autre avant de le supprimer ou de le rétrograder).'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS last_superadmin_guard ON multisports.app_profiles;
CREATE TRIGGER last_superadmin_guard
  BEFORE UPDATE OR DELETE ON multisports.app_profiles
  FOR EACH ROW EXECUTE FUNCTION multisports.guard_last_superadmin();

-- Accès de secours : la clé service_role (serveur uniquement) doit pouvoir écrire le profil.
GRANT USAGE ON SCHEMA multisports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON multisports.app_profiles TO service_role;

NOTIFY pgrst, 'reload schema';
