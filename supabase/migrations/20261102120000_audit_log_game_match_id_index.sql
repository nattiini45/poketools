-- Admin match history: the game events of one match (resource_type 'game', metadata.match_id), newest first.
-- listMatchAuditEvents filters them with metadata->>'match_id', which no existing index covers, so the read scanned
-- audit_log; this partial index serves that branch and its created_at order.
-- One statement and no transaction on purpose: CREATE INDEX CONCURRENTLY refuses to run inside a transaction and the
-- CLI sends a file as a pipeline, so a second statement (even SET lock_timeout) makes it fail. When applying by hand,
-- run SET lock_timeout = '5s'; in the same session first. A failed concurrent build leaves an INVALID index behind
-- (find it with SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid; DROP INDEX CONCURRENTLY it and run
-- this again).
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_game_match_id_idx ON public.audit_log ((metadata->>'match_id'), created_at DESC) WHERE resource_type = 'game';
