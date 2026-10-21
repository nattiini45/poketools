-- Evolution Point Buy: full remediation (review round 2)
--
-- C4:  season FKs on evo_progress_log / redraft_history gain ON DELETE CASCADE
--      (deleteSeason previously failed once EPB rows existed).
-- C5+C6: epb_token_grants one-shot table — player-scoped, redraft-proof and
--      race-free (PK violation instead of SELECT-then-INSERT guard).
-- W7:  evolution_events development-event log.
-- S13: evolution_tracker.locked_stage3_pokemon, point_buy_list_entries.species_ids.
-- C2:  trigger blocks mutation of list entries whose version is bound to a
--      non-upcoming season (immutable snapshot enforcement).
-- S15: atomic RPCs epb_apply_progress / epb_grant_and_apply_tokens /
--      epb_execute_redraft (each call = one transaction).
-- S20: covering indexes for redraft history, progress log and entry lookups.
-- S19: explicit service-role-only comments on all EPB tables.

-- ── 1. Season FK cascade fixes (C4) ────────────────────────────────

ALTER TABLE "public"."evo_progress_log"
    DROP CONSTRAINT IF EXISTS "evo_progress_log_season_id_fkey";
ALTER TABLE "public"."evo_progress_log"
    ADD CONSTRAINT "evo_progress_log_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;

ALTER TABLE "public"."redraft_history"
    DROP CONSTRAINT IF EXISTS "redraft_history_season_id_fkey";
ALTER TABLE "public"."redraft_history"
    ADD CONSTRAINT "redraft_history_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;

-- ── 2. One-shot token grants (C5 + C6) ─────────────────────────────
-- A grant row records that a player's one-shot token event (draft-token
-- allocation / kill-token distribution) has happened. The PK makes the
-- guard atomic and independent of tracker rows, so redrafts (which delete
-- trackers and SET NULL the progress-log references) cannot reopen it.

CREATE TABLE IF NOT EXISTS "public"."epb_token_grants" (
    "season_id" "uuid" NOT NULL REFERENCES "public"."seasons"("id") ON DELETE CASCADE,
    "player_id" "uuid" NOT NULL REFERENCES "public"."players"("id"),
    "grant_type" "text" NOT NULL CHECK ("grant_type" IN ('draft_token', 'kill_token')),
    "token_count" smallint NOT NULL DEFAULT 0,
    "created_by" "uuid" REFERENCES "public"."players"("id"),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    PRIMARY KEY ("season_id", "player_id", "grant_type")
);

ALTER TABLE "public"."epb_token_grants" OWNER TO "postgres";
ALTER TABLE "public"."epb_token_grants" ENABLE ROW LEVEL SECURITY;

-- ── 3. Development events (W7) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."evolution_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "season_id" "uuid" NOT NULL REFERENCES "public"."seasons"("id") ON DELETE CASCADE,
    "matchday" smallint,
    "tracker_id" "uuid" REFERENCES "public"."evolution_tracker"("id") ON DELETE SET NULL,
    "player_id" "uuid" NOT NULL REFERENCES "public"."players"("id"),
    "base_pokemon" "text" NOT NULL,
    "previous_form" "text" NOT NULL,
    "new_form" "text" NOT NULL,
    "previous_stage" smallint,
    "new_stage" smallint NOT NULL,
    "total_kos" smallint,
    "is_devolution" boolean NOT NULL DEFAULT false,
    "is_manual" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."evolution_events" OWNER TO "postgres";
ALTER TABLE "public"."evolution_events" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "idx_evo_events_season_matchday"
    ON "public"."evolution_events" ("season_id", "matchday");
CREATE INDEX IF NOT EXISTS "idx_evo_events_tracker"
    ON "public"."evolution_events" ("tracker_id");

-- ── 4. New columns (S13) ───────────────────────────────────────────

ALTER TABLE "public"."evolution_tracker"
    ADD COLUMN IF NOT EXISTS "locked_stage3_pokemon" "text" DEFAULT NULL;

ALTER TABLE "public"."point_buy_list_entries"
    ADD COLUMN IF NOT EXISTS "species_ids" "jsonb" DEFAULT NULL;

-- ── 5. Bound list version immutability (C2) ───────────────────────

CREATE OR REPLACE FUNCTION public.prevent_bound_list_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_version_id := OLD.list_version_id;
  ELSE
    v_version_id := NEW.list_version_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.seasons
    WHERE point_buy_list_id = v_version_id
      AND status <> 'upcoming'
  ) THEN
    RAISE EXCEPTION 'Point-buy list version % is bound to a non-upcoming season and is immutable', v_version_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_pble_immutable" ON "public"."point_buy_list_entries";
