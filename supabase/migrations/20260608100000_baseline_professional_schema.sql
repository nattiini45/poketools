
-- Baseline public schema.
-- Replaces 56 earlier incremental migrations.
-- Generated via: supabase db dump --linked --schema public

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."aggregate_scope" AS ENUM (
    'tournament',
    'league',
    'all_time'
);


ALTER TYPE "public"."aggregate_scope" OWNER TO "postgres";


CREATE TYPE "public"."bracket_type" AS ENUM (
    'single_elim',
    'double_elim',
    'round_robin',
    'swiss'
);


ALTER TYPE "public"."bracket_type" OWNER TO "postgres";


CREATE TYPE "public"."draft_pool_status" AS ENUM (
    'pending',
    'in_progress',
    'complete'
);


ALTER TYPE "public"."draft_pool_status" OWNER TO "postgres";


CREATE TYPE "public"."draft_type" AS ENUM (
    'snake',
    'auction',
    'budget'
);


ALTER TYPE "public"."draft_type" OWNER TO "postgres";


CREATE TYPE "public"."game_source" AS ENUM (
    'ps_replay',
    'manual',
    'champions'
);


ALTER TYPE "public"."game_source" OWNER TO "postgres";


CREATE TYPE "public"."match_proposal_status" AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'expired',
    'cancelled'
);


ALTER TYPE "public"."match_proposal_status" OWNER TO "postgres";


CREATE TYPE "public"."match_status" AS ENUM (
    'scheduled',
    'in_progress',
    'pending_confirmation',
    'completed',
    'disputed'
);


ALTER TYPE "public"."match_status" OWNER TO "postgres";


CREATE TYPE "public"."round_status" AS ENUM (
    'pending',
    'active',
    'completed'
);


ALTER TYPE "public"."round_status" OWNER TO "postgres";


CREATE TYPE "public"."season_format_type" AS ENUM (
    'singles',
    'doubles',
    'draft'
);


ALTER TYPE "public"."season_format_type" OWNER TO "postgres";


CREATE TYPE "public"."season_status" AS ENUM (
    'upcoming',
    'active',
    'completed'
);


ALTER TYPE "public"."season_status" OWNER TO "postgres";


CREATE TYPE "public"."team_import_source" AS ENUM (
    'pokepastes',
    'manual',
    'ps_text'
);


ALTER TYPE "public"."team_import_source" OWNER TO "postgres";


CREATE TYPE "public"."team_visibility" AS ENUM (
    'hidden_until_match',
    'always_public'
);


ALTER TYPE "public"."team_visibility" OWNER TO "postgres";


CREATE TYPE "public"."tournament_status" AS ENUM (
    'upcoming',
    'active',
    'completed'
);


