-- =====================================================================================
-- TEAMSTATS : effectifs des équipes du club (import du trombinoscope PDF de l'extranet FFBB).
-- À exécuter APRÈS admin_01_club_calendar.sql. Rejouable sans risque.
-- Données personnelles (nom, licence, date de naissance, y compris de mineurs) : lecture réservée aux
-- admin / superadmin et aux comptes affectés à l'équipe ; écriture réservée aux admin / superadmin.
-- Les photos du PDF ne sont jamais lues ni enregistrées.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS multisports.stats_club_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_team_id uuid NOT NULL REFERENCES multisports.stats_club_teams (id) ON DELETE CASCADE,
  licence_number text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  birthdate date,
  sexe text CHECK (sexe IN ('F', 'M')),
  nationality text,
  licence_type text,                         -- « 0C »
  licence_category text,                     -- « U11 », « Seniors » (catégorie de la licence)
  licence_date date,
  insurance text,
  extra text,                                -- information supplémentaire de la fiche (ex. « D11 »)
  role text NOT NULL DEFAULT 'joueur' CHECK (role IN ('joueur', 'encadrement')),
  is_coach boolean NOT NULL DEFAULT false,   -- encadrement : coach de l'équipe (plusieurs possibles)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_team_id, licence_number)      -- une personne peut figurer dans 2 équipes (surclassement)
);
CREATE INDEX IF NOT EXISTS stats_club_roster_team_idx ON multisports.stats_club_roster (club_team_id);

ALTER TABLE multisports.stats_club_roster ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON multisports.stats_club_roster FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON multisports.stats_club_roster TO authenticated;

DROP POLICY IF EXISTS club_roster_read ON multisports.stats_club_roster;
DROP POLICY IF EXISTS club_roster_write ON multisports.stats_club_roster;
CREATE POLICY club_roster_read ON multisports.stats_club_roster
  FOR SELECT TO authenticated USING (multisports.can_access_club_team(club_team_id));
CREATE POLICY club_roster_write ON multisports.stats_club_roster
  FOR ALL TO authenticated USING (multisports.is_admin()) WITH CHECK (multisports.is_admin());

NOTIFY pgrst, 'reload schema';
