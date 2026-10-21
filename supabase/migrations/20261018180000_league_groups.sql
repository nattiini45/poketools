-- League groups, part 1: the database and the draft engine (owner request 2026-10-18; design of record:
-- league-groups-design.md, lead rulings round 3).
--
-- A league (season) may split its trainers into groups that persist across its phases and draft their own pools:
--   * season_groups (one row per group of a league) and season_group_members (one group per trainer per league; a member
--     must be a participant of the league: composite FK to season_participants, which also carries a substitution, an
--     in-place player_id swap, into the membership).
--   * tournament_groups.season_group_id: a phase's group mirrors a league group (nullable, ON DELETE RESTRICT).
--   * draft_pools.season_group_id: the group whose pool this is (nullable, ON DELETE RESTRICT). One initial and one live
--     redraft pool per (league, group): the unique keys become (season_id, season_group_id) NULLS NOT DISTINCT.
--   * evolution_tracker.season_group_id: lines are unique PER GROUP. The line key becomes (season_id, season_group_id,
--     line_id) NULLS NOT DISTINCT, so two groups can each draft the same line and one group still cannot hold a line twice.
--     A trigger fills the column from the trainer's membership (and refuses a row whose group is not the trainer's);
--     existing rows stay NULL (no league has groups yet).
-- A league WITHOUT groups behaves exactly as before: every pool, tracker and lookup carries NULL, and every group filter
-- below is `IS NOT DISTINCT FROM`, which for NULL selects exactly the rows the old season-wide filter selected.
--
-- Draft engine: every function that reads lines, owners, pools or seats by season is scoped to the pool's group:
--   draft__legal_lines, draft__pool_completable (free lines), draft__commit_pick (owner check, tracker insert),
--   draft_end (abort), draft_admin_void_pick, draft_configure (re-seating a group's pool: seats = the group's members),
--   redraft__publish_locked, redraft_admin_restore_drop, redraft_set_submission,
--   draft__build_snapshot ('taken'; a refused automatic publish is NOT in the snapshot: its one read path is
--   src/lib/supabase/queries/draft-publish-refusals.ts, admin routes only), draft_create_pool (p_season_group_id: one initial pool per group, seats = exactly the group's members, the
--   redraft's parent = the group's initial pool; SEASON_GROUP_REQUIRED for a league with groups and no group),
--   epb__season_remaining_points (base budget = the trainer's group's initial pool; the scalar subquery would return
--   several rows otherwise), epb_purchase_draft_token (the trainer's group's initial pool), epb_set_comeback_spend_open
--   (league-wide switch; logged on no pool in a league with groups) and epb_spend_comeback_tokens (opens with the
--   trainer's group's redraft; logged on that group's pool). Bodies are the latest definitions (20261012024916,
--   20261012025023, 20261012025134, 20261018140000, 20261018140100, 20261018140200) with only these edits.
-- The advisory lock stays season-wide (draft__lock): simple and correct; the membership and group guards take it too,
-- so a membership change and a pool creation never race.
--
-- Guards (triggers, coded P0001 raises):
--   * season_groups: refused while the league has a live pool without a group or drafted lines without a group
--     (SEASON_GROUPS_AFTER_DRAFT); season_id is immutable (SEASON_GROUP_INVALID).
--   * season_group_members: joining a group, or moving between groups, is refused while either group has a live
--     (not cancelled) pool or the trainer holds lines of the old group (SEASON_GROUP_LOCKED). Leaving the league
--     (season_participants delete) cascades.
--   * draft_pools: a pool of a league with groups names its group (SEASON_GROUP_REQUIRED); the composite FK keeps the
--     group inside the pool's league.
--   * tournament_groups: a phase group mirrors a group of its own league (SEASON_GROUP_INVALID).
-- season_groups_replace(p_season_id, p_groups) is the editor's atomic write (create N groups, rename, set members),
-- refused once the league has a live pool or drafted lines.
--
-- RLS on, no policies, table privileges to service_role only; every function is revoked from PUBLIC/anon/authenticated
-- and granted to service_role at the end of this file.
BEGIN;

-- 1. Tables ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.season_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT season_groups_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  sort_order smallint NOT NULL CONSTRAINT season_groups_sort_order_range CHECK (sort_order BETWEEN 1 AND 26),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_season_groups_id_season UNIQUE (id, season_id),
  CONSTRAINT uq_season_groups_sort_order UNIQUE (season_id, sort_order),
  -- deferrable: season_groups_replace may swap two names in one transaction
  CONSTRAINT uq_season_groups_name UNIQUE (season_id, name) DEFERRABLE INITIALLY IMMEDIATE
);
COMMENT ON TABLE public.season_groups IS
  'Service-role only. League-level groups (persist across phases; each drafts its own pool). No RLS policies by design.';

CREATE TABLE public.season_group_members (
  season_id uuid NOT NULL,
  group_id uuid NOT NULL,
  player_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_group_members_pkey PRIMARY KEY (season_id, player_id),      -- one group per trainer per league
  CONSTRAINT season_group_members_group_fkey FOREIGN KEY (group_id, season_id)
    REFERENCES public.season_groups (id, season_id) ON DELETE CASCADE,
  CONSTRAINT season_group_members_participant_fkey FOREIGN KEY (season_id, player_id)
    REFERENCES public.season_participants (season_id, player_id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX idx_season_group_members_group ON public.season_group_members (group_id);
COMMENT ON TABLE public.season_group_members IS
  'Service-role only. Trainer -> league group (one per league; members are league participants). No RLS policies by design.';

ALTER TABLE public.season_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_group_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.season_groups, public.season_group_members TO service_role;

CREATE TRIGGER trg_season_groups_updated BEFORE UPDATE ON public.season_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Group keys on phases, pools and trackers ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tournament_groups
  ADD COLUMN season_group_id uuid REFERENCES public.season_groups(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_tournament_groups_season_group ON public.tournament_groups (tournament_id, season_group_id)
  WHERE season_group_id IS NOT NULL;
CREATE INDEX idx_tournament_groups_season_group ON public.tournament_groups (season_group_id)
  WHERE season_group_id IS NOT NULL;
COMMENT ON COLUMN public.tournament_groups.season_group_id IS
  'The league group this phase group mirrors; NULL for a phase-only group (leagues without groups, standalone tournaments).';

ALTER TABLE public.draft_pools ADD COLUMN season_group_id uuid;
ALTER TABLE public.draft_pools ADD CONSTRAINT draft_pools_season_group_fkey FOREIGN KEY (season_group_id, season_id)
  REFERENCES public.season_groups (id, season_id) ON DELETE RESTRICT;
CREATE INDEX idx_draft_pools_season_group ON public.draft_pools (season_group_id) WHERE season_group_id IS NOT NULL;
COMMENT ON COLUMN public.draft_pools.season_group_id IS
  'The league group this pool drafts for; NULL in a league without groups. Unique per (season, group, kind).';

DROP INDEX public.uq_draft_pools_season_initial;
CREATE UNIQUE INDEX uq_draft_pools_season_initial ON public.draft_pools (season_id, season_group_id) NULLS NOT DISTINCT
  WHERE kind = 'initial';
DROP INDEX public.uq_draft_pools_season_redraft;
CREATE UNIQUE INDEX uq_draft_pools_season_redraft ON public.draft_pools (season_id, season_group_id) NULLS NOT DISTINCT
  WHERE kind = 'redraft' AND phase <> 'cancelled';

ALTER TABLE public.evolution_tracker ADD COLUMN season_group_id uuid;
ALTER TABLE public.evolution_tracker ADD CONSTRAINT evolution_tracker_season_group_fkey FOREIGN KEY (season_group_id, season_id)
  REFERENCES public.season_groups (id, season_id);                      -- NO ACTION: checked after a league delete's cascade
CREATE INDEX idx_evolution_tracker_season_group ON public.evolution_tracker (season_group_id) WHERE season_group_id IS NOT NULL;
DROP INDEX public.uq_evolution_tracker_season_line;
CREATE UNIQUE INDEX uq_evolution_tracker_season_group_line ON public.evolution_tracker (season_id, season_group_id, line_id)
  NULLS NOT DISTINCT WHERE line_id IS NOT NULL;
COMMENT ON COLUMN public.evolution_tracker.season_group_id IS
  'League group of the owning trainer (set from season_group_members); lines are unique per (season, group). NULL in a league without groups.';
COMMENT ON COLUMN public.evolution_tracker.line_id IS
  'Draft line id (point_buy_list_entries.line_id); one tracker per line per season and league group. NULL for legacy evolution-tier leagues.';

-- 3. Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- A trainer's group in a league; NULL in a league without groups (or for a trainer in none).
CREATE OR REPLACE FUNCTION public.draft__player_group(p_season_id uuid, p_player_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT m.group_id FROM public.season_group_members m WHERE m.season_id = p_season_id AND m.player_id = p_player_id
$$;

-- A group's membership is frozen while it has a live (not cancelled) pool.
CREATE OR REPLACE FUNCTION public.season_group__has_live_pool(p_group_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.draft_pools WHERE season_group_id = p_group_id AND phase <> 'cancelled')
$$;

-- 4. Guards ────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
  RETURN NEW;
END $$;
CREATE TRIGGER trg_season_groups_guard BEFORE INSERT OR UPDATE OF season_id ON public.season_groups
  FOR EACH ROW EXECUTE FUNCTION public.season_groups__guard();

CREATE OR REPLACE FUNCTION public.season_group_members__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.season_id::text));
  IF TG_OP = 'INSERT' THEN
    IF public.season_group__has_live_pool(NEW.group_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', NEW.group_id)::text;
    END IF;
  ELSIF NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.season_id IS DISTINCT FROM OLD.season_id THEN
    -- A move. (A substitution only swaps player_id through the participant FK: the slot keeps its group.)
    IF public.season_group__has_live_pool(OLD.group_id) OR public.season_group__has_live_pool(NEW.group_id)
       OR EXISTS (SELECT 1 FROM public.evolution_tracker t
                   WHERE t.season_id = OLD.season_id AND t.player_id = OLD.player_id AND t.season_group_id = OLD.group_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', OLD.group_id)::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_season_group_members_guard BEFORE INSERT OR UPDATE ON public.season_group_members
  FOR EACH ROW EXECUTE FUNCTION public.season_group_members__guard();

CREATE OR REPLACE FUNCTION public.draft_pools__guard_group() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.season_group_id IS NULL AND EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = NEW.season_id) THEN
    RAISE EXCEPTION 'SEASON_GROUP_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_draft_pools_guard_group BEFORE INSERT OR UPDATE OF season_id, season_group_id ON public.draft_pools
  FOR EACH ROW EXECUTE FUNCTION public.draft_pools__guard_group();

-- Fills a tracker's group from the trainer's membership; a row naming another group is an invariant breach (a logged
-- 500: the engine always writes the pool's group, and seats are exactly the group's members).
CREATE OR REPLACE FUNCTION public.evolution_tracker__group() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_group uuid;
BEGIN
  v_group := public.draft__player_group(NEW.season_id, NEW.player_id);
  IF NEW.season_group_id IS NULL THEN
    NEW.season_group_id := v_group;
  ELSIF NEW.season_group_id IS DISTINCT FROM v_group THEN
    RAISE EXCEPTION 'SEASON_GROUP_MISMATCH' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('season_group_id', NEW.season_group_id, 'player_id', NEW.player_id)::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_evolution_tracker_group BEFORE INSERT OR UPDATE OF season_id, player_id, season_group_id
  ON public.evolution_tracker FOR EACH ROW EXECUTE FUNCTION public.evolution_tracker__group();

CREATE OR REPLACE FUNCTION public.tournament_groups__guard_season_group() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.season_group_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.season_groups g JOIN public.tournaments t ON t.season_id = g.season_id
        WHERE g.id = NEW.season_group_id AND t.id = NEW.tournament_id) THEN
    RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tournament_groups_guard_season_group BEFORE INSERT OR UPDATE OF tournament_id, season_group_id
  ON public.tournament_groups FOR EACH ROW EXECUTE FUNCTION public.tournament_groups__guard_season_group();

-- 5. The editor's atomic write ──────────────────────────────────────────────────────────────────────────────────────────
-- p_groups: [{"name": text, "player_ids": [uuid, ...]}, ...] in display order (sort_order = position, 1..26); [] removes
-- every group. Groups keep their ids by position (renamed in place); positions beyond the new count are deleted and
-- must be unused (no pool, phase group or tracker: SEASON_GROUP_IN_USE). Memberships are replaced. Refused while the
-- league has a live pool or drafted lines (SEASON_GROUP_LOCKED). Every member must be a league participant in exactly
-- one group (SEASON_GROUP_MEMBERS_INVALID). Returns the groups with their members.
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

  SET CONSTRAINTS public.uq_season_groups_name DEFERRED;
  DELETE FROM public.season_group_members WHERE season_id = p_season_id;
  DELETE FROM public.season_groups WHERE season_id = p_season_id AND sort_order > v_n;
  FOR v_g, v_pos IN SELECT g, o::int FROM jsonb_array_elements(p_groups) WITH ORDINALITY AS a(g, o) LOOP
    INSERT INTO public.season_groups (season_id, name, sort_order)
    VALUES (p_season_id, btrim(v_g->>'name'), v_pos)
    ON CONFLICT (season_id, sort_order) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_id;
    INSERT INTO public.season_group_members (season_id, group_id, player_id)
    SELECT p_season_id, v_id, (p #>> '{}')::uuid FROM jsonb_array_elements(v_g->'player_ids') p;
  END LOOP;
  SET CONSTRAINTS public.uq_season_groups_name IMMEDIATE;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'sort_order', g.sort_order,
             'player_ids', COALESCE((SELECT jsonb_agg(m.player_id ORDER BY m.created_at, m.player_id)
                                       FROM public.season_group_members m WHERE m.group_id = g.id), '[]'::jsonb))
             ORDER BY g.sort_order)
      FROM public.season_groups g WHERE g.season_id = p_season_id), '[]'::jsonb);
