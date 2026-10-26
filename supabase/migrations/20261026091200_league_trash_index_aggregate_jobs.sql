-- League recycle bin, part 3 of 6: the aggregate_jobs.game_id key. The existing index is partial (pending / processing only), which the referential check of a deleted game cannot use; aggregate_jobs holds one row per game ever played, so without this every deleted game scans the whole table.
-- One statement and no transaction on purpose: CREATE INDEX CONCURRENTLY refuses to run inside a transaction and the
-- CLI sends a file as a pipeline, so a second statement (even SET lock_timeout) makes it fail. When applying by hand,
-- run `SET lock_timeout = '5s';` in the same session first. A failed concurrent build leaves an INVALID index behind
-- (find it with SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid; drop it and run this again).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aggregate_jobs_game_id_all ON public.aggregate_jobs (game_id);
