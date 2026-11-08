-- Format engine: one phase per group for a stage with `foreach_group`.
--
-- tournaments.format_group   0 for every ordinary phase; 1..N for the phase a `foreach_group` stage plays for group N of
--                            the stage it repeats over. A kit stage then maps to one phase per group, all with the same
--                            format_stage_key, so the key alone no longer identifies a phase: (season_id,
--                            format_stage_key, format_group) does.
-- tournament_groups          unique (tournament_id, group_number): concurrent group forming collides instead of duplicating.
-- format_attach_season()     reads format_group from each stage row (absent: 0), upserts by the three-part key and
--                            removes the phases whose (key, group) left the spec (a stage that now repeats over fewer
--                            groups, or no longer repeats). Same result as the 20261104100000 body with one new
--                            argument, p_confirm_clear (see Reset guard below), and
--                            each entry of `stages` carries its `group` besides `id` and `key`.
--
-- Runtime state (20261105090000): an attach that REPLACES a format and a detach empty the nine format_* runtime tables of the
-- league (format__clear_runtime). The league has not started (both refuse first), but players may already have saved picks,
-- an admin may have adjusted, a time mark may have fired: all of it belongs to the spec that is going away, and a stale
-- event key ("already fired") or a locked action flag would block the new spec's events. format_detach_season() is
-- redefined here for that (its body is 20261026090000's plus the clear).
--
-- Reset guard: the clear above is silent, but "the league has not started" does not mean "nothing happened": the draw
-- of a Secret Santa, the locked premium reservations and the gifts all live in a phase that counts as not started. A
-- replace or a detach whose league holds relation links, resource items, action submissions or adjustments therefore
-- refuses with FORMAT_RUNTIME_HAS_DATA (DETAIL {links, items, submissions, adjustments}) unless the caller passes
-- p_confirm_clear = true. A first attach and a league without such rows are unaffected. The new argument is a new
-- signature, so the two old ones are dropped first (format__guard_runtime_clear is the shared check).
--
-- The confirmation names what the admin saw: p_confirmed_counts is the {links, items, submissions, adjustments} of the
-- FORMAT_RUNTIME_HAS_DATA answer the admin confirmed. Players keep saving picks while the dialog is open, so a confirmed clear
-- that finds MORE rows than that raises FORMAT_RUNTIME_HAS_DATA again with the fresh counts (the admin confirms again). NULL
-- keeps the blanket meaning of p_confirm_clear for callers that never showed a count.
--
-- Race with the generators and the status writers: attach and detach lock the seasons row FOR UPDATE and then every phase
-- (tournaments) row of the league FOR UPDATE, in id order, BEFORE they decide format_season_started. A round write
-- (round_write takes seasons KEY SHARE first), a plain status UPDATE of a phase and the foreign-key lock of any round insert all
-- conflict with those locks, so the started check sees every committed round and status, and nothing can start the league
-- between the check and the DELETE/upsert that follows. (A STABLE snapshot read alone would miss a round that is committing.)
--
-- What the clear deleted: the guard always counts the four tables and returns {links, items, submissions, adjustments},
-- confirmed or not. A replace (not a first attach) and a detach return them as `cleared`, so the audit entry of a
-- confirmed clear can say how much was destroyed (the adjustment rows carry the reasons, and they go with the clear).
--
-- Service-role only, like the functions it replaces (src/lib/supabase/__tests__/migration-api-grants.test.ts).
-- Deploy order: before the code.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.tournaments
  ADD COLUMN format_group integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT tournaments_format_group_check CHECK (format_group >= 0 AND format_group <= 256);

COMMENT ON COLUMN public.tournaments.format_group IS
  'Format engine: 0 for an ordinary phase, N for the phase a foreach_group stage plays for group N of its source stage.';

DROP INDEX public.uq_tournaments_season_format_stage;
CREATE UNIQUE INDEX uq_tournaments_season_format_stage ON public.tournaments (season_id, format_stage_key, format_group)
  WHERE format_stage_key IS NOT NULL;

-- A phase has one group per number. Two requests that form the groups of a phase at the same moment (the first round of a
-- kit stage with groups, from two tabs or a retry) each insert 1..N; the second insert now fails with 23505, which the
-- engine answers as 409 groups_forming_in_progress, instead of leaving a duplicate set of groups. Every writer deletes a
-- phase's groups before it inserts a new layout, so no existing flow collides.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_groups_tournament_group_number
  ON public.tournament_groups (tournament_id, group_number);

DROP FUNCTION IF EXISTS public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.format_detach_season(uuid);
DROP FUNCTION IF EXISTS public.format_detach_season(uuid, boolean);
DROP FUNCTION IF EXISTS public.format__guard_runtime_clear(uuid, boolean);

-- Internal: locks the seasons row (done by the caller) then every phase row of the league FOR UPDATE, in id order, so the
-- started check that follows reads a state no writer can still change (see the header).
CREATE OR REPLACE FUNCTION public.format__lock_phases(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.tournaments t WHERE t.season_id = p_season_id ORDER BY t.id FOR UPDATE;
END $$;

-- Internal. Returns the four counts {links, items, submissions, adjustments} of the runtime rows a clear would delete
-- and refuses (FORMAT_RUNTIME_HAS_DATA, DETAIL = the same counts) when there are any and the caller has not confirmed.
-- Counts only the rows a person or a draw produced (links, items, submissions, adjustments); flags, events, checks,
-- attributes and track progress follow from them or are rebuilt by the new spec.
CREATE OR REPLACE FUNCTION public.format__guard_runtime_clear(p_season_id uuid, p_confirm boolean, p_confirmed_counts jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_links       integer;
  v_items       integer;
  v_submissions integer;
  v_adjustments integer;
  v_counts      jsonb;
BEGIN
  SELECT count(*) INTO v_links       FROM public.format_relation_links     WHERE season_id = p_season_id;
  SELECT count(*) INTO v_items       FROM public.format_resource_items     WHERE season_id = p_season_id;
  SELECT count(*) INTO v_submissions FROM public.format_action_submissions WHERE season_id = p_season_id;
  SELECT count(*) INTO v_adjustments FROM public.format_adjustments        WHERE season_id = p_season_id;
  v_counts := jsonb_build_object('links', v_links, 'items', v_items, 'submissions', v_submissions,
                                 'adjustments', v_adjustments);
  IF NOT p_confirm AND v_links + v_items + v_submissions + v_adjustments > 0 THEN
    RAISE EXCEPTION 'FORMAT_RUNTIME_HAS_DATA' USING ERRCODE = 'P0001', DETAIL = v_counts::text;
  END IF;
  -- Confirmed, but only what the admin was shown: a table that grew since is not covered by the confirmation.
  IF p_confirm AND p_confirmed_counts IS NOT NULL AND jsonb_typeof(p_confirmed_counts) = 'object' AND (
       v_links > coalesce((p_confirmed_counts ->> 'links')::integer, 0)
    OR v_items > coalesce((p_confirmed_counts ->> 'items')::integer, 0)
    OR v_submissions > coalesce((p_confirmed_counts ->> 'submissions')::integer, 0)
    OR v_adjustments > coalesce((p_confirmed_counts ->> 'adjustments')::integer, 0)) THEN
    RAISE EXCEPTION 'FORMAT_RUNTIME_HAS_DATA' USING ERRCODE = 'P0001', DETAIL = v_counts::text;
  END IF;
  RETURN v_counts;
END $$;

CREATE OR REPLACE FUNCTION public.format_attach_season(
  p_season_id uuid, p_definition_id uuid, p_version_no integer, p_spec jsonb, p_spec_hash text, p_seed text, p_stages jsonb,
  p_preset_rulesets jsonb DEFAULT '{}'::jsonb, p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_format           public.season_format_type;
  v_replaced         boolean;
  v_manual           integer;
  v_removed          uuid[];
  v_stages           jsonb;
  v_previous         jsonb;
  v_removed_rulesets uuid[];
  v_cleared          jsonb;
BEGIN
  IF p_stages IS NULL OR jsonb_typeof(p_stages) <> 'array' THEN
    RAISE EXCEPTION 'format_attach_season: p_stages must be a json array' USING ERRCODE = '22023';
  END IF;
  IF p_preset_rulesets IS NULL OR jsonb_typeof(p_preset_rulesets) <> 'object' THEN
    RAISE EXCEPTION 'format_attach_season: p_preset_rulesets must be a json object' USING ERRCODE = '22023';
  END IF;
  SELECT s.format_type INTO v_format FROM public.seasons s WHERE s.id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_format <> 'custom' THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_CUSTOM' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.format__lock_phases(p_season_id);
  IF public.format_season_started(p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_SEASON_STARTED' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_manual FROM public.tournaments t
   WHERE t.season_id = p_season_id AND t.format_stage_key IS NULL;
  IF v_manual > 0 THEN
    RAISE EXCEPTION 'FORMAT_SEASON_HAS_MANUAL_PHASES' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('count', v_manual)::text;
  END IF;

  SELECT f.preset_rulesets INTO v_previous FROM public.season_formats f WHERE f.season_id = p_season_id;
  v_replaced := FOUND;
  IF v_replaced THEN
    v_cleared := public.format__guard_runtime_clear(p_season_id, coalesce(p_confirm_clear, false), p_confirmed_counts);
  END IF;
  -- A first attach clears too: runtime rows without a season_formats row belong to no format (a ghost check or an event of a
  -- format that was detached, written by a writer that raced the detach), and would otherwise be inherited by the new one.
  PERFORM public.format__clear_runtime(p_season_id);
  INSERT INTO public.season_formats AS f (season_id, definition_id, version_no, spec, spec_hash, seed, preset_rulesets)
  VALUES (p_season_id, p_definition_id, p_version_no, p_spec, p_spec_hash, p_seed, p_preset_rulesets)
  ON CONFLICT (season_id) DO UPDATE
    SET definition_id = EXCLUDED.definition_id, version_no = EXCLUDED.version_no, spec = EXCLUDED.spec,
        spec_hash = EXCLUDED.spec_hash, seed = EXCLUDED.seed, tunables = '{}'::jsonb,
        amendments = '[]'::jsonb, preset_rulesets = EXCLUDED.preset_rulesets, frozen_at = now();

  -- Phases whose (stage, group) left the spec are removed. The started check above, taken under the seasons row and every
  -- phase row (format__lock_phases), proves they are upcoming and have no rounds, and no writer can change that before this
  -- statement.
  WITH wanted AS (
    SELECT x.key, coalesce(x.format_group, 0) AS format_group
      FROM jsonb_to_recordset(p_stages) AS x(key text, format_group integer)),
  gone AS (
    DELETE FROM public.tournaments t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM wanted w WHERE w.key = t.format_stage_key AND w.format_group = t.format_group)
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;

  WITH up AS (
    INSERT INTO public.tournaments AS t
           (season_id, format_stage_key, format_group, name, bracket_type, ruleset_id, best_of_default, bo_overrides,
            is_doubles, bracket_reset_enabled, third_place_enabled, stage_order, stage_spec)
    SELECT p_season_id, x.key, coalesce(x.format_group, 0), x.name, x.bracket_type, x.ruleset_id, x.best_of_default,
           coalesce(x.bo_overrides, '{}'::jsonb), x.is_doubles, x.bracket_reset_enabled,
           coalesce(x.third_place_enabled, false), x.stage_order, x.stage_spec
      FROM jsonb_to_recordset(p_stages) AS x(
             key text, format_group integer, name text, bracket_type public.bracket_type, ruleset_id uuid,
             best_of_default integer, bo_overrides jsonb, is_doubles boolean, bracket_reset_enabled boolean,
             third_place_enabled boolean, stage_order integer, stage_spec jsonb)
    ON CONFLICT (season_id, format_stage_key, format_group) WHERE format_stage_key IS NOT NULL DO UPDATE
      SET name = EXCLUDED.name, bracket_type = EXCLUDED.bracket_type, ruleset_id = EXCLUDED.ruleset_id,
          best_of_default = EXCLUDED.best_of_default, bo_overrides = EXCLUDED.bo_overrides,
          is_doubles = EXCLUDED.is_doubles, bracket_reset_enabled = EXCLUDED.bracket_reset_enabled,
          third_place_enabled = EXCLUDED.third_place_enabled,
          stage_order = EXCLUDED.stage_order, stage_spec = EXCLUDED.stage_spec
    RETURNING t.id, t.format_stage_key, t.format_group)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'key', u.format_stage_key, 'group', u.format_group)), '[]'::jsonb)
    INTO v_stages FROM up u;

  -- Rulesets the previous attach created that this one no longer uses (after the phases point at the new ones).
  v_removed_rulesets := public.format_delete_unused_preset_rulesets(v_previous, p_preset_rulesets);

  RETURN jsonb_build_object(
    'replaced', v_replaced, 'stages', v_stages,
    'removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets),
    'cleared', v_cleared);
END $$;

-- Detach: one transaction. Returns {removed_stage_ids, removed_ruleset_ids, cleared} (cleared: the counts the clear deleted).
--   FORMAT_SEASON_NOT_FOUND / FORMAT_NOTHING_ATTACHED / FORMAT_SEASON_STARTED / FORMAT_RUNTIME_HAS_DATA
CREATE OR REPLACE FUNCTION public.format_detach_season(p_season_id uuid, p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_removed          uuid[];
  v_recorded         jsonb;
  v_removed_rulesets uuid[];
  v_cleared          jsonb;
BEGIN
  PERFORM 1 FROM public.seasons s WHERE s.id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT f.preset_rulesets INTO v_recorded FROM public.season_formats f WHERE f.season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_NOTHING_ATTACHED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.format__lock_phases(p_season_id);
  IF public.format_season_started(p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_SEASON_STARTED' USING ERRCODE = 'P0001';
  END IF;
  v_cleared := public.format__guard_runtime_clear(p_season_id, coalesce(p_confirm_clear, false), p_confirmed_counts);
  -- A teams row that points at a stage raises 23503 here and rolls everything back.
  WITH gone AS (
    DELETE FROM public.tournaments t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;
  PERFORM public.format__clear_runtime(p_season_id);
  DELETE FROM public.season_formats f WHERE f.season_id = p_season_id;
  v_removed_rulesets := public.format_delete_unused_preset_rulesets(v_recorded, '{}'::jsonb);
  RETURN jsonb_build_object('removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets),
                            'cleared', v_cleared);
END $$;

REVOKE ALL ON FUNCTION public.format__guard_runtime_clear(uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format__guard_runtime_clear(uuid, boolean, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.format__lock_phases(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format__lock_phases(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb, boolean, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.format_detach_season(uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_detach_season(uuid, boolean, jsonb) TO service_role;

COMMENT ON FUNCTION public.format__guard_runtime_clear(uuid, boolean, jsonb) IS
  'Internal: returns {links, items, submissions, adjustments} for the league and raises FORMAT_RUNTIME_HAS_DATA (same DETAIL) when it has such runtime rows and the clear is not confirmed, or when a confirmed clear finds more rows than the counts the admin confirmed (p_confirmed_counts, optional).';
COMMENT ON FUNCTION public.format__lock_phases(uuid) IS
  'Internal: locks every phase (tournaments) row of the league FOR UPDATE in id order, so the started check of an attach or a detach cannot be outrun by a round write or a status update.';

-- A custom league's format_type may not change under an attached format or after the league started. PATCH
-- /api/seasons/[id] checks the same in the application (assertFormatTypeChangeAllowed) from an unlocked read, so an attach
-- or a first round that commits between that read and the UPDATE would leave a league that is not `custom` with a
-- season_formats row and keyed phases (format_attach_season refuses it: NOT_CUSTOM). The trigger decides under the row lock
-- the UPDATE holds; the attach locks the seasons row FOR UPDATE, so of the two exactly one goes first and the second sees it.
-- A change between the legacy types is untouched, a league without a format that has not started may switch freely.
CREATE OR REPLACE FUNCTION public.seasons__guard_format_type()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.format_type IS DISTINCT FROM OLD.format_type AND (OLD.format_type = 'custom' OR NEW.format_type = 'custom') THEN
    IF EXISTS (SELECT 1 FROM public.season_formats f WHERE f.season_id = OLD.id) OR public.format_season_started(OLD.id) THEN
      RAISE EXCEPTION 'season_format_type_locked' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seasons_guard_format_type ON public.seasons;
CREATE TRIGGER trg_seasons_guard_format_type BEFORE UPDATE OF format_type ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.seasons__guard_format_type();

REVOKE ALL ON FUNCTION public.seasons__guard_format_type() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.seasons__guard_format_type() IS
  'Refuses (season_format_type_locked) a switch to or from custom while a format is attached or after the league started; the database half of assertFormatTypeChangeAllowed.';

COMMIT;