END $$;

-- 6. draft__legal_lines (base 20261012024916): a line is taken in this pool's group only ───────────────────────────────
-- Branch-exact (BR-3): a line is taken when a tracker of the season and of the pool's group (NULL = no groups), or a
-- live pick of the pool, holds its line_id.
CREATE OR REPLACE FUNCTION public.draft__legal_lines(p_pool_id uuid, p_player_id uuid)
RETURNS TABLE (entry_id uuid, line_id text, price integer) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.id, e.line_id, e.price::int
    FROM public.draft_pools p JOIN public.point_buy_list_entries e ON e.list_version_id = p.list_version_id
   WHERE p.id = p_pool_id
     AND NOT EXISTS (SELECT 1 FROM public.evolution_tracker t WHERE t.season_id = p.season_id
                       AND t.season_group_id IS NOT DISTINCT FROM p.season_group_id AND t.line_id = e.line_id)
     AND NOT EXISTS (SELECT 1 FROM public.draft_picks dp WHERE dp.draft_pool_id = p.id AND dp.line_id = e.line_id AND dp.voided_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.draft_line_restrictions r
                      WHERE r.draft_pool_id = p.id AND r.player_id = p_player_id AND r.line_id = e.line_id)
     AND NOT (p.kind = 'redraft' AND p.redraft_lock_no_redraft_lines AND COALESCE((e.special_rules->>'no_redraft')::boolean, false))
$$;

-- 7. draft__pool_completable (base 20261018140200): free lines of the pool's group ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft__pool_completable(p_pool_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_price integer[]; v_line text[]; v_players uuid[]; v_slots integer[]; v_budget integer[]; v_elig boolean[];
        v_res jsonb; v_n integer; v_active integer; v_open integer; v_money integer; v_min integer;
BEGIN
  SELECT COALESCE(array_agg(e.price::int ORDER BY e.line_id COLLATE "C"), '{}'),
         COALESCE(array_agg(e.line_id ORDER BY e.line_id COLLATE "C"), '{}')
    INTO v_price, v_line
    FROM public.draft_pools p JOIN public.point_buy_list_entries e ON e.list_version_id = p.list_version_id
   WHERE p.id = p_pool_id
     AND NOT EXISTS (SELECT 1 FROM public.evolution_tracker t WHERE t.season_id = p.season_id
                       AND t.season_group_id IS NOT DISTINCT FROM p.season_group_id AND t.line_id = e.line_id)
     AND NOT EXISTS (SELECT 1 FROM public.draft_picks dp WHERE dp.draft_pool_id = p.id AND dp.line_id = e.line_id
                                                          AND dp.voided_at IS NULL)
     AND NOT (p.kind = 'redraft' AND p.redraft_lock_no_redraft_lines AND COALESCE((e.special_rules->>'no_redraft')::boolean, false));
  SELECT COALESCE(array_agg(x.player_id ORDER BY x.seat), '{}'), COALESCE(array_agg(x.open ORDER BY x.seat), '{}'),
         COALESCE(array_agg(x.budget ORDER BY x.seat), '{}')
    INTO v_players, v_slots, v_budget
    FROM (SELECT dp.player_id, dp.seat, public.draft__open_slots(p_pool_id, dp.player_id) AS open,
                 COALESCE(public.draft__remaining_budget(p_pool_id, dp.player_id), 0) AS budget
            FROM public.draft_participants dp WHERE dp.draft_pool_id = p_pool_id) x;
  SELECT COALESCE(array_agg(NOT EXISTS (SELECT 1 FROM public.draft_line_restrictions r
                                         WHERE r.draft_pool_id = p_pool_id AND r.player_id = pl.player_id
                                           AND r.line_id = l.line_id)
                            ORDER BY pl.ord, l.ord), '{}')
    INTO v_elig
    FROM unnest(v_players) WITH ORDINALITY AS pl(player_id, ord)
    CROSS JOIN unnest(v_line) WITH ORDINALITY AS l(line_id, ord);

  v_res := public.draft__completable_search(v_price, v_line, v_slots, v_budget, v_elig);
  v_n := COALESCE(array_length(v_price, 1), 0);
  SELECT count(*) FILTER (WHERE s > 0), COALESCE(sum(s) FILTER (WHERE s > 0), 0), COALESCE(sum(b) FILTER (WHERE s > 0), 0)
    INTO v_active, v_open, v_money
    FROM unnest(v_slots, v_budget) AS z(s, b);
  IF v_n >= v_open THEN
    SELECT COALESCE(sum(pr), 0) INTO v_min FROM (SELECT pr FROM unnest(v_price) pr ORDER BY pr LIMIT v_open) c;
  END IF;
  RETURN v_res || jsonb_build_object('participants', v_active, 'slots', v_open, 'lines', v_n, 'min_total', v_min,
                                     'budget_total', v_money);
END $$;

