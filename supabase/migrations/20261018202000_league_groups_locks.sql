-- League groups, part 2: membership locks and editor invariants (lead rulings round 4; follows
-- 20261018180000_league_groups.sql, whose bodies these replace with only the edits listed here).
--
-- 1. Schedule lock. Once ANY phase of a league has a round, the phases' groups, the schedule, the group tables and
--    the per-group first half (Redraft order) all use the league groups as they were. Changing the membership after
--    that would move a trainer to another group's draft, tokens and table while the schedule keeps the old group.
--    So, once the league has a round:
--      * season_groups_replace (split again, manual groups, remove every group) is refused;
--      * a new group (season_groups insert) is refused;
--      * joining a group or moving between groups (season_group_members insert / group change) is refused.
--    All with SEASON_GROUPS_SCHEDULED. Renaming a group stays allowed (a name changes no seat, pool or line), and so
--    does a substitution (the participant FK swaps player_id in place: the slot keeps its group).
-- 2. Substitution during a running group draft. A substitution cascades player_id into the membership while the
--    group's pool keeps the outgoing trainer's seat; during 'drafting' that seat could then never pick (its tracker
--    would name a group its trainer is no longer in). Refused while the group's pool is in 'submissions' or
--    'drafting' (SEASON_GROUP_SUBSTITUTION_LOCKED): a Redraft's submitted drops belong to the outgoing trainer's
--    trackers, and the deadline publishes them on its own, so the outgoing seat would go live. In 'setup' the admin
--    re-seats the pool from the group's members (draft_configure accepts exactly them); after 'complete' or
--    'cancelled' nothing is seated any more.
-- 2b. Seats = members when a group pool goes live. Whatever path moves a group pool into 'drafting' (draft_start, a
--    Redraft publish, by the admin or at the deadline), its seats must be exactly the group's members, else
--    SEASON_GROUP_SEATS_STALE {season_group_id} and nothing changes (trigger on draft_pools). A seat that is no longer
--    a member could never pick (SEASON_GROUP_MISMATCH on its tracker), so the draft would never complete.
-- 3. Group size. Every group keeps at least two trainers (a round robin and a draft both need two):
--    season_groups_replace refuses a smaller group and a member move refuses to leave fewer than two behind
--    (SEASON_GROUP_TOO_SMALL).
-- 4. Coverage. season_groups_replace with one or more groups must place EVERY league participant in exactly one
--    group (SEASON_GROUP_MEMBERS_INVALID {player_id} of the first one missing); a trainer outside every group would
--    get no seat, no pool and no group table.
-- 5. One name rule. Group names are unique per league ignoring case and surrounding blanks (the editor's rule): the
--    case-sensitive uq_season_groups_name is replaced by the unique index uq_season_groups_name_ci on
--    (season_id, lower(btrim(name))). season_groups_replace swaps names through a temporary unique name (the group
--    id) instead of a deferred constraint (an expression index cannot be deferred).
--
-- Deploy order: this migration before the code that reads `scheduleLocked` (docs/season.md, "Deploy order").
-- RLS unchanged (tables from 20261018180000); every function is revoked from PUBLIC/anon/authenticated and granted
-- to service_role at the end of this file.
BEGIN;

-- 1. Names: one case-insensitive rule ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.season_groups DROP CONSTRAINT uq_season_groups_name;
CREATE UNIQUE INDEX uq_season_groups_name_ci ON public.season_groups (season_id, lower(btrim(name)));
COMMENT ON INDEX public.uq_season_groups_name_ci IS
  'Group names are unique per league ignoring case and surrounding blanks (the editor''s rule).';

-- 2. Helper: a league whose phases have rounds ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.season_group__league_scheduled(p_season_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rounds r JOIN public.tournaments t ON t.id = r.tournament_id
                  WHERE t.season_id = p_season_id)
$$;

-- 3. Guards ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.season_groups__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.season_id IS DISTINCT FROM OLD.season_id THEN
      RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));     -- the draft__lock key: serialized with pool creation
  IF EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = NEW.season_id AND season_group_id IS NULL
                                               AND phase <> 'cancelled')
     OR EXISTS (SELECT 1 FROM public.evolution_tracker WHERE season_id = NEW.season_id AND season_group_id IS NULL
                                                      AND line_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SEASON_GROUPS_AFTER_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  -- A new group after the first round (the upsert of season_groups_replace never reaches here then: it refuses first).
  IF NOT EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = NEW.season_id AND sort_order = NEW.sort_order)
     AND public.season_group__league_scheduled(NEW.season_id) THEN
    RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.season_group_members__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_left integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));
  IF TG_OP = 'INSERT' THEN
    IF public.season_group__league_scheduled(NEW.season_id) THEN
      RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', NEW.group_id)::text;
    END IF;
    IF public.season_group__has_live_pool(NEW.group_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', NEW.group_id)::text;
    END IF;
  ELSIF NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.season_id IS DISTINCT FROM OLD.season_id THEN
    -- A move.
    IF public.season_group__league_scheduled(OLD.season_id) THEN
      RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', OLD.group_id)::text;
    END IF;
    IF public.season_group__has_live_pool(OLD.group_id) OR public.season_group__has_live_pool(NEW.group_id)
       OR EXISTS (SELECT 1 FROM public.evolution_tracker t
                   WHERE t.season_id = OLD.season_id AND t.player_id = OLD.player_id AND t.season_group_id = OLD.group_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', OLD.group_id)::text;
    END IF;
    SELECT count(*) INTO v_left FROM public.season_group_members
     WHERE group_id = OLD.group_id AND player_id <> OLD.player_id;
    IF v_left < 2 THEN
      RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', OLD.group_id)::text;
    END IF;
  ELSIF NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    -- A substitution (season_participants.player_id cascades here): the slot keeps its group, but a running draft
    -- of that group keeps the outgoing trainer's seat (a Redraft in 'submissions' also keeps the outgoing trainer's
    -- drops, and its deadline publishes them on its own).
    IF EXISTS (SELECT 1 FROM public.draft_pools WHERE season_group_id = OLD.group_id
                                                 AND phase IN ('submissions', 'drafting')) THEN
      RAISE EXCEPTION 'SEASON_GROUP_SUBSTITUTION_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', OLD.group_id)::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 3b. Seats = members when a group pool goes live (header item 2b) ─────────────────────────────────────────────────────