ALTER TYPE "public"."tournament_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_decrement_aggregates"("p_deltas" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  d jsonb;
  v_id uuid;
  v_new_appearances int;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    SELECT id, GREATEST(0, total_appearances - (d->>'appearances')::int)
    INTO v_id, v_new_appearances
    FROM aggregates
    WHERE scope_type = (d->>'scope_type')::aggregate_scope
      AND COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          COALESCE((d->>'scope_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND pokemon_name = d->>'pokemon_name';

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_new_appearances = 0 THEN
      DELETE FROM aggregates WHERE id = v_id;
    ELSE
      UPDATE aggregates SET
        total_appearances = v_new_appearances,
        total_brought = GREATEST(0, total_brought - (d->>'brought')::int),
        total_led = GREATEST(0, total_led - (d->>'led')::int),
        total_kos_dealt = GREATEST(0, total_kos_dealt - (d->>'kos_dealt')::int),
        total_koed = GREATEST(0, total_koed - (d->>'koed')::int),
        total_wins = GREATEST(0, total_wins - (d->>'wins')::int),
        total_games = GREATEST(0, total_games - (d->>'games')::int),
        move_counts = subtract_move_counts(move_counts, d->'move_counts'),
        last_updated = now()
      WHERE id = v_id;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."batch_decrement_aggregates"("p_deltas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_decrement_player_aggregates"("p_deltas" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  d jsonb;
  v_id uuid;
  v_new_appearances int;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    SELECT id, GREATEST(0, total_appearances - (d->>'appearances')::int)
    INTO v_id, v_new_appearances
    FROM player_aggregates
    WHERE scope_type = (d->>'scope_type')::aggregate_scope
      AND COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          COALESCE((d->>'scope_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND player_id = (d->>'player_id')::uuid
      AND pokemon_name = d->>'pokemon_name';

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_new_appearances = 0 THEN
      DELETE FROM player_aggregates WHERE id = v_id;
    ELSE
      UPDATE player_aggregates SET
        total_appearances = v_new_appearances,
        total_brought = GREATEST(0, total_brought - (d->>'brought')::int),
        total_led = GREATEST(0, total_led - (d->>'led')::int),
        total_kos_dealt = GREATEST(0, total_kos_dealt - (d->>'kos_dealt')::int),
        total_koed = GREATEST(0, total_koed - (d->>'koed')::int),
        total_wins = GREATEST(0, total_wins - (d->>'wins')::int),
        total_games = GREATEST(0, total_games - (d->>'games')::int),
        move_counts = subtract_move_counts(move_counts, d->'move_counts'),
        last_updated = now()
      WHERE id = v_id;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."batch_decrement_player_aggregates"("p_deltas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_update_seeds"("p_tournament_id" "uuid", "p_seeds" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE tournament_participants tp
  SET seed = (s.value->>'seed')::int
  FROM jsonb_array_elements(p_seeds) AS s(value)
  WHERE tp.tournament_id = p_tournament_id
    AND tp.player_id = (s.value->>'player_id')::uuid;
END;
$$;


ALTER FUNCTION "public"."batch_update_seeds"("p_tournament_id" "uuid", "p_seeds" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_upsert_aggregates"("p_deltas" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  d jsonb;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    INSERT INTO aggregates (
      scope_type, scope_id, pokemon_name,
      total_appearances, total_brought, total_led,
      total_kos_dealt, total_koed, total_wins, total_games,
      move_counts, last_updated
    ) VALUES (
      (d->>'scope_type')::aggregate_scope,
      (d->>'scope_id')::uuid,
      d->>'pokemon_name',
      (d->>'appearances')::int,
      (d->>'brought')::int,
      (d->>'led')::int,
      (d->>'kos_dealt')::int,
      (d->>'koed')::int,
      (d->>'wins')::int,
      (d->>'games')::int,
      COALESCE(d->'move_counts', '{}'::jsonb),
      now()
    )
    ON CONFLICT (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), pokemon_name)
    DO UPDATE SET
      total_appearances = aggregates.total_appearances + EXCLUDED.total_appearances,
      total_brought = aggregates.total_brought + EXCLUDED.total_brought,
      total_led = aggregates.total_led + EXCLUDED.total_led,
      total_kos_dealt = aggregates.total_kos_dealt + EXCLUDED.total_kos_dealt,
      total_koed = aggregates.total_koed + EXCLUDED.total_koed,
      total_wins = aggregates.total_wins + EXCLUDED.total_wins,
      total_games = aggregates.total_games + EXCLUDED.total_games,
      move_counts = merge_move_counts(aggregates.move_counts, EXCLUDED.move_counts),
      last_updated = now();
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."batch_upsert_aggregates"("p_deltas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_upsert_player_aggregates"("p_deltas" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  d jsonb;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    INSERT INTO player_aggregates (
      scope_type, scope_id, player_id, pokemon_name,
      total_appearances, total_brought, total_led,
      total_kos_dealt, total_koed, total_wins, total_games,
      move_counts, last_updated
    ) VALUES (
      (d->>'scope_type')::aggregate_scope,
      (d->>'scope_id')::uuid,
      (d->>'player_id')::uuid,
      d->>'pokemon_name',
      (d->>'appearances')::int,
      (d->>'brought')::int,
      (d->>'led')::int,
      (d->>'kos_dealt')::int,
      (d->>'koed')::int,
      (d->>'wins')::int,
      (d->>'games')::int,
      COALESCE(d->'move_counts', '{}'::jsonb),
      now()
    )
    ON CONFLICT (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), player_id, pokemon_name)
    DO UPDATE SET
      total_appearances = player_aggregates.total_appearances + EXCLUDED.total_appearances,
      total_brought = player_aggregates.total_brought + EXCLUDED.total_brought,
      total_led = player_aggregates.total_led + EXCLUDED.total_led,
      total_kos_dealt = player_aggregates.total_kos_dealt + EXCLUDED.total_kos_dealt,
      total_koed = player_aggregates.total_koed + EXCLUDED.total_koed,
      total_wins = player_aggregates.total_wins + EXCLUDED.total_wins,
      total_games = player_aggregates.total_games + EXCLUDED.total_games,
      move_counts = merge_move_counts(player_aggregates.move_counts, EXCLUDED.move_counts),
      last_updated = now();
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."batch_upsert_player_aggregates"("p_deltas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_aggregate_jobs_for_game"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE aggregate_jobs
  SET status = 'cancelled', updated_at = now()
  WHERE game_id = p_game_id
    AND status IN ('pending', 'processing');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."cancel_aggregate_jobs_for_game"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_record_admin_export"("p_player_id" "uuid", "p_daily_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_row admin_export_limits%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_reset_at TIMESTAMPTZ := date_trunc('day', now()) + INTERVAL '1 day';
BEGIN
  INSERT INTO admin_export_limits (player_id, window_start, request_count)
  VALUES (p_player_id, v_today, 0)
  ON CONFLICT (player_id) DO NOTHING;

  SELECT * INTO v_row
  FROM admin_export_limits
  WHERE player_id = p_player_id
  FOR UPDATE;

  IF v_row.window_start < v_today THEN
    UPDATE admin_export_limits
    SET window_start = v_today,
        request_count = 0,
        updated_at = now()
    WHERE player_id = p_player_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.request_count >= p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'reset_at', v_reset_at
    );
  END IF;

  UPDATE admin_export_limits
  SET request_count = request_count + 1,
      updated_at = now()
  WHERE player_id = p_player_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', GREATEST(p_daily_limit - v_row.request_count, 0),
    'reset_at', v_reset_at
  );
END;
$$;


ALTER FUNCTION "public"."check_and_record_admin_export"("p_player_id" "uuid", "p_daily_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_record_ai_generation"("p_player_id" "uuid", "p_endpoint" "text", "p_daily_limit" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_used INT;
  v_cutoff TIMESTAMPTZ := now() - INTERVAL '24 hours';
BEGIN
  PERFORM 1 FROM ai_generations
    WHERE player_id = p_player_id
      AND endpoint = p_endpoint
      AND created_at >= v_cutoff
    FOR UPDATE;

  SELECT COUNT(*) INTO v_used
    FROM ai_generations
    WHERE player_id = p_player_id
      AND endpoint = p_endpoint
      AND created_at >= v_cutoff;

  IF v_used >= p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'used', v_used,
      'limit', p_daily_limit
    );
  END IF;

  INSERT INTO ai_generations (player_id, endpoint)
    VALUES (p_player_id, p_endpoint);

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', p_daily_limit - v_used - 1,
    'used', v_used + 1,
    'limit', p_daily_limit
  );
END;
$$;


ALTER FUNCTION "public"."check_and_record_ai_generation"("p_player_id" "uuid", "p_endpoint" "text", "p_daily_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_record_avatar_generation"("p_player_id" "uuid", "p_daily_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count int;
  v_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  PERFORM id FROM avatar_generations
    WHERE player_id = p_player_id AND created_at >= v_cutoff
    FOR UPDATE;

  SELECT COUNT(*) INTO v_count
    FROM avatar_generations
    WHERE player_id = p_player_id AND created_at >= v_cutoff;

  IF v_count >= p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'used', v_count,
      'remaining', 0,
      'limit', p_daily_limit
    );
  END IF;

  INSERT INTO avatar_generations (player_id) VALUES (p_player_id);

  RETURN jsonb_build_object(
    'allowed', true,
    'used', v_count + 1,
    'remaining', p_daily_limit - v_count - 1,
    'limit', p_daily_limit
  );
END;
$$;


ALTER FUNCTION "public"."check_and_record_avatar_generation"("p_player_id" "uuid", "p_daily_limit" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."aggregate_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid" NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "season_id" "uuid",
    "operation" "text" DEFAULT 'increment'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    CONSTRAINT "aggregate_jobs_operation_check" CHECK (("operation" = ANY (ARRAY['increment'::"text", 'decrement'::"text"]))),
    CONSTRAINT "aggregate_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."aggregate_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_aggregate_jobs"("p_limit" integer DEFAULT 10) RETURNS SETOF "public"."aggregate_jobs"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_claimed_ids UUID[];
BEGIN
  -- Select pending jobs that haven't exhausted their attempts.
  -- FOR UPDATE SKIP LOCKED ensures other processors skip these rows.
  WITH claimed AS (
    SELECT id FROM aggregate_jobs
    WHERE status = 'pending'
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE aggregate_jobs ag
  SET status = 'processing',
      attempts = ag.attempts + 1,
      updated_at = now()
  FROM claimed c
  WHERE ag.id = c.id
  RETURNING ag.id INTO v_claimed_ids;

  -- Return the updated rows so the processor knows what to work on
  IF array_length(v_claimed_ids, 1) > 0 THEN
    RETURN QUERY
    SELECT * FROM aggregate_jobs
    WHERE id = ANY(v_claimed_ids)
    ORDER BY created_at ASC;
  END IF;
END;
$$;


ALTER FUNCTION "public"."claim_aggregate_jobs"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_move_counts"("existing" "jsonb", "incoming" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  result jsonb := COALESCE(existing, '{}'::jsonb);
  k text;
  v text;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each_text(COALESCE(incoming, '{}'::jsonb))
  LOOP
    result := jsonb_set(
      result,
      ARRAY[k],
      to_jsonb(COALESCE((result->>k)::int, 0) + v::int)
    );
  END LOOP;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."merge_move_counts"("existing" "jsonb", "incoming" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_log_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;


ALTER FUNCTION "public"."prevent_audit_log_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reclaim_stale_aggregate_jobs"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count INT;
BEGIN
  WITH reclaimed AS (
    UPDATE aggregate_jobs
    SET status = 'pending', updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - INTERVAL '5 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM reclaimed;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."reclaim_stale_aggregate_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."subtract_move_counts"("existing" "jsonb", "removed" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  result jsonb := COALESCE(existing, '{}'::jsonb);
  k text;
  v text;
  new_val int;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each_text(COALESCE(removed, '{}'::jsonb))
  LOOP
    new_val := COALESCE((result->>k)::int, 0) - v::int;
    IF new_val <= 0 THEN
      result := result - k;
    ELSE
      result := jsonb_set(result, ARRAY[k], to_jsonb(new_val));
    END IF;
  END LOOP;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."subtract_move_counts"("existing" "jsonb", "removed" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO aggregates (
    scope_type, scope_id, pokemon_name,
    total_appearances, total_brought, total_led,
    total_kos_dealt, total_koed, total_wins, total_games,
    move_counts, last_updated
  ) VALUES (
    p_scope_type, p_scope_id, p_pokemon_name,
    p_appearances, p_brought, p_led,
    p_kos_dealt, p_koed, p_wins, p_games,
    COALESCE(p_move_counts, '{}'::jsonb), now()
  )
  ON CONFLICT (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), pokemon_name)
  DO UPDATE SET
    total_appearances = aggregates.total_appearances + EXCLUDED.total_appearances,
    total_brought = aggregates.total_brought + EXCLUDED.total_brought,
    total_led = aggregates.total_led + EXCLUDED.total_led,
    total_kos_dealt = aggregates.total_kos_dealt + EXCLUDED.total_kos_dealt,
    total_koed = aggregates.total_koed + EXCLUDED.total_koed,
    total_wins = aggregates.total_wins + EXCLUDED.total_wins,
    total_games = aggregates.total_games + EXCLUDED.total_games,
    move_counts = merge_move_counts(aggregates.move_counts, EXCLUDED.move_counts),
    last_updated = now();
END;
$$;


ALTER FUNCTION "public"."upsert_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_player_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_player_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO player_aggregates (
    scope_type, scope_id, player_id, pokemon_name,
    total_appearances, total_brought, total_led,
    total_kos_dealt, total_koed, total_wins, total_games,
    move_counts, last_updated
  ) VALUES (
    p_scope_type, p_scope_id, p_player_id, p_pokemon_name,
    p_appearances, p_brought, p_led,
    p_kos_dealt, p_koed, p_wins, p_games,
    COALESCE(p_move_counts, '{}'::jsonb), now()
  )
  ON CONFLICT (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), player_id, pokemon_name)
  DO UPDATE SET
    total_appearances = player_aggregates.total_appearances + EXCLUDED.total_appearances,
    total_brought = player_aggregates.total_brought + EXCLUDED.total_brought,
    total_led = player_aggregates.total_led + EXCLUDED.total_led,
    total_kos_dealt = player_aggregates.total_kos_dealt + EXCLUDED.total_kos_dealt,
    total_koed = player_aggregates.total_koed + EXCLUDED.total_koed,
    total_wins = player_aggregates.total_wins + EXCLUDED.total_wins,
    total_games = player_aggregates.total_games + EXCLUDED.total_games,
    move_counts = merge_move_counts(player_aggregates.move_counts, EXCLUDED.move_counts),
    last_updated = now();
END;
$$;


ALTER FUNCTION "public"."upsert_player_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_player_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."achievement_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "icon" "text",
    "category" "text" NOT NULL,
    "tier" "text" NOT NULL,
    "repeatable" boolean DEFAULT false NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL,
    "criteria" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "achievement_definitions_category_check" CHECK (("category" = ANY (ARRAY['combat'::"text", 'milestone'::"text", 'social'::"text", 'rare'::"text", 'meta'::"text"]))),
    CONSTRAINT "achievement_definitions_tier_check" CHECK (("tier" = ANY (ARRAY['bronze'::"text", 'silver'::"text", 'gold'::"text", 'platinum'::"text"])))
);


ALTER TABLE "public"."achievement_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_export_limits" (
    "player_id" "uuid" NOT NULL,
    "window_start" "date" DEFAULT CURRENT_DATE NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_export_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aggregates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "public"."aggregate_scope" NOT NULL,
    "scope_id" "uuid",
    "pokemon_name" "text" NOT NULL,
    "total_appearances" integer DEFAULT 0 NOT NULL,
    "total_brought" integer DEFAULT 0 NOT NULL,
    "total_led" integer DEFAULT 0 NOT NULL,
    "total_kos_dealt" integer DEFAULT 0 NOT NULL,
    "total_koed" integer DEFAULT 0 NOT NULL,
    "total_wins" integer DEFAULT 0 NOT NULL,
    "total_games" integer DEFAULT 0 NOT NULL,
    "move_counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."aggregates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_avatar_gallery" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "image_url" "text" NOT NULL,
    "choices" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "style" "text" DEFAULT 'anime'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_avatar_gallery" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_generations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "resource_name" "text",
    "changes" "jsonb",
    "metadata" "jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'Immutable audit trail of privileged operations. Entries are append-only — no UPDATE or DELETE allowed via application code.';



CREATE TABLE IF NOT EXISTS "public"."avatar_generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."avatar_generations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "pokemon_name" "text" NOT NULL,
    "was_brought" boolean DEFAULT true NOT NULL,
    "was_lead" boolean DEFAULT false NOT NULL,
    "kos_dealt" integer DEFAULT 0 NOT NULL,
    "was_koed" boolean DEFAULT false NOT NULL,
    "moves_used" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "turns_active" integer DEFAULT 0 NOT NULL,
    "match_won" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."battle_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."broadcast_moments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid",
    "match_id" "uuid" NOT NULL,
    "turn_number" integer,
    "moment_type" "text" NOT NULL,
    "description" "text",
    "pokemon_name" "text",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "broadcast_moments_moment_type_check" CHECK (("moment_type" = ANY (ARRAY['turning_point'::"text", 'big_ko'::"text", 'misplay'::"text", 'clutch'::"text", 'highlight'::"text"])))
);


ALTER TABLE "public"."broadcast_moments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."broadcast_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "preset_type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "broadcast_presets_preset_type_check" CHECK (("preset_type" = ANY (ARRAY['match_preview'::"text", 'match_results'::"text", 'standings'::"text", 'attract'::"text", 'draft'::"text", 'recap'::"text"])))
);


ALTER TABLE "public"."broadcast_presets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cast_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "match_id" "uuid",
    "tournament_id" "uuid",
    "season_id" "uuid",
    "name" "text" DEFAULT 'Untitled Session'::"text" NOT NULL,
    "mode" "text" DEFAULT 'cast'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "player1_id" "uuid",
    "player1_name" "text",
    "player1_avatar_url" "text",
    "player2_id" "uuid",
    "player2_name" "text",
    "player2_avatar_url" "text",
    "player1_team" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "player2_team" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "tracker_state" "jsonb",
    "overlay_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "format" "text" DEFAULT 'gen9ou'::"text" NOT NULL,
    "generation" integer DEFAULT 9 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "caster_notes" "jsonb" DEFAULT '{}'::"jsonb",
    "realtime_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "cast_sessions_mode_check" CHECK (("mode" = ANY (ARRAY['cast'::"text", 'solo'::"text", 'replaycast'::"text"]))),
    CONSTRAINT "cast_sessions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."cast_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cast_sessions"."caster_notes" IS 'Free-form caster notes: { player1: string, player2: string, match: string }';



CREATE TABLE IF NOT EXISTS "public"."discord_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "uuid",
    "webhook_url" "text" NOT NULL,
    "label" "text" DEFAULT 'General'::"text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "event_filter" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "format_options" "jsonb" DEFAULT '{"spoiler_results": true, "show_replay_link": true, "attach_match_card": true, "ping_next_drafter": false, "show_pokemon_details": true}'::"jsonb" NOT NULL,
    CONSTRAINT "discord_webhooks_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['season'::"text", 'tournament'::"text", 'global'::"text"]))),
    CONSTRAINT "valid_scope" CHECK (((("scope_type" = 'global'::"text") AND ("scope_id" IS NULL)) OR (("scope_type" = ANY (ARRAY['season'::"text", 'tournament'::"text"])) AND ("scope_id" IS NOT NULL))))
);


ALTER TABLE "public"."discord_webhooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "draft_pool_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "pokemon_name" "text" NOT NULL,
    "pick_number" integer NOT NULL,
    "round" integer NOT NULL,
    "points_spent" integer,
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."draft_picks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_pool_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "pokemon_name" "text" NOT NULL,
    "power_tier" "text",
    "point_cost" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."draft_pool_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_pool_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "pool_mode" "text" DEFAULT 'tier'::"text" NOT NULL,
    "entries" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."draft_pool_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_pools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "draft_type" "public"."draft_type" NOT NULL,
    "point_budget" integer,
    "status" "public"."draft_pool_status" DEFAULT 'pending'::"public"."draft_pool_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pool_mode" "text" DEFAULT 'tier'::"text" NOT NULL,
    "default_point_cost" integer DEFAULT 1,
    "team_size_mode" "text",
    "team_size_exact" integer,
    "team_size_min" integer,
    "team_size_max" integer
);


ALTER TABLE "public"."draft_pools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_replay_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "draft_pool_id" "uuid" NOT NULL,
    "pick_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sequence_number" integer NOT NULL,
    "wall_clock_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_duration_ms" integer DEFAULT 5000 NOT NULL,
    CONSTRAINT "draft_replay_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['pick'::"text", 'skip'::"text", 'trade'::"text", 'pause'::"text", 'commentary'::"text", 'timer_expire'::"text"])))
);


ALTER TABLE "public"."draft_replay_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."draft_tier_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "power_tier" "text" NOT NULL,
    "max_picks" integer NOT NULL,
    CONSTRAINT "draft_tier_limits_max_picks_check" CHECK (("max_picks" >= 0))
);


ALTER TABLE "public"."draft_tier_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."evolution_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "player_id" "uuid",
    "base_pokemon" "text" NOT NULL,
    "stage2_pokemon" "text" NOT NULL,
    "stage2_kos" integer NOT NULL,
    "stage3_pokemon" "text",
    "stage3_kos" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "power_tier" "text" DEFAULT 'C'::"text"
);


ALTER TABLE "public"."evolution_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."evolution_tracker" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "base_pokemon" "text" NOT NULL,
    "current_form" "text" NOT NULL,
    "total_kos" integer DEFAULT 0 NOT NULL,
    "current_stage" integer DEFAULT 1 NOT NULL,
    "evolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."evolution_tracker" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "game_number" integer NOT NULL,
    "winner_id" "uuid",
    "replay_url" "text" DEFAULT ''::"text" NOT NULL,
    "source" "public"."game_source" DEFAULT 'manual'::"public"."game_source" NOT NULL,
    "parsed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aggregate_applied_at" timestamp with time zone,
    "stats_locked" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_standings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "rank" integer NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "draws" integer DEFAULT 0 NOT NULL,
    "losses" integer DEFAULT 0 NOT NULL,
    "points" numeric(6,2) DEFAULT 0 NOT NULL,
    "kill_differential" integer DEFAULT 0 NOT NULL,
    "games_played" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legacy_standings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_analyses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "model_id" "text" NOT NULL,
    "analysis" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "generation_time_ms" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."match_analyses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_prep_analyses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "model_id" "text" NOT NULL,
    "analysis" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "has_user_team" boolean DEFAULT false NOT NULL,
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "generation_time_ms" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."match_prep_analyses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_prep_teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "pokemon" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "import_source" "public"."team_import_source" DEFAULT 'manual'::"public"."team_import_source" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."match_prep_teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid" NOT NULL,
    "proposer_id" "uuid" NOT NULL,
    "responder_id" "uuid" NOT NULL,
    "proposed_at" timestamp with time zone NOT NULL,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."match_proposal_status" DEFAULT 'pending'::"public"."match_proposal_status" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "responded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "match_proposals_distinct_players" CHECK (("proposer_id" <> "responder_id")),
    CONSTRAINT "match_proposals_message_length" CHECK (("char_length"("message") <= 1000)),
    CONSTRAINT "match_proposals_response_status" CHECK (((("status" = ANY (ARRAY['accepted'::"public"."match_proposal_status", 'rejected'::"public"."match_proposal_status", 'expired'::"public"."match_proposal_status", 'cancelled'::"public"."match_proposal_status"])) AND ("responded_at" IS NOT NULL)) OR (("status" = 'pending'::"public"."match_proposal_status") AND ("responded_at" IS NULL))))
);


ALTER TABLE "public"."match_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "round_id" "uuid" NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "player_1_id" "uuid" NOT NULL,
    "player_2_id" "uuid" NOT NULL,
    "winner_id" "uuid",
    "status" "public"."match_status" DEFAULT 'scheduled'::"public"."match_status" NOT NULL,
    "submitter_id" "uuid",
    "date_played" timestamp with time zone,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "social_image_url" "text",
    "scheduled_at" timestamp with time zone,
    "auto_confirm_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone
);


ALTER TABLE "public"."matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_usage_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "format" "text" NOT NULL,
    "pokemon_name" "text" NOT NULL,
    "usage_pct" numeric(8,5) NOT NULL,
    "lead_pct" numeric(8,5),
    "moves" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "items" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "abilities" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "teammates" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "spreads" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tera_types" "jsonb",
    "counters" "jsonb",
    "viability" "jsonb",
    "last_imported" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meta_usage_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "achievement_id" "uuid" NOT NULL,
    "earned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "context" "jsonb",
    "times_earned" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."player_achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_aggregates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "public"."aggregate_scope" NOT NULL,
    "scope_id" "uuid",
    "player_id" "uuid" NOT NULL,
    "pokemon_name" "text" NOT NULL,
    "total_appearances" integer DEFAULT 0 NOT NULL,
    "total_brought" integer DEFAULT 0 NOT NULL,
    "total_led" integer DEFAULT 0 NOT NULL,
    "total_kos_dealt" integer DEFAULT 0 NOT NULL,
    "total_koed" integer DEFAULT 0 NOT NULL,
    "total_wins" integer DEFAULT 0 NOT NULL,
    "total_games" integer DEFAULT 0 NOT NULL,
    "move_counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_aggregates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "rating" numeric(7,2) DEFAULT 1500.00 NOT NULL,
    "rd" numeric(7,2) DEFAULT 350.00 NOT NULL,
    "volatility" numeric(8,6) DEFAULT 0.06 NOT NULL,
    "peak_rating" numeric(7,2) DEFAULT 1500.00 NOT NULL,
    "peak_date" timestamp with time zone,
    "wins" integer DEFAULT 0 NOT NULL,
    "losses" integer DEFAULT 0 NOT NULL,
    "draws" integer DEFAULT 0 NOT NULL,
    "last_match_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_signatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "signatures" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_signatures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_streaks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "current_win_streak" integer DEFAULT 0 NOT NULL,
    "best_win_streak" integer DEFAULT 0 NOT NULL,
    "current_loss_streak" integer DEFAULT 0 NOT NULL,
    "best_loss_streak" integer DEFAULT 0 NOT NULL,
    "current_ko_streak" integer DEFAULT 0 NOT NULL,
    "best_ko_streak" integer DEFAULT 0 NOT NULL,
    "current_flawless_streak" integer DEFAULT 0 NOT NULL,
    "best_flawless_streak" integer DEFAULT 0 NOT NULL,
    "last_match_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_streaks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "discord_id" "text" NOT NULL,
    "ps_username" "text" DEFAULT ''::"text" NOT NULL,
    "champions_username" "text" DEFAULT ''::"text" NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "joined_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "avatar_url" "text",
    "avatar_config" "jsonb",
    "is_creator" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "suspended_until" timestamp with time zone,
    "ban_reason" "text",
    "auth_user_id" "uuid",
    CONSTRAINT "players_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'banned'::"text"])))
);


ALTER TABLE "public"."players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rating_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "match_id" "uuid" NOT NULL,
    "rating_before" numeric(7,2) NOT NULL,
    "rating_after" numeric(7,2) NOT NULL,
    "rd_before" numeric(7,2) NOT NULL,
    "rd_after" numeric(7,2) NOT NULL,
    "opponent_id" "uuid" NOT NULL,
    "opponent_rating" numeric(7,2) NOT NULL,
    "result" "text" NOT NULL,
    "rating_change" numeric(7,2) GENERATED ALWAYS AS (("rating_after" - "rating_before")) STORED,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rating_history_result_check" CHECK (("result" = ANY (ARRAY['win'::"text", 'loss'::"text", 'draw'::"text"])))
);