-- 8. draft__commit_pick (base 20261018140200): owner check per group; the tracker carries the pool's group ──────────
CREATE OR REPLACE FUNCTION public.draft__commit_pick(
  p_pool public.draft_pools, p_slot public.draft_slots, p_entry_id uuid, p_actor_id uuid, p_actor_role text,
  p_client_request_id uuid, p_redraft_slot_id uuid, p_line_thresholds jsonb, p_action text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_entry public.point_buy_list_entries; v_player uuid := p_slot.player_id; v_owner uuid; v_restriction text;
  v_open integer; v_rem integer; v_cnt integer; v_cost integer; v_size smallint;
  v_rslot public.redraft_slots; v_transfer integer := 0; v_stage integer := 1; v_form text; v_s2 integer; v_s3 integer;
  v_pick_no integer; v_pick_id uuid; v_tracker_id uuid; v_next uuid; v_pool public.draft_pools; v_gate jsonb;
BEGIN
  SELECT * INTO v_entry FROM public.point_buy_list_entries WHERE id = p_entry_id AND list_version_id = p_pool.list_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;

  -- 1. one owner per line per season and group (BR-3; the pool's group, NULL in a league without groups)
  v_owner := (SELECT t.player_id FROM public.evolution_tracker t
               WHERE t.season_id = p_pool.season_id AND t.season_group_id IS NOT DISTINCT FROM p_pool.season_group_id
                 AND t.line_id = v_entry.line_id LIMIT 1);
  IF v_owner IS NULL THEN
    v_owner := (SELECT k.player_id FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool.id AND k.line_id = v_entry.line_id AND k.voided_at IS NULL LIMIT 1);
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'player_id', v_owner)::text;
  END IF;

  -- 2. restrictions
  SELECT r.reason INTO v_restriction FROM public.draft_line_restrictions r
   WHERE r.draft_pool_id = p_pool.id AND r.player_id = v_player AND r.line_id = v_entry.line_id;
  IF v_restriction = 'own_redraft_drop' THEN RAISE EXCEPTION 'OWN_REDRAFT_DROP' USING ERRCODE = 'P0001'; END IF;
  IF v_restriction IS NOT NULL THEN RAISE EXCEPTION 'LINE_RESTRICTED' USING ERRCODE = 'P0001'; END IF;

  -- 3. redraft lock (Cosmog: special_rules.no_redraft, stored by the importer)
  IF p_pool.kind = 'redraft' AND p_pool.redraft_lock_no_redraft_lines
     AND COALESCE((v_entry.special_rules->>'no_redraft')::boolean, false) THEN
    RAISE EXCEPTION 'COSMOG_REDRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  -- 4. roster
  v_open := public.draft__open_slots(p_pool.id, v_player);
  IF v_open < 1 THEN
    SELECT slots_total INTO v_size FROM public.draft_participants WHERE draft_pool_id = p_pool.id AND player_id = v_player;
    RAISE EXCEPTION 'ROSTER_FULL' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('size', COALESCE(v_size, 0))::text;
  END IF;

  -- 5. the picker's own budget + completion check (twin of evaluateCompletion in budget.ts); the pool gate is step 10b
  v_rem := COALESCE(public.draft__remaining_budget(p_pool.id, v_player), 0);
  IF v_entry.price > v_rem THEN
    RAISE EXCEPTION 'INSUFFICIENT_BUDGET' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('price', v_entry.price, 'remaining', v_rem)::text;
  END IF;
  SELECT m.cnt, m.cost INTO v_cnt, v_cost FROM public.draft__min_completion(p_pool.id, v_player, v_open - 1, v_entry.line_id) m;
  IF v_cnt < v_open - 1 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_LINES' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('slots', v_open - 1, 'available', v_cnt)::text;
  END IF;
  IF v_cost > v_rem - v_entry.price THEN
    RAISE EXCEPTION 'BUDGET_INFEASIBLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('shortfall', v_cost - (v_rem - v_entry.price), 'slots', v_open - 1,
                                  'remaining_after', v_rem - v_entry.price, 'min_cost', v_cost)::text;
  END IF;

  -- 6. redraft slot (the slot-bound real-kill transfer, SPEC:757-770)
  IF p_pool.kind = 'redraft' THEN
    IF p_redraft_slot_id IS NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO v_rslot FROM public.redraft_slots WHERE id = p_redraft_slot_id FOR UPDATE;
    IF NOT FOUND OR v_rslot.draft_pool_id <> p_pool.id OR v_rslot.player_id <> v_player THEN
      RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_rslot.filled_by_pick_id IS NOT NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001'; END IF;
    v_transfer := v_rslot.transferred_real_kills;
  ELSIF p_redraft_slot_id IS NOT NULL THEN
    RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- 7. stage reached by the transfer (cumulative thresholds, override applied by TS effectiveThresholds)
  IF v_transfer > 0 THEN
    IF p_line_thresholds IS NULL OR p_line_thresholds->>'line_id' IS DISTINCT FROM v_entry.line_id
       OR jsonb_typeof(p_line_thresholds->'stage2_kos') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'THRESHOLDS_REQUIRED' USING ERRCODE = 'P0001';                    -- internal: the route must pass them
    END IF;
    v_s2 := (p_line_thresholds->>'stage2_kos')::int;
    v_s3 := CASE WHEN jsonb_typeof(p_line_thresholds->'stage3_kos') = 'number' THEN (p_line_thresholds->>'stage3_kos')::int END;
    v_stage := CASE WHEN v_s3 IS NOT NULL AND v_entry.stage3_pokemon IS NOT NULL AND v_transfer >= v_s3 THEN 3
                    WHEN v_transfer >= v_s2 THEN 2 ELSE 1 END;
  END IF;
  v_form := CASE v_stage WHEN 3 THEN v_entry.stage3_pokemon WHEN 2 THEN v_entry.stage2_pokemon ELSE v_entry.base_pokemon END;

  -- 8. the pick
  SELECT COALESCE(max(pick_number), 0) + 1 INTO v_pick_no FROM public.draft_picks
   WHERE draft_pool_id = p_pool.id AND voided_at IS NULL;
  INSERT INTO public.draft_picks (draft_pool_id, player_id, pokemon_name, pick_number, round, points_spent, line_id,
    line_entry_id, slot_id, redraft_slot_id, client_request_id, made_by, made_by_role, override_reason)
  VALUES (p_pool.id, v_player, v_entry.base_pokemon, v_pick_no, p_slot.round, v_entry.price, v_entry.line_id,
    v_entry.id, p_slot.id, p_redraft_slot_id, p_client_request_id, p_actor_id, p_actor_role,
    CASE WHEN p_actor_role = 'admin' THEN left(p_reason, 500) END)
  RETURNING id INTO v_pick_id;

  -- 9. the tracker (real kills start at 0; a redraft transfer is evolution progress only, SPEC:859-867)
  INSERT INTO public.evolution_tracker (season_id, player_id, base_pokemon, current_form, current_stage, total_kos, real_kills,
    transferred_evo_progress, locked_stage3_pokemon, line_id, redraft_slot_id, evolved_at, season_group_id)
  VALUES (p_pool.season_id, v_player, v_entry.base_pokemon, v_form, v_stage, v_transfer, 0, v_transfer,
    v_entry.stage3_pokemon, v_entry.line_id, CASE WHEN p_pool.kind = 'redraft' THEN p_redraft_slot_id END,
    CASE WHEN v_stage > 1 THEN now() END, p_pool.season_group_id)
  RETURNING id INTO v_tracker_id;
  IF v_transfer > 0 THEN
    INSERT INTO public.evo_progress_log (tracker_id, season_id, matchday, source, amount, note, created_by)
    VALUES (v_tracker_id, p_pool.season_id, NULL, 'transferred', v_transfer, 'Redraft slot ' || v_rslot.label, p_actor_id);
  END IF;
  IF v_stage > 1 THEN
    INSERT INTO public.evolution_events (season_id, matchday, tracker_id, player_id, base_pokemon, previous_form, new_form,
      previous_stage, new_stage, total_kos, is_devolution, is_manual)
    VALUES (p_pool.season_id, NULL, v_tracker_id, v_player, v_entry.base_pokemon, v_entry.base_pokemon, v_form,
      1, v_stage, v_transfer, false, false);
  END IF;

  -- 10. close the slot
  IF v_rslot.id IS NOT NULL THEN
    UPDATE public.redraft_slots SET filled_by_pick_id = v_pick_id WHERE id = v_rslot.id;
  END IF;
  UPDATE public.draft_slots
     SET status = 'done', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL
   WHERE id = p_slot.id;
  IF public.draft__open_slots(p_pool.id, v_player) = 0 THEN
    UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool.id AND player_id = v_player;
  END IF;

  -- 10b. pool gate: after this pick every participant must still be able to fill every open slot. A refusal rolls the
  --      whole pick back (one statement, one transaction).
  v_gate := public.draft__pool_completable(p_pool.id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'POOL_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'player_id', v_player)::text;
  END IF;

  -- 11. audit
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, p_action,
    p_player_id => v_player, p_slot_id => p_slot.id, p_pick_id => v_pick_id, p_line_id => v_entry.line_id,
    p_after => jsonb_build_object('price', v_entry.price, 'pick_number', v_pick_no, 'redraft_slot_label', v_rslot.label,
                                  'transfer', v_transfer, 'stage', v_stage),
    p_reason => p_reason, p_client_request_id => p_client_request_id);

  -- 12. next slot
  v_next := public.draft__activate_next(p_pool.id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool.id
  RETURNING * INTO v_pool;

  -- 13.
  RETURN jsonb_build_object('pick_id', v_pick_id, 'tracker_id', v_tracker_id, 'line_id', v_entry.line_id,
    'pick_number', v_pick_no, 'player_id', v_player, 'price', v_entry.price, 'stage', v_stage, 'replay', false,
    'next_slot_id', v_next, 'completed', v_pool.phase = 'complete', 'state_version', v_pool.state_version);
END $$;

-- 9. draft_end (base 20261018140200): the abort voids the trackers of the pool's group only ──────────────────────────
CREATE OR REPLACE FUNCTION public.draft_end(p_pool_id uuid, p_actor_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_pick public.draft_picks; v_tracker public.evolution_tracker; v_progress integer;
        v_voided integer := 0; v_discarded integer := 0;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'drafting' THEN
    IF v_pool.kind <> 'initial' THEN RAISE EXCEPTION 'DRAFT_ABORT_NOT_ALLOWED' USING ERRCODE = 'P0001'; END IF;
    FOR v_pick IN SELECT * FROM public.draft_picks WHERE draft_pool_id = p_pool_id AND voided_at IS NULL
                   ORDER BY pick_number FOR UPDATE LOOP
      SELECT * INTO v_tracker FROM public.evolution_tracker
       WHERE season_id = v_pool.season_id AND season_group_id IS NOT DISTINCT FROM v_pool.season_group_id
         AND line_id = v_pick.line_id FOR UPDATE;
      IF FOUND THEN
        IF v_tracker.player_id <> v_pick.player_id THEN
          RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('line_id', v_pick.line_id, 'player_id', v_tracker.player_id)::text;
        END IF;
        v_progress := v_tracker.real_kills + v_tracker.draft_tokens + v_tracker.kill_tokens + v_tracker.cosmo_points;
        IF v_progress > 0 THEN
          RAISE EXCEPTION 'VOID_BLOCKED_PROGRESS' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('progress', v_progress, 'line_id', v_pick.line_id)::text;
        END IF;
        DELETE FROM public.evolution_tracker WHERE id = v_tracker.id;
      END IF;
      UPDATE public.draft_picks SET voided_at = now(), voided_by = p_actor_id, void_reason = left(p_reason, 500)
       WHERE id = v_pick.id;
      v_voided := v_voided + 1;
    END LOOP;
    DELETE FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('pending', 'active');
    GET DIAGNOSTICS v_discarded = ROW_COUNT;
    UPDATE public.draft_pools
       SET phase = 'cancelled', status = 'complete', ended_at = now(), paused_at = NULL, paused_by = NULL, pause_reason = NULL,
           updated_at = now()
     WHERE id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_cancelled',
      p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'ended_at', v_pool.ended_at,
                                     'paused_at', v_pool.paused_at, 'pause_reason', v_pool.pause_reason),
      p_after => jsonb_build_object('phase', 'cancelled', 'status', 'complete', 'reason', 'admin_abort',
                                    'voided_picks', v_voided, 'discarded_slots', v_discarded), p_reason => p_reason);
  ELSIF v_pool.phase = 'submissions' THEN
    UPDATE public.draft_pools SET phase = 'cancelled', status = 'complete', ended_at = now(), updated_at = now()
     WHERE id = p_pool_id;                                              -- submissions stay for the audit
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_cancelled',
      p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'ended_at', v_pool.ended_at),
      p_after => jsonb_build_object('phase', 'cancelled', 'status', 'complete'), p_reason => p_reason);
  ELSIF v_pool.phase = 'setup' THEN
    RAISE EXCEPTION 'DRAFT_NOT_STARTED' USING ERRCODE = 'P0001';
  ELSE
    RAISE EXCEPTION 'DRAFT_COMPLETE' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'phase', v_pool.phase);
END $$;

-- 10. draft_admin_void_pick (base 20261018140200): the voided line's tracker is looked up in the pool's group ───────
CREATE OR REPLACE FUNCTION public.draft_admin_void_pick(p_pool_id uuid, p_pick_id uuid, p_actor_id uuid, p_reason text,
  p_requeue boolean, p_replacement_line_id text DEFAULT NULL, p_replacement_thresholds jsonb DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_pick public.draft_picks; v_existing public.draft_picks; v_tracker public.evolution_tracker;
        v_has_tracker boolean; v_progress integer; v_src public.draft_slots; v_current public.draft_slots;
        v_anchor public.draft_slots; v_prev numeric; v_key numeric; v_r uuid; v_r_slot public.draft_slots;
        v_secs integer; v_entry_id uuid; v_commit jsonb := NULL; v_gate jsonb;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_requeue IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'requeue')::text;
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  -- A replayed correction returns the first result.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.draft_picks WHERE draft_pool_id = p_pool_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('replay', true, 'pick_id', v_existing.id, 'state_version', v_pool.state_version);
    END IF;
  END IF;

  SELECT * INTO v_pick FROM public.draft_picks WHERE id = p_pick_id AND draft_pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PICK_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pick.voided_at IS NOT NULL THEN RAISE EXCEPTION 'PICK_ALREADY_VOIDED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'drafting' THEN
    IF v_pool.paused_at IS NULL THEN RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE' USING ERRCODE = 'P0001'; END IF;
  ELSIF v_pool.phase <> 'complete' THEN
    RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tracker FROM public.evolution_tracker
   WHERE season_id = v_pool.season_id AND season_group_id IS NOT DISTINCT FROM v_pool.season_group_id
     AND line_id = v_pick.line_id FOR UPDATE;
  v_has_tracker := FOUND;
  IF v_has_tracker THEN
    IF v_tracker.player_id <> v_pick.player_id THEN                    -- the line moved on: never touch it
      RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('line_id', v_pick.line_id, 'player_id', v_tracker.player_id)::text;
    END IF;
    v_progress := v_tracker.real_kills + v_tracker.draft_tokens + v_tracker.kill_tokens + v_tracker.cosmo_points;
    IF v_progress > 0 THEN
      RAISE EXCEPTION 'VOID_BLOCKED_PROGRESS' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('progress', v_progress)::text;
    END IF;
  END IF;

  UPDATE public.draft_picks SET voided_at = now(), voided_by = p_actor_id, void_reason = left(p_reason, 500) WHERE id = p_pick_id;
  IF v_has_tracker THEN DELETE FROM public.evolution_tracker WHERE id = v_tracker.id; END IF;
  UPDATE public.redraft_slots SET filled_by_pick_id = NULL WHERE filled_by_pick_id = p_pick_id;
  SELECT * INTO v_src FROM public.draft_slots WHERE id = v_pick.slot_id;

  -- requeue: the current slot goes back to pending and R goes directly before it (else to the end)
  SELECT * INTO v_current FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.draft_slots
       SET status = 'pending', timer_seconds = NULL, started_at = NULL, deadline_at = NULL, remaining_ms_at_pause = NULL,
           extension_seconds = 0
     WHERE id = v_current.id;
  END IF;
  SELECT * INTO v_anchor FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND status = 'pending' ORDER BY sort_key LIMIT 1;
  IF FOUND THEN
    SELECT max(sort_key) INTO v_prev FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND sort_key < v_anchor.sort_key;
    v_key := CASE WHEN v_prev IS NULL THEN v_anchor.sort_key - 1 ELSE (v_prev + v_anchor.sort_key) / 2 END;
  ELSE
    SELECT COALESCE(max(sort_key), 0) + 1 INTO v_key FROM public.draft_slots WHERE draft_pool_id = p_pool_id;
  END IF;
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number, kind, status, previous_slot_id)
  VALUES (p_pool_id, v_pick.player_id, v_key, COALESCE(v_src.round, v_pick.round::smallint),
          COALESCE(v_src.nominal_pick_number, v_pick.pick_number), 'normal', 'pending', v_src.id)
  RETURNING id INTO v_r;
  UPDATE public.draft_participants SET done_at = NULL WHERE draft_pool_id = p_pool_id AND player_id = v_pick.player_id;
  IF v_pool.phase = 'complete' THEN                                   -- reopen, paused, so the admin resumes it
    UPDATE public.draft_pools
       SET phase = 'drafting', status = 'in_progress', ended_at = NULL, paused_at = now(), paused_by = p_actor_id,
           pause_reason = 'admin', updated_at = now()
     WHERE id = p_pool_id;
  END IF;

  v_gate := public.draft__pool_completable(p_pool_id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('pick_id', p_pick_id, 'nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'POOL_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('pick_id', p_pick_id, 'player_id', v_pick.player_id)::text;
  END IF;

  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'pick_voided',
    p_player_id => v_pick.player_id, p_slot_id => v_pick.slot_id, p_pick_id => p_pick_id, p_line_id => v_pick.line_id,
    p_before => to_jsonb(v_pick), p_after => jsonb_build_object('restored_slot_id', v_r, 'requeue', true),
    p_reason => p_reason);

  IF p_replacement_line_id IS NOT NULL THEN
    SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
    SELECT id INTO v_entry_id FROM public.point_buy_list_entries
     WHERE list_version_id = v_pool.list_version_id AND line_id = p_replacement_line_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;
    v_secs := public.draft__slot_seconds(v_pool, v_pick.player_id, 'normal');
    UPDATE public.draft_slots
       SET status = 'active', timer_seconds = v_secs, started_at = now(), deadline_at = NULL, remaining_ms_at_pause = v_secs * 1000
     WHERE id = v_r RETURNING * INTO v_r_slot;
    v_commit := public.draft__commit_pick(v_pool, v_r_slot, v_entry_id, p_actor_id, 'admin', p_client_request_id,
      v_pick.redraft_slot_id, p_replacement_thresholds, 'pick_corrected', p_reason);
  END IF;

  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'restored_slot_id', v_r, 'requeue', true,
    'pick_id', v_commit->'pick_id', 'replay', false);
