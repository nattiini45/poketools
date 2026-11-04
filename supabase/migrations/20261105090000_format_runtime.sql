-- Format runtime (Format Studio engine, M3b): the state a custom format changes while a league runs.
--
--   format_relation_links      A relation's links, from -> to (secret santa: giver -> recipient). One link per from player
--                              and one per to player in a relation. revealed_at is set when the relation is revealed.
--   format_resource_items      What a player holds of a resource (a domain entry, or an amount of a counter). `exclusive`
--                              rows are unique per (season, resource, item): the partial index is the exclusivity rule.
--   format_action_submissions  A player action's pick (draft -> submitted -> locked), one per (season, action, actor).
--   format_event_log           Every fired event once (event_key is the idempotency key) with the ops it applied.
--   format_flags               Switches: `domain:<key>` = "locked" | "unlocked", `action:<key>` = "open" | "locked".
--   format_player_attrs        Player attribute values (manual, random_seeded, expr results, set_attr effects).
--   format_track_progress      The step a player reached on a progression track (only ever raised).
--   format_checks              Assisted checks an admin confirms or rejects, deduplicated by dedupe_key.
--   format_adjustments         The admin audit of manual adjustments (points, resource, relation, ...), reason required.
--
-- Writers: the TS planner turns an event or an adjustment into an array of ops (the vocabulary below); these functions
-- apply it in ONE transaction, so a failing op rolls the whole call back.
--
--   format__apply_ops(season, ops)           The single op applier (internal): set_flag, set_relation, reveal_relation,
--                                            grant_item, revoke_item, set_attr, adjust_points, open_action, lock_action,
--                                            set_track. An unknown op or a missing member raises invalid_op.
--   format__insert_item(...)                 Internal: one resource_items row; an exclusive clash raises resource_item_taken.
--   format_fire_event(...)                   Logs the event once and applies its ops; false when it already fired.
--   format_action_save / _submit(...)        Save a draft pick / submit it (replacing the items the earlier submission
--                                            granted) and optionally lock it. Raises action_locked.
--   format_apply_adjustment(...)             Records an admin adjustment, applies its ops, appends a domain amendment to
--                                            season_formats.amendments. Raises reason_required, domain_amendment_locked.
--   format_check_open / format_check_resolve Open a deduplicated check; resolve it only from open.
--
-- Domain errors are `RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001', DETAIL = <json text>`: action_locked,
-- resource_item_taken (DETAIL {"resource", "item_id"}), domain_amendment_locked (DETAIL {"actions"}), reason_required,
-- invalid_op (DETAIL {"op"}). A league without an attached format raises FORMAT_NOT_ATTACHED on a domain adjustment.
--
-- League recycle bin: all nine tables are owned (season_id = $1) and cascade with the league. They reference only
-- seasons and players, so the restore order among them is free (steps 100-108). Their player columns are found by the
-- 'players' junction through the catalog (league_trash__protect), so a trashed league keeps its players.
--
-- Player delete: a player's own rows (player_id, from/to, actor, target) go with the player (ON DELETE CASCADE, like the
-- draft tables), actor columns (fired_by, resolved_by, admin_id) become NULL. claim_guest_player reads these keys from
-- pg_constraint and refuses to delete a source account that still owns such rows, so no list needs the new columns.
--
-- Grants: service_role only. No RLS policies by design.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.format_relation_links (
  season_id      uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  relation_key   text NOT NULL,
  from_player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  to_player_id   uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  revealed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, relation_key, from_player_id),
  CONSTRAINT format_relation_links_to_key UNIQUE (season_id, relation_key, to_player_id),
  CONSTRAINT format_relation_links_distinct CHECK (from_player_id <> to_player_id)
);
CREATE INDEX idx_format_relation_links_from ON public.format_relation_links (from_player_id);
CREATE INDEX idx_format_relation_links_to ON public.format_relation_links (to_player_id);

