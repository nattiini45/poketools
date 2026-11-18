CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_phase_game_match_id_idx ON public.audit_log ((metadata->>'match_id'), created_at DESC) WHERE resource_type = 'phase_game';
