-- Matchs à venir de chaque équipe (calendrier tenu dans l'appli principale), lisibles par
-- l'appli de suivi de match sans ouvrir la table basketball_matches (RLS) en lecture.
-- À exécuter dans l'éditeur SQL de Supabase.
--
-- Ne renvoie que les matchs au statut 'a_venir' (ou datés d'au plus 1 jour dans le passé, au cas
-- où le statut n'aurait pas encore été mis à jour), avec un identifiant FFBB, sans doublon.
-- "category" (ex. U15F) et "our_team_name" servent à retrouver notre équipe côté appli.

CREATE OR REPLACE FUNCTION multisports.list_upcoming_ffbb_matches()
RETURNS TABLE (
  ffbb_rencontre_id text,
  match_date timestamptz,
  opponent text,
  home_away text,
  location text,
  division_label text,
  numero_journee text,
  season text,
  our_team_name text,
  category text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = multisports, public
AS $$
  SELECT t.*
  FROM (
    SELECT DISTINCT ON (m.ffbb_rencontre_id)
      m.ffbb_rencontre_id,
      m.match_date,
      m.opponent,
      m.home_away,
      m.location,
      m.division_label,
      m.numero_journee,
      m.season,
      ph.our_team_name,
      ps.category
    FROM multisports.basketball_matches m
    LEFT JOIN multisports.basketball_phases ph ON ph.id = m.phase_id
    LEFT JOIN multisports.participant_sports ps ON ps.id = m.participant_sport_id
    WHERE m.status = 'a_venir'
      AND m.ffbb_rencontre_id IS NOT NULL
      AND m.match_date IS NOT NULL
      AND m.match_date >= now() - interval '1 day'
    ORDER BY m.ffbb_rencontre_id, m.match_date
  ) t
  ORDER BY t.match_date
  LIMIT 300;
$$;

REVOKE ALL ON FUNCTION multisports.list_upcoming_ffbb_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION multisports.list_upcoming_ffbb_matches() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