CREATE TABLE public.format_resource_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id    uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  resource_key text NOT NULL,
  player_id    uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  item_id      text,
  amount       integer NOT NULL DEFAULT 1,
  exclusive    boolean NOT NULL DEFAULT false,
  source       text NOT NULL,
  source_ref   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT format_resource_items_amount_check CHECK (amount > 0),
  CONSTRAINT format_resource_items_source_check CHECK (source IN ('event', 'action', 'adjustment'))
);
CREATE INDEX idx_format_resource_items_player ON public.format_resource_items (season_id, player_id);
CREATE INDEX idx_format_resource_items_player_fk ON public.format_resource_items (player_id);
CREATE UNIQUE INDEX format_resource_items_exclusive_key
  ON public.format_resource_items (season_id, resource_key, item_id) WHERE exclusive AND item_id IS NOT NULL;
CREATE INDEX idx_format_resource_items_source ON public.format_resource_items (season_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE public.format_action_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id        uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  action_key       text NOT NULL,
  actor_player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  target_player_id uuid REFERENCES public.players(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'draft',
  picks            jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at     timestamptz,
  locked_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT format_action_submissions_key UNIQUE (season_id, action_key, actor_player_id),
  CONSTRAINT format_action_submissions_status_check CHECK (status IN ('draft', 'submitted', 'locked'))
);
CREATE INDEX idx_format_action_submissions_actor ON public.format_action_submissions (actor_player_id);
CREATE INDEX idx_format_action_submissions_target ON public.format_action_submissions (target_player_id) WHERE target_player_id IS NOT NULL;

CREATE TABLE public.format_event_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  event_key  text NOT NULL,
  event      text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ops        jsonb NOT NULL DEFAULT '[]'::jsonb,
  fired_by   uuid REFERENCES public.players(id) ON DELETE SET NULL,
  fired_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT format_event_log_key UNIQUE (season_id, event_key)
);
CREATE INDEX idx_format_event_log_fired_by ON public.format_event_log (fired_by) WHERE fired_by IS NOT NULL;

CREATE TABLE public.format_flags (
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, key)
);

CREATE TABLE public.format_player_attrs (
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  attr_key   text NOT NULL,
  value      jsonb NOT NULL,
  source     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, player_id, attr_key)
);
CREATE INDEX idx_format_player_attrs_player ON public.format_player_attrs (player_id);

CREATE TABLE public.format_track_progress (
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  track_key  text NOT NULL,
  step       integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, player_id, track_key),
  CONSTRAINT format_track_progress_step_check CHECK (step >= 0)
);
CREATE INDEX idx_format_track_progress_player ON public.format_track_progress (player_id);

CREATE TABLE public.format_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  source      text NOT NULL,
  rule_id     text NOT NULL,
  dedupe_key  text NOT NULL,
  subject     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'open',
  note        text,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  CONSTRAINT format_checks_key UNIQUE (season_id, dedupe_key),
  CONSTRAINT format_checks_source_check CHECK (source IN ('unresolved_outcome', 'standings_tie', 'pairing_rematch', 'expr')),
  CONSTRAINT format_checks_status_check CHECK (status IN ('open', 'confirmed', 'rejected'))
);
CREATE INDEX idx_format_checks_resolved_by ON public.format_checks (resolved_by) WHERE resolved_by IS NOT NULL;

CREATE TABLE public.format_adjustments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  target     jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta      jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason     text NOT NULL,
  admin_id   uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT format_adjustments_kind_check CHECK (kind IN ('points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank')),
  CONSTRAINT format_adjustments_reason_length CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500)
);
CREATE INDEX idx_format_adjustments_season ON public.format_adjustments (season_id, created_at, id);
CREATE INDEX idx_format_adjustments_admin ON public.format_adjustments (admin_id) WHERE admin_id IS NOT NULL;

ALTER TABLE public.format_relation_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_resource_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_action_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_event_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_flags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_player_attrs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_track_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_checks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_adjustments        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.format_relation_links, public.format_resource_items, public.format_action_submissions,
  public.format_event_log, public.format_flags, public.format_player_attrs, public.format_track_progress,
  public.format_checks, public.format_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.format_relation_links, public.format_resource_items,
  public.format_action_submissions, public.format_event_log, public.format_flags, public.format_player_attrs,
  public.format_track_progress, public.format_checks, public.format_adjustments TO service_role;