ALTER TABLE "public"."rating_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resource_admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "resource_admins_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['tournament'::"text", 'season'::"text"])))
);


ALTER TABLE "public"."resource_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rounds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "round_number" integer NOT NULL,
    "best_of" integer NOT NULL,
    "status" "public"."round_status" DEFAULT 'pending'::"public"."round_status" NOT NULL,
    "pairings_generated" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deadline" timestamp with time zone
);


ALTER TABLE "public"."rounds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rulesets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "base_format" "text" DEFAULT 'blank'::"text" NOT NULL,
    "is_doubles" boolean DEFAULT false NOT NULL,
    "clauses" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "banned_pokemon" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "banned_moves" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "banned_items" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "added_pokemon" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "custom_rules_string" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "min_shared_type_pct" integer DEFAULT 0 NOT NULL,
    "team_constraints" "jsonb",
    "banned_abilities" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."rulesets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."rulesets"."team_constraints" IS 'Generic team-composition rules (type quotas, tera match, evolution stage, eviolite cap). See docs/poketools-spec.md §9.1.';



CREATE TABLE IF NOT EXISTS "public"."season_participants" (
    "season_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "core_types" "text"[],
    "core_assigned_at" timestamp with time zone,
    "gym_type" "text",
    CONSTRAINT "season_participants_core_types_valid" CHECK ((("core_types" IS NULL) OR (("array_length"("core_types", 1) = 3) AND ("core_types" <@ ARRAY['Normal'::"text", 'Fire'::"text", 'Water'::"text", 'Electric'::"text", 'Grass'::"text", 'Ice'::"text", 'Fighting'::"text", 'Poison'::"text", 'Ground'::"text", 'Flying'::"text", 'Psychic'::"text", 'Bug'::"text", 'Rock'::"text", 'Ghost'::"text", 'Dragon'::"text", 'Dark'::"text", 'Steel'::"text", 'Fairy'::"text"]) AND ("core_types"[1] <> "core_types"[2]) AND ("core_types"[1] <> "core_types"[3]) AND ("core_types"[2] <> "core_types"[3]))))
);


