-- =====================================================================================
-- TEAMSTATS : case « Coach » pour l'encadrement d'une équipe (effectif). À exécuter APRÈS admin_03_roster.sql. Rejouable sans risque.
-- Plusieurs coachs possibles par équipe ; le premier encadrant importé d'une équipe sans coach est coché par défaut (dans l'appli).
-- =====================================================================================
ALTER TABLE multisports.stats_club_roster ADD COLUMN IF NOT EXISTS is_coach boolean NOT NULL DEFAULT false;
NOTIFY pgrst, 'reload schema';
