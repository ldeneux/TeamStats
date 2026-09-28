-- Recherche d'un match par ID FFBB, utilisable par l'appli sans ouvrir la table
-- basketball_matches (RLS) en lecture : seules 4 colonnes sont renvoyées, pour un ID exact.
-- À exécuter dans l'éditeur SQL de Supabase.

CREATE OR REPLACE FUNCTION multisports.lookup_ffbb_match(p_ffbb_id text)
RETURNS TABLE (opponent text, home_away text, match_date timestamptz, division_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT m.opponent, m.home_away, m.match_date, m.division_label
  FROM multisports.basketball_matches m
  WHERE m.ffbb_rencontre_id = p_ffbb_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION multisports.lookup_ffbb_match(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION multisports.lookup_ffbb_match(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