ALTER TABLE "public"."season_participants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."season_participants"."core_types" IS 'Three Pokémon types assigned by Core Liga draw (sorted alphabetically). null when not yet drawn.';



COMMENT ON COLUMN "public"."season_participants"."core_assigned_at" IS 'When core_types was assigned (audit + idempotency).';



CREATE TABLE IF NOT EXISTS "public"."season_storylines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "featured" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."season_storylines" OWNER TO "postgres";


COMMENT ON TABLE "public"."season_storylines" IS 'Caster-maintained narrative storylines for a season';



CREATE TABLE IF NOT EXISTS "public"."seasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "format_type" "public"."season_format_type" NOT NULL,
    "ruleset_id" "uuid",
    "start_date" "date",
    "end_date" "date",
    "status" "public"."season_status" DEFAULT 'upcoming'::"public"."season_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "legacy" boolean DEFAULT false NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "core_pool" "jsonb"
);


ALTER TABLE "public"."seasons" OWNER TO "postgres";


COMMENT ON COLUMN "public"."seasons"."core_pool" IS 'Curated list of allowed 3-type triples for Core Liga draw. null when feature unused.';



CREATE TABLE IF NOT EXISTS "public"."smogon_sample_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "generation" integer NOT NULL,
    "format" "text" NOT NULL,
    "pokemon_name" "text" NOT NULL,
    "set_name" "text" NOT NULL,
    "moveset" "jsonb" NOT NULL,
    "description" "text",
    "outdated" boolean DEFAULT false,
    "last_imported" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."smogon_sample_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "uuid",
    "label" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "event_filter" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "post_options" "jsonb" DEFAULT '{"include_hashtags": false, "include_replay_link": true}'::"jsonb" NOT NULL,
    "credential_hint" "text",
    "credentials_encrypted" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_integrations_provider_check" CHECK (("provider" = ANY (ARRAY['x'::"text", 'threads'::"text", 'bluesky'::"text"]))),
    CONSTRAINT "social_integrations_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['season'::"text", 'tournament'::"text", 'global'::"text"]))),
    CONSTRAINT "valid_social_scope" CHECK (((("scope_type" = 'global'::"text") AND ("scope_id" IS NULL)) OR (("scope_type" = ANY (ARRAY['season'::"text", 'tournament'::"text"])) AND ("scope_id" IS NOT NULL))))
);


ALTER TABLE "public"."social_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" "uuid" NOT NULL,
    "tournament_id" "uuid",
    "season_id" "uuid",
    "pokemon" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "import_source" "public"."team_import_source" DEFAULT 'manual'::"public"."team_import_source" NOT NULL,
    "locked" boolean DEFAULT false NOT NULL,
    "draft_pool_id" "uuid",
    "is_draft_team" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "match_id" "uuid",
    "share_token" "uuid",
    "share_enabled_at" timestamp with time zone,
    "library_published_at" timestamp with time zone,
    "library_title" "text",
    "library_description" "text",
    "library_tags" "text"[],
    "forked_from_team_id" "uuid"
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tournament_group_members" (
    "group_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "seed" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."tournament_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tournament_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "group_number" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tournament_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tournament_participants" (
    "tournament_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "seed" integer
);


ALTER TABLE "public"."tournament_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tournament_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "round_id" "uuid" NOT NULL,
    "report_type" "text" NOT NULL,
    "model_id" "text" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "generation_time_ms" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tournament_reports_report_type_check" CHECK (("report_type" = ANY (ARRAY['round_recap'::"text", 'round_forecast'::"text"]))),
    CONSTRAINT "tournament_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."tournament_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tournaments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "season_id" "uuid",
    "bracket_type" "public"."bracket_type" NOT NULL,
    "ruleset_id" "uuid" NOT NULL,
    "best_of_default" integer DEFAULT 1 NOT NULL,
    "is_doubles" boolean DEFAULT false NOT NULL,
    "team_visibility" "public"."team_visibility" DEFAULT 'hidden_until_match'::"public"."team_visibility" NOT NULL,
    "status" "public"."tournament_status" DEFAULT 'upcoming'::"public"."tournament_status" NOT NULL,
    "current_round" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stage_order" integer DEFAULT 0 NOT NULL,
    "advancement_rule" "jsonb",
    "bo_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "legacy" boolean DEFAULT false NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."tournaments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wiki_note_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wiki_note_reports_details_check" CHECK ((("details" IS NULL) OR ("char_length"("details") <= 500))),
    CONSTRAINT "wiki_note_reports_reason_check" CHECK ((("char_length"("reason") >= 1) AND ("char_length"("reason") <= 80))),
    CONSTRAINT "wiki_note_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."wiki_note_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wiki_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_name" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "scope_type" "text" DEFAULT 'global'::"text" NOT NULL,
    "scope_id" "uuid",
    "approved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejected_by" "uuid",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "moderation_flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "wiki_notes_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['pokemon'::"text", 'move'::"text", 'item'::"text", 'ability'::"text", 'tera'::"text"]))),
    CONSTRAINT "wiki_notes_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['global'::"text", 'tournament'::"text", 'league'::"text"])))
);


ALTER TABLE "public"."wiki_notes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."achievement_definitions"
    ADD CONSTRAINT "achievement_definitions_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."achievement_definitions"
    ADD CONSTRAINT "achievement_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_export_limits"
    ADD CONSTRAINT "admin_export_limits_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."aggregate_jobs"
    ADD CONSTRAINT "aggregate_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aggregates"
    ADD CONSTRAINT "aggregates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_avatar_gallery"
    ADD CONSTRAINT "ai_avatar_gallery_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."avatar_generations"
    ADD CONSTRAINT "avatar_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battle_stats"
    ADD CONSTRAINT "battle_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcast_moments"
    ADD CONSTRAINT "broadcast_moments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcast_presets"
    ADD CONSTRAINT "broadcast_presets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discord_webhooks"
    ADD CONSTRAINT "discord_webhooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_pool_entries"
    ADD CONSTRAINT "draft_pool_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_pool_entries"
    ADD CONSTRAINT "draft_pool_entries_season_id_pokemon_name_key" UNIQUE ("season_id", "pokemon_name");