END $$;

-- 11. redraft__publish_locked (base 20261018140200): submissions join the trackers of the pool's group ──────────────
CREATE OR REPLACE FUNCTION public.redraft__publish_locked(p_pool public.draft_pools, p_actor_id uuid, p_actor_role text,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_subs jsonb; v_sub jsonb; v_tracker public.evolution_tracker; v_entry public.point_buy_list_entries;
        v_player uuid := NULL; v_n integer := 0; v_slot_id uuid; v_drops jsonb := '[]'::jsonb; v_total integer := 0;
        v_part record; v_next uuid; v_pool public.draft_pools; v_capped integer := 0; v_gate jsonb;
BEGIN
  IF p_pool.kind <> 'redraft' OR p_pool.phase <> 'submissions' THEN
    RAISE EXCEPTION 'SUBMISSIONS_ALREADY_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Freeze first: deleting the dropped trackers cascades their submission rows. Only participants' submissions count.
  --    Defensive cap: never more than redraft_max_lines per player (draft_configure refuses lowering it below a saved
  --    list; this guards rows written any other way): the first max lines in BR-10 order drop, the rest stay rostered.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'tracker_id', r.tracker_id, 'line_id', r.line_id,
                                               'price', r.price)
                            ORDER BY r.player_id, r.price DESC NULLS LAST, r.line_id)
                    FILTER (WHERE r.rn <= COALESCE(p_pool.redraft_max_lines, 3)), '[]'::jsonb),
         count(*) FILTER (WHERE r.rn > COALESCE(p_pool.redraft_max_lines, 3))
    INTO v_subs, v_capped
    FROM (SELECT s.player_id, s.tracker_id, s.line_id, e.price,
                 row_number() OVER (PARTITION BY s.player_id ORDER BY e.price DESC NULLS LAST, s.line_id) AS rn
            FROM public.redraft_submissions s
            JOIN public.draft_participants dp ON dp.draft_pool_id = s.draft_pool_id AND dp.player_id = s.player_id
            JOIN public.evolution_tracker t ON t.id = s.tracker_id AND t.player_id = s.player_id
                                           AND t.season_id = p_pool.season_id
                                           AND t.season_group_id IS NOT DISTINCT FROM p_pool.season_group_id
            LEFT JOIN public.point_buy_list_entries e ON e.list_version_id = p_pool.list_version_id AND e.line_id = s.line_id
           WHERE s.draft_pool_id = p_pool.id) r;
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, 'submissions_frozen',
    p_after => jsonb_build_object('count', jsonb_array_length(v_subs), 'capped', v_capped), p_reason => p_reason,
    p_is_public => false);
  IF v_capped > 0 THEN                                 -- capped lines stay rostered: their stale secret rows go
    DELETE FROM public.redraft_submissions s
     WHERE s.draft_pool_id = p_pool.id
       AND s.tracker_id NOT IN (SELECT (x->>'tracker_id')::uuid FROM jsonb_array_elements(v_subs) AS x);
  END IF;

  -- 2. Per player, dropped price desc then line id → labels A, B, C… (BR-10).
  FOR v_sub IN SELECT x FROM jsonb_array_elements(v_subs) AS x LOOP
    IF v_player IS DISTINCT FROM (v_sub->>'player_id')::uuid THEN
      v_player := (v_sub->>'player_id')::uuid;
      v_n := 0;
    END IF;
    v_n := v_n + 1;
    SELECT * INTO v_tracker FROM public.evolution_tracker WHERE id = (v_sub->>'tracker_id')::uuid FOR UPDATE;
    SELECT * INTO v_entry FROM public.point_buy_list_entries
     WHERE list_version_id = p_pool.list_version_id AND line_id = v_tracker.line_id;
    INSERT INTO public.redraft_slots (draft_pool_id, season_id, player_id, label, dropped_line_id, dropped_entry_id,
      dropped_price, transferred_real_kills, dropped_stage, dropped_tracker_snapshot)
    VALUES (p_pool.id, p_pool.season_id, v_player, chr(64 + v_n), v_tracker.line_id, v_entry.id, COALESCE(v_entry.price, 0),
      v_tracker.real_kills, v_tracker.current_stage, to_jsonb(v_tracker))          -- only real kills transfer (SPEC:757-770)
    RETURNING id INTO v_slot_id;
    INSERT INTO public.draft_line_restrictions (draft_pool_id, player_id, line_id, reason, created_by)
    VALUES (p_pool.id, v_player, v_tracker.line_id, 'own_redraft_drop', p_actor_id)
    ON CONFLICT (draft_pool_id, player_id, line_id) DO NOTHING;
    INSERT INTO public.redraft_history (season_id, player_id, from_tracker_id, to_base_pokemon, to_stage3_pokemon, transfer_type,
      missing_kills_transferred, points_spent, draft_pool_id, dropped_line_id, transferred_real_kills, points_refunded)
    VALUES (p_pool.season_id, v_player, v_tracker.id, v_tracker.base_pokemon, v_tracker.locked_stage3_pokemon, 'secret_drop',
      0, 0, p_pool.id, v_tracker.line_id, v_tracker.real_kills, COALESCE(v_entry.price, 0));
    DELETE FROM public.evolution_tracker WHERE id = v_tracker.id;
    v_drops := v_drops || jsonb_build_object('player_id', v_player, 'label', chr(64 + v_n), 'line_id', v_tracker.line_id,
      'transferred_real_kills', v_tracker.real_kills, 'price', COALESCE(v_entry.price, 0));
    v_total := v_total + 1;
  END LOOP;

  -- 3. Participants: slots = drops; budget = season leftover + refunds (BR-5 ledger, now incl. redraft_slots).
  FOR v_part IN SELECT player_id FROM public.draft_participants WHERE draft_pool_id = p_pool.id LOOP
    UPDATE public.draft_participants dp
       SET slots_total = (SELECT count(*) FROM public.redraft_slots rs
                           WHERE rs.draft_pool_id = p_pool.id AND rs.player_id = v_part.player_id),
           budget_start = COALESCE(public.epb__season_remaining_points(p_pool.season_id, v_part.player_id), 0)
     WHERE dp.draft_pool_id = p_pool.id AND dp.player_id = v_part.player_id;
  END LOOP;
  UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool.id AND slots_total = 0;

  -- 4. Redraft queue (§5.2): rounds 1..max(drops); player P only in rounds 1..drops(P); snake over the frozen seats.
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number)
  SELECT p_pool.id, s.player_id, s.rn, s.round, s.rn
    FROM (SELECT dp.player_id, r.round,
                 row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN dp.seat ELSE -dp.seat END) AS rn
            FROM public.draft_participants dp
            CROSS JOIN LATERAL generate_series(1, dp.slots_total) AS r(round)
           WHERE dp.draft_pool_id = p_pool.id AND dp.slots_total > 0) s;

  -- 4b. Pool gate: every redraft slot must be fillable at once (free lines incl. the drops, own drops and redraft-locked
  --     lines excluded, the published budgets). A refusal rolls the whole publish back: the submissions stay secret
  --     and editable once the admin moves the deadline (draft_configure), so the players can change their drops.
  v_gate := public.draft__pool_completable(p_pool.id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'REDRAFT_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('slots', (v_gate->>'slots')::int, 'lines', (v_gate->>'lines')::int,
                                  'participants', (v_gate->>'participants')::int, 'min_total', (v_gate->>'min_total')::int,
                                  'budget_total', (v_gate->>'budget_total')::int)::text;
  END IF;

  UPDATE public.draft_pools
     SET phase = 'drafting', status = 'in_progress', submissions_published_at = now(), started_at = now(),
         paused_at = NULL, paused_by = NULL, pause_reason = NULL, updated_at = now()
   WHERE id = p_pool.id;
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, 'submissions_published',
    p_after => jsonb_build_object('drops', v_drops), p_reason => p_reason);
  v_next := public.draft__activate_next(p_pool.id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool.id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'drops', v_total, 'published', true,
    'active_slot_id', v_next);
END $$;

