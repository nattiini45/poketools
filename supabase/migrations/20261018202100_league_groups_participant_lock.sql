-- League groups, part 3: the roster honours the membership rules (round-4 gate; follows 20261018202000).
--
-- 20261018202000 guards every INSERT and UPDATE of season_group_members, but a trainer also leaves their group when
-- they leave the league: the membership's participant key is ON DELETE CASCADE (20261018180000), and no DELETE guard
-- exists on purpose (a league delete cascades through the same key and must stay possible). So the roster's two
-- writes get the rules here:
--
-- 1. Removing a trainer (season_participant_remove, the only removal path of the app: DELETE
--    /api/seasons/[id]/participants). When the trainer holds a league group it is refused
--      * once any phase of the league has a round (SEASON_GROUPS_SCHEDULED): the schedule and the group tables keep
--        the trainer's group;
--      * while that group has a live pool (any draft_pools row not 'cancelled') or the trainer holds lines drafted in
--        it (SEASON_GROUP_LOCKED): the pool keeps the trainer's seat;
--      * when the group would keep fewer than two trainers (SEASON_GROUP_TOO_SMALL).
--    A trainer in no group (or a league without groups) is removed as before. The check and the delete run under the
--    season's advisory lock (the draft__lock key), so a membership write or pool creation cannot slip in between.
--    A league delete does not call this function, so it cascades as before.
-- 2. Adding a trainer to a grouped league once any phase has a round is refused (SEASON_GROUPS_SCHEDULED, trigger on
--    season_participants INSERT): the new trainer could join no group (20261018202000 refuses first placement then)
--    and would have no fixtures, so the coverage rule (every participant in exactly one group) could never hold
--    again. A league without groups adds trainers as before. A substitution is an UPDATE and is not affected.
--
-- Deploy order: this migration before the code that calls season_participant_remove (docs/season.md, "Deploy order").
-- RLS unchanged; both functions are revoked from PUBLIC/anon/authenticated and granted to service_role.
BEGIN;

-- 1. Removal ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Returns true when a participant row was removed, false when the trainer was not on the roster.
CREATE OR REPLACE FUNCTION public.season_participant_remove(p_season_id uuid, p_player_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_group uuid; v_left integer; v_n integer;
BEGIN
  IF p_season_id IS NULL OR p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'player_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));      -- the draft__lock key
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

-- 2. Adding to a scheduled grouped league ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.season_participants__group_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = NEW.season_id) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));
  IF public.season_group__league_scheduled(NEW.season_id) THEN
    RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_season_participants_group_guard BEFORE INSERT ON public.season_participants
  FOR EACH ROW EXECUTE FUNCTION public.season_participants__group_guard();

-- 3. Privileges ───────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.season_participant_remove(uuid, uuid),
  public.season_participants__group_guard()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.season_participant_remove(uuid, uuid),
  public.season_participants__group_guard()
TO service_role;

COMMIT;