ALTER TABLE ONLY "public"."draft_pool_templates"
    ADD CONSTRAINT "draft_pool_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_pools"
    ADD CONSTRAINT "draft_pools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_replay_events"
    ADD CONSTRAINT "draft_replay_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_tier_limits"
    ADD CONSTRAINT "draft_tier_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_tier_limits"
    ADD CONSTRAINT "draft_tier_limits_season_id_power_tier_key" UNIQUE ("season_id", "power_tier");



ALTER TABLE ONLY "public"."evolution_tiers"
    ADD CONSTRAINT "evolution_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."evolution_tracker"
    ADD CONSTRAINT "evolution_tracker_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_standings"
    ADD CONSTRAINT "legacy_standings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_standings"
    ADD CONSTRAINT "legacy_standings_season_id_player_id_key" UNIQUE ("season_id", "player_id");



ALTER TABLE ONLY "public"."match_analyses"
    ADD CONSTRAINT "match_analyses_match_id_key" UNIQUE ("match_id");



ALTER TABLE ONLY "public"."match_analyses"
    ADD CONSTRAINT "match_analyses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_prep_analyses"
    ADD CONSTRAINT "match_prep_analyses_match_id_player_id_key" UNIQUE ("match_id", "player_id");



ALTER TABLE ONLY "public"."match_prep_analyses"
    ADD CONSTRAINT "match_prep_analyses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_prep_teams"
    ADD CONSTRAINT "match_prep_teams_match_id_player_id_key" UNIQUE ("match_id", "player_id");



ALTER TABLE ONLY "public"."match_prep_teams"
    ADD CONSTRAINT "match_prep_teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_proposals"
    ADD CONSTRAINT "match_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_usage_cache"
    ADD CONSTRAINT "meta_usage_cache_format_pokemon_name_key" UNIQUE ("format", "pokemon_name");



ALTER TABLE ONLY "public"."meta_usage_cache"
    ADD CONSTRAINT "meta_usage_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_achievements"
    ADD CONSTRAINT "player_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_aggregates"
    ADD CONSTRAINT "player_aggregates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_ratings"
    ADD CONSTRAINT "player_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_signatures"
    ADD CONSTRAINT "player_signatures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_streaks"
    ADD CONSTRAINT "player_streaks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_discord_id_key" UNIQUE ("discord_id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_player_match_unique" UNIQUE ("player_id", "match_id");



ALTER TABLE ONLY "public"."resource_admins"
    ADD CONSTRAINT "resource_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resource_admins"
    ADD CONSTRAINT "resource_admins_player_id_resource_type_resource_id_key" UNIQUE ("player_id", "resource_type", "resource_id");



ALTER TABLE ONLY "public"."rounds"
    ADD CONSTRAINT "rounds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rulesets"
    ADD CONSTRAINT "rulesets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."season_participants"
    ADD CONSTRAINT "season_participants_pkey" PRIMARY KEY ("season_id", "player_id");



ALTER TABLE ONLY "public"."season_storylines"
    ADD CONSTRAINT "season_storylines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smogon_sample_sets"
    ADD CONSTRAINT "smogon_sample_sets_generation_format_pokemon_name_set_name_key" UNIQUE ("generation", "format", "pokemon_name", "set_name");



ALTER TABLE ONLY "public"."smogon_sample_sets"
    ADD CONSTRAINT "smogon_sample_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_integrations"
    ADD CONSTRAINT "social_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_share_token_key" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."tournament_group_members"
    ADD CONSTRAINT "tournament_group_members_pkey" PRIMARY KEY ("group_id", "player_id");



ALTER TABLE ONLY "public"."tournament_groups"
    ADD CONSTRAINT "tournament_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tournament_participants"
    ADD CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("tournament_id", "player_id");



ALTER TABLE ONLY "public"."tournament_reports"
    ADD CONSTRAINT "tournament_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tournament_reports"
    ADD CONSTRAINT "tournament_reports_tournament_id_round_id_report_type_key" UNIQUE ("tournament_id", "round_id", "report_type");



ALTER TABLE ONLY "public"."tournaments"
    ADD CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_achievements"
    ADD CONSTRAINT "uq_player_achievements" UNIQUE ("player_id", "achievement_id");



ALTER TABLE ONLY "public"."player_ratings"
    ADD CONSTRAINT "uq_player_ratings_player" UNIQUE ("player_id");



ALTER TABLE ONLY "public"."player_signatures"
    ADD CONSTRAINT "uq_player_signatures_player" UNIQUE ("player_id");



ALTER TABLE ONLY "public"."player_streaks"
    ADD CONSTRAINT "uq_player_streaks_player" UNIQUE ("player_id");



ALTER TABLE ONLY "public"."wiki_note_reports"
    ADD CONSTRAINT "wiki_note_reports_note_id_reporter_id_key" UNIQUE ("note_id", "reporter_id");



ALTER TABLE ONLY "public"."wiki_note_reports"
    ADD CONSTRAINT "wiki_note_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wiki_notes"
    ADD CONSTRAINT "wiki_notes_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_log_action_idx" ON "public"."audit_log" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "audit_log_actor_id_idx" ON "public"."audit_log" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "audit_log_created_at_idx" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "audit_log_resource_idx" ON "public"."audit_log" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_aggregate_jobs_game_id" ON "public"."aggregate_jobs" USING "btree" ("game_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));



CREATE INDEX "idx_aggregate_jobs_status_created" ON "public"."aggregate_jobs" USING "btree" ("status", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));