-- 12. redraft_admin_restore_drop (base 20261018140200): owner check and restored tracker in the pool's group ───────
CREATE OR REPLACE FUNCTION public.redraft_admin_restore_drop(p_pool_id uuid, p_redraft_slot_id uuid, p_actor_id uuid,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.redraft_slots; v_snap public.evolution_tracker; v_owner uuid;
        v_budget_start integer; v_spent integer; v_tracker_id uuid; v_queue public.draft_slots; v_removed uuid := NULL;
        v_was_current boolean := false; v_gate jsonb;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' OR v_pool.kind <> 'redraft' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'drafting' OR v_pool.paused_at IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_slot FROM public.redraft_slots WHERE id = p_redraft_slot_id AND draft_pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.filled_by_pick_id IS NOT NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001'; END IF;
  v_owner := (SELECT t.player_id FROM public.evolution_tracker t
               WHERE t.season_id = v_pool.season_id AND t.season_group_id IS NOT DISTINCT FROM v_pool.season_group_id
                 AND t.line_id = v_slot.dropped_line_id LIMIT 1);
  IF v_owner IS NULL THEN
    v_owner := (SELECT k.player_id FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool_id AND k.line_id = v_slot.dropped_line_id AND k.voided_at IS NULL LIMIT 1);
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_slot.dropped_line_id, 'player_id', v_owner)::text;
  END IF;
  SELECT budget_start INTO v_budget_start FROM public.draft_participants
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id FOR UPDATE;
  IF NOT FOUND THEN                                     -- a removed participant keeps redraft_slots rows: no budget to check
    RAISE EXCEPTION 'NOT_PARTICIPANT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('player_id', v_slot.player_id)::text;
  END IF;
  SELECT COALESCE(sum(points_spent), 0) INTO v_spent FROM public.draft_picks
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND voided_at IS NULL;
  IF v_budget_start IS NULL OR v_budget_start - v_slot.dropped_price - v_spent < 0 THEN   -- NULL-safe
    RAISE EXCEPTION 'RESTORE_WOULD_OVERDRAW' USING ERRCODE = 'P0001';
  END IF;

  v_snap := jsonb_populate_record(NULL::public.evolution_tracker, v_slot.dropped_tracker_snapshot);
  INSERT INTO public.evolution_tracker (season_id, player_id, base_pokemon, current_form, total_kos, current_stage, evolved_at,
    real_kills, draft_tokens, kill_tokens, cosmo_points, suspended_until_matchday, evolution_points_awarded,
    locked_stage3_pokemon, line_id, transferred_evo_progress, redraft_slot_id, season_group_id)
  VALUES (v_pool.season_id, v_slot.player_id, v_snap.base_pokemon, v_snap.current_form, COALESCE(v_snap.total_kos, 0),
    COALESCE(v_snap.current_stage, 1), v_snap.evolved_at, COALESCE(v_snap.real_kills, 0), COALESCE(v_snap.draft_tokens, 0),
    COALESCE(v_snap.kill_tokens, 0), COALESCE(v_snap.cosmo_points, 0), v_snap.suspended_until_matchday,
    COALESCE(v_snap.evolution_points_awarded, 0), v_snap.locked_stage3_pokemon, v_slot.dropped_line_id,
    COALESCE(v_snap.transferred_evo_progress, 0),
    CASE WHEN v_snap.redraft_slot_id IS DISTINCT FROM v_slot.id THEN v_snap.redraft_slot_id END, v_pool.season_group_id)
  RETURNING id INTO v_tracker_id;

  DELETE FROM public.draft_line_restrictions
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND line_id = v_slot.dropped_line_id
     AND reason = 'own_redraft_drop';
  -- draft_picks.redraft_slot_id has no ON DELETE action: a live pick on the slot is a coded error (never a raw 23503),
  -- and voided picks drop the reference (the slot id stays in this action's log entry).
  IF EXISTS (SELECT 1 FROM public.draft_picks WHERE redraft_slot_id = v_slot.id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.draft_picks SET redraft_slot_id = NULL WHERE redraft_slot_id = v_slot.id AND voided_at IS NOT NULL;
  DELETE FROM public.redraft_slots WHERE id = v_slot.id;
  UPDATE public.draft_participants
     SET slots_total = GREATEST(slots_total - 1, 0), budget_start = budget_start - v_slot.dropped_price
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;

  -- the player needs one line fewer: their last pending queue slot leaves the queue, else their current slot (then the
  -- next one activates, still paused). Open queue slots are referenced by no pick and no other slot.
  SELECT * INTO v_queue FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status = 'pending'
   ORDER BY sort_key DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_queue FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status = 'active' FOR UPDATE;
    v_was_current := FOUND;
  END IF;
  IF v_queue.id IS NOT NULL THEN
    DELETE FROM public.draft_slots WHERE id = v_queue.id;
    v_removed := v_queue.id;
  END IF;
  IF public.draft__open_slots(p_pool_id, v_slot.player_id) = 0 THEN
    UPDATE public.draft_participants SET done_at = COALESCE(done_at, now())
     WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;
  END IF;

  v_gate := public.draft__pool_completable(p_pool_id);
  IF v_gate->>'status' = 'undecided' THEN
    RAISE EXCEPTION 'POOL_CHECK_LIMIT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('redraft_slot_id', v_slot.id, 'nodes', (v_gate->>'nodes')::int)::text;
  ELSIF v_gate->>'status' <> 'completable' THEN
    RAISE EXCEPTION 'POOL_NOT_COMPLETABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('redraft_slot_id', v_slot.id, 'player_id', v_slot.player_id)::text;
  END IF;
  IF v_was_current THEN PERFORM public.draft__activate_next(p_pool_id, now()); END IF;

  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'drop_restored',
    p_player_id => v_slot.player_id, p_slot_id => v_removed, p_line_id => v_slot.dropped_line_id,
    p_before => jsonb_build_object('redraft_slot_id', v_slot.id, 'label', v_slot.label, 'dropped_price', v_slot.dropped_price,
                                   'transferred_real_kills', v_slot.transferred_real_kills),
    p_after => jsonb_build_object('tracker_id', v_tracker_id, 'removed_slot_id', v_removed), p_reason => p_reason);
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'tracker_id', v_tracker_id, 'removed_slot_id', v_removed);
END $$;

-- 13. redraft_set_submission (base 20261012025023): the trainer's trackers of the pool's group ───────────────────────
CREATE OR REPLACE FUNCTION public.redraft_set_submission(p_pool_id uuid, p_player_id uuid, p_actor_id uuid, p_actor_role text,
  p_line_ids text[]) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_lines text[]; v_line text; v_tracker public.evolution_tracker; v_rules jsonb;
        v_now timestamptz := now();
BEGIN
  -- Own submission only: admins cannot submit for other players (§8.1 #19).
  IF p_actor_id IS DISTINCT FROM p_player_id OR p_actor_role IS NULL OR p_actor_role NOT IN ('player', 'admin') THEN
    RAISE EXCEPTION 'ACTOR_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' OR v_pool.kind <> 'redraft' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'submissions' OR v_pool.submission_deadline_at IS NULL OR v_now >= v_pool.submission_deadline_at THEN
    RAISE EXCEPTION 'SUBMISSION_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_participants WHERE draft_pool_id = p_pool_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'NOT_PARTICIPANT' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT l ORDER BY l), '{}'::text[]) INTO v_lines
    FROM unnest(COALESCE(p_line_ids, '{}'::text[])) AS l WHERE l IS NOT NULL;
  IF cardinality(v_lines) > COALESCE(v_pool.redraft_max_lines, 3) THEN
    RAISE EXCEPTION 'REDRAFT_MAX_EXCEEDED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('max', COALESCE(v_pool.redraft_max_lines, 3))::text;
  END IF;
  FOREACH v_line IN ARRAY v_lines LOOP
    SELECT * INTO v_tracker FROM public.evolution_tracker
     WHERE season_id = v_pool.season_id AND season_group_id IS NOT DISTINCT FROM v_pool.season_group_id
       AND line_id = v_line AND player_id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
    SELECT e.special_rules INTO v_rules FROM public.point_buy_list_entries e
     WHERE e.list_version_id = v_pool.list_version_id AND e.line_id = v_line;
    IF COALESCE((v_rules->>'no_redraft')::boolean, false) THEN
      RAISE EXCEPTION 'LINE_NOT_DROPPABLE' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
  END LOOP;

  DELETE FROM public.redraft_submissions WHERE draft_pool_id = p_pool_id AND player_id = p_player_id;
  INSERT INTO public.redraft_submissions (draft_pool_id, player_id, tracker_id, line_id, updated_at)
  SELECT p_pool_id, p_player_id, t.id, t.line_id, v_now
    FROM public.evolution_tracker t
   WHERE t.season_id = v_pool.season_id AND t.season_group_id IS NOT DISTINCT FROM v_pool.season_group_id
     AND t.player_id = p_player_id AND t.line_id = ANY (v_lines);

  -- Secret: never public, never in recent_events.
  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, p_actor_role, 'submission_changed',
    p_player_id => p_player_id, p_after => jsonb_build_object('line_ids', to_jsonb(v_lines)), p_is_public => false);
  RETURN jsonb_build_object('line_ids', to_jsonb(v_lines), 'updated_at', CASE WHEN cardinality(v_lines) > 0 THEN v_now END);
END $$;

-- 14. draft__build_snapshot (base 20261018140100): 'taken' = the pool's group ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft__build_snapshot(p_pool public.draft_pools) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_current public.draft_slots; v_published boolean; v_redraft jsonb := NULL; v_active jsonb := NULL;
BEGIN
  SELECT * INTO v_current FROM public.draft_slots
   WHERE draft_pool_id = p_pool.id AND status IN ('active', 'blocked') LIMIT 1;
  IF FOUND THEN
    v_active := jsonb_build_object('slot_id', v_current.id, 'player_id', v_current.player_id, 'round', v_current.round,
      'pick_number', v_current.nominal_pick_number, 'kind', v_current.kind, 'status', v_current.status,
      'duration_ms', COALESCE(v_current.timer_seconds, 0) * 1000, 'extensions_applied_ms', v_current.extension_seconds * 1000,
      'started_at', v_current.started_at, 'deadline_at', v_current.deadline_at,
      'remaining_ms_at_pause', v_current.remaining_ms_at_pause, 'sort_key', v_current.sort_key);
  END IF;

  IF p_pool.kind = 'redraft' THEN
    v_published := p_pool.submissions_published_at IS NOT NULL;
    v_redraft := jsonb_build_object(
      'phase', CASE WHEN p_pool.phase = 'submissions'
                    THEN CASE WHEN p_pool.submission_deadline_at IS NOT NULL AND now() >= p_pool.submission_deadline_at
                              THEN 'locked' ELSE 'submissions' END
                    WHEN p_pool.phase = 'drafting' THEN 'drafting' ELSE 'complete' END,
      'deadline_at', p_pool.submission_deadline_at,
      'published_at', p_pool.submissions_published_at,
      'drops', CASE WHEN v_published THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('player_id', rs.player_id, 'line_id', rs.dropped_line_id,
                                              'transferred_real_kills', rs.transferred_real_kills) ORDER BY dp.seat, rs.label)
            FROM public.redraft_slots rs
            LEFT JOIN public.draft_participants dp ON dp.draft_pool_id = rs.draft_pool_id AND dp.player_id = rs.player_id
           WHERE rs.draft_pool_id = p_pool.id), '[]'::jsonb) END,
      'all_slots', CASE WHEN v_published THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('redraft_slot_id', rs.id, 'player_id', rs.player_id, 'label', rs.label,
                                              'dropped_line_id', rs.dropped_line_id,
                                              'transferred_real_kills', rs.transferred_real_kills,
                                              'filled_by_pick_id', rs.filled_by_pick_id) ORDER BY dp.seat, rs.label)
            FROM public.redraft_slots rs
            LEFT JOIN public.draft_participants dp ON dp.draft_pool_id = rs.draft_pool_id AND dp.player_id = rs.player_id
           WHERE rs.draft_pool_id = p_pool.id), '[]'::jsonb) ELSE '[]'::jsonb END);
  END IF;

  RETURN jsonb_build_object(
    'state_version', p_pool.state_version,
    'server_now', now(),
    'pool', jsonb_build_object('id', p_pool.id, 'season_id', p_pool.season_id, 'kind', p_pool.kind, 'mode', p_pool.mode,
      'status', p_pool.status, 'paused', p_pool.paused_at IS NOT NULL, 'paused_at', p_pool.paused_at,
      'roster_size', COALESCE(p_pool.roster_size, 0), 'budget', COALESCE(p_pool.point_budget, 0),
      'started_at', p_pool.started_at, 'ended_at', p_pool.ended_at, 'phase', p_pool.phase,
      'pause_reason', p_pool.pause_reason, 'list_version_id', p_pool.list_version_id, 'engine', p_pool.engine),
    'config', jsonb_build_object('pick_seconds', COALESCE(p_pool.pick_seconds, 300),
      'makeup_seconds', COALESCE(p_pool.makeup_seconds, 150), 'slow_ladder_seconds', to_jsonb(p_pool.slow_ladder_seconds),
      'extension_seconds', CASE WHEN p_pool.mode = 'slow' OR NOT p_pool.extensions_enabled THEN NULL
                                ELSE to_jsonb(p_pool.extension_seconds) END,
      'redraft_max_lines', p_pool.redraft_max_lines, 'extensions_enabled', p_pool.extensions_enabled,
      'redraft_lock_no_redraft_lines', p_pool.redraft_lock_no_redraft_lines,
      'submission_deadline_at', p_pool.submission_deadline_at, 'token_purchase_closes_at', p_pool.token_purchase_closes_at,
      'quiet_hours', public.draft__quiet_hours_json(p_pool.quiet_start_hour, p_pool.quiet_end_hour, p_pool.quiet_timezone)),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'player_id', dp.player_id, 'name', pl.name, 'avatar_url', pl.avatar_url, 'seat', dp.seat,
          'standing_rank', dp.standing_rank, 'slots_total', dp.slots_total,
          'picks_made', (SELECT count(*) FROM public.draft_picks k
                          WHERE k.draft_pool_id = p_pool.id AND k.player_id = dp.player_id AND k.voided_at IS NULL),
          'open_slots', public.draft__open_slots(p_pool.id, dp.player_id),
          'budget_start', dp.budget_start,
          'budget_remaining', public.draft__remaining_budget(p_pool.id, dp.player_id),
          'penalty_stage', dp.penalty_stage, 'timeout_count', dp.timeout_count,
          'extensions', jsonb_build_object('plus120_used', dp.ext_plus120_used_at IS NOT NULL,
                                           'plus60_used', dp.ext_plus60_used_at IS NOT NULL),
          'done', dp.done_at IS NOT NULL) ORDER BY dp.seat)
        FROM public.draft_participants dp JOIN public.players pl ON pl.id = dp.player_id
       WHERE dp.draft_pool_id = p_pool.id), '[]'::jsonb),
    'active_slot', v_active,
    'upcoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('slot_id', u.id, 'player_id', u.player_id, 'pick_number', u.nominal_pick_number,
                                          'round', u.round, 'kind', u.kind,
                                          'duration_ms', public.draft__slot_seconds(p_pool, u.player_id, u.kind) * 1000,
                                          'sort_key', u.sort_key) ORDER BY u.sort_key)
        FROM (SELECT * FROM public.draft_slots s WHERE s.draft_pool_id = p_pool.id AND s.status = 'pending'
               ORDER BY s.sort_key LIMIT 10) u), '[]'::jsonb),
    'picks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pick_id', k.id, 'slot_id', k.slot_id, 'pick_number', k.pick_number,
                                          'round', k.round, 'player_id', k.player_id, 'line_id', k.line_id,
                                          'entry_id', k.line_entry_id, 'price', COALESCE(k.points_spent, 0),
                                          'made_at', k."timestamp",
                                          'admin_override', k.made_by_role = 'admin' AND k.made_by IS DISTINCT FROM k.player_id,
                                          'redraft_slot_id', k.redraft_slot_id) ORDER BY k.pick_number)
        FROM public.draft_picks k WHERE k.draft_pool_id = p_pool.id AND k.voided_at IS NULL), '[]'::jsonb),
    'taken', COALESCE((
      SELECT jsonb_object_agg(o.line_id, o.player_id)
        FROM (SELECT DISTINCT ON (x.line_id) x.line_id, x.player_id FROM (
                SELECT t.line_id, t.player_id, 0 AS pri FROM public.evolution_tracker t
                 WHERE t.season_id = p_pool.season_id AND t.line_id IS NOT NULL
                   AND t.season_group_id IS NOT DISTINCT FROM p_pool.season_group_id
                UNION ALL
                SELECT k.line_id, k.player_id, 1 FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool.id AND k.voided_at IS NULL AND k.line_id IS NOT NULL) x
              ORDER BY x.line_id, x.pri) o), '{}'::jsonb),
    'prices', COALESCE((
      SELECT jsonb_object_agg(e.line_id, e.price) FROM public.point_buy_list_entries e
       WHERE e.list_version_id = p_pool.list_version_id), '{}'::jsonb),
    'restrictions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('player_id', r.player_id, 'line_id', r.line_id, 'reason', r.reason)
                       ORDER BY r.player_id, r.line_id)
        FROM public.draft_line_restrictions r WHERE r.draft_pool_id = p_pool.id), '[]'::jsonb),
    'no_redraft_line_ids', COALESCE((
      SELECT jsonb_agg(e.line_id ORDER BY e.line_id) FROM public.point_buy_list_entries e
       WHERE e.list_version_id = p_pool.list_version_id AND COALESCE((e.special_rules->>'no_redraft')::boolean, false)),
      '[]'::jsonb),
    'redraft', v_redraft,
    'recent_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.occurred_at, 'action', a.action, 'actor_role', a.actor_role,
                                          'player_id', a.player_id, 'line_id', a.line_id, 'slot_id', a.slot_id) ORDER BY a.id DESC)
        FROM (SELECT * FROM public.draft_action_log l
               WHERE l.draft_pool_id = p_pool.id AND l.is_public
                 AND l.action NOT IN ('submission_changed', 'submissions_frozen')
               ORDER BY l.id DESC LIMIT 12) a), '[]'::jsonb));
