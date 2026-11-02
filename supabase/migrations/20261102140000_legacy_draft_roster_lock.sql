-- The roster is frozen while a legacy draft is live (issue #46; follows 20261018202100).
--
-- A legacy pool (draft_pools.engine = 'legacy', every non-Evolution-Point-Buy league) stores no seats: the turn, the
-- round and the pick total are recomputed on every request from the CURRENT season_participants (src/lib/draft/engine.ts,
-- legacySeatOrder / computeDraftState). Adding, removing or substituting a trainer while the pool is 'in_progress'
-- therefore moves everybody's seat: a trainer can be skipped or asked twice, the round number jumps, and the pool can
-- complete early or never. 20261018202100 guarded this only for leagues with groups, which cannot run a legacy pool.
--
-- Rule: while the league has a legacy pool with status 'in_progress', a trainer can neither leave (season_participant_remove)
-- nor join (INSERT on season_participants): both raise SEASON_DRAFT_LOCKED (P0001, an `errors/draft` code, HTTP 409).
-- A 'pending' or 'complete' pool, a league without a pool, an Evolution Point Buy queue pool (it stores its seats in
-- draft_participants) and a league with groups keep their existing behaviour. The route also refuses a substitution
-- (an UPDATE of season_participants.player_id) with the same code, before any write (src/lib/season/substitute.ts).
-- There is no override: an admin ends the draft (free order, then complete) or moves the pool back to pending first.
--
-- A league delete and the league recycle bin are not affected:
--   * a delete cascades through the foreign key of season_participants and never calls season_participant_remove;
--   * a restore (league_trash__restore_plan) inserts season_participants (step 20) BEFORE draft_pools (steps 40/50), so
--     the guard below finds no live legacy pool at that moment. src/lib/draft/__tests__/legacy-roster-lock-migration.test.ts
--     pins that order.
-- No new trigger: the existing INSERT trigger function is replaced, so league_trash__inventory() needs no change.
--
-- The check and the write run under the season's advisory lock (the draft__lock key), as the group rules do. The status
-- flip of the pool and the substitution UPDATE take the same lock through the triggers of
-- 20261102150100_legacy_draft_roster_lock_serialize.sql.
--
-- Deploy order: before the code that maps SEASON_DRAFT_LOCKED (the guard is inert without it, the old code would
-- answer a raw 500). Functions only: no table, no data, RLS unchanged; both functions stay service_role only.
BEGIN;

-- 1. Predicate ────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.season__legacy_draft_live(p_season_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.draft_pools
                  WHERE season_id = p_season_id AND engine = 'legacy' AND status = 'in_progress')
$$;

-- 2. Removal (base 20261018202100): the lock check comes first, for every league ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.season_participant_remove(p_season_id uuid, p_player_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_group uuid; v_left integer; v_n integer;
BEGIN
  IF p_season_id IS NULL OR p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'player_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));      -- the draft__lock key
  IF public.season__legacy_draft_live(p_season_id) THEN
    RAISE EXCEPTION 'SEASON_DRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  SELECT m.group_id INTO v_group FROM public.season_group_members m
   WHERE m.season_id = p_season_id AND m.player_id = p_player_id;
  IF FOUND THEN
    IF public.season_group__league_scheduled(p_season_id) THEN
      RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_group)::text;
    END IF;
    IF public.season_group__has_live_pool(v_group)
       OR EXISTS (SELECT 1 FROM public.evolution_tracker t
                   WHERE t.season_id = p_season_id AND t.player_id = p_player_id AND t.season_group_id = v_group
                     AND t.line_id IS NOT NULL) THEN
      RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_group)::text;
    END IF;
    SELECT count(*) INTO v_left FROM public.season_group_members
     WHERE group_id = v_group AND player_id <> p_player_id;
    IF v_left < 2 THEN
      RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_group)::text;
    END IF;
  END IF;
  DELETE FROM public.season_participants WHERE season_id = p_season_id AND player_id = p_player_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

-- 3. Joining (base 20261018202100): the live-pool check runs before the "no groups" early return ──────────────────────
CREATE OR REPLACE FUNCTION public.season_participants__group_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_grouped boolean;
BEGIN
  v_grouped := EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = NEW.season_id);
  -- A league with neither groups nor a legacy pool (almost every insert) takes no lock.
  IF NOT v_grouped AND NOT EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = NEW.season_id AND engine = 'legacy') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));
  IF public.season__legacy_draft_live(NEW.season_id) THEN
    RAISE EXCEPTION 'SEASON_DRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_grouped AND public.season_group__league_scheduled(NEW.season_id) THEN
    RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- 4. Privileges ───────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.season__legacy_draft_live(uuid),
  public.season_participant_remove(uuid, uuid),
  public.season_participants__group_guard()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.season__legacy_draft_live(uuid),
  public.season_participant_remove(uuid, uuid),
  public.season_participants__group_guard()
TO service_role;

COMMIT;
