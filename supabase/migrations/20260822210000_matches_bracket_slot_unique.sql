-- Partial unique index so concurrent bracket materialization cannot
-- insert two matches into the same (round, side, pos) slot.
CREATE UNIQUE INDEX IF NOT EXISTS matches_round_side_pos_unique
  ON public.matches (round_id, bracket_side, bracket_pos)
  WHERE bracket_pos IS NOT NULL;