END $$;

-- 15. draft_create_pool (base 20261018140100): p_season_group_id ──────────────────────────────────────────────────────
DROP FUNCTION public.draft_create_pool(uuid, text, uuid, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.draft_create_pool(p_season_id uuid, p_kind text, p_actor_id uuid, p_config jsonb, p_seats jsonb,
  p_season_group_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_season public.seasons; v_rules public.format_rules; v_initial public.draft_pools; v_pool_id uuid;
        v_mode text; v_budget integer; v_roster integer; v_pick integer; v_makeup integer; v_ladder integer[];
        v_ext_enabled boolean; v_max_lines integer; v_lock boolean; v_deadline timestamptz; v_closes timestamptz;
        v_n integer; v_replaced uuid; v_q_start smallint; v_q_end smallint; v_q_tz text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('initial', 'redraft') THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'kind')::text;
  END IF;
  IF p_config IS NOT NULL AND jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'config')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'season_id')::text;
  END IF;
  SELECT * INTO v_rules FROM public.format_rules WHERE season_id = p_season_id;
  v_n := public.draft__validate_seats(p_seats);
  -- League groups: a league with groups drafts per group (seats = exactly the group's members); a league without
  -- groups names none. Membership cannot change while the group has a live pool (season_group_members guard).
  IF p_season_group_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = p_season_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.season_groups WHERE id = p_season_group_id AND season_id = p_season_id) THEN
      RAISE EXCEPTION 'SEASON_GROUP_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT m.player_id FROM public.season_group_members m WHERE m.group_id = p_season_group_id
               EXCEPT SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e)
       OR EXISTS (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e
               EXCEPT SELECT m.player_id FROM public.season_group_members m WHERE m.group_id = p_season_group_id) THEN
      RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', p_season_group_id)::text;
    END IF;
  END IF;

  -- shared config (§8.2 ranges are zod's; SQL keeps the safe outer bounds of the column CHECKs)
  v_mode := COALESCE(p_config->>'mode', 'live');
  IF v_mode NOT IN ('live', 'slow') THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'mode')::text;
  END IF;
  v_pick := COALESCE(public.draft__cfg_int(p_config, 'pick_seconds', 30, 172800), 300);
  v_makeup := COALESCE(public.draft__cfg_int(p_config, 'makeup_seconds', 30, 172800), 150);
  v_ladder := COALESCE(public.draft__cfg_ladder(p_config), '{43200,21600,10800,5400}'::integer[]);
  v_ext_enabled := COALESCE(public.draft__cfg_bool(p_config, 'extensions_enabled'), true);
  v_lock := COALESCE(public.draft__cfg_bool(p_config, 'redraft_lock_no_redraft_lines'), true);
  v_max_lines := public.draft__cfg_int(p_config, 'redraft_max_lines', 0, 20, true);
  -- Quiet hours: the route sends the format pack's window; frozen at creation, never patched.
  SELECT q.start_hour, q.end_hour, q.time_zone INTO v_q_start, v_q_end, v_q_tz FROM public.draft__cfg_quiet(p_config) q;

  IF p_kind = 'initial' THEN
    -- A pre-M2 placeholder (engine legacy, still pending, no picks) never became a draft:
    -- the live point-buy league season created its pool row before the queue engine existed. It is replaced, not a conflict.
    SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
       AND season_group_id IS NOT DISTINCT FROM p_season_group_id;
    IF FOUND THEN
      IF v_initial.engine = 'legacy' AND v_initial.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_pool_id = v_initial.id)
         AND NOT EXISTS (SELECT 1 FROM public.teams WHERE draft_pool_id = v_initial.id) THEN
        DELETE FROM public.draft_pools WHERE id = v_initial.id;
        v_replaced := v_initial.id;
      ELSE
        RAISE EXCEPTION 'POOL_EXISTS' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_season.point_buy_list_id IS NULL THEN RAISE EXCEPTION 'SEASON_HAS_NO_LIST' USING ERRCODE = 'P0001'; END IF;
    v_budget := COALESCE(public.draft__cfg_int(p_config, 'budget', 1, 1000), v_rules.draft_budget, 180);
    v_roster := COALESCE(public.draft__cfg_int(p_config, 'roster_size', 1, 20), v_rules.draft_picks, 9);
    v_closes := public.draft__cfg_ts(p_config, 'token_purchase_closes_at');
    INSERT INTO public.draft_pools (season_id, draft_type, point_budget, status, engine, kind, mode, phase, list_version_id,
      roster_size, pick_seconds, makeup_seconds, slow_ladder_seconds, extensions_enabled, redraft_max_lines,
      redraft_lock_no_redraft_lines, token_purchase_closes_at, created_by, quiet_start_hour, quiet_end_hour, quiet_timezone,
      season_group_id)
    VALUES (p_season_id, 'snake', v_budget, 'pending', 'queue', 'initial', v_mode, 'setup', v_season.point_buy_list_id,
      v_roster, v_pick, v_makeup, v_ladder, v_ext_enabled, v_max_lines, v_lock, v_closes, p_actor_id, v_q_start, v_q_end, v_q_tz,
      p_season_group_id)
    RETURNING id INTO v_pool_id;
    INSERT INTO public.draft_participants (draft_pool_id, player_id, seat, standing_rank, slots_total, budget_start)
    SELECT v_pool_id, (e->>'player_id')::uuid, (e->>'seat')::int, (e->>'standing_rank')::int, v_roster, v_budget
      FROM jsonb_array_elements(p_seats) e;
  ELSE
    SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
       AND season_group_id IS NOT DISTINCT FROM p_season_group_id;
    IF NOT FOUND OR v_initial.phase <> 'complete' THEN
      RAISE EXCEPTION 'INITIAL_DRAFT_NOT_COMPLETE' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase <> 'cancelled'
                AND season_group_id IS NOT DISTINCT FROM p_season_group_id) THEN
      RAISE EXCEPTION 'POOL_EXISTS' USING ERRCODE = 'P0001';
    END IF;
    v_deadline := public.draft__cfg_ts(p_config, 'submission_deadline_at');
    IF v_deadline IS NULL OR v_deadline <= now() THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('field', 'submission_deadline_at')::text;
    END IF;
    INSERT INTO public.draft_pools (season_id, draft_type, point_budget, status, engine, kind, mode, phase, list_version_id,
      parent_pool_id, roster_size, pick_seconds, makeup_seconds, slow_ladder_seconds, extensions_enabled, redraft_max_lines,
      redraft_lock_no_redraft_lines, submission_deadline_at, created_by, quiet_start_hour, quiet_end_hour, quiet_timezone,
      season_group_id)
    VALUES (p_season_id, 'snake', NULL, 'in_progress', 'queue', 'redraft', v_mode, 'submissions',
      COALESCE(v_initial.list_version_id, v_season.point_buy_list_id), v_initial.id, v_initial.roster_size, v_pick, v_makeup,
      v_ladder, v_ext_enabled, COALESCE(v_max_lines, 3), v_lock, v_deadline, p_actor_id, v_q_start, v_q_end, v_q_tz,
      p_season_group_id)
    RETURNING id INTO v_pool_id;
    INSERT INTO public.draft_participants (draft_pool_id, player_id, seat, standing_rank, slots_total, budget_start)
    SELECT v_pool_id, (e->>'player_id')::uuid, (e->>'seat')::int, (e->>'standing_rank')::int, 0, 0
      FROM jsonb_array_elements(p_seats) e;
  END IF;

  PERFORM public.draft__log(p_season_id, v_pool_id, p_actor_id, 'admin', 'draft_configured',
    p_before => CASE WHEN v_replaced IS NULL THEN NULL
                     ELSE jsonb_build_object('replaced_legacy_placeholder_pool_id', v_replaced) END,
    p_after => jsonb_build_object('kind', p_kind, 'config', COALESCE(p_config, '{}'::jsonb), 'seats', p_seats)
               || CASE WHEN p_season_group_id IS NULL THEN '{}'::jsonb
                       ELSE jsonb_build_object('season_group_id', p_season_group_id) END);
  RETURN v_pool_id;
END $$;

