-- =====================================================================================
-- TEAMSTATS : enregistrement d'un match en UNE SEULE opération (atomique) + détection des écrasements.
-- À exécuter dans l'éditeur SQL de Supabase. Rejouable sans risque. L'appli continue de fonctionner
-- (ancienne méthode) tant que ce script n'a pas été exécuté ; après, elle l'utilise toute seule.
--
-- Ce que ça change :
--  1) ATOMIQUE : le match, ses événements et ses statistiques sont réécrits dans une même transaction.
--     Deux enregistrements simultanés ne peuvent plus s'entrecroiser (doublons, mélange).
--  2) VERSION : chaque match porte un numéro de version (save_version), le nom de la dernière personne
--     qui l'a enregistré (saved_by_name) et la date (saved_at). L'appli envoie la version qu'elle a vue :
--     si quelqu'un a enregistré entre-temps, l'enregistrement est REFUSÉ et l'appli demande confirmation
--     avant d'écraser. Plus d'écrasement silencieux.
--
-- Les règles de sécurité existantes (RLS, saisons clôturées) continuent de s'appliquer : la fonction
-- s'exécute avec les droits de la personne connectée (SECURITY INVOKER).
-- =====================================================================================

ALTER TABLE multisports.stats_matches
  ADD COLUMN IF NOT EXISTS save_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saved_by uuid,
  ADD COLUMN IF NOT EXISTS saved_by_name text,
  ADD COLUMN IF NOT EXISTS saved_at timestamptz;

-- Matchs déjà enregistrés : version 1 (un nouveau match, créé sans connaître la base, sera donc détecté).
UPDATE multisports.stats_matches
   SET save_version = 1, saved_at = COALESCE(saved_at, created_at)
 WHERE save_version = 0;

-- Insère des lignes JSON dans une table de statistiques du match. Seules les clés qui sont des colonnes
-- existantes sont utilisées (les colonnes steals / turnovers… peuvent ne pas exister : pas d'erreur).
CREATE OR REPLACE FUNCTION multisports.save_rows(p_table regclass, p_match uuid, p_rows jsonb)
RETURNS void LANGUAGE plpgsql
SET search_path = multisports, public
AS $$
DECLARE cols text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RETURN; END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
    FROM pg_attribute a
   WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'match_id'
     AND a.attname IN (SELECT jsonb_object_keys(p_rows -> 0));
  IF cols IS NULL THEN RETURN; END IF;
  EXECUTE format('INSERT INTO %s (match_id, %s) SELECT $1, %s FROM jsonb_populate_recordset(NULL::%s, $2)', p_table, cols, cols, p_table)
    USING p_match, p_rows;
END $$;

CREATE OR REPLACE FUNCTION multisports.save_match_stats(
  p_match jsonb,                    -- la ligne du match (mêmes colonnes que stats_matches)
  p_events jsonb,                   -- événements (stats_match_events), sans match_id
  p_totals jsonb,                   -- totaux par joueuse (stats_player_game_stats), sans match_id
  p_periods jsonb,                  -- statistiques par joueuse et période (stats_player_period_stats), sans match_id
  p_expected_version integer DEFAULT NULL,   -- version vue par l'appli (0 = « je crée ce match ») ; NULL = ne pas vérifier
  p_force boolean DEFAULT false,             -- true = écraser malgré un enregistrement plus récent (après confirmation)
  p_saved_by_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = multisports, public
AS $$
DECLARE
  v_ffbb text := p_match ->> 'ffbb_match_id';
  v_id uuid; v_ver integer; v_by uuid; v_by_name text; v_at timestamptz;
  v_name text; v_new integer; v_update boolean := false;
BEGIN
  IF v_ffbb IS NULL OR v_ffbb = '' THEN RAISE EXCEPTION 'ffbb_match_id manquant'; END IF;
  v_name := COALESCE(NULLIF((SELECT display_name FROM multisports.app_profiles WHERE user_id = auth.uid()), ''),
                     NULLIF(trim(p_saved_by_name), ''), 'quelqu''un');

  -- Verrou sur la ligne du match : deux enregistrements du même match se font l'un après l'autre.
  SELECT id, save_version, saved_by, saved_by_name, saved_at INTO v_id, v_ver, v_by, v_by_name, v_at
    FROM multisports.stats_matches WHERE ffbb_match_id = v_ffbb FOR UPDATE;

  IF NOT FOUND THEN
    v_id := NULL;
    INSERT INTO multisports.stats_matches (ffbb_match_id, match_date, team_home, team_away, score_home, score_away,
                                           period_count, period_minutes, current_period, current_timer,
                                           save_version, saved_by, saved_by_name, saved_at)
    SELECT m.ffbb_match_id, m.match_date, m.team_home, m.team_away, m.score_home, m.score_away,
           m.period_count, m.period_minutes, m.current_period, m.current_timer, 1, auth.uid(), v_name, now()
      FROM jsonb_populate_record(NULL::multisports.stats_matches, p_match) m
    ON CONFLICT (ffbb_match_id) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      v_new := 1;
    ELSE   -- quelqu'un vient de créer ce même match
      SELECT id, save_version, saved_by, saved_by_name, saved_at INTO v_id, v_ver, v_by, v_by_name, v_at
        FROM multisports.stats_matches WHERE ffbb_match_id = v_ffbb FOR UPDATE;
      v_update := true;
    END IF;
  ELSE
    v_update := true;
  END IF;

  IF v_update THEN
    IF NOT p_force AND p_expected_version IS NOT NULL AND p_expected_version <> v_ver THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true, 'version', v_ver, 'saved_by_name', v_by_name,
                                'saved_at', v_at, 'mine', (v_by IS NOT NULL AND v_by = auth.uid()));
    END IF;
    UPDATE multisports.stats_matches s
       SET match_date = m.match_date, team_home = m.team_home, team_away = m.team_away,
           score_home = m.score_home, score_away = m.score_away, period_count = m.period_count,
           period_minutes = m.period_minutes, current_period = m.current_period, current_timer = m.current_timer,
           save_version = v_ver + 1, saved_by = auth.uid(), saved_by_name = v_name, saved_at = now()
      FROM jsonb_populate_record(NULL::multisports.stats_matches, p_match) m
     WHERE s.id = v_id;
    v_new := v_ver + 1;
  END IF;

  DELETE FROM multisports.stats_match_events WHERE match_id = v_id;
  DELETE FROM multisports.stats_player_game_stats WHERE match_id = v_id;
  DELETE FROM multisports.stats_player_period_stats WHERE match_id = v_id;
  PERFORM multisports.save_rows('multisports.stats_match_events'::regclass, v_id, p_events);
  PERFORM multisports.save_rows('multisports.stats_player_game_stats'::regclass, v_id, p_totals);
  PERFORM multisports.save_rows('multisports.stats_player_period_stats'::regclass, v_id, p_periods);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'version', v_new);
END $$;

REVOKE ALL ON FUNCTION multisports.save_rows(regclass, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION multisports.save_match_stats(jsonb, jsonb, jsonb, jsonb, integer, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.save_rows(regclass, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION multisports.save_match_stats(jsonb, jsonb, jsonb, jsonb, integer, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
