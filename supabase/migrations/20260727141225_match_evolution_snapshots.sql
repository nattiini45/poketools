-- Match Evolution Snapshots
-- Stores the evolution state of each roster slot at the time of a match.
-- Historical match pages use this to show the form that was actually used,
-- preventing later evolutions or redrafts from retroactively changing old pages.
--
-- All *_delta columns hold per-matchday deltas derived from evo_progress_log,
-- NOT cumulative tracker totals.

CREATE TABLE IF NOT EXISTS match_evolution_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id),
  tracker_id uuid REFERENCES evolution_tracker(id) ON DELETE SET NULL,
  base_pokemon text NOT NULL,
  species_at_match text NOT NULL,
  stage_at_match smallint NOT NULL,
  progress_before int NOT NULL DEFAULT 0,
  progress_after int NOT NULL DEFAULT 0,
  real_kos smallint NOT NULL DEFAULT 0,
  draft_tokens_delta smallint NOT NULL DEFAULT 0,
  kill_tokens_delta smallint NOT NULL DEFAULT 0,
  cosmo_points_delta smallint NOT NULL DEFAULT 0,
  evolution_triggered boolean NOT NULL DEFAULT false,
  suspension_triggered boolean NOT NULL DEFAULT false,
  brought boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Natural key: all NOT NULL so re-finalize upserts resolve deterministically
  -- (tracker_id is nullable via ON DELETE SET NULL and must not be part of it)
  UNIQUE(match_id, player_id, base_pokemon)
);

-- Index for fast lookup by match
CREATE INDEX IF NOT EXISTS idx_match_evolution_snapshots_match
  ON match_evolution_snapshots(match_id);

-- Index for player history queries
CREATE INDEX IF NOT EXISTS idx_match_evolution_snapshots_player
  ON match_evolution_snapshots(player_id, created_at DESC);

COMMENT ON TABLE match_evolution_snapshots IS
  'Point-in-time snapshot of evolution tracker state per match appearance. '
  'Written by the match evaluator; read by the match detail page.';

COMMENT ON COLUMN match_evolution_snapshots.species_at_match IS
  'Form actually used in the match (pre-evolution form when the line evolved this matchday).';
COMMENT ON COLUMN match_evolution_snapshots.real_kos IS
  'Real KOs credited to this line this matchday (from evo_progress_log real_kill entries).';
COMMENT ON COLUMN match_evolution_snapshots.draft_tokens_delta IS
  'Progress gained this matchday from draft tokens (per-matchday delta, not cumulative).';
COMMENT ON COLUMN match_evolution_snapshots.kill_tokens_delta IS
  'Progress gained this matchday from kill tokens (per-matchday delta, not cumulative).';
COMMENT ON COLUMN match_evolution_snapshots.cosmo_points_delta IS
  'Progress gained this matchday from cosmo points (per-matchday delta, not cumulative).';
COMMENT ON COLUMN match_evolution_snapshots.suspension_triggered IS
  'True when this match triggered the early stage-3 suspension for the next matchday.';
COMMENT ON COLUMN match_evolution_snapshots.brought IS
  'True when a form of this line appeared in the match battle stats.';