CREATE TRIGGER "trg_pble_immutable"
    BEFORE INSERT OR UPDATE OR DELETE ON "public"."point_buy_list_entries"
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bound_list_entry_mutation();

-- ── 6. Atomic RPCs (S15 / C6) ──────────────────────────────────────

-- 6.1 Progress increment + audit log in one transaction.
--     p_source uses the log vocabulary (real_kill, draft_token, kill_token,
--     cosmo_point); the tracker column is derived inside the function.
CREATE OR REPLACE FUNCTION public.epb_apply_progress(
  p_tracker_id uuid,
  p_source text,
  p_amount integer,
  p_matchday integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS public.evolution_tracker
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_column text;
  v_row public.evolution_tracker;
BEGIN
  v_column := CASE p_source
    WHEN 'real_kill'   THEN 'real_kills'
    WHEN 'draft_token' THEN 'draft_tokens'
    WHEN 'kill_token'  THEN 'kill_tokens'
    WHEN 'cosmo_point' THEN 'cosmo_points'
    ELSE NULL
  END;
  IF v_column IS NULL THEN
    RAISE EXCEPTION 'Invalid progress source: %', p_source;
  END IF;

  v_row := public.increment_tracker_progress(p_tracker_id, v_column, p_amount);

  INSERT INTO public.evo_progress_log
    (tracker_id, season_id, matchday, source, amount, note, created_by)
  VALUES
    (p_tracker_id, v_row.season_id, p_matchday, p_source, p_amount, p_note, p_created_by);

  RETURN v_row;
END;
$$;

-- 6.2 One-shot token grant + allocation in one transaction.
--     The grant INSERT is the gate: a duplicate raises unique_violation
--     (23505), which the route maps to 409. p_allocations is a jsonb array
--     of { tracker_id, amount, note }.
CREATE OR REPLACE FUNCTION public.epb_grant_and_apply_tokens(
  p_season_id uuid,
  p_player_id uuid,
  p_grant_type text,
  p_allocations jsonb,
  p_created_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_alloc jsonb;
  v_tracker_id uuid;
  v_total integer := 0;
BEGIN
  IF p_grant_type NOT IN ('draft_token', 'kill_token') THEN
    RAISE EXCEPTION 'Invalid grant type: %', p_grant_type;
  END IF;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_total := v_total + (v_alloc->>'amount')::integer;
  END LOOP;

  INSERT INTO public.epb_token_grants (season_id, player_id, grant_type, token_count, created_by)
  VALUES (p_season_id, p_player_id, p_grant_type, v_total, p_created_by);

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_tracker_id := (v_alloc->>'tracker_id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.evolution_tracker
      WHERE id = v_tracker_id AND season_id = p_season_id AND player_id = p_player_id
    ) THEN
      RAISE EXCEPTION 'Tracker % does not belong to player % in season %',
        v_tracker_id, p_player_id, p_season_id;
    END IF;

    PERFORM public.epb_apply_progress(
      v_tracker_id,
      p_grant_type,
      (v_alloc->>'amount')::integer,
      NULL,
      v_alloc->>'note',
      p_created_by
    );
  END LOOP;
END;
$$;

-- 6.3 Atomic redraft: create new tracker(s), record history, delete old
--     tracker(s) — one transaction for free swaps (1 swap) and trades
--     (2 mirrored swaps). p_swaps is a jsonb array of
--     { player_id, from_tracker_id, new_tracker: {...}, history: {...} }.
--     An advisory xact lock per season serializes concurrent redrafts so
--     the free-line check cannot race.
CREATE OR REPLACE FUNCTION public.epb_execute_redraft(
  p_season_id uuid,
  p_swaps jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_swap jsonb;
  v_new jsonb;
  v_hist jsonb;
  v_from public.evolution_tracker;
  v_from_ids uuid[] := '{}';
  v_new_id uuid;
  v_new_ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  -- Pass 1: lock + validate every source tracker.
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    SELECT * INTO v_from FROM public.evolution_tracker
      WHERE id = (v_swap->>'from_tracker_id')::uuid
        AND season_id = p_season_id
        AND player_id = (v_swap->>'player_id')::uuid
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source tracker % not found for this player in this season',
        v_swap->>'from_tracker_id';
    END IF;
    v_from_ids := array_append(v_from_ids, v_from.id);
  END LOOP;

  -- Pass 2: every target line must be free (ignoring lines leaving in
  -- this same batch — the trade counter-side).
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    IF EXISTS (
      SELECT 1 FROM public.evolution_tracker
      WHERE season_id = p_season_id
        AND base_pokemon = v_swap->'new_tracker'->>'base_pokemon'
        AND NOT (id = ANY(v_from_ids))
    ) THEN
      RAISE EXCEPTION 'Line % is already owned by another player',
        v_swap->'new_tracker'->>'base_pokemon';
    END IF;
  END LOOP;

  -- Pass 3: create new trackers and history rows (history references the
  -- still-existing source tracker; the FK is ON DELETE SET NULL).
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    v_new := v_swap->'new_tracker';
    v_hist := v_swap->'history';

    INSERT INTO public.evolution_tracker
      (season_id, player_id, base_pokemon, current_form, current_stage,
       total_kos, real_kills, evolution_points_awarded, locked_stage3_pokemon)
    VALUES
      (p_season_id,
       (v_swap->>'player_id')::uuid,
       v_new->>'base_pokemon',
       v_new->>'current_form',
       (v_new->>'current_stage')::integer,
       (v_new->>'total_kos')::integer,
       (v_new->>'real_kills')::integer,
       COALESCE((v_new->>'evolution_points_awarded')::integer, 0),
       v_new->>'locked_stage3_pokemon')
    RETURNING id INTO v_new_id;

    INSERT INTO public.redraft_history
      (season_id, player_id, from_tracker_id, to_base_pokemon, to_stage3_pokemon,
       transfer_type, trade_partner_id, missing_kills_transferred, points_spent)
    VALUES
      (p_season_id,
       (v_swap->>'player_id')::uuid,
       (v_swap->>'from_tracker_id')::uuid,
       v_hist->>'to_base_pokemon',
       v_hist->>'to_stage3_pokemon',
       v_hist->>'transfer_type',
       (v_hist->>'trade_partner_id')::uuid,
       COALESCE((v_hist->>'missing_kills_transferred')::integer, 0),
       COALESCE((v_hist->>'points_spent')::integer, 0));

    v_new_ids := v_new_ids || to_jsonb(v_new_id);
  END LOOP;

  -- Pass 4: delete the source trackers last.
  DELETE FROM public.evolution_tracker WHERE id = ANY(v_from_ids);

  RETURN v_new_ids;
END;
$$;

-- ── 7. Indexes (S20) ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_redraft_history_season_player"
    ON "public"."redraft_history" ("season_id", "player_id");
CREATE INDEX IF NOT EXISTS "idx_epl_season_source"
    ON "public"."evo_progress_log" ("season_id", "source");
CREATE INDEX IF NOT EXISTS "idx_pble_version_base"
    ON "public"."point_buy_list_entries" ("list_version_id", "base_pokemon");

-- ── 8. RLS posture (S19) ───────────────────────────────────────────
-- All EPB tables are service-role only: reads/writes go through Next.js
-- API routes (auth enforced in handlers). RLS stays enabled with zero
-- policies by design — anon/browser access is intentionally impossible.

COMMENT ON TABLE "public"."point_buy_list_versions" IS
  'Service-role only. Access via Next.js API routes; no anon/browser RLS policies by design.';
COMMENT ON TABLE "public"."point_buy_list_entries" IS
  'Service-role only. Access via Next.js API routes; no anon/browser RLS policies by design. Entries of versions bound to non-upcoming seasons are immutable (trg_pble_immutable).';
COMMENT ON TABLE "public"."evo_progress_log" IS
  'Service-role only. Access via Next.js API routes; no anon/browser RLS policies by design.';
COMMENT ON TABLE "public"."format_rules" IS
  'Service-role only. Access via Next.js API routes; no anon/browser RLS policies by design.';
COMMENT ON TABLE "public"."redraft_history" IS
  'Service-role only. Access via Next.js API routes; no anon/browser RLS policies by design.';
COMMENT ON TABLE "public"."team_roles" IS
  'Service-role only. Access via Next.js API routes; no anon/browser RLS policies by design.';
COMMENT ON TABLE "public"."epb_token_grants" IS
  'Service-role only. One-shot gate for EPB token allocation/distribution; no anon/browser RLS policies by design.';
COMMENT ON TABLE "public"."evolution_events" IS
  'Service-role only. EPB development-event log; no anon/browser RLS policies by design.';
