-- =====================================================================================
-- CADENAS DE SAISIE D'UN MATCH (TeamStats)
-- À exécuter une fois dans l'éditeur SQL de Supabase (après sql/stats_save_atomic.sql).
--
-- Principe
--   * Quand on choisit un match dans la liste, l'appli pose un cadenas à son nom (nom du profil, sinon
--     la partie de l'e-mail avant « @ ») et à l'appareil utilisé.
--   * Tant que l'appli est ouverte sur ce match, elle confirme toutes les 90 s qu'elle le tient, et indique
--     la dernière activité (action saisie, chrono, score). Sans activité depuis 4 h, le cadenas est
--     considéré comme abandonné : n'importe qui le prend en un geste.
--   * Prendre la main sur un cadenas encore actif demande de taper « confirmation » (un admin n'a pas à le
--     faire). L'autre personne est alors prévenue « Votre saisie a été reprise » à son prochain battement
--     ou à son prochain enregistrement.
--   * Le cadenas est un CONFORT : la vraie protection reste la comparaison de version à l'enregistrement
--     (stats_save_atomic.sql). Sans réseau, ou si ce script n'est pas exécuté, l'appli fonctionne
--     comme avant, simplement sans cadenas.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS multisports.stats_match_locks (
  ffbb_match_id    text PRIMARY KEY,
  locked_by        uuid        NOT NULL,
  locked_by_name   text,
  device_id        text        NOT NULL,
  locked_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at     timestamptz NOT NULL DEFAULT now(),
  taken_from_name  text,
  taken_at         timestamptz
);

-- Lecture pour tout compte connecté (affichage des cadenas dans la liste) ; aucune écriture directe :
-- tout passe par les deux fonctions ci-dessous.
ALTER TABLE multisports.stats_match_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stats_match_locks_select ON multisports.stats_match_locks;
CREATE POLICY stats_match_locks_select ON multisports.stats_match_locks
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON multisports.stats_match_locks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON multisports.stats_match_locks TO authenticated;

-- Prend (ou confirme) le cadenas d'un match.
--   * personne ne le tient, ou c'est moi sur cet appareil, ou il est périmé  -> ok
--   * quelqu'un d'autre le tient et p_force est faux                          -> ok = false, status = 'locked'
--   * p_force vrai (après confirmation dans l'appli)                           -> je le reprends
-- p_idle_seconds : depuis combien de secondes l'appareil n'a eu aucune activité (évite de dépendre de son horloge).
CREATE OR REPLACE FUNCTION multisports.lock_take(
  p_ffbb          text,
  p_device        text,
  p_name          text    DEFAULT NULL,
  p_force         boolean DEFAULT false,
  p_idle_seconds  integer DEFAULT 0,
  p_stale_minutes integer DEFAULT 240
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = multisports, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_name  text;
  v_idle  interval;
  v_stale boolean;
  r       multisports.stats_match_locks%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Non connecté'; END IF;
  IF COALESCE(trim(p_ffbb), '') = '' OR COALESCE(trim(p_device), '') = '' THEN
    RAISE EXCEPTION 'Paramètres manquants';
  END IF;
  -- Un compte consultant (lecture seule) ne saisit pas : il ne pose pas de cadenas.
  IF EXISTS (SELECT 1 FROM multisports.app_profiles WHERE user_id = v_uid AND role = 'consultant') THEN
    RAISE EXCEPTION 'Compte en lecture seule';
  END IF;

  -- Ménage : les cadenas inactifs depuis plus de 3 jours disparaissent.
  DELETE FROM multisports.stats_match_locks WHERE last_activity_at < now() - interval '3 days';

  v_name := COALESCE(
    NULLIF((SELECT display_name FROM multisports.app_profiles WHERE user_id = v_uid), ''),
    NULLIF(trim(p_name), ''),
    'quelqu''un');
  v_idle := make_interval(secs => LEAST(GREATEST(COALESCE(p_idle_seconds, 0), 0), 86400));

  INSERT INTO multisports.stats_match_locks (ffbb_match_id, locked_by, locked_by_name, device_id, last_activity_at)
  VALUES (p_ffbb, v_uid, v_name, p_device, now() - v_idle)
  ON CONFLICT (ffbb_match_id) DO NOTHING;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'taken');
  END IF;

  SELECT * INTO r FROM multisports.stats_match_locks WHERE ffbb_match_id = p_ffbb FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'retry');   -- libéré entre-temps : l'appli réessaiera
  END IF;

  v_stale := r.last_activity_at < now() - make_interval(mins => GREATEST(COALESCE(p_stale_minutes, 240), 1));

  -- Déjà à moi, sur cet appareil : simple battement de cœur.
  IF r.locked_by = v_uid AND r.device_id = p_device THEN
    UPDATE multisports.stats_match_locks
       SET heartbeat_at     = now(),
           last_activity_at = GREATEST(last_activity_at, now() - v_idle),
           locked_by_name   = v_name
     WHERE ffbb_match_id = p_ffbb;
    RETURN jsonb_build_object('ok', true, 'status', 'mine');
  END IF;

  -- Cadenas abandonné (inactif depuis longtemps) ou prise de main confirmée.
  IF v_stale OR p_force THEN
    UPDATE multisports.stats_match_locks
       SET locked_by        = v_uid,
           locked_by_name   = v_name,
           device_id        = p_device,
           locked_at        = now(),
           heartbeat_at     = now(),
           last_activity_at = now() - v_idle,
           taken_from_name  = r.locked_by_name,
           taken_at         = now()
     WHERE ffbb_match_id = p_ffbb;
    RETURN jsonb_build_object(
      'ok', true,
      'status', CASE WHEN v_stale THEN 'taken_stale' ELSE 'forced' END,
      'previous_name', r.locked_by_name);
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'status', 'locked',
    'holder_name', r.locked_by_name,
    'locked_at', r.locked_at,
    'last_activity_at', r.last_activity_at,
    'same_user', r.locked_by = v_uid);
END;
$$;

-- Libère le cadenas : seulement celui que CET appareil tient.
CREATE OR REPLACE FUNCTION multisports.lock_release(p_ffbb text, p_device text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = multisports, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non connecté'; END IF;
  DELETE FROM multisports.stats_match_locks
   WHERE ffbb_match_id = p_ffbb AND locked_by = auth.uid() AND device_id = p_device;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

REVOKE ALL ON FUNCTION multisports.lock_take(text, text, text, boolean, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION multisports.lock_release(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION multisports.lock_take(text, text, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION multisports.lock_release(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
