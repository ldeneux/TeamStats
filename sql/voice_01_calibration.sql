-- =====================================================================================
-- TEAMSTATS : calibrage de la commande vocale, enregistré PAR COMPTE (suit l'utilisateur d'un PC à une tablette).
-- À exécuter une fois (Supabase > SQL Editor). Rejouable sans risque.
-- Contenu : variantes de prononciation des prénoms et corrections de mots apprises au calibrage.
-- Aucune donnée audio n'est stockée : uniquement du texte (ex. « clauer » -> « chloé »).
-- Chaque compte ne voit et ne modifie QUE sa propre ligne.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS multisports.voice_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  aliases jsonb NOT NULL DEFAULT '{}'::jsonb,       -- { "chloe": ["clauer", "cloée"], ... } (clé = prénom sans accent, en minuscules)
  word_fixes jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { "poing": "points", ... } (mot entendu -> mot attendu)
  calibrated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE multisports.voice_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON multisports.voice_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON multisports.voice_profiles TO authenticated;

DROP POLICY IF EXISTS voice_profiles_own ON multisports.voice_profiles;
CREATE POLICY voice_profiles_own ON multisports.voice_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
