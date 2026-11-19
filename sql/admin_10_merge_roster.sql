-- =====================================================================================
-- TEAMSTATS : FUSION de l'effectif importé (stats_club_roster) et des joueuses TeamStats (stats_players).
-- À exécuter APRÈS admin_01 et admin_03 (et admin_08 si exécuté). Rejouable sans risque.
--
-- Une équipe chargée depuis le PDF et l'équipe TeamStats sont la MÊME équipe : la fiche joueuse est unique (stats_players)
-- et rassemble les infos des deux sources : numéro de maillot (TeamStats) + n° de licence, date de naissance, catégorie... (PDF).
--   - les joueuses déjà dans TeamStats sont rapprochées de l'effectif par nom (« Léa MARTIN » = Léa + MARTIN) et complétées ;
--   - les autres personnes de l'effectif sont créées dans l'équipe TeamStats liée (maillot 0 en attendant) ;
--   - l'encadrement est dans la même table (role = 'encadrement') et n'apparaît jamais dans les feuilles de match.
-- L'ancienne table stats_club_roster n'est plus utilisée par l'appli ; elle est CONSERVÉE (sauvegarde), rien n'est supprimé.
--
-- + fonction renfort_candidates() : permet à un coach de voir les joueuses (nom, numéro seulement) des autres équipes du club
--   pour constituer des renforts, sans lui ouvrir ces équipes.
-- =====================================================================================
ALTER TABLE multisports.stats_players
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS licence_number text,
  ADD COLUMN IF NOT EXISTS birthdate date,
  ADD COLUMN IF NOT EXISTS sexe text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS licence_type text,
  ADD COLUMN IF NOT EXISTS licence_category text,
  ADD COLUMN IF NOT EXISTS licence_date date,
  ADD COLUMN IF NOT EXISTS insurance text,
  ADD COLUMN IF NOT EXISTS extra text,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'joueur',
  ADD COLUMN IF NOT EXISTS is_coach boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stats_players_role_check') THEN
    ALTER TABLE multisports.stats_players ADD CONSTRAINT stats_players_role_check CHECK (role IN ('joueur', 'encadrement'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stats_players_sexe_check') THEN
    ALTER TABLE multisports.stats_players ADD CONSTRAINT stats_players_sexe_check CHECK (sexe IS NULL OR sexe IN ('F', 'M'));
  END IF;
END $$;

ALTER TABLE multisports.stats_players ALTER COLUMN number SET DEFAULT 0;   -- le PDF ne donne pas de numéro de maillot
CREATE UNIQUE INDEX IF NOT EXISTS stats_players_team_licence_uk ON multisports.stats_players (team_id, licence_number) WHERE licence_number IS NOT NULL;

-- Reprise de l'effectif déjà importé (si la table existe).
DO $$
BEGIN
  IF to_regclass('multisports.stats_club_roster') IS NULL THEN RETURN; END IF;
  EXECUTE $q$
    UPDATE multisports.stats_players p SET
      first_name = r.first_name, last_name = r.last_name, licence_number = r.licence_number, birthdate = r.birthdate, sexe = r.sexe,
      nationality = r.nationality, licence_type = r.licence_type, licence_category = r.licence_category, licence_date = r.licence_date,
      insurance = r.insurance, extra = r.extra, role = r.role, is_coach = COALESCE(r.is_coach, false)
    FROM multisports.stats_club_roster r
    JOIN multisports.stats_club_teams t ON t.id = r.club_team_id
    WHERE p.team_id = t.stats_team_id AND p.licence_number IS NULL
      AND lower(btrim(p.name)) IN (lower(btrim(r.first_name || ' ' || r.last_name)), lower(btrim(r.last_name || ' ' || r.first_name)))
      AND NOT EXISTS (SELECT 1 FROM multisports.stats_players q WHERE q.team_id = p.team_id AND q.licence_number = r.licence_number)
  $q$;
  EXECUTE $q$
    INSERT INTO multisports.stats_players
      (team_id, name, number, first_name, last_name, licence_number, birthdate, sexe, nationality, licence_type, licence_category, licence_date, insurance, extra, role, is_coach)
    SELECT t.stats_team_id, btrim(r.first_name || ' ' || r.last_name), 0, r.first_name, r.last_name, r.licence_number, r.birthdate, r.sexe, r.nationality,
           r.licence_type, r.licence_category, r.licence_date, r.insurance, r.extra, r.role, COALESCE(r.is_coach, false)
    FROM multisports.stats_club_roster r
    JOIN multisports.stats_club_teams t ON t.id = r.club_team_id
    WHERE t.stats_team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM multisports.stats_players q WHERE q.team_id = t.stats_team_id AND q.licence_number = r.licence_number)
  $q$;
END $$;

-- Renforts : joueuses (nom + numéro seulement) des équipes du club de la MÊME saison que l'équipe `p_target_team`.
-- Il faut avoir accès à `p_target_team`. Les équipes sans joueuse apparaissent avec player_id nul.
CREATE OR REPLACE FUNCTION multisports.renfort_candidates(p_target_team uuid)
RETURNS TABLE (club_team_id uuid, code text, label text, category text, sexe text, team_number integer, logo_asset text,
               is_target boolean, stats_team_id uuid, player_id uuid, player_name text, player_number integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = multisports, public
AS $$
DECLARE v_season text;
BEGIN
  IF NOT multisports.can_access_team(p_target_team) THEN
    RAISE EXCEPTION 'Accès refusé à cette équipe.' USING ERRCODE = '42501';
  END IF;
  SELECT t.season INTO v_season FROM multisports.stats_club_teams t WHERE t.stats_team_id = p_target_team LIMIT 1;
  IF v_season IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT t.id, t.code, t.label, t.category, t.sexe, t.team_number, t.logo_asset,
           (t.stats_team_id = p_target_team), t.stats_team_id, p.id, p.name, p.number
    FROM multisports.stats_club_teams t
    LEFT JOIN multisports.stats_players p ON p.team_id = t.stats_team_id AND p.role = 'joueur'
    WHERE t.season = v_season AND t.stats_team_id IS NOT NULL
    ORDER BY t.code, p.name;
END $$;
REVOKE ALL ON FUNCTION multisports.renfort_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.renfort_candidates(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
