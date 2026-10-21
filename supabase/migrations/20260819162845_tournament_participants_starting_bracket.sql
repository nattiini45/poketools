ALTER TABLE tournament_participants ADD COLUMN starting_bracket text NOT NULL DEFAULT 'winners' CHECK (starting_bracket IN ('winners','losers'));
