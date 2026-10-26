-- League recycle bin, part 4 of 6: the match_evolution_snapshots.tracker_id key (a deleted tracker checks this table).
-- One statement and no transaction on purpose: CREATE INDEX CONCURRENTLY refuses to run inside a transaction and the
-- CLI sends a file as a pipeline, so a second statement (even SET lock_timeout) makes it fail. When applying by hand,
-- run `SET lock_timeout = '5s';` in the same session first. A failed concurrent build leaves an INVALID index behind
-- (find it with SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid; drop it and run this again).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_evolution_snapshots_tracker_id ON public.match_evolution_snapshots (tracker_id);