-- Fires on the move into 'drafting' only (draft_start from 'setup', redraft__publish_locked from 'submissions'); the
-- callers hold the draft__lock key (season advisory lock), the same key as the membership guard.
CREATE OR REPLACE FUNCTION public.draft_pools__guard_group_seats() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT m.player_id FROM public.season_group_members m WHERE m.group_id = NEW.season_group_id
             EXCEPT SELECT dp.player_id FROM public.draft_participants dp WHERE dp.draft_pool_id = NEW.id)
     OR EXISTS (SELECT dp.player_id FROM public.draft_participants dp WHERE dp.draft_pool_id = NEW.id
             EXCEPT SELECT m.player_id FROM public.season_group_members m WHERE m.group_id = NEW.season_group_id) THEN
    RAISE EXCEPTION 'SEASON_GROUP_SEATS_STALE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('season_group_id', NEW.season_group_id)::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_draft_pools_group_seats BEFORE UPDATE OF phase ON public.draft_pools
  FOR EACH ROW
  WHEN (NEW.phase = 'drafting' AND OLD.phase IS DISTINCT FROM 'drafting' AND NEW.season_group_id IS NOT NULL)
  EXECUTE FUNCTION public.draft_pools__guard_group_seats();

-- 4. The editor's atomic write (base 20261018180000) ─────────────────────────────────────────────────────────────────
-- p_groups: [{"name": text, "player_ids": [uuid, ...]}, ...] in display order (sort_order = position, 1..26); [] removes
-- every group. Groups keep their ids by position (renamed in place); positions beyond the new count are deleted and
-- must be unused (no pool, phase group or tracker: SEASON_GROUP_IN_USE). Memberships are replaced. Refused once a
-- phase of the league has a round (SEASON_GROUPS_SCHEDULED) and while the league has a live pool or drafted lines
-- (SEASON_GROUP_LOCKED: the editor locks the whole league, since a re-split rewrites every membership). With one or
-- more groups, every league participant is in exactly one group (SEASON_GROUP_MEMBERS_INVALID) and every group has at
-- least two (SEASON_GROUP_TOO_SMALL). Returns the groups with their members.
CREATE OR REPLACE FUNCTION public.season_groups_replace(p_season_id uuid, p_groups jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n integer; v_g jsonb; v_pos integer; v_id uuid; v_bad text;
BEGIN
  IF p_groups IS NULL OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'groups')::text;
  END IF;
  v_n := jsonb_array_length(p_groups);
  IF v_n > 26 THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'groups')::text;
  END IF;
  -- Shape (ordered CASE: every cast sits behind its type test).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_groups) g
              WHERE CASE
                      WHEN jsonb_typeof(g) IS DISTINCT FROM 'object' THEN true
                      WHEN jsonb_typeof(g->'name') IS DISTINCT FROM 'string' THEN true
                      WHEN char_length(btrim(g->>'name')) NOT BETWEEN 1 AND 60 THEN true
                      WHEN jsonb_typeof(g->'player_ids') IS DISTINCT FROM 'array' THEN true
                      ELSE false
                    END) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'groups')::text;
  END IF;
  IF (SELECT count(DISTINCT lower(btrim(g->>'name'))) FROM jsonb_array_elements(p_groups) g) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'name')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_groups) g CROSS JOIN LATERAL jsonb_array_elements(g->'player_ids') p
              WHERE CASE
                      WHEN jsonb_typeof(p) IS DISTINCT FROM 'string' THEN true
                      ELSE (p #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    END) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'player_ids')::text;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));       -- the draft__lock key
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'season_id')::text;
  END IF;
  IF public.season_group__league_scheduled(p_season_id) THEN
    RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = p_season_id AND phase <> 'cancelled')
     OR EXISTS (SELECT 1 FROM public.evolution_tracker WHERE season_id = p_season_id AND line_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  -- Members: each a participant of this league, in at most one group.
  SELECT x.player_id INTO v_bad FROM (
    SELECT (p #>> '{}') AS player_id FROM jsonb_array_elements(p_groups) g
      CROSS JOIN LATERAL jsonb_array_elements(g->'player_ids') p) x
   GROUP BY x.player_id
  HAVING count(*) > 1
      OR NOT EXISTS (SELECT 1 FROM public.season_participants sp
                      WHERE sp.season_id = p_season_id AND sp.player_id = x.player_id::uuid)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SEASON_GROUP_MEMBERS_INVALID' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('player_id', v_bad)::text;
  END IF;
  IF v_n > 0 THEN
    -- ... and every participant in a group.
    SELECT sp.player_id::text INTO v_bad FROM public.season_participants sp
     WHERE sp.season_id = p_season_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_groups) g
                        CROSS JOIN LATERAL jsonb_array_elements(g->'player_ids') p
                        WHERE lower(p #>> '{}') = sp.player_id::text)
     ORDER BY sp.player_id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'SEASON_GROUP_MEMBERS_INVALID' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('player_id', v_bad)::text;
    END IF;
    -- Every group seats a round robin and a draft: at least two trainers.
    SELECT o::text INTO v_bad FROM jsonb_array_elements(p_groups) WITH ORDINALITY AS a(g, o)
     WHERE jsonb_array_length(g->'player_ids') < 2
     ORDER BY o
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('position', v_bad::int)::text;
    END IF;
  END IF;

  -- Groups past the new count must be unused before they go.
  SELECT g.id::text INTO v_bad FROM public.season_groups g
   WHERE g.season_id = p_season_id AND g.sort_order > v_n
     AND (EXISTS (SELECT 1 FROM public.draft_pools d WHERE d.season_group_id = g.id)
          OR EXISTS (SELECT 1 FROM public.tournament_groups tg WHERE tg.season_group_id = g.id)
          OR EXISTS (SELECT 1 FROM public.evolution_tracker t WHERE t.season_group_id = g.id))
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SEASON_GROUP_IN_USE' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('season_group_id', v_bad)::text;
  END IF;

  DELETE FROM public.season_group_members WHERE season_id = p_season_id;
  DELETE FROM public.season_groups WHERE season_id = p_season_id AND sort_order > v_n;
  -- Kept groups take a temporary unique name first (their id), so two of them can swap names under the immediate
  -- case-insensitive unique index.
  UPDATE public.season_groups SET name = id::text WHERE season_id = p_season_id;
  FOR v_g, v_pos IN SELECT g, o::int FROM jsonb_array_elements(p_groups) WITH ORDINALITY AS a(g, o) LOOP
    INSERT INTO public.season_groups (season_id, name, sort_order)
    VALUES (p_season_id, btrim(v_g->>'name'), v_pos)
    ON CONFLICT (season_id, sort_order) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_id;
    INSERT INTO public.season_group_members (season_id, group_id, player_id)
    SELECT p_season_id, v_id, (p #>> '{}')::uuid FROM jsonb_array_elements(v_g->'player_ids') p;
  END LOOP;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'sort_order', g.sort_order,
             'player_ids', COALESCE((SELECT jsonb_agg(m.player_id ORDER BY m.created_at, m.player_id)
                                       FROM public.season_group_members m WHERE m.group_id = g.id), '[]'::jsonb))
             ORDER BY g.sort_order)
      FROM public.season_groups g WHERE g.season_id = p_season_id), '[]'::jsonb);
END $$;

-- 5. Privileges ───────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.season_group__league_scheduled(uuid),
  public.season_groups__guard(),
  public.season_group_members__guard(),
  public.draft_pools__guard_group_seats(),
  public.season_groups_replace(uuid, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.season_group__league_scheduled(uuid),
  public.season_groups__guard(),
  public.season_group_members__guard(),
  public.draft_pools__guard_group_seats(),
  public.season_groups_replace(uuid, jsonb)
TO service_role;

COMMIT;