CREATE INDEX "idx_aggregate_jobs_tournament" ON "public"."aggregate_jobs" USING "btree" ("tournament_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_aggregates_scope" ON "public"."aggregates" USING "btree" ("scope_type", "scope_id");



CREATE UNIQUE INDEX "idx_aggregates_scope_pokemon" ON "public"."aggregates" USING "btree" ("scope_type", COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "pokemon_name");



CREATE INDEX "idx_ai_avatar_gallery_player" ON "public"."ai_avatar_gallery" USING "btree" ("player_id", "created_at" DESC);



CREATE INDEX "idx_ai_avatar_gallery_recent" ON "public"."ai_avatar_gallery" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ai_generations_lookup" ON "public"."ai_generations" USING "btree" ("player_id", "endpoint", "created_at" DESC);



CREATE INDEX "idx_avatar_generations_player_date" ON "public"."avatar_generations" USING "btree" ("player_id", "created_at");



CREATE INDEX "idx_battle_stats_game" ON "public"."battle_stats" USING "btree" ("game_id");



CREATE INDEX "idx_battle_stats_player" ON "public"."battle_stats" USING "btree" ("player_id");



CREATE INDEX "idx_broadcast_moments_game" ON "public"."broadcast_moments" USING "btree" ("game_id");



CREATE INDEX "idx_broadcast_moments_match" ON "public"."broadcast_moments" USING "btree" ("match_id");



CREATE INDEX "idx_broadcast_presets_owner" ON "public"."broadcast_presets" USING "btree" ("owner_id");



CREATE INDEX "idx_cast_sessions_match" ON "public"."cast_sessions" USING "btree" ("match_id") WHERE ("match_id" IS NOT NULL);



CREATE INDEX "idx_cast_sessions_owner" ON "public"."cast_sessions" USING "btree" ("owner_id");



CREATE UNIQUE INDEX "idx_cast_sessions_realtime_key" ON "public"."cast_sessions" USING "btree" ("realtime_key");



CREATE INDEX "idx_cast_sessions_status" ON "public"."cast_sessions" USING "btree" ("owner_id", "status");



CREATE INDEX "idx_discord_webhooks_scope" ON "public"."discord_webhooks" USING "btree" ("scope_type", "scope_id");



CREATE INDEX "idx_draft_picks_pool" ON "public"."draft_picks" USING "btree" ("draft_pool_id");



CREATE INDEX "idx_draft_pool_entries_season" ON "public"."draft_pool_entries" USING "btree" ("season_id");



CREATE INDEX "idx_draft_replay_pool" ON "public"."draft_replay_events" USING "btree" ("draft_pool_id");



CREATE UNIQUE INDEX "idx_draft_replay_sequence" ON "public"."draft_replay_events" USING "btree" ("draft_pool_id", "sequence_number");



CREATE INDEX "idx_draft_tier_limits_season" ON "public"."draft_tier_limits" USING "btree" ("season_id");



CREATE INDEX "idx_evolution_tiers_season" ON "public"."evolution_tiers" USING "btree" ("season_id");



CREATE UNIQUE INDEX "idx_evolution_tiers_unique" ON "public"."evolution_tiers" USING "btree" ("season_id", "base_pokemon", COALESCE("player_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX "idx_evolution_tracker_player" ON "public"."evolution_tracker" USING "btree" ("player_id");



CREATE INDEX "idx_evolution_tracker_season" ON "public"."evolution_tracker" USING "btree" ("season_id");



CREATE UNIQUE INDEX "idx_evolution_tracker_unique" ON "public"."evolution_tracker" USING "btree" ("season_id", "player_id", "base_pokemon");



CREATE INDEX "idx_games_aggregate_applied_at" ON "public"."games" USING "btree" ("aggregate_applied_at") WHERE ("aggregate_applied_at" IS NOT NULL);



CREATE INDEX "idx_games_match" ON "public"."games" USING "btree" ("match_id");



CREATE INDEX "idx_games_stats_locked" ON "public"."games" USING "btree" ("stats_locked") WHERE ("stats_locked" = true);



CREATE INDEX "idx_legacy_standings_season" ON "public"."legacy_standings" USING "btree" ("season_id");



CREATE INDEX "idx_match_analyses_match_id" ON "public"."match_analyses" USING "btree" ("match_id");



CREATE INDEX "idx_match_analyses_status" ON "public"."match_analyses" USING "btree" ("status");



CREATE INDEX "idx_match_prep_analyses_match_player" ON "public"."match_prep_analyses" USING "btree" ("match_id", "player_id");



CREATE INDEX "idx_match_prep_analyses_status" ON "public"."match_prep_analyses" USING "btree" ("status");



CREATE INDEX "idx_match_prep_teams_player" ON "public"."match_prep_teams" USING "btree" ("player_id");



CREATE INDEX "idx_match_proposals_expired_pending" ON "public"."match_proposals" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"public"."match_proposal_status");



CREATE INDEX "idx_match_proposals_match" ON "public"."match_proposals" USING "btree" ("match_id");



CREATE UNIQUE INDEX "idx_match_proposals_pending_proposer" ON "public"."match_proposals" USING "btree" ("match_id", "proposer_id") WHERE ("status" = 'pending'::"public"."match_proposal_status");



CREATE UNIQUE INDEX "idx_match_proposals_pending_responder" ON "public"."match_proposals" USING "btree" ("match_id", "responder_id") WHERE ("status" = 'pending'::"public"."match_proposal_status");



CREATE INDEX "idx_match_proposals_responder_pending" ON "public"."match_proposals" USING "btree" ("responder_id", "expires_at") WHERE ("status" = 'pending'::"public"."match_proposal_status");



CREATE INDEX "idx_matches_auto_confirm_at" ON "public"."matches" USING "btree" ("auto_confirm_at") WHERE ("auto_confirm_at" IS NOT NULL);



CREATE INDEX "idx_matches_round" ON "public"."matches" USING "btree" ("round_id");



CREATE INDEX "idx_matches_scheduled_at" ON "public"."matches" USING "btree" ("scheduled_at") WHERE ("scheduled_at" IS NOT NULL);



CREATE INDEX "idx_matches_status" ON "public"."matches" USING "btree" ("status");



CREATE INDEX "idx_matches_tournament" ON "public"."matches" USING "btree" ("tournament_id");



CREATE INDEX "idx_meta_usage_format" ON "public"."meta_usage_cache" USING "btree" ("format");



CREATE INDEX "idx_meta_usage_format_usage" ON "public"."meta_usage_cache" USING "btree" ("format", "usage_pct" DESC);



CREATE INDEX "idx_meta_usage_pokemon" ON "public"."meta_usage_cache" USING "btree" ("pokemon_name");



CREATE INDEX "idx_player_agg_player" ON "public"."player_aggregates" USING "btree" ("player_id");



CREATE INDEX "idx_player_agg_pokemon" ON "public"."player_aggregates" USING "btree" ("pokemon_name");



CREATE INDEX "idx_player_agg_scope" ON "public"."player_aggregates" USING "btree" ("scope_type", "scope_id");



CREATE UNIQUE INDEX "idx_player_agg_scope_player_pokemon" ON "public"."player_aggregates" USING "btree" ("scope_type", COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "player_id", "pokemon_name");



CREATE INDEX "idx_player_ratings_rating" ON "public"."player_ratings" USING "btree" ("rating" DESC);



CREATE INDEX "idx_rating_history_match" ON "public"."rating_history" USING "btree" ("match_id");



CREATE INDEX "idx_rating_history_player" ON "public"."rating_history" USING "btree" ("player_id", "recorded_at" DESC);



CREATE INDEX "idx_resource_admins_player" ON "public"."resource_admins" USING "btree" ("player_id");



CREATE INDEX "idx_resource_admins_resource" ON "public"."resource_admins" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_rounds_deadline" ON "public"."rounds" USING "btree" ("deadline") WHERE ("deadline" IS NOT NULL);



CREATE INDEX "idx_sample_sets_lookup" ON "public"."smogon_sample_sets" USING "btree" ("generation", "format", "pokemon_name");



CREATE INDEX "idx_season_storylines_featured" ON "public"."season_storylines" USING "btree" ("featured") WHERE ("featured" = true);



CREATE INDEX "idx_season_storylines_season_id" ON "public"."season_storylines" USING "btree" ("season_id");



CREATE INDEX "idx_social_integrations_provider" ON "public"."social_integrations" USING "btree" ("provider");



CREATE INDEX "idx_social_integrations_scope" ON "public"."social_integrations" USING "btree" ("scope_type", "scope_id");



CREATE INDEX "idx_teams_forked_from" ON "public"."teams" USING "btree" ("forked_from_team_id") WHERE ("forked_from_team_id" IS NOT NULL);



CREATE INDEX "idx_teams_library_published" ON "public"."teams" USING "btree" ("library_published_at" DESC) WHERE ("library_published_at" IS NOT NULL);



CREATE INDEX "idx_teams_library_tags" ON "public"."teams" USING "gin" ("library_tags") WHERE ("library_tags" IS NOT NULL);



CREATE INDEX "idx_teams_player" ON "public"."teams" USING "btree" ("player_id");



CREATE INDEX "idx_teams_share_token" ON "public"."teams" USING "btree" ("share_token") WHERE ("share_token" IS NOT NULL);



CREATE INDEX "idx_teams_tournament" ON "public"."teams" USING "btree" ("tournament_id");



CREATE INDEX "idx_tournament_groups_tournament" ON "public"."tournament_groups" USING "btree" ("tournament_id");



CREATE INDEX "idx_tournament_reports_status" ON "public"."tournament_reports" USING "btree" ("status");



CREATE INDEX "idx_tournament_reports_tournament" ON "public"."tournament_reports" USING "btree" ("tournament_id");



CREATE INDEX "idx_tournaments_season_stage" ON "public"."tournaments" USING "btree" ("season_id", "stage_order");



CREATE INDEX "idx_wiki_note_reports_note" ON "public"."wiki_note_reports" USING "btree" ("note_id");



CREATE INDEX "idx_wiki_note_reports_status" ON "public"."wiki_note_reports" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_wiki_notes_entity" ON "public"."wiki_notes" USING "btree" ("entity_type", "entity_name");



CREATE INDEX "idx_wiki_notes_pending_moderation" ON "public"."wiki_notes" USING "btree" ("created_at" DESC) WHERE (("approved" = false) AND ("rejected_at" IS NULL));



CREATE INDEX "idx_wiki_notes_rejected" ON "public"."wiki_notes" USING "btree" ("rejected_at" DESC) WHERE ("rejected_at" IS NOT NULL);



CREATE INDEX "idx_wiki_notes_scope" ON "public"."wiki_notes" USING "btree" ("scope_type", "scope_id") WHERE ("scope_id" IS NOT NULL);



CREATE INDEX "players_status_idx" ON "public"."players" USING "btree" ("status") WHERE ("status" <> 'active'::"text");



CREATE UNIQUE INDEX "season_participants_unique_core" ON "public"."season_participants" USING "btree" ("season_id", "core_types") WHERE ("core_types" IS NOT NULL);



CREATE UNIQUE INDEX "teams_player_match_unique" ON "public"."teams" USING "btree" ("player_id", "match_id") WHERE ("match_id" IS NOT NULL);



CREATE UNIQUE INDEX "tournament_participants_seed_unique" ON "public"."tournament_participants" USING "btree" ("tournament_id", "seed") WHERE ("seed" IS NOT NULL);



CREATE OR REPLACE TRIGGER "audit_log_prevent_delete" BEFORE DELETE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_mutation"();



CREATE OR REPLACE TRIGGER "audit_log_prevent_update" BEFORE UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_mutation"();



CREATE OR REPLACE TRIGGER "trg_draft_pools_updated" BEFORE UPDATE ON "public"."draft_pools" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_evolution_tracker_updated" BEFORE UPDATE ON "public"."evolution_tracker" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_games_updated" BEFORE UPDATE ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_match_proposals_updated" BEFORE UPDATE ON "public"."match_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_matches_updated" BEFORE UPDATE ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_players_updated" BEFORE UPDATE ON "public"."players" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_rounds_updated" BEFORE UPDATE ON "public"."rounds" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_rulesets_updated" BEFORE UPDATE ON "public"."rulesets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_seasons_updated" BEFORE UPDATE ON "public"."seasons" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_teams_updated" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tournament_groups_updated" BEFORE UPDATE ON "public"."tournament_groups" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tournaments_updated" BEFORE UPDATE ON "public"."tournaments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."admin_export_limits"
    ADD CONSTRAINT "admin_export_limits_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aggregate_jobs"
    ADD CONSTRAINT "aggregate_jobs_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_avatar_gallery"
    ADD CONSTRAINT "ai_avatar_gallery_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."avatar_generations"
    ADD CONSTRAINT "avatar_generations_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_stats"
    ADD CONSTRAINT "battle_stats_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_stats"
    ADD CONSTRAINT "battle_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."broadcast_moments"
    ADD CONSTRAINT "broadcast_moments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."broadcast_moments"
    ADD CONSTRAINT "broadcast_moments_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."broadcast_moments"
    ADD CONSTRAINT "broadcast_moments_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id");



ALTER TABLE ONLY "public"."broadcast_presets"
    ADD CONSTRAINT "broadcast_presets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cast_sessions"
    ADD CONSTRAINT "cast_sessions_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_draft_pool_id_fkey" FOREIGN KEY ("draft_pool_id") REFERENCES "public"."draft_pools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."draft_pool_entries"
    ADD CONSTRAINT "draft_pool_entries_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."draft_pool_templates"
    ADD CONSTRAINT "draft_pool_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."draft_pools"
    ADD CONSTRAINT "draft_pools_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id");



