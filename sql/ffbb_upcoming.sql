-- Matchs à venir de NOS équipes (calendrier tenu dans l'appli principale), lisibles par l'appli de
-- suivi de match sans ouvrir la table basketball_matches (RLS) en lecture.
-- À exécuter dans l'éditeur SQL de Supabase APRÈS sql/security_01_profiles_and_rls.sql (cette fonction s'appuie sur
-- is_admin() et team_access : un analyste ne voit que les matchs à venir des catégories de ses équipes autorisées).
--
-- IMPORTANT : l'appli principale synchronise TOUTE la poule (les matchs des autres équipes aussi).
-- us_is_team1 n'est renseigné (true/false) QUE pour les matchs qui nous concernent : sans ce filtre,
-- la liste affichait n'importe quel match de la poule (ex. 3 matchs le même jour pour une seule équipe).
-- Même convention que le calendrier de l'appli principale : équipe 1 = domicile ;
-- l'adversaire est l'autre équipe ; pas d'adversaire = exempt (ligne ignorée).
--
-- Ne renvoie que les matchs au statut 'a_venir' (ou datés d'au plus 1 jour dans le passé, au cas
-- où le statut n'aurait pas encore été mis à jour), avec un identifiant FFBB, sans doublon.
-- "category" (ex. U15F) et "our_team_name" servent à retrouver notre équipe côté appli.

DROP FUNCTION IF EXISTS multisports.list_upcoming_ffbb_matches();

CREATE FUNCTION multisports.list_upcoming_ffbb_matches()
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
      CASE WHEN m.us_is_team1 THEN m.team2_name ELSE m.team1_name END AS opponent,
      CASE WHEN m.us_is_team1 THEN 'domicile' ELSE 'exterieur' END AS home_away,
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
      AND m.us_is_team1 IS NOT NULL
      AND m.ffbb_rencontre_id IS NOT NULL
      AND m.match_date IS NOT NULL
      AND m.match_date >= now() - interval '1 day'
      AND COALESCE(CASE WHEN m.us_is_team1 THEN m.team2_name ELSE m.team1_name END, '') <> ''
      -- Admin : tout. Analyst : seulement les catégories (ex. U15F) présentes dans le nom de ses équipes autorisées.
      AND (
        multisports.is_admin()
        OR (
          ps.category IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM multisports.team_access a
            JOIN multisports.stats_teams t ON t.id = a.team_id
            WHERE a.user_id = auth.uid()
              AND upper(t.name) LIKE '%' || upper(ps.category) || '%'
          )
        )
      )
    ORDER BY m.ffbb_rencontre_id, m.match_date
  ) t
  ORDER BY t.match_date
  LIMIT 300;
$$;

REVOKE ALL ON FUNCTION multisports.list_upcoming_ffbb_matches() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION multisports.list_upcoming_ffbb_matches() FROM anon;
GRANT EXECUTE ON FUNCTION multisports.list_upcoming_ffbb_matches() TO authenticated;

NOTIFY pgrst, 'reload schema';