-- 15b. draft_configure (base 20261012024916): re-seating a group's pool keeps the seats = exactly the group's members
CREATE OR REPLACE FUNCTION public.draft_configure(p_pool_id uuid, p_actor_id uuid, p_patch jsonb, p_seats jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_after public.draft_pools; v_key text; v_allowed text[]; v_patch jsonb;
        v_before_seats jsonb; v_after_seats jsonb; v_int integer; v_ladder integer[]; v_ts timestamptz; v_subs_max integer;
BEGIN
  v_patch := COALESCE(p_patch, '{}'::jsonb) - 'participant_order';      -- seats travel in p_seats
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'config')::text;
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  IF v_pool.kind = 'initial' THEN
    IF v_pool.phase = 'setup' THEN
      v_allowed := ARRAY['mode', 'roster_size', 'budget', 'pick_seconds', 'makeup_seconds', 'slow_ladder_seconds',
                         'extensions_enabled', 'redraft_max_lines', 'redraft_lock_no_redraft_lines', 'token_purchase_closes_at'];
    ELSE
      v_allowed := ARRAY['token_purchase_closes_at'];                  -- editable in every phase
      IF p_seats IS NOT NULL THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
    END IF;
  ELSE
    IF v_pool.phase <> 'submissions' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
    v_allowed := ARRAY['mode', 'pick_seconds', 'makeup_seconds', 'slow_ladder_seconds', 'extensions_enabled',
                       'redraft_max_lines', 'redraft_lock_no_redraft_lines', 'submission_deadline_at'];
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      IF v_pool.kind = 'initial' AND v_pool.phase <> 'setup' THEN
        RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', v_key)::text;
    END IF;
  END LOOP;

  IF v_patch ? 'mode' THEN
    IF jsonb_typeof(v_patch->'mode') <> 'string' OR v_patch->>'mode' NOT IN ('live', 'slow') THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'mode')::text;
    END IF;
    UPDATE public.draft_pools SET mode = v_patch->>'mode' WHERE id = p_pool_id;
  END IF;
  v_int := public.draft__cfg_int(v_patch, 'roster_size', 1, 20);
  IF v_int IS NOT NULL THEN
    UPDATE public.draft_pools SET roster_size = v_int WHERE id = p_pool_id;
    UPDATE public.draft_participants SET slots_total = v_int WHERE draft_pool_id = p_pool_id;
  END IF;
  v_int := public.draft__cfg_int(v_patch, 'budget', 1, 1000);
  IF v_int IS NOT NULL THEN
    UPDATE public.draft_pools SET point_budget = v_int WHERE id = p_pool_id;
    UPDATE public.draft_participants SET budget_start = v_int WHERE draft_pool_id = p_pool_id;
  END IF;
  v_int := public.draft__cfg_int(v_patch, 'pick_seconds', 30, 172800);
  IF v_int IS NOT NULL THEN UPDATE public.draft_pools SET pick_seconds = v_int WHERE id = p_pool_id; END IF;
  v_int := public.draft__cfg_int(v_patch, 'makeup_seconds', 30, 172800);
  IF v_int IS NOT NULL THEN UPDATE public.draft_pools SET makeup_seconds = v_int WHERE id = p_pool_id; END IF;
  v_ladder := public.draft__cfg_ladder(v_patch);
  IF v_ladder IS NOT NULL THEN UPDATE public.draft_pools SET slow_ladder_seconds = v_ladder WHERE id = p_pool_id; END IF;
  IF v_patch ? 'extensions_enabled' THEN
    UPDATE public.draft_pools SET extensions_enabled = public.draft__cfg_bool(v_patch, 'extensions_enabled') WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'redraft_lock_no_redraft_lines' THEN
    UPDATE public.draft_pools SET redraft_lock_no_redraft_lines = public.draft__cfg_bool(v_patch, 'redraft_lock_no_redraft_lines')
     WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'redraft_max_lines' THEN
    v_int := public.draft__cfg_int(v_patch, 'redraft_max_lines', 0, 20, true);
    -- Never below a saved secret drop list (NULL = the default 3): publish would otherwise drop more lines than the
    -- configured maximum. Only the count leaves the function, never whose list it is.
    SELECT COALESCE(max(n), 0) INTO v_subs_max
      FROM (SELECT count(*) AS n FROM public.redraft_submissions WHERE draft_pool_id = p_pool_id GROUP BY player_id) c;
    IF v_subs_max > COALESCE(v_int, 3) THEN
      RAISE EXCEPTION 'REDRAFT_MAX_BELOW_SUBMISSIONS' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('count', v_subs_max)::text;
    END IF;
    UPDATE public.draft_pools SET redraft_max_lines = v_int WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'token_purchase_closes_at' THEN
    UPDATE public.draft_pools SET token_purchase_closes_at = public.draft__cfg_ts(v_patch, 'token_purchase_closes_at')
     WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'submission_deadline_at' THEN
    v_ts := public.draft__cfg_ts(v_patch, 'submission_deadline_at');
    IF v_ts IS NULL OR v_ts <= now() THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('field', 'submission_deadline_at')::text;
    END IF;
    UPDATE public.draft_pools SET submission_deadline_at = v_ts WHERE id = p_pool_id;
  END IF;

  IF p_seats IS NOT NULL THEN
    PERFORM public.draft__validate_seats(p_seats);
    IF v_pool.season_group_id IS NOT NULL
       AND (EXISTS (SELECT m.player_id FROM public.season_group_members m WHERE m.group_id = v_pool.season_group_id
                    EXCEPT SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e)
            OR EXISTS (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e
                       EXCEPT SELECT m.player_id FROM public.season_group_members m WHERE m.group_id = v_pool.season_group_id)) THEN
      RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_pool.season_group_id)::text;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', player_id, 'seat', seat, 'standing_rank', standing_rank)
                              ORDER BY seat), '[]'::jsonb)
      INTO v_before_seats FROM public.draft_participants WHERE draft_pool_id = p_pool_id;
    SET CONSTRAINTS public.draft_participants_seat_unique DEFERRED;
    DELETE FROM public.redraft_submissions s
     WHERE s.draft_pool_id = p_pool_id
       AND s.player_id NOT IN (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e);
    DELETE FROM public.draft_participants dp
     WHERE dp.draft_pool_id = p_pool_id
       AND dp.player_id NOT IN (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e);
    SELECT * INTO v_after FROM public.draft_pools WHERE id = p_pool_id;
    INSERT INTO public.draft_participants (draft_pool_id, player_id, seat, standing_rank, slots_total, budget_start)
    SELECT p_pool_id, (e->>'player_id')::uuid, (e->>'seat')::int, (e->>'standing_rank')::int,
           CASE WHEN v_after.kind = 'initial' THEN COALESCE(v_after.roster_size, 0) ELSE 0 END,
           CASE WHEN v_after.kind = 'initial' THEN COALESCE(v_after.point_budget, 0) ELSE 0 END
      FROM jsonb_array_elements(p_seats) e
    ON CONFLICT (draft_pool_id, player_id) DO UPDATE SET seat = EXCLUDED.seat, standing_rank = EXCLUDED.standing_rank;
    SET CONSTRAINTS public.draft_participants_seat_unique IMMEDIATE;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', player_id, 'seat', seat, 'standing_rank', standing_rank)
                              ORDER BY seat), '[]'::jsonb)
      INTO v_after_seats FROM public.draft_participants WHERE draft_pool_id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'seats_changed',
      p_before => v_before_seats, p_after => v_after_seats);
  END IF;

  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id
  RETURNING * INTO v_after;
  IF v_patch <> '{}'::jsonb THEN
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_configured',
      p_before => jsonb_build_object('mode', v_pool.mode, 'roster_size', v_pool.roster_size, 'budget', v_pool.point_budget,
        'pick_seconds', v_pool.pick_seconds, 'makeup_seconds', v_pool.makeup_seconds,
        'slow_ladder_seconds', v_pool.slow_ladder_seconds, 'extensions_enabled', v_pool.extensions_enabled,
        'redraft_max_lines', v_pool.redraft_max_lines, 'redraft_lock_no_redraft_lines', v_pool.redraft_lock_no_redraft_lines,
        'submission_deadline_at', v_pool.submission_deadline_at, 'token_purchase_closes_at', v_pool.token_purchase_closes_at),
      p_after => v_patch);
  END IF;
  RETURN jsonb_build_object('state_version', v_after.state_version);
END $$;

-- 16. epb__season_remaining_points (base 20261012024916): the base budget is the trainer's group's initial pool ─────
CREATE OR REPLACE FUNCTION public.epb__season_remaining_points(p_season_id uuid, p_player_id uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (COALESCE((SELECT point_budget FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
                       AND season_group_id IS NOT DISTINCT FROM public.draft__player_group(p_season_id, p_player_id)),
                    fr.draft_budget)
    - COALESCE((SELECT sum(dp.points_spent) FROM public.draft_picks dp JOIN public.draft_pools pl ON pl.id = dp.draft_pool_id
                 WHERE pl.season_id = p_season_id AND pl.phase <> 'cancelled' AND dp.player_id = p_player_id AND dp.voided_at IS NULL), 0)
    - COALESCE((SELECT sum(g.token_count) FROM public.epb_token_grants g
                 WHERE g.season_id = p_season_id AND g.player_id = p_player_id AND g.grant_type = 'draft_token'), 0) * fr.draft_token_ratio
    - COALESCE((SELECT sum(x.points_spent) FROM public.epb_draft_token_purchases x
                 WHERE x.season_id = p_season_id AND x.player_id = p_player_id), 0)
    - COALESCE((SELECT sum(rh.points_spent) FROM public.redraft_history rh
                 WHERE rh.season_id = p_season_id AND rh.player_id = p_player_id), 0)
    + COALESCE((SELECT sum(rs.dropped_price) FROM public.redraft_slots rs
                 WHERE rs.season_id = p_season_id AND rs.player_id = p_player_id), 0))::int
  FROM public.format_rules fr WHERE fr.season_id = p_season_id
$$;

-- 17. epb_purchase_draft_token (base 20261012025134): the window and the log use the trainer's group's initial pool
CREATE OR REPLACE FUNCTION public.epb_purchase_draft_token(p_season_id uuid, p_player_id uuid, p_actor_id uuid, p_line_id text,
  p_next_threshold integer, p_client_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_existing public.epb_draft_token_purchases; v_initial public.draft_pools; v_rules public.format_rules;
        v_closed boolean; v_owned integer; v_line_has boolean; v_remaining integer; v_tracker public.evolution_tracker;
        v_after public.evolution_tracker; v_purchase_id uuid;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'client_request_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  -- replay: the same request id returns the first purchase
  SELECT * INTO v_existing FROM public.epb_draft_token_purchases
   WHERE season_id = p_season_id AND player_id = p_player_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('purchase_id', v_existing.id, 'tracker_id', v_existing.tracker_id, 'line_id', v_existing.line_id,
      'points_spent', v_existing.points_spent, 'replay', true);
  END IF;

  SELECT * INTO v_rules FROM public.format_rules WHERE season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'format_rules')::text;
  END IF;

  -- 1. window (critique B10; twin of draftKillTokenWindow): open after the initial draft, until the explicit cutoff or,
  --    without one, until the first completed match of the season (owner ruling).
  SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
     AND season_group_id IS NOT DISTINCT FROM public.draft__player_group(p_season_id, p_player_id);
  IF NOT FOUND OR v_initial.phase <> 'complete' THEN
    RAISE EXCEPTION 'TOKEN_WINDOW_CLOSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('window', 'before')::text;
  END IF;
  IF v_initial.token_purchase_closes_at IS NOT NULL THEN
    v_closed := now() >= v_initial.token_purchase_closes_at;
  ELSE
    v_closed := EXISTS (SELECT 1 FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
                         WHERE t.season_id = p_season_id AND m.status = 'completed');
  END IF;
  IF v_closed THEN
    RAISE EXCEPTION 'TOKEN_WINDOW_CLOSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('window', 'closed')::text;
  END IF;

  -- 2. player limit (purchases + legacy one-shot grant tokens)
  v_owned := (SELECT count(*) FROM public.epb_draft_token_purchases WHERE season_id = p_season_id AND player_id = p_player_id)
           + COALESCE((SELECT sum(token_count) FROM public.epb_token_grants
                        WHERE season_id = p_season_id AND player_id = p_player_id AND grant_type = 'draft_token'), 0);
  IF v_owned >= v_rules.draft_token_max THEN
    RAISE EXCEPTION 'TOKEN_PLAYER_LIMIT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('max', v_rules.draft_token_max)::text;
  END IF;

  -- 3. line limit (a purchase on this line, or legacy draft tokens already on its tracker)
  v_line_has := EXISTS (SELECT 1 FROM public.epb_draft_token_purchases
                         WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id)
             OR EXISTS (SELECT 1 FROM public.evolution_tracker
                         WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id
                           AND draft_tokens >= v_rules.draft_token_max_per_line);
  IF v_line_has THEN RAISE EXCEPTION 'TOKEN_LINE_LIMIT' USING ERRCODE = 'P0001'; END IF;

  -- 4. unspent points
  v_remaining := COALESCE(public.epb__season_remaining_points(p_season_id, p_player_id), 0);
  IF v_remaining < v_rules.draft_token_ratio THEN
    RAISE EXCEPTION 'TOKEN_POINTS_SHORT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('needed', v_rules.draft_token_ratio, 'remaining', v_remaining)::text;
  END IF;

  -- 5. owned line, 6. fully evolved, 7. may never trigger an evolution (progress read under the lock)
  SELECT * INTO v_tracker FROM public.evolution_tracker
   WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', p_line_id)::text;
  END IF;
  IF p_next_threshold IS NULL THEN RAISE EXCEPTION 'LINE_FULLY_EVOLVED' USING ERRCODE = 'P0001'; END IF;
  IF v_tracker.total_kos + 1 >= p_next_threshold THEN
    RAISE EXCEPTION 'TOKEN_WOULD_EVOLVE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('next', p_next_threshold, 'progress', v_tracker.total_kos)::text;
  END IF;

  INSERT INTO public.epb_draft_token_purchases (season_id, player_id, line_id, tracker_id, points_spent, client_request_id, created_by)
  VALUES (p_season_id, p_player_id, p_line_id, v_tracker.id, v_rules.draft_token_ratio, p_client_request_id, p_actor_id)
  RETURNING id INTO v_purchase_id;
  v_after := public.epb_apply_progress(v_tracker.id, 'draft_token', 1, NULL, 'Draft Kill Token', p_actor_id);
  PERFORM public.draft__log(p_season_id, v_initial.id, p_actor_id,
    CASE WHEN p_actor_id IS NOT DISTINCT FROM p_player_id THEN 'player' ELSE 'admin' END, 'token_purchased',
    p_player_id => p_player_id, p_line_id => p_line_id,
    p_after => jsonb_build_object('purchase_id', v_purchase_id, 'points_spent', v_rules.draft_token_ratio,
                                  'progress', v_after.total_kos),
    p_client_request_id => p_client_request_id);
  RETURN jsonb_build_object('purchase_id', v_purchase_id, 'tracker_id', v_tracker.id, 'line_id', p_line_id,
    'points_spent', v_rules.draft_token_ratio, 'progress', v_after.total_kos,
    'remaining_points', v_remaining - v_rules.draft_token_ratio, 'replay', false);
END $$;

-- 18. epb_set_comeback_spend_open (base 20261012025134): no scalar subquery over several initial pools ────────────────
CREATE OR REPLACE FUNCTION public.epb_set_comeback_spend_open(p_season_id uuid, p_actor_id uuid, p_open boolean) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_before boolean; v_pool uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  SELECT comeback_spend_open INTO v_before FROM public.format_rules WHERE season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'format_rules')::text;
  END IF;
  UPDATE public.format_rules SET comeback_spend_open = COALESCE(p_open, false) WHERE season_id = p_season_id;
  -- The switch is league-wide: a league without groups logs it on its initial pool (as before), a league with
  -- groups on no pool (several initial pools; draft_action_log.draft_pool_id is nullable).
  v_pool := (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
              AND season_group_id IS NULL);
  PERFORM public.draft__log(p_season_id, v_pool, p_actor_id, 'admin', 'comeback_spend_opened',
    p_before => jsonb_build_object('open', v_before), p_after => jsonb_build_object('open', COALESCE(p_open, false)));