ALTER TABLE ONLY "public"."draft_replay_events"
    ADD CONSTRAINT "draft_replay_events_draft_pool_id_fkey" FOREIGN KEY ("draft_pool_id") REFERENCES "public"."draft_pools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."draft_replay_events"
    ADD CONSTRAINT "draft_replay_events_pick_id_fkey" FOREIGN KEY ("pick_id") REFERENCES "public"."draft_picks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."draft_tier_limits"
    ADD CONSTRAINT "draft_tier_limits_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evolution_tiers"
    ADD CONSTRAINT "evolution_tiers_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evolution_tiers"
    ADD CONSTRAINT "evolution_tiers_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evolution_tracker"
    ADD CONSTRAINT "evolution_tracker_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evolution_tracker"
    ADD CONSTRAINT "evolution_tracker_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "fk_teams_draft_pool" FOREIGN KEY ("draft_pool_id") REFERENCES "public"."draft_pools"("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."legacy_standings"
    ADD CONSTRAINT "legacy_standings_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."legacy_standings"
    ADD CONSTRAINT "legacy_standings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_analyses"
    ADD CONSTRAINT "match_analyses_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_prep_analyses"
    ADD CONSTRAINT "match_prep_analyses_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_prep_analyses"
    ADD CONSTRAINT "match_prep_analyses_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_prep_teams"
    ADD CONSTRAINT "match_prep_teams_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_prep_teams"
    ADD CONSTRAINT "match_prep_teams_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."match_proposals"
    ADD CONSTRAINT "match_proposals_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_proposals"
    ADD CONSTRAINT "match_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."match_proposals"
    ADD CONSTRAINT "match_proposals_responder_id_fkey" FOREIGN KEY ("responder_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_player_1_id_fkey" FOREIGN KEY ("player_1_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_player_2_id_fkey" FOREIGN KEY ("player_2_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."player_achievements"
    ADD CONSTRAINT "player_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievement_definitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_achievements"
    ADD CONSTRAINT "player_achievements_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_aggregates"
    ADD CONSTRAINT "player_aggregates_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."player_ratings"
    ADD CONSTRAINT "player_ratings_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_signatures"
    ADD CONSTRAINT "player_signatures_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_streaks"
    ADD CONSTRAINT "player_streaks_last_match_id_fkey" FOREIGN KEY ("last_match_id") REFERENCES "public"."matches"("id");



ALTER TABLE ONLY "public"."player_streaks"
    ADD CONSTRAINT "player_streaks_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_admins"
    ADD CONSTRAINT "resource_admins_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rounds"
    ADD CONSTRAINT "rounds_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rulesets"
    ADD CONSTRAINT "rulesets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."season_participants"
    ADD CONSTRAINT "season_participants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."season_participants"
    ADD CONSTRAINT "season_participants_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."season_storylines"
    ADD CONSTRAINT "season_storylines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."season_storylines"
    ADD CONSTRAINT "season_storylines_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_forked_from_team_id_fkey" FOREIGN KEY ("forked_from_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id");



ALTER TABLE ONLY "public"."tournament_group_members"
    ADD CONSTRAINT "tournament_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."tournament_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_group_members"
    ADD CONSTRAINT "tournament_group_members_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_groups"
    ADD CONSTRAINT "tournament_groups_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_participants"
    ADD CONSTRAINT "tournament_participants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_participants"
    ADD CONSTRAINT "tournament_participants_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_reports"
    ADD CONSTRAINT "tournament_reports_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_reports"
    ADD CONSTRAINT "tournament_reports_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournaments"
    ADD CONSTRAINT "tournaments_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id");



ALTER TABLE ONLY "public"."tournaments"
    ADD CONSTRAINT "tournaments_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id");



ALTER TABLE ONLY "public"."wiki_note_reports"
    ADD CONSTRAINT "wiki_note_reports_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."wiki_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_note_reports"
    ADD CONSTRAINT "wiki_note_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_notes"
    ADD CONSTRAINT "wiki_notes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wiki_notes"
    ADD CONSTRAINT "wiki_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_notes"
    ADD CONSTRAINT "wiki_notes_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "public"."players"("id") ON DELETE SET NULL;



CREATE POLICY "Public read achievement_definitions" ON "public"."achievement_definitions" FOR SELECT USING (true);



CREATE POLICY "Public read aggregates" ON "public"."aggregates" FOR SELECT USING (true);



CREATE POLICY "Public read approved wiki_notes" ON "public"."wiki_notes" FOR SELECT USING (("approved" = true));



CREATE POLICY "Public read battle_stats" ON "public"."battle_stats" FOR SELECT USING (true);



CREATE POLICY "Public read broadcast_moments" ON "public"."broadcast_moments" FOR SELECT USING (true);



CREATE POLICY "Public read draft_picks" ON "public"."draft_picks" FOR SELECT USING (true);



CREATE POLICY "Public read draft_pool_entries" ON "public"."draft_pool_entries" FOR SELECT USING (true);



CREATE POLICY "Public read draft_pool_templates" ON "public"."draft_pool_templates" FOR SELECT USING (true);



CREATE POLICY "Public read draft_pools" ON "public"."draft_pools" FOR SELECT USING (true);



CREATE POLICY "Public read draft_tier_limits" ON "public"."draft_tier_limits" FOR SELECT USING (true);



CREATE POLICY "Public read evolution_tiers" ON "public"."evolution_tiers" FOR SELECT USING (true);



CREATE POLICY "Public read evolution_tracker" ON "public"."evolution_tracker" FOR SELECT USING (true);



CREATE POLICY "Public read games" ON "public"."games" FOR SELECT USING (true);



CREATE POLICY "Public read matches" ON "public"."matches" FOR SELECT USING (true);



CREATE POLICY "Public read meta_usage_cache" ON "public"."meta_usage_cache" FOR SELECT USING (true);



CREATE POLICY "Public read player_achievements" ON "public"."player_achievements" FOR SELECT USING (true);



CREATE POLICY "Public read player_aggregates" ON "public"."player_aggregates" FOR SELECT USING (true);



CREATE POLICY "Public read player_ratings" ON "public"."player_ratings" FOR SELECT USING (true);



CREATE POLICY "Public read player_signatures" ON "public"."player_signatures" FOR SELECT USING (true);



CREATE POLICY "Public read player_streaks" ON "public"."player_streaks" FOR SELECT USING (true);



CREATE POLICY "Public read players" ON "public"."players" FOR SELECT USING (true);



CREATE POLICY "Public read rating_history" ON "public"."rating_history" FOR SELECT USING (true);



CREATE POLICY "Public read rounds" ON "public"."rounds" FOR SELECT USING (true);



CREATE POLICY "Public read rulesets" ON "public"."rulesets" FOR SELECT USING (true);



CREATE POLICY "Public read season_participants" ON "public"."season_participants" FOR SELECT USING (true);



CREATE POLICY "Public read seasons" ON "public"."seasons" FOR SELECT USING (true);



CREATE POLICY "Public read smogon_sample_sets" ON "public"."smogon_sample_sets" FOR SELECT USING (true);



CREATE POLICY "Public read tournament_group_members" ON "public"."tournament_group_members" FOR SELECT USING (true);



CREATE POLICY "Public read tournament_groups" ON "public"."tournament_groups" FOR SELECT USING (true);



CREATE POLICY "Public read tournament_participants" ON "public"."tournament_participants" FOR SELECT USING (true);



CREATE POLICY "Public read tournaments" ON "public"."tournaments" FOR SELECT USING (true);



ALTER TABLE "public"."achievement_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_export_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aggregate_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aggregates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_avatar_gallery" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_generations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avatar_generations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcast_moments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcast_presets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cast_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discord_webhooks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_pool_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_pool_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_pools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_replay_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_tier_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."evolution_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."evolution_tracker" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legacy_standings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_analyses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_prep_analyses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_prep_teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_usage_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_aggregates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_signatures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_streaks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rating_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resource_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rounds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rulesets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."season_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."season_storylines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."smogon_sample_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournament_group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournament_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournament_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournament_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournaments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wiki_note_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wiki_notes" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."batch_decrement_aggregates"("p_deltas" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."batch_decrement_aggregates"("p_deltas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_decrement_aggregates"("p_deltas" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."batch_decrement_player_aggregates"("p_deltas" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."batch_decrement_player_aggregates"("p_deltas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_decrement_player_aggregates"("p_deltas" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."batch_update_seeds"("p_tournament_id" "uuid", "p_seeds" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."batch_update_seeds"("p_tournament_id" "uuid", "p_seeds" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_update_seeds"("p_tournament_id" "uuid", "p_seeds" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."batch_upsert_aggregates"("p_deltas" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."batch_upsert_aggregates"("p_deltas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_upsert_aggregates"("p_deltas" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."batch_upsert_player_aggregates"("p_deltas" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."batch_upsert_player_aggregates"("p_deltas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_upsert_player_aggregates"("p_deltas" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_aggregate_jobs_for_game"("p_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_aggregate_jobs_for_game"("p_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_aggregate_jobs_for_game"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_record_admin_export"("p_player_id" "uuid", "p_daily_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_record_admin_export"("p_player_id" "uuid", "p_daily_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_record_admin_export"("p_player_id" "uuid", "p_daily_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_record_ai_generation"("p_player_id" "uuid", "p_endpoint" "text", "p_daily_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_record_ai_generation"("p_player_id" "uuid", "p_endpoint" "text", "p_daily_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_record_ai_generation"("p_player_id" "uuid", "p_endpoint" "text", "p_daily_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_record_avatar_generation"("p_player_id" "uuid", "p_daily_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_record_avatar_generation"("p_player_id" "uuid", "p_daily_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_record_avatar_generation"("p_player_id" "uuid", "p_daily_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."aggregate_jobs" TO "anon";
GRANT ALL ON TABLE "public"."aggregate_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."aggregate_jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_aggregate_jobs"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_aggregate_jobs"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_aggregate_jobs"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_move_counts"("existing" "jsonb", "incoming" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_move_counts"("existing" "jsonb", "incoming" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_move_counts"("existing" "jsonb", "incoming" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_log_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reclaim_stale_aggregate_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."reclaim_stale_aggregate_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reclaim_stale_aggregate_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."subtract_move_counts"("existing" "jsonb", "removed" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."subtract_move_counts"("existing" "jsonb", "removed" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."subtract_move_counts"("existing" "jsonb", "removed" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_player_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_player_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_player_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_player_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_player_aggregate"("p_scope_type" "public"."aggregate_scope", "p_scope_id" "uuid", "p_player_id" "uuid", "p_pokemon_name" "text", "p_appearances" integer, "p_brought" integer, "p_led" integer, "p_kos_dealt" integer, "p_koed" integer, "p_wins" integer, "p_games" integer, "p_move_counts" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."achievement_definitions" TO "anon";
GRANT ALL ON TABLE "public"."achievement_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."achievement_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_export_limits" TO "anon";
GRANT ALL ON TABLE "public"."admin_export_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_export_limits" TO "service_role";



GRANT ALL ON TABLE "public"."aggregates" TO "anon";
GRANT ALL ON TABLE "public"."aggregates" TO "authenticated";
GRANT ALL ON TABLE "public"."aggregates" TO "service_role";



GRANT ALL ON TABLE "public"."ai_avatar_gallery" TO "anon";
GRANT ALL ON TABLE "public"."ai_avatar_gallery" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_avatar_gallery" TO "service_role";



GRANT ALL ON TABLE "public"."ai_generations" TO "anon";
GRANT ALL ON TABLE "public"."ai_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_generations" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."avatar_generations" TO "anon";
GRANT ALL ON TABLE "public"."avatar_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."avatar_generations" TO "service_role";



GRANT ALL ON TABLE "public"."battle_stats" TO "anon";
GRANT ALL ON TABLE "public"."battle_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."battle_stats" TO "service_role";



GRANT ALL ON TABLE "public"."broadcast_moments" TO "anon";
GRANT ALL ON TABLE "public"."broadcast_moments" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcast_moments" TO "service_role";



GRANT ALL ON TABLE "public"."broadcast_presets" TO "anon";
GRANT ALL ON TABLE "public"."broadcast_presets" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcast_presets" TO "service_role";



GRANT ALL ON TABLE "public"."cast_sessions" TO "anon";
GRANT ALL ON TABLE "public"."cast_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."cast_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."discord_webhooks" TO "anon";
GRANT ALL ON TABLE "public"."discord_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."discord_webhooks" TO "service_role";



GRANT ALL ON TABLE "public"."draft_picks" TO "anon";
GRANT ALL ON TABLE "public"."draft_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_picks" TO "service_role";



GRANT ALL ON TABLE "public"."draft_pool_entries" TO "anon";
GRANT ALL ON TABLE "public"."draft_pool_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_pool_entries" TO "service_role";



GRANT ALL ON TABLE "public"."draft_pool_templates" TO "anon";
GRANT ALL ON TABLE "public"."draft_pool_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_pool_templates" TO "service_role";



GRANT ALL ON TABLE "public"."draft_pools" TO "anon";
GRANT ALL ON TABLE "public"."draft_pools" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_pools" TO "service_role";



GRANT ALL ON TABLE "public"."draft_replay_events" TO "anon";
GRANT ALL ON TABLE "public"."draft_replay_events" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_replay_events" TO "service_role";



GRANT ALL ON TABLE "public"."draft_tier_limits" TO "anon";
GRANT ALL ON TABLE "public"."draft_tier_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_tier_limits" TO "service_role";



GRANT ALL ON TABLE "public"."evolution_tiers" TO "anon";
GRANT ALL ON TABLE "public"."evolution_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."evolution_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."evolution_tracker" TO "anon";
GRANT ALL ON TABLE "public"."evolution_tracker" TO "authenticated";
GRANT ALL ON TABLE "public"."evolution_tracker" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."legacy_standings" TO "anon";
GRANT ALL ON TABLE "public"."legacy_standings" TO "authenticated";
GRANT ALL ON TABLE "public"."legacy_standings" TO "service_role";



GRANT ALL ON TABLE "public"."match_analyses" TO "anon";
GRANT ALL ON TABLE "public"."match_analyses" TO "authenticated";
GRANT ALL ON TABLE "public"."match_analyses" TO "service_role";



GRANT ALL ON TABLE "public"."match_prep_analyses" TO "anon";
GRANT ALL ON TABLE "public"."match_prep_analyses" TO "authenticated";
GRANT ALL ON TABLE "public"."match_prep_analyses" TO "service_role";



GRANT ALL ON TABLE "public"."match_prep_teams" TO "anon";
GRANT ALL ON TABLE "public"."match_prep_teams" TO "authenticated";
GRANT ALL ON TABLE "public"."match_prep_teams" TO "service_role";



GRANT ALL ON TABLE "public"."match_proposals" TO "anon";
GRANT ALL ON TABLE "public"."match_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."match_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."matches" TO "anon";
GRANT ALL ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";



GRANT ALL ON TABLE "public"."meta_usage_cache" TO "anon";
GRANT ALL ON TABLE "public"."meta_usage_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_usage_cache" TO "service_role";



GRANT ALL ON TABLE "public"."player_achievements" TO "anon";
GRANT ALL ON TABLE "public"."player_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."player_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."player_aggregates" TO "anon";
GRANT ALL ON TABLE "public"."player_aggregates" TO "authenticated";
GRANT ALL ON TABLE "public"."player_aggregates" TO "service_role";



GRANT ALL ON TABLE "public"."player_ratings" TO "anon";
GRANT ALL ON TABLE "public"."player_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."player_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."player_signatures" TO "anon";
GRANT ALL ON TABLE "public"."player_signatures" TO "authenticated";
GRANT ALL ON TABLE "public"."player_signatures" TO "service_role";



GRANT ALL ON TABLE "public"."player_streaks" TO "anon";
GRANT ALL ON TABLE "public"."player_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."player_streaks" TO "service_role";



GRANT ALL ON TABLE "public"."players" TO "anon";
GRANT ALL ON TABLE "public"."players" TO "authenticated";
GRANT ALL ON TABLE "public"."players" TO "service_role";



GRANT ALL ON TABLE "public"."rating_history" TO "anon";
GRANT ALL ON TABLE "public"."rating_history" TO "authenticated";
GRANT ALL ON TABLE "public"."rating_history" TO "service_role";



GRANT ALL ON TABLE "public"."resource_admins" TO "anon";
GRANT ALL ON TABLE "public"."resource_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."resource_admins" TO "service_role";



GRANT ALL ON TABLE "public"."rounds" TO "anon";
GRANT ALL ON TABLE "public"."rounds" TO "authenticated";
GRANT ALL ON TABLE "public"."rounds" TO "service_role";



GRANT ALL ON TABLE "public"."rulesets" TO "anon";
GRANT ALL ON TABLE "public"."rulesets" TO "authenticated";
GRANT ALL ON TABLE "public"."rulesets" TO "service_role";



GRANT ALL ON TABLE "public"."season_participants" TO "anon";
GRANT ALL ON TABLE "public"."season_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."season_participants" TO "service_role";



GRANT ALL ON TABLE "public"."season_storylines" TO "anon";
GRANT ALL ON TABLE "public"."season_storylines" TO "authenticated";
GRANT ALL ON TABLE "public"."season_storylines" TO "service_role";



GRANT ALL ON TABLE "public"."seasons" TO "anon";
GRANT ALL ON TABLE "public"."seasons" TO "authenticated";
GRANT ALL ON TABLE "public"."seasons" TO "service_role";



GRANT ALL ON TABLE "public"."smogon_sample_sets" TO "anon";
GRANT ALL ON TABLE "public"."smogon_sample_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."smogon_sample_sets" TO "service_role";



GRANT ALL ON TABLE "public"."social_integrations" TO "anon";
GRANT ALL ON TABLE "public"."social_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."social_integrations" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."tournament_group_members" TO "anon";
GRANT ALL ON TABLE "public"."tournament_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."tournament_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."tournament_groups" TO "anon";
GRANT ALL ON TABLE "public"."tournament_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."tournament_groups" TO "service_role";



GRANT ALL ON TABLE "public"."tournament_participants" TO "anon";
GRANT ALL ON TABLE "public"."tournament_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."tournament_participants" TO "service_role";



GRANT ALL ON TABLE "public"."tournament_reports" TO "anon";
GRANT ALL ON TABLE "public"."tournament_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."tournament_reports" TO "service_role";



GRANT ALL ON TABLE "public"."tournaments" TO "anon";
GRANT ALL ON TABLE "public"."tournaments" TO "authenticated";
GRANT ALL ON TABLE "public"."tournaments" TO "service_role";



GRANT ALL ON TABLE "public"."wiki_note_reports" TO "anon";
GRANT ALL ON TABLE "public"."wiki_note_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."wiki_note_reports" TO "service_role";



GRANT ALL ON TABLE "public"."wiki_notes" TO "anon";
GRANT ALL ON TABLE "public"."wiki_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."wiki_notes" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







