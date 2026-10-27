-- Fingerprints for the league-trash lab (LOCAL stack only).
--   lt_lab.fp(season)      per owned table: row count + md5 over the league's rows, minus the columns that legitimately
--                          change across delete + restore (shifted clocks, the aggregate marker, paused-pool columns).
--   lt_lab.others(season)  row counts of every table outside the inventory (and outside the trash tables): a delete and a
--                          restore must leave them as they were.
CREATE SCHEMA IF NOT EXISTS lt_lab;

CREATE OR REPLACE FUNCTION lt_lab.fp(p_season uuid)
RETURNS TABLE (rel text, n bigint, h text) LANGUAGE plpgsql AS $$
DECLARE r record; v_excl text[];
BEGIN
  FOR r IN SELECT i.rel, i.pred FROM public.league_trash__inventory() i WHERE i.cls = 'owned' ORDER BY i.rel LOOP
    v_excl := CASE r.rel
      WHEN 'draft_pools' THEN ARRAY['paused_at','paused_by','pause_reason','state_version','updated_at','submission_deadline_at','token_purchase_closes_at']
      WHEN 'draft_slots' THEN ARRAY['deadline_at','remaining_ms_at_pause']
      WHEN 'matches' THEN ARRAY['auto_confirm_at']
      WHEN 'rounds' THEN ARRAY['deadline']
      WHEN 'match_proposals' THEN ARRAY['expires_at']
      WHEN 'games' THEN ARRAY['aggregate_applied_at']
      ELSE ARRAY[]::text[] END;
    RETURN QUERY EXECUTE format('SELECT %L::text, count(*), coalesce(md5(string_agg((to_jsonb(t) - $2)::text, ''|'' ORDER BY (to_jsonb(t) - $2)::text)), ''-'') FROM public.%I t WHERE %s',
      r.rel, r.rel, public.league_trash__x(r.pred)) USING p_season, v_excl;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION lt_lab.others(p_season uuid)
RETURNS TABLE (k text, v text) LANGUAGE plpgsql AS $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname NOT LIKE 'league_trash%'
     AND c.relname NOT IN (SELECT i.rel FROM public.league_trash__inventory() i WHERE i.cls IN ('owned','derived')) ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    k := r.relname; v := n::text; RETURN NEXT;
  END LOOP;
END $$;
