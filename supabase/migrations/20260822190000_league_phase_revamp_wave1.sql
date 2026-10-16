-- Wave 1: league phase revamp — bracket columns, guest players, enrollment tracking

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS bracket_side text NULL
    CHECK (bracket_side IS NULL OR bracket_side IN ('winners', 'losers', 'grand_finals')),
  ADD COLUMN IF NOT EXISTS bracket_pos integer NULL;

ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS bracket_side text NULL
    CHECK (bracket_side IS NULL OR bracket_side IN ('winners', 'losers', 'grand_finals'));

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS enrollment_source jsonb NULL;

COMMENT ON COLUMN players.is_guest IS 'Admin-created guest player without Discord/auth; claimable later.';
COMMENT ON COLUMN matches.bracket_side IS 'Elimination bracket lane: winners, losers, or grand_finals.';
COMMENT ON COLUMN matches.bracket_pos IS 'Vertical slot index within the round column for bracket rendering.';
COMMENT ON COLUMN rounds.bracket_side IS 'Elimination bracket lane for this round column.';
COMMENT ON COLUMN tournaments.enrollment_source IS 'Auto-enrollment sync state: { type, source_phase_id, synced_at, frozen }.';
