-- =====================================================================================
-- TEAMSTATS : apprentissages de la commande vocale PARTAGÉS entre tous les comptes du club.
-- À exécuter APRÈS voice_01_calibration.sql. Rejouable sans risque.
-- Chaque calibrage / chaque variante de prénom apprise par un compte alimente cette table ; tous les comptes en profitent.
-- Contenu : du TEXTE uniquement (variantes de prénoms, corrections de mots). Aucune photo, aucune donnée sur les joueuses :
-- seulement des prénoms déjà présents dans les effectifs, jamais affichés dans l'application (visibles en base seulement).
-- Écriture uniquement par la fonction voice_share (contrôlée) ; suppression réservée aux administrateurs.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS multisports.voice_shared (
  kind text NOT NULL CHECK (kind IN ('alias', 'fix')),
  key text NOT NULL,                    -- alias : prénom normalisé ; fix : mot entendu (normalisé)
  value text NOT NULL,                  -- alias : variante entendue ; fix : mot attendu
  uses integer NOT NULL DEFAULT 1,      -- nombre de fois où cet apprentissage a été confirmé
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key, value)
);

ALTER TABLE multisports.voice_shared ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON multisports.voice_shared FROM anon;
REVOKE INSERT, UPDATE ON multisports.voice_shared FROM authenticated;
GRANT SELECT, DELETE ON multisports.voice_shared TO authenticated;

DROP POLICY IF EXISTS voice_shared_read ON multisports.voice_shared;
DROP POLICY IF EXISTS voice_shared_delete ON multisports.voice_shared;
CREATE POLICY voice_shared_read ON multisports.voice_shared FOR SELECT TO authenticated USING (true);
CREATE POLICY voice_shared_delete ON multisports.voice_shared FOR DELETE TO authenticated USING (multisports.is_admin());

-- p_entries : [{"kind":"alias","key":"chloe","value":"clauer"}, {"kind":"fix","key":"poing","value":"points"}, ...]
CREATE OR REPLACE FUNCTION multisports.voice_share(p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = multisports, public AS $$
DECLARE e jsonb; k text; kk text; v text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'non connecté'; END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) > 300 THEN RAISE EXCEPTION 'liste invalide'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    k := e->>'kind'; kk := e->>'key'; v := e->>'value';
    CONTINUE WHEN k NOT IN ('alias', 'fix') OR kk IS NULL OR v IS NULL OR kk = v;
    CONTINUE WHEN kk !~ '^[a-z0-9 ]{1,40}$' OR v !~ '^[a-z0-9 ]{1,40}$';   -- texte normalisé uniquement
    INSERT INTO multisports.voice_shared (kind, key, value) VALUES (k, kk, v)
    ON CONFLICT (kind, key, value) DO UPDATE SET uses = multisports.voice_shared.uses + 1, updated_at = now();
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION multisports.voice_share(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION multisports.voice_share(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