COMMENT ON TABLE public.format_relation_links IS
  'Links of a format relation (from -> to), revealed_at set on reveal. Written by format__apply_ops. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_resource_items IS
  'What a player holds of a format resource (a domain entry or a counter amount). Exclusive items are unique per season and resource. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_action_submissions IS
  'A player action pick of a format (draft, submitted, locked), one per season, action and actor. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_event_log IS
  'Every fired format event once (event_key is the idempotency key) with the ops it applied. Written by format_fire_event(). Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_flags IS
  'Format switches: domain:<key> = locked|unlocked, action:<key> = open|locked. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_player_attrs IS
  'Player attribute values of a format with their source. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_track_progress IS
  'The step a player reached on a progression track; it only ever rises. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_checks IS
  'Assisted checks (open, confirmed, rejected), deduplicated by dedupe_key per season. Service-role only. No RLS policies by design.';
COMMENT ON TABLE public.format_adjustments IS
  'Audit of manual format adjustments by an admin or an adjust_points op; a reason is required. Service-role only. No RLS policies by design.';

-- ---------------------------------------------------------------------------------------------------------------
-- Ops. The required members per op are listed in format__apply_ops; the TS FormatOp type (queries/format-runtime.ts) is its twin.
CREATE OR REPLACE FUNCTION public.format__insert_item(
  p_season_id uuid, p_resource text, p_player uuid, p_item text, p_amount integer,
  p_exclusive boolean, p_source text, p_source_ref text
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.format_resource_items (season_id, resource_key, player_id, item_id, amount, exclusive, source, source_ref)
  VALUES (p_season_id, p_resource, p_player, p_item, p_amount, p_exclusive, p_source, p_source_ref);
EXCEPTION WHEN unique_violation THEN
  -- Only format_resource_items_exclusive_key can fire: the id is random.
  RAISE EXCEPTION 'resource_item_taken' USING ERRCODE = 'P0001',
    DETAIL = jsonb_build_object('resource', p_resource, 'item_id', p_item)::text;
END $$;

CREATE OR REPLACE FUNCTION public.format__apply_ops(p_season_id uuid, p_ops jsonb)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_op   jsonb;
  v_kind text;
  v_need text[];
  v_left integer;
  v_row  record;
  v_take integer;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', NULL::text)::text;
  END IF;

  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_kind := CASE WHEN jsonb_typeof(v_op) = 'object' THEN v_op ->> 'op' END;
    v_need := CASE v_kind
      WHEN 'set_flag'        THEN ARRAY['key', 'value']
      WHEN 'set_relation'    THEN ARRAY['relation', 'links']
      WHEN 'reveal_relation' THEN ARRAY['relation']
      WHEN 'grant_item'      THEN ARRAY['resource', 'player_id', 'item_id', 'amount', 'exclusive', 'source', 'source_ref']
      WHEN 'revoke_item'     THEN ARRAY['resource', 'player_id', 'item_id', 'amount']
      WHEN 'set_attr'        THEN ARRAY['player_id', 'attr', 'value', 'source']
      WHEN 'adjust_points'   THEN ARRAY['stage', 'player_id', 'points', 'reason']
      WHEN 'open_action'     THEN ARRAY['action']
      WHEN 'lock_action'     THEN ARRAY['action']
      WHEN 'set_track'       THEN ARRAY['track', 'player_id', 'step']
    END;
    IF v_need IS NULL OR NOT (v_op ?& v_need) THEN
      RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', v_kind)::text;
    END IF;

    IF v_kind = 'set_flag' THEN
      INSERT INTO public.format_flags (season_id, key, value) VALUES (p_season_id, v_op ->> 'key', v_op -> 'value')
      ON CONFLICT (season_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    ELSIF v_kind = 'set_relation' THEN
      IF NOT EXISTS (SELECT 1 FROM public.format_relation_links WHERE season_id = p_season_id AND relation_key = v_op ->> 'relation') THEN
        INSERT INTO public.format_relation_links (season_id, relation_key, from_player_id, to_player_id)
        SELECT p_season_id, v_op ->> 'relation', (l ->> 'from')::uuid, (l ->> 'to')::uuid
          FROM jsonb_array_elements(v_op -> 'links') l;
      END IF;

    ELSIF v_kind = 'reveal_relation' THEN
      UPDATE public.format_relation_links SET revealed_at = now()
       WHERE season_id = p_season_id AND relation_key = v_op ->> 'relation' AND revealed_at IS NULL;

    ELSIF v_kind = 'grant_item' THEN
      PERFORM public.format__insert_item(
        p_season_id, v_op ->> 'resource', (v_op ->> 'player_id')::uuid, v_op ->> 'item_id', (v_op ->> 'amount')::integer,
        (v_op ->> 'exclusive')::boolean, v_op ->> 'source', v_op ->> 'source_ref');

    ELSIF v_kind = 'revoke_item' THEN
      -- Removes `amount` units, oldest rows first; a row holding more than is left to take keeps the rest.
      v_left := (v_op ->> 'amount')::integer;
      FOR v_row IN
        SELECT id, amount FROM public.format_resource_items
         WHERE season_id = p_season_id AND resource_key = v_op ->> 'resource' AND player_id = (v_op ->> 'player_id')::uuid
           AND item_id IS NOT DISTINCT FROM (v_op ->> 'item_id')
         ORDER BY created_at, id
           FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(v_left, v_row.amount);
        IF v_take = v_row.amount THEN
          DELETE FROM public.format_resource_items WHERE id = v_row.id;
        ELSE
          UPDATE public.format_resource_items SET amount = amount - v_take WHERE id = v_row.id;
        END IF;
        v_left := v_left - v_take;
      END LOOP;

    ELSIF v_kind = 'set_attr' THEN
      INSERT INTO public.format_player_attrs (season_id, player_id, attr_key, value, source)
      VALUES (p_season_id, (v_op ->> 'player_id')::uuid, v_op ->> 'attr', v_op -> 'value', v_op ->> 'source')
      ON CONFLICT (season_id, player_id, attr_key)
        DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now();

    ELSIF v_kind = 'adjust_points' THEN
      INSERT INTO public.format_adjustments (season_id, kind, target, delta, reason, admin_id)
      VALUES (p_season_id, 'points', jsonb_build_object('stage', v_op ->> 'stage', 'player_id', v_op ->> 'player_id'),
              jsonb_build_object('points', (v_op ->> 'points')::numeric), v_op ->> 'reason', NULL);

    ELSIF v_kind = 'open_action' THEN
      INSERT INTO public.format_flags (season_id, key, value) VALUES (p_season_id, 'action:' || (v_op ->> 'action'), '"open"')
      ON CONFLICT (season_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    ELSIF v_kind = 'lock_action' THEN
      INSERT INTO public.format_flags (season_id, key, value) VALUES (p_season_id, 'action:' || (v_op ->> 'action'), '"locked"')
      ON CONFLICT (season_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      UPDATE public.format_action_submissions SET status = 'locked', locked_at = now(), updated_at = now()
       WHERE season_id = p_season_id AND action_key = v_op ->> 'action' AND status = 'submitted';

    ELSE -- set_track
      INSERT INTO public.format_track_progress (season_id, player_id, track_key, step)
      VALUES (p_season_id, (v_op ->> 'player_id')::uuid, v_op ->> 'track', (v_op ->> 'step')::integer)
      ON CONFLICT (season_id, player_id, track_key)
        DO UPDATE SET step = EXCLUDED.step, updated_at = now() WHERE public.format_track_progress.step < EXCLUDED.step;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Events
CREATE OR REPLACE FUNCTION public.format_fire_event(
  p_season_id uuid, p_event_key text, p_event text, p_payload jsonb, p_ops jsonb, p_fired_by uuid
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_rows integer;
BEGIN
  INSERT INTO public.format_event_log (season_id, event_key, event, payload, ops, fired_by)
  VALUES (p_season_id, p_event_key, p_event, coalesce(p_payload, '{}'::jsonb), coalesce(p_ops, '[]'::jsonb), p_fired_by)
  ON CONFLICT (season_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;
  PERFORM public.format__apply_ops(p_season_id, coalesce(p_ops, '[]'::jsonb));
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Player actions
CREATE OR REPLACE FUNCTION public.format__action_flag_locked(p_season_id uuid, p_action_key text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.format_flags WHERE season_id = p_season_id AND key = 'action:' || p_action_key AND value = '"locked"'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.format_action_save(
  p_season_id uuid, p_action_key text, p_actor uuid, p_target uuid, p_picks jsonb
) RETURNS public.format_action_submissions
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_row public.format_action_submissions;
BEGIN
  IF public.format__action_flag_locked(p_season_id, p_action_key) THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  INSERT INTO public.format_action_submissions AS s (season_id, action_key, actor_player_id, target_player_id, status, picks)
  VALUES (p_season_id, p_action_key, p_actor, p_target, 'draft', coalesce(p_picks, '[]'::jsonb))
  ON CONFLICT (season_id, action_key, actor_player_id) DO UPDATE
    SET target_player_id = EXCLUDED.target_player_id, picks = EXCLUDED.picks, status = 'draft', updated_at = now()
    WHERE s.status <> 'locked'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.format_action_submit(
  p_season_id uuid, p_action_key text, p_actor uuid, p_target uuid, p_picks jsonb, p_items jsonb, p_lock boolean
) RETURNS public.format_action_submissions
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row  public.format_action_submissions;
  v_item jsonb;
BEGIN
  IF public.format__action_flag_locked(p_season_id, p_action_key) THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'items')::text;
  END IF;

  INSERT INTO public.format_action_submissions (season_id, action_key, actor_player_id, target_player_id, picks)
  VALUES (p_season_id, p_action_key, p_actor, p_target, coalesce(p_picks, '[]'::jsonb))
  ON CONFLICT (season_id, action_key, actor_player_id) DO NOTHING;
  SELECT * INTO v_row FROM public.format_action_submissions
   WHERE season_id = p_season_id AND action_key = p_action_key AND actor_player_id = p_actor
     FOR UPDATE;
  IF v_row.status = 'locked' THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;

  DELETE FROM public.format_resource_items
   WHERE season_id = p_season_id AND source = 'action' AND source_ref = v_row.id::text;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR NOT (v_item ?& ARRAY['resource', 'item_id']) THEN
      RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'items')::text;
    END IF;
    PERFORM public.format__insert_item(
      p_season_id, v_item ->> 'resource', coalesce(p_target, p_actor), v_item ->> 'item_id', 1,
      coalesce((v_item ->> 'exclusive')::boolean, false), 'action', v_row.id::text);
  END LOOP;

  UPDATE public.format_action_submissions
     SET target_player_id = p_target, picks = coalesce(p_picks, '[]'::jsonb),
         status = CASE WHEN p_lock THEN 'locked' ELSE 'submitted' END,
         submitted_at = now(), locked_at = CASE WHEN p_lock THEN now() END, updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin adjustments
CREATE OR REPLACE FUNCTION public.format_apply_adjustment(
  p_season_id uuid, p_kind text, p_target jsonb, p_delta jsonb, p_reason text, p_admin uuid, p_ops jsonb, p_guard_actions text[]
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_locked text[];
  v_id     uuid;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind = 'domain' THEN
    SELECT array_agg(g.k ORDER BY g.k) INTO v_locked
      FROM unnest(coalesce(p_guard_actions, '{}'::text[])) AS g(k)
     WHERE public.format__action_flag_locked(p_season_id, g.k)
        OR EXISTS (SELECT 1 FROM public.format_action_submissions s
                    WHERE s.season_id = p_season_id AND s.action_key = g.k AND s.status = 'locked');
    IF v_locked IS NOT NULL THEN
      RAISE EXCEPTION 'domain_amendment_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('actions', to_jsonb(v_locked))::text;
    END IF;
  END IF;

  INSERT INTO public.format_adjustments (season_id, kind, target, delta, reason, admin_id)
  VALUES (p_season_id, p_kind, coalesce(p_target, '{}'::jsonb), coalesce(p_delta, '{}'::jsonb), p_reason, p_admin)
  RETURNING id INTO v_id;

  PERFORM public.format__apply_ops(p_season_id, coalesce(p_ops, '[]'::jsonb));

  IF p_kind = 'domain' THEN
    UPDATE public.season_formats SET amendments = amendments || jsonb_build_array(coalesce(p_delta, '{}'::jsonb))
     WHERE season_id = p_season_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FORMAT_NOT_ATTACHED' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Checks
CREATE OR REPLACE FUNCTION public.format_check_open(
  p_season_id uuid, p_source text, p_rule_id text, p_dedupe_key text, p_subject jsonb
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.format_checks (season_id, source, rule_id, dedupe_key, subject)
  VALUES (p_season_id, p_source, p_rule_id, p_dedupe_key, coalesce(p_subject, '{}'::jsonb))
  ON CONFLICT (season_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.format_check_resolve(p_check_id uuid, p_status text, p_admin uuid, p_note text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_rows integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'status')::text;
  END IF;
  UPDATE public.format_checks SET status = p_status, resolved_by = p_admin, resolved_at = now(), note = p_note
   WHERE id = p_check_id AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants and comments
REVOKE ALL ON FUNCTION
  public.format__insert_item(uuid, text, uuid, text, integer, boolean, text, text),
  public.format__apply_ops(uuid, jsonb),
  public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid),
  public.format__action_flag_locked(uuid, text),
  public.format_action_save(uuid, text, uuid, uuid, jsonb),
  public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean),
  public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[]),
  public.format_check_open(uuid, text, text, text, jsonb),
  public.format_check_resolve(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.format__insert_item(uuid, text, uuid, text, integer, boolean, text, text),
  public.format__apply_ops(uuid, jsonb),
  public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid),
  public.format__action_flag_locked(uuid, text),
  public.format_action_save(uuid, text, uuid, uuid, jsonb),
  public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean),
  public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[]),
  public.format_check_open(uuid, text, text, text, jsonb),
  public.format_check_resolve(uuid, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.format__insert_item(uuid, text, uuid, text, integer, boolean, text, text) IS
  'Internal: inserts one format_resource_items row; an exclusive clash raises resource_item_taken (P0001).';
COMMENT ON FUNCTION public.format__apply_ops(uuid, jsonb) IS
  'Internal: applies a jsonb array of format ops in order (set_flag, set_relation, reveal_relation, grant_item, revoke_item, set_attr, adjust_points, open_action, lock_action, set_track). Unknown op or missing member raises invalid_op.';
COMMENT ON FUNCTION public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid) IS
  'Logs a format event once (event_key) and applies its ops. Returns true when it fired now, false when it had fired before.';
COMMENT ON FUNCTION public.format__action_flag_locked(uuid, text) IS
  'Internal: true when the flag action:<key> is "locked".';
COMMENT ON FUNCTION public.format_action_save(uuid, text, uuid, uuid, jsonb) IS
  'Saves a player action pick as a draft. Raises action_locked when the action flag or the actor''s submission is locked.';
COMMENT ON FUNCTION public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean) IS
  'Submits (and with p_lock locks) a player action pick, replacing the resource items the earlier submission granted. Raises action_locked, resource_item_taken (the whole call rolls back).';
COMMENT ON FUNCTION public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[]) IS
  'Records an admin adjustment, applies its ops and, for kind domain, appends the delta to season_formats.amendments. Raises reason_required, domain_amendment_locked. Returns the adjustment id.';
COMMENT ON FUNCTION public.format_check_open(uuid, text, text, text, jsonb) IS
  'Opens an assisted check; returns its id, or NULL when a check with that dedupe_key already exists.';
COMMENT ON FUNCTION public.format_check_resolve(uuid, text, uuid, text) IS
  'Resolves an open check to confirmed or rejected. Returns false when it was not open.';

-- ---------------------------------------------------------------------------------------------------------------
-- The recycle bin classifies the nine tables. These definitions replace 20261104090000's; the inventory test reads the
-- last definition of each function.
CREATE OR REPLACE FUNCTION public.league_trash__inventory()
RETURNS TABLE (rel text, cls text, pred text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('seasons',                   'owned',   'id = $1'),
    ('season_participants',       'owned',   'season_id = $1'),
    ('season_groups',             'owned',   'season_id = $1'),
    ('season_group_members',      'owned',   'season_id = $1'),
    ('season_formats',            'owned',   'season_id = $1'),
    ('format_relation_links',     'owned',   'season_id = $1'),
    ('format_resource_items',     'owned',   'season_id = $1'),
    ('format_action_submissions', 'owned',   'season_id = $1'),
    ('format_event_log',          'owned',   'season_id = $1'),
    ('format_flags',              'owned',   'season_id = $1'),
    ('format_player_attrs',       'owned',   'season_id = $1'),
    ('format_track_progress',     'owned',   'season_id = $1'),
    ('format_checks',             'owned',   'season_id = $1'),
    ('format_adjustments',        'owned',   'season_id = $1'),
    ('format_rules',              'owned',   'season_id = $1'),
    ('evolution_tiers',           'owned',   'season_id = $1'),
    ('draft_tier_limits',         'owned',   'season_id = $1'),
    ('draft_pool_entries',        'owned',   'season_id = $1'),
    ('legacy_standings',          'owned',   'season_id = $1'),
    ('epb_kill_credit_epochs',    'owned',   'season_id = $1'),
    ('epb_token_grants',          'owned',   'season_id = $1'),
    ('season_storylines',         'owned',   'season_id = $1'),
    ('tournaments',               'owned',   'season_id = $1'),
    ('tournament_participants',   'owned',   'tournament_id IN {phases}'),
    ('tournament_groups',         'owned',   'tournament_id IN {phases}'),
    ('tournament_group_members',  'owned',   'group_id IN {tgroups}'),
    ('rounds',                    'owned',   'tournament_id IN {phases}'),
    ('tournament_reports',        'owned',   'tournament_id IN {phases}'),
    ('matches',                   'owned',   'tournament_id IN {phases}'),
    ('match_outcomes',            'owned',   'match_id IN {matches}'),
    ('games',                     'owned',   'match_id IN {matches}'),
    ('battle_stats',              'owned',   'game_id IN {games}'),
    ('match_analyses',            'owned',   'match_id IN {matches}'),
    ('match_prep_analyses',       'owned',   'match_id IN {matches}'),
    ('match_prep_teams',          'owned',   'match_id IN {matches}'),
    ('match_proposals',           'owned',   'match_id IN {matches}'),
    ('match_evolution_snapshots', 'owned',   'match_id IN {matches}'),
    ('epb_animation_views',       'owned',   'match_id IN {matches}'),
    ('broadcast_moments',         'owned',   'match_id IN {matches} OR game_id IN {games}'),
    ('draft_pools',               'owned',   'season_id = $1'),
    ('draft_participants',        'owned',   'draft_pool_id IN {pools}'),
    ('draft_slots',               'owned',   'draft_pool_id IN {pools}'),
    ('draft_picks',               'owned',   'draft_pool_id IN {pools}'),
    ('draft_replay_events',       'owned',   'draft_pool_id IN {pools}'),
    ('draft_line_restrictions',   'owned',   'draft_pool_id IN {pools}'),
    ('redraft_slots',             'owned',   'season_id = $1 OR draft_pool_id IN {pools}'),
    ('redraft_submissions',       'owned',   'draft_pool_id IN {pools}'),
    ('evolution_tracker',         'owned',   'season_id = $1'),
    ('evolution_events',          'owned',   'season_id = $1'),
    ('evo_progress_log',          'owned',   'season_id = $1'),
    ('epb_draft_token_purchases', 'owned',   'season_id = $1'),
    ('epb_comeback_token_spends', 'owned',   'season_id = $1'),
    ('redraft_history',           'owned',   'season_id = $1'),
    ('redraft_trade_requests',    'owned',   'season_id = $1'),
    ('teams',                     'owned',   'season_id = $1 OR tournament_id IN {phases} OR draft_pool_id IN {pools}'),
    ('resource_admins',           'owned',   '(resource_type = ''season'' AND resource_id = $1) OR (resource_type = ''tournament'' AND resource_id IN {phases})'),
    ('discord_webhooks',          'owned',   '(scope_type = ''season'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('social_integrations',       'owned',   '(scope_type = ''season'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('wiki_notes',                'owned',   '(scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('wiki_note_reports',         'owned',   'note_id IN {notes}'),
    ('aggregates',                'derived', '(scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('player_aggregates',         'derived', '(scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('aggregate_jobs',            'derived', 'game_id IN {games}'),
    ('rating_history',            'derived', 'match_id IN {matches}'),
    ('audit_log',                 'kept',    'false'),
    ('draft_action_log',          'kept',    'false')
  ) AS v(rel, cls, pred)
$$;

CREATE OR REPLACE FUNCTION public.league_trash__restore_plan()
RETURNS TABLE (step int, rel text, filter text, defer text[])
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    (10, 'seasons',                   NULL,                            NULL::text[]),
    (20, 'season_participants',       NULL,                            NULL),
    (25, 'season_formats',            NULL,                            NULL),
    (26, 'format_rules',              NULL,                            NULL),
    (27, 'evolution_tiers',           NULL,                            NULL),
    (28, 'draft_tier_limits',         NULL,                            NULL),
    (29, 'draft_pool_entries',        NULL,                            NULL),
    (30, 'legacy_standings',          NULL,                            NULL),
    (31, 'epb_kill_credit_epochs',    NULL,                            NULL),
    (32, 'epb_token_grants',          NULL,                            NULL),
    (33, 'season_storylines',         NULL,                            NULL),
    (40, 'draft_pools',               'r.season_group_id IS NULL',     NULL),
    (45, 'season_groups',             NULL,                            NULL),
    (46, 'season_group_members',      NULL,                            NULL),
    (50, 'draft_pools',               'r.season_group_id IS NOT NULL', NULL),
    (51, 'draft_participants',        NULL,                            NULL),
    (52, 'draft_slots',               NULL,                            NULL),
    (53, 'redraft_slots',             NULL,                            ARRAY['filled_by_pick_id']),
    (54, 'draft_picks',               NULL,                            NULL),
    (55, 'draft_replay_events',       NULL,                            NULL),
    (56, 'draft_line_restrictions',   NULL,                            NULL),
    (60, 'evolution_tracker',         NULL,                            NULL),
    (61, 'redraft_submissions',       NULL,                            NULL),
    (62, 'evolution_events',          NULL,                            NULL),
    (63, 'evo_progress_log',          NULL,                            NULL),
    (64, 'epb_draft_token_purchases', NULL,                            NULL),
    (65, 'epb_comeback_token_spends', NULL,                            NULL),
    (66, 'redraft_history',           NULL,                            NULL),
    (67, 'redraft_trade_requests',    NULL,                            NULL),
    (70, 'tournaments',               NULL,                            NULL),
    (71, 'tournament_participants',   NULL,                            NULL),
    (72, 'rounds',                    NULL,                            NULL),
    (73, 'tournament_reports',        NULL,                            NULL),
    (74, 'matches',                   NULL,                            NULL),
    (75, 'tournament_groups',         NULL,                            NULL),
    (76, 'tournament_group_members',  NULL,                            NULL),
    (77, 'match_outcomes',            NULL,                            NULL),
    (80, 'games',                     NULL,                            NULL),
    (81, 'battle_stats',              NULL,                            NULL),
    (82, 'match_analyses',            NULL,                            NULL),
    (83, 'match_prep_analyses',       NULL,                            NULL),
    (84, 'match_prep_teams',          NULL,                            NULL),
    (85, 'match_proposals',           NULL,                            NULL),
    (86, 'match_evolution_snapshots', NULL,                            NULL),
    (87, 'epb_animation_views',       NULL,                            NULL),
    (88, 'broadcast_moments',         NULL,                            NULL),
    (90, 'teams',                     NULL,                            NULL),
    (95, 'resource_admins',           NULL,                            NULL),
    (96, 'discord_webhooks',          NULL,                            NULL),
    (97, 'social_integrations',       NULL,                            NULL),
    (98, 'wiki_notes',                NULL,                            NULL),
    (99, 'wiki_note_reports',         NULL,                            NULL),
    (100, 'format_relation_links',     NULL,                            NULL),
    (101, 'format_resource_items',     NULL,                            NULL),
    (102, 'format_action_submissions', NULL,                            NULL),
    (103, 'format_event_log',          NULL,                            NULL),
    (104, 'format_flags',              NULL,                            NULL),
    (105, 'format_player_attrs',       NULL,                            NULL),
    (106, 'format_track_progress',     NULL,                            NULL),
    (107, 'format_checks',             NULL,                            NULL),
    (108, 'format_adjustments',        NULL,                            NULL)
  ) AS v(step, rel, filter, defer)
$$;

REVOKE ALL ON FUNCTION public.league_trash__inventory(), public.league_trash__restore_plan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__inventory(), public.league_trash__restore_plan() TO service_role;

COMMIT;