END $$;

-- 19. epb_spend_comeback_tokens (base 20261018140000): opens with the trainer's group's redraft ─────────────────────
CREATE OR REPLACE FUNCTION public.epb_spend_comeback_tokens(p_season_id uuid, p_player_id uuid, p_actor_id uuid,
  p_earned_total integer, p_allocations jsonb, p_client_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_open boolean; v_requested integer := 0; v_spent integer; v_balance integer; v_alloc jsonb; v_line text;
        v_count integer; v_ratio integer; v_progress integer := 0; v_tracker public.evolution_tracker;
        v_tracker_ids jsonb := '[]'::jsonb; v_pool uuid; v_group uuid;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'client_request_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  -- replay
  IF EXISTS (SELECT 1 FROM public.epb_comeback_token_spends
              WHERE season_id = p_season_id AND player_id = p_player_id AND client_request_id = p_client_request_id) THEN
    SELECT COALESCE(sum(amount) FILTER (WHERE client_request_id = p_client_request_id), 0), COALESCE(sum(amount), 0)
      INTO v_requested, v_spent
      FROM public.epb_comeback_token_spends WHERE season_id = p_season_id AND player_id = p_player_id;
    RETURN jsonb_build_object('spent', v_requested, 'balance_after', GREATEST(0, COALESCE(p_earned_total, 0) - v_spent),
                              'replay', true);
  END IF;

  -- Per group: the player's own group's redraft opens the spend (NULL group = a league without groups, as before).
  v_group := public.draft__player_group(p_season_id, p_player_id);
  v_open := EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase = 'complete'
                     AND season_group_id IS NOT DISTINCT FROM v_group)
         OR COALESCE((SELECT comeback_spend_open FROM public.format_rules WHERE season_id = p_season_id), false);
  IF NOT v_open THEN RAISE EXCEPTION 'COMEBACK_NOT_YET' USING ERRCODE = 'P0001'; END IF;

  -- Shape checks. PostgreSQL does not promise left-to-right OR evaluation, so every cast sits behind its type test:
  -- the array test is its own IF, and each element is checked in a CASE (evaluated in order), so a non-numeric
  -- count or ratio is INVALID_CONFIG, never a cast error.
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'allocations')::text;
  END IF;
  IF jsonb_array_length(p_allocations) < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a
                 WHERE CASE
                         WHEN jsonb_typeof(a) IS DISTINCT FROM 'object' THEN true
                         WHEN jsonb_typeof(a->'line_id') IS DISTINCT FROM 'string' THEN true
                         WHEN jsonb_typeof(a->'count') IS DISTINCT FROM 'number' THEN true
                         WHEN (a->>'count')::numeric <> trunc((a->>'count')::numeric)
                              OR (a->>'count')::numeric NOT BETWEEN 1 AND 20 THEN true
                         WHEN NOT (a ? 'ratio') THEN false
                         WHEN jsonb_typeof(a->'ratio') IS DISTINCT FROM 'number' THEN true
                         ELSE (a->>'ratio')::numeric <> trunc((a->>'ratio')::numeric)
                              OR (a->>'ratio')::numeric NOT BETWEEN 1 AND 10
                       END)
     OR (SELECT count(*) FROM jsonb_array_elements(p_allocations)) <>
        (SELECT count(DISTINCT a->>'line_id') FROM jsonb_array_elements(p_allocations) a) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'allocations')::text;
  END IF;

  -- Per-line comeback rate: whole progress points only (tokens on a line must be a multiple of its rate); checked before any write.
  SELECT COALESCE((a->>'ratio')::numeric::int, 1) INTO v_ratio FROM jsonb_array_elements(p_allocations) a
   WHERE (a->>'count')::numeric::int % COALESCE((a->>'ratio')::numeric::int, 1) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'COMEBACK_TOKENS_NOT_MULTIPLE' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('ratio', v_ratio)::text;
  END IF;

  SELECT sum((a->>'count')::numeric::int) INTO v_requested FROM jsonb_array_elements(p_allocations) a;
  -- spent = Σ spends in tokens; no legacy kill_token grant stock (no carried-over comeback stock; twin of comebackSpentTotal in TS)
  SELECT COALESCE(sum(amount), 0) INTO v_spent FROM public.epb_comeback_token_spends
   WHERE season_id = p_season_id AND player_id = p_player_id;
  v_balance := COALESCE(p_earned_total, 0) - v_spent;
  IF v_balance < v_requested THEN
    RAISE EXCEPTION 'COMEBACK_BALANCE_SHORT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('balance', GREATEST(v_balance, 0))::text;
  END IF;

  FOR v_alloc IN SELECT a FROM jsonb_array_elements(p_allocations) AS a LOOP
    v_line := v_alloc->>'line_id';
    v_count := (v_alloc->>'count')::numeric::int;
    v_ratio := COALESCE((v_alloc->>'ratio')::numeric::int, 1);
    SELECT * INTO v_tracker FROM public.evolution_tracker
     WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = v_line FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
    -- The ledger keeps tokens; the tracker gets progress.
    INSERT INTO public.epb_comeback_token_spends (season_id, player_id, line_id, tracker_id, amount, client_request_id, created_by)
    VALUES (p_season_id, p_player_id, v_line, v_tracker.id, v_count, p_client_request_id, p_actor_id);
    PERFORM public.epb_apply_progress(v_tracker.id, 'kill_token', v_count / v_ratio, NULL, 'Comeback Token', p_actor_id);
    v_progress := v_progress + v_count / v_ratio;
    v_tracker_ids := v_tracker_ids || to_jsonb(v_tracker.id);
  END LOOP;

  v_pool := COALESCE(
    (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase <> 'cancelled'
        AND season_group_id IS NOT DISTINCT FROM v_group),
    (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
        AND season_group_id IS NOT DISTINCT FROM v_group));
  PERFORM public.draft__log(p_season_id, v_pool, p_actor_id,
    CASE WHEN p_actor_id IS NOT DISTINCT FROM p_player_id THEN 'player' ELSE 'admin' END, 'comeback_spent',
    p_player_id => p_player_id,
    p_after => jsonb_build_object('allocations', p_allocations, 'balance_after', v_balance - v_requested,
                                  'progress', v_progress),
    p_client_request_id => p_client_request_id);
  -- Stage changes are applied by TS right after (recheckEpbStages), as for every other progress write.
  RETURN jsonb_build_object('spent', v_requested, 'balance_after', v_balance - v_requested, 'progress', v_progress,
                            'tracker_ids', v_tracker_ids, 'replay', false);
END $$;

-- Privileges ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.draft__player_group(uuid, uuid),
  public.season_group__has_live_pool(uuid),
  public.season_groups__guard(),
  public.season_group_members__guard(),
  public.draft_pools__guard_group(),
  public.evolution_tracker__group(),
  public.tournament_groups__guard_season_group(),
  public.season_groups_replace(uuid, jsonb),
  public.draft__legal_lines(uuid, uuid),
  public.draft__pool_completable(uuid),
  public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, text, text),
  public.draft_end(uuid, uuid, text),
  public.draft_admin_void_pick(uuid, uuid, uuid, text, boolean, text, jsonb, uuid),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text),
  public.redraft_set_submission(uuid, uuid, uuid, text, text[]),
  public.draft__build_snapshot(public.draft_pools),
  public.draft_create_pool(uuid, text, uuid, jsonb, jsonb, uuid),
  public.draft_configure(uuid, uuid, jsonb, jsonb),
  public.epb__season_remaining_points(uuid, uuid),
  public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid),
  public.epb_set_comeback_spend_open(uuid, uuid, boolean),
  public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft__player_group(uuid, uuid),
  public.season_group__has_live_pool(uuid),
  public.season_groups__guard(),
  public.season_group_members__guard(),
  public.draft_pools__guard_group(),
  public.evolution_tracker__group(),
  public.tournament_groups__guard_season_group(),
  public.season_groups_replace(uuid, jsonb),
  public.draft__legal_lines(uuid, uuid),
  public.draft__pool_completable(uuid),
  public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, text, text),
  public.draft_end(uuid, uuid, text),
  public.draft_admin_void_pick(uuid, uuid, uuid, text, boolean, text, jsonb, uuid),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text),
  public.redraft_set_submission(uuid, uuid, uuid, text, text[]),
  public.draft__build_snapshot(public.draft_pools),
  public.draft_create_pool(uuid, text, uuid, jsonb, jsonb, uuid),
  public.draft_configure(uuid, uuid, jsonb, jsonb),
  public.epb__season_remaining_points(uuid, uuid),
  public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid),
  public.epb_set_comeback_spend_open(uuid, uuid, boolean),
  public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid)
TO service_role;

COMMIT;
