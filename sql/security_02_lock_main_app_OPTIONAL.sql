-- =====================================================================================
-- OPTIONNEL MAIS IMPORTANT : fermer l'appli principale (Multisports) aux nouveaux comptes.
--
-- Le compte Supabase est PARTAGÉ entre toutes les applis du projet. Dans l'appli principale, les
-- tables sont ouvertes à n'importe quel compte connecté (politique « authenticated_full_access »).
-- Sans ce script, un analyst créé pour TeamStats pourrait, via l'API, lire ou modifier les données
-- de la famille (participants, documents, natation, basket...).
--
-- Ce script remplace ces politiques par « réservé aux comptes de profil admin ».
-- À exécuter APRÈS security_01_profiles_and_rls.sql, et seulement quand tous les comptes de la
-- famille qui utilisent l'appli principale ont le profil admin (voir l'étape 2 de security_01).
-- Si vous exécutez ce script trop tôt, l'appli principale affichera des listes vides.
-- =====================================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'multisports'
      AND policyname = 'authenticated_full_access'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    EXECUTE format(
      'CREATE POLICY family_admin_only ON %I.%I FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin())',
      r.schemaname, r.tablename
    );
  END LOOP;
END $$;

-- Vérification : cette requête ne doit plus montrer que des politiques voulues.
-- Toute ligne dont « qual » vaut « true » ou « (auth.role() = 'authenticated') » reste ouverte à tout compte connecté.
--   SELECT tablename, policyname, roles, cmd, qual
--   FROM pg_policies WHERE schemaname = 'multisports' ORDER BY tablename, policyname;
--
-- Reste à traiter à la main si vous les utilisez : les stockages de fichiers (Storage > Policies :
-- buckets documents / vidéos) ont probablement la même règle « tout compte connecté ».
-- Et, dans Authentication > Sign In / Providers, désactiver « Allow new users to sign up »
-- pour que personne ne puisse se créer un compte seul.

NOTIFY pgrst, 'reload schema';
