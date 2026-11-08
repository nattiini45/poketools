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
--   format__apply_ops(season, ops, strict, tolerant)
--                                            The single op applier (internal): set_flag, set_relation, reveal_relation,
--                                            grant_item, revoke_item, set_attr, adjust_points, open_action, lock_action,
--                                            set_track. An unknown op or a missing member raises invalid_op. Returns the
--                                            grants a tolerant (event) call skipped; strict (adjustment) makes a short revoke
--                                            raise insufficient_holding.
--   format__insert_item(...)                 Internal: one resource_items row, under the holding's advisory lock. An exclusive
--                                            clash raises resource_item_taken; a grant that would take the holder over the
--                                            resource's capacity (read from the attached spec) raises resource_capacity_reached.
--                                            Event, action and adjustment grants all go through it, so the check cannot be
--                                            outrun by a concurrent grant of another path.
--   format_fire_event(...)                   Logs the event once and applies its ops; false when it already fired. Takes
--                                            p_expected_revision like a save and submit: an event planned for a format that
--                                            was replaced, switched or amended since raises format_context_stale before it is
--                                            logged (its key stays free) and applies nothing.
--   format_action_save / _submit(...)        Save a draft pick / submit it (replacing the items the earlier submission
--                                            granted) and optionally lock it. Raises action_locked. A save over a submitted
--                                            pick turns it back into a draft and releases the items it granted. Save, submit
--                                            and the lock_action op of one action run under one advisory lock, so a submit
--                                            can never slip in after the action's lock.
--                                            A domain adjustment takes the same lock of every guarded action before its guard
--                                            reads, so a lock-submit cannot slip in beside the amendment.
--                                            Both take p_expected_revision, the season_formats.revision the application
--                                            validated the pick against (attach, replace, engine switch and every amendment
--                                            bump it, a detach removes the row). Under the action lock the row is read FOR
--                                            SHARE, so no attach, detach or amendment commits between the check and the
--                                            write; a different revision raises format_context_stale and nothing is written.
--                                            A locked pick raises action_locked even with p_only_if_unsubmitted; only a
--                                            submitted (unlocked) one raises action_already_submitted.
--   format_apply_adjustment(...)             Records an admin adjustment, applies its ops, appends a domain amendment to
--                                            season_formats.amendments. Raises reason_required, domain_amendment_locked,
--                                            and for the two changes the ops would otherwise skip without a word:
--                                            relation_has_links (a set_relation on a relation that has links),
--                                            insufficient_holding (a revoke_item of more units than the player holds),
--                                            domain_in_use (a domain amendment removes an entry that is held, or a stage
--                                            whose team constraints count the domain, named in p_guard_stages, has fired its
--                                            stage_start) and
--                                            action_state_unchanged (an action already in the requested state), so a
--                                            history row never records a change that did not happen. All four are decided under
--                                            the locks the call holds, after the application's own check of a snapshot. Takes
--                                            p_expected_revision too: an adjustment prepared against another version of the
--                                            format (replaced, switched, amended) raises format_context_stale and writes
--                                            nothing. A domain amendment locks the season_formats row FOR UPDATE for it.
--   format_check_open / format_check_resolve Open a deduplicated check (p_expected_revision like an event: a stale or post-detach
--                                            open raises format_context_stale and leaves no ghost check or burnt dedupe_key);
--                                            resolve it only from open, and only in its own league (p_season_id: a check id of
--                                            another league resolves nothing; it depends on no context and is not fenced).
--   format__clear_runtime(season)            Internal: empties the runtime tables of one league (nine here; format_challenges is
--                                            added by 20261106090000). Every attach (a first one too: rows without a
--                                            season_formats row belong to no format) and detach call it (before the league
--                                            starts nothing in them is worth keeping).
--
-- Domain errors are `RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001', DETAIL = <json text>`: action_locked,
-- format_context_stale (the format changed after the pick was validated), resource_capacity_reached
-- (DETAIL {"resource", "player_id", "capacity"}), resource_item_taken (DETAIL {"resource", "item_id"}), domain_amendment_locked (DETAIL {"actions"}), reason_required,
-- relation_has_links (DETAIL {"relation"}), insufficient_holding (DETAIL {"resource", "player_id", "item_id"}),
-- domain_in_use (DETAIL {"domain"}: an amendment removes an entry a resource holding the domain still holds),
-- action_state_unchanged (DETAIL {"action"}: an action adjustment to the state it is in), invalid_op (DETAIL {"op"}). A league without an attached format raises format_context_stale on an event or an adjustment (the
-- revision check finds no row); FORMAT_NOT_ATTACHED stays as the last line of defence of the amendment's own update.
--
-- Lock order, one for every writer of the format runtime (a transaction takes the locks it needs in this order, sorted within
-- a kind, so no two can wait on each other): relation (format_relation:) -> action (format__lock_action) -> the seasons row
-- (KEY SHARE) and the season_formats row (SHARE; FOR UPDATE for a domain amendment) of the revision check -> holding
-- (format__lock_holding) -> exclusive key (format__lock_exclusive). A writer takes the subset it needs. An event and an
-- adjustment take the relation and action locks of their ops first (format__lock_op_keys), then check the revision, then
-- format__apply_ops takes the holdings and exclusive keys of its grants and revokes (format__lock_grants). What this order
-- does NOT cover: the keyed upserts of format__apply_ops (flags, attributes, track steps) are applied in op order, so two
-- events whose ops write the same keys in opposite order (the two legs of a pairing with swapped players) can still
-- deadlock; Postgres aborts one with 40P01 and the caller's hook reports a failed step that the heal retries (the event key
-- is not logged after the rollback). The rows of the league recycle bin are locked by league_trash_delete under its own order.
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
-- Context revision. season_formats.revision changes on EVERY insert and update of the row (an attach or a replace, an
-- engine switch, a domain amendment, ...) and is drawn from one sequence, so a detach followed by a new attach never
-- reuses the number a validator read from the old row. The application reads it together with the spec it validates a
-- pick against and hands it back to format_action_save / format_action_submit, which refuse the write when it moved.
-- Rows that exist before this file take 0 and a number at their first change. The sequence is used by the API role that
-- writes season_formats (service_role), so it gets USAGE.
CREATE SEQUENCE public.season_format_revision_seq;
REVOKE ALL ON SEQUENCE public.season_format_revision_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.season_format_revision_seq TO service_role;

ALTER TABLE public.season_formats ADD COLUMN revision bigint NOT NULL DEFAULT 0;

-- The seconds the league spent in the recycle bin. The stage calendar is computed from absolute dates, so a restore cannot move a
-- stored instant; league_trash_restore adds the time away here (20261106090000) and the calendar adds it to every instant it
-- computes, so nothing that fell due while the league was away is due the moment it is back.
ALTER TABLE public.season_formats ADD COLUMN clock_shift_seconds bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.season_formats.clock_shift_seconds IS
  'Seconds the league spent in the recycle bin (added by league_trash_restore); the stage calendar shifts every instant it computes by this.';

CREATE OR REPLACE FUNCTION public.season_formats__bump_revision()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.revision := nextval('public.season_format_revision_seq');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.season_formats__bump_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.season_formats__bump_revision() TO service_role;

CREATE TRIGGER trg_season_formats_revision BEFORE INSERT OR UPDATE ON public.season_formats
  FOR EACH ROW EXECUTE FUNCTION public.season_formats__bump_revision();

COMMENT ON COLUMN public.season_formats.revision IS
  'Changes on every insert and update of the row (one sequence). The runtime writes of a player action carry the revision they validated against and are refused (format_context_stale) when it moved.';

-- Refuses a write validated against another version of the league's format. The caller holds the action lock. The seasons
-- row is share-locked FIRST (the attach and the detach lock it FOR UPDATE before they touch season_formats, and the
-- foreign keys of the rows written afterwards would take the same share lock): taking it after the season_formats lock
-- could deadlock with an attach. The season_formats row is then read FOR SHARE, so an attach, a detach, an engine switch
-- or an amendment waits for this transaction to commit, or has committed already and is seen here.
CREATE OR REPLACE FUNCTION public.format__check_revision(p_season_id uuid, p_expected_revision bigint)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint;
BEGIN
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'revision')::text;
  END IF;
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  SELECT f.revision INTO v_revision FROM public.season_formats f WHERE f.season_id = p_season_id FOR SHARE;
  IF NOT FOUND OR v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- The same check for a writer that changes the season_formats row itself (a domain amendment). It takes the row FOR UPDATE
-- instead of FOR SHARE: two amendments that both held the share lock and then both updated the row would wait on each
-- other. The seasons row is share-locked first, like format__check_revision.
CREATE OR REPLACE FUNCTION public.format__check_revision_for_update(p_season_id uuid, p_expected_revision bigint)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint;
BEGIN
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'revision')::text;
  END IF;
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  SELECT f.revision INTO v_revision FROM public.season_formats f WHERE f.season_id = p_season_id FOR UPDATE;
  IF NOT FOUND OR v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- The write gate of a player's move, decided under the lock: the application's check (assertSeasonOpenForPlay) ran in
-- another request. The seasons row FOR SHARE conflicts with the UPDATE that closes the league (FOR KEY SHARE would not), so
-- a close either commits first and is seen here, or waits for this move. It comes before format__check_revision: seasons
-- first, then season_formats.
CREATE OR REPLACE FUNCTION public.format__assert_season_open(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_status   public.season_status;
  v_archived boolean;
BEGIN
  SELECT s.status, s.archived INTO v_status, v_archived FROM public.seasons s WHERE s.id = p_season_id FOR SHARE;
  IF FOUND AND (v_status = 'completed' OR v_archived) THEN
    RAISE EXCEPTION 'format_season_closed' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Holdings. What a player holds of one resource is capped by the resource's `capacity` in the attached spec. Every
-- writer of the holding takes the same transaction lock first and reads the held units under it, so two grants (a
-- player's submit, an event, an admin adjustment) cannot both fit into the last free unit.
CREATE OR REPLACE FUNCTION public.format__lock_holding(p_season_id uuid, p_resource text, p_player uuid)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('format_holding:' || p_season_id::text || ':' || p_resource || ':' || p_player::text, 0));
END $$;

-- The exclusive key (league, resource, item) as a transaction lock. format_resource_items_exclusive_key is global per
-- (season, resource, item) while a holding lock is per player, so two transactions that grant overlapping exclusive items
-- to different players in opposite order would each wait on the other's uncommitted unique key (40P01). Every writer that
-- inserts or deletes exclusive items takes these locks in one sorted pre-pass (format__lock_grants), so the unique index
-- never has to wait for an uncommitted row and a clash raises a clean resource_item_taken.
CREATE OR REPLACE FUNCTION public.format__lock_exclusive(p_season_id uuid, p_resource text, p_item text)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('format_exclusive:' || p_season_id::text || ':' || p_resource || ':' || p_item, 0));
END $$;

-- The holding and exclusive-key locks of a batch of item writes (internal), sorted: every holding (resource, player) first,
-- then every exclusive key (resource, item). p_rows is an array of {resource, player_id, item_id, exclusive}; a grant, a
-- revoke and the delete of an earlier submission's items all go through it, so no two writers wait on each other in a cycle
-- and a revoke is serialised with a grant of the same holding. Re-taking a lock the transaction holds is free.
CREATE OR REPLACE FUNCTION public.format__lock_grants(p_season_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_lock record;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN;
  END IF;
  FOR v_lock IN
    SELECT DISTINCT r ->> 'resource' AS resource_key, (r ->> 'player_id')::uuid AS player_id FROM jsonb_array_elements(p_rows) AS r
     ORDER BY resource_key, player_id
  LOOP
    PERFORM public.format__lock_holding(p_season_id, v_lock.resource_key, v_lock.player_id);
  END LOOP;
  FOR v_lock IN
    SELECT DISTINCT r ->> 'resource' AS resource_key, r ->> 'item_id' AS item_id FROM jsonb_array_elements(p_rows) AS r
     WHERE r ->> 'exclusive' = 'true' AND r ->> 'item_id' IS NOT NULL
     ORDER BY resource_key, item_id
  LOOP
    PERFORM public.format__lock_exclusive(p_season_id, v_lock.resource_key, v_lock.item_id);
  END LOOP;
END $$;

-- The capacity of a resource in the league's attached spec, or NULL (no format, no such resource, no capacity).
CREATE OR REPLACE FUNCTION public.format__resource_capacity(p_season_id uuid, p_resource text)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(r -> 'capacity') = 'number' THEN (r ->> 'capacity')::integer END
    FROM public.season_formats f,
         jsonb_array_elements(CASE WHEN jsonb_typeof(f.spec -> 'resources') = 'array' THEN f.spec -> 'resources' ELSE '[]'::jsonb END) AS r
   WHERE f.season_id = p_season_id AND jsonb_typeof(r) = 'object' AND r ->> 'key' = p_resource
   LIMIT 1
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Serialises everything that changes one action's lock state: a save or submit (flag check, then the row) against the
-- lock_action op (flag, then the submitted rows). The lock is transaction-scoped.
CREATE OR REPLACE FUNCTION public.format__lock_action(p_season_id uuid, p_action_key text)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('format_action:' || p_season_id::text || ':' || p_action_key, 0));
END $$;

-- Empties the nine runtime tables of one league (internal). The attach that replaces a format and the detach call it
-- while the league has not started: events, flags, links, items, picks and checks of the old spec are stale.
CREATE OR REPLACE FUNCTION public.format__clear_runtime(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.format_relation_links     WHERE season_id = p_season_id;
  DELETE FROM public.format_resource_items     WHERE season_id = p_season_id;
  DELETE FROM public.format_action_submissions WHERE season_id = p_season_id;
  DELETE FROM public.format_event_log          WHERE season_id = p_season_id;
  DELETE FROM public.format_flags              WHERE season_id = p_season_id;
  DELETE FROM public.format_player_attrs       WHERE season_id = p_season_id;
  DELETE FROM public.format_track_progress     WHERE season_id = p_season_id;
  DELETE FROM public.format_checks             WHERE season_id = p_season_id;
  DELETE FROM public.format_adjustments        WHERE season_id = p_season_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Ops. The required members per op are listed in format__apply_ops; the TS FormatOp type (queries/format-runtime.ts) is its twin.
CREATE OR REPLACE FUNCTION public.format__insert_item(
  p_season_id uuid, p_resource text, p_player uuid, p_item text, p_amount integer,
  p_exclusive boolean, p_source text, p_source_ref text
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_capacity integer;
  v_held     bigint;
BEGIN
  -- Under the holding's lock the units held are read after every earlier grant of the holding has committed (the caller
  -- usually took the lock already, in sorted order; taking it again is free). A grant over the capacity is refused and the
  -- whole call rolls back, so a submission never keeps a part of its items.
  PERFORM public.format__lock_holding(p_season_id, p_resource, p_player);
  IF p_exclusive AND p_item IS NOT NULL THEN
    PERFORM public.format__lock_exclusive(p_season_id, p_resource, p_item);
  END IF;
  v_capacity := public.format__resource_capacity(p_season_id, p_resource);
  IF v_capacity IS NOT NULL THEN
    SELECT coalesce(sum(i.amount), 0) INTO v_held FROM public.format_resource_items i
     WHERE i.season_id = p_season_id AND i.resource_key = p_resource AND i.player_id = p_player;
    IF v_held + p_amount > v_capacity THEN
      RAISE EXCEPTION 'resource_capacity_reached' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('resource', p_resource, 'player_id', p_player, 'capacity', v_capacity)::text;
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.format_resource_items (season_id, resource_key, player_id, item_id, amount, exclusive, source, source_ref)
    VALUES (p_season_id, p_resource, p_player, p_item, p_amount, p_exclusive, p_source, p_source_ref);
  EXCEPTION WHEN unique_violation THEN
    -- Only format_resource_items_exclusive_key can fire: the id is random.
    RAISE EXCEPTION 'resource_item_taken' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('resource', p_resource, 'item_id', p_item)::text;
  END;
END $$;

-- The relation and action locks of an op batch (internal), the first two kinds of the lock order. Sorted and deduplicated, so
-- every caller takes them in one order. A relation a set_relation op draws is locked under the same key
-- format_apply_adjustment takes: without it a set_relation from an event and one from an adjustment both see no links, both
-- insert, and the loser fails on the primary key (rolling back a whole event). An action a lock_action op locks is locked
-- under format__lock_action, the key of every save and submit of that action; so is an action an open_action op opens (an
-- adjustment decides action_state_unchanged from the flag under that lock). format_fire_event and format_apply_adjustment
-- call this BEFORE their revision check: a transaction that holds the season_formats row (the share lock of the check, or the
-- row lock of a domain amendment) must never wait for an action lock, because the amendment holds action locks while it
-- waits for that row. A batch that is not an array and malformed ops are left to format__apply_ops, which raises invalid_op.
CREATE OR REPLACE FUNCTION public.format__lock_op_keys(p_season_id uuid, p_ops jsonb)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_rel  text;
  v_lock record;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RETURN;
  END IF;
  FOR v_rel IN
    SELECT DISTINCT o ->> 'relation' AS relation_key FROM jsonb_array_elements(p_ops) AS o
     WHERE jsonb_typeof(o) = 'object' AND o ->> 'op' = 'set_relation' AND o ->> 'relation' IS NOT NULL
     ORDER BY relation_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('format_relation:' || p_season_id::text || ':' || v_rel, 0));
  END LOOP;
  FOR v_lock IN
    SELECT DISTINCT o ->> 'action' AS action_key FROM jsonb_array_elements(p_ops) AS o
     WHERE jsonb_typeof(o) = 'object' AND o ->> 'op' IN ('lock_action', 'open_action') AND o ->> 'action' IS NOT NULL
     ORDER BY action_key
  LOOP
    PERFORM public.format__lock_action(p_season_id, v_lock.action_key);
  END LOOP;
END $$;

-- p_strict (an admin adjustment): a revoke_item that finds fewer units than it asks for raises insufficient_holding, so the
-- adjustment row rolls back with it (an event's revoke stays lenient: a match revert removes what is left). p_tolerant (an
-- event): a grant_item that hits resource_capacity_reached or resource_item_taken (a concurrent writer took the last unit
-- or the exclusive item after the planner read its snapshot) is skipped in a savepoint instead of rolling the whole event
-- back; the skipped grants are the return value (a jsonb array of {resource, player_id, item_id, reason}).
DROP FUNCTION IF EXISTS public.format__apply_ops(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.format__apply_ops(p_season_id uuid, p_ops jsonb, p_strict boolean DEFAULT false, p_tolerant boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_op      jsonb;
  v_kind    text;
  v_need    text[];
  v_left    integer;
  v_row     record;
  v_take    integer;
  v_skipped jsonb := '[]'::jsonb;
  v_msg     text;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', NULL::text)::text;
  END IF;

  -- The relation and action locks of the batch, in the order every writer uses (format__lock_op_keys). An event and an
  -- adjustment take them before their revision check and so have them already; re-taking a held lock is a no-op.
  PERFORM public.format__lock_op_keys(p_season_id, p_ops);

  -- Then the holdings the grant_item and revoke_item ops write to (capacity is checked per holding, and a revoke must not
  -- race a grant or another removal of the same holding), and the exclusive keys the grants take, sorted: the order every
  -- writer uses (relation -> action -> revision check -> holding -> exclusive key), so an event and a player's submit that
  -- touch the same holding or item cannot wait on each other. Malformed ops are left to the check below: a player_id that
  -- is not a canonical uuid is skipped here and fails the cast of the op itself.
  PERFORM public.format__lock_grants(p_season_id, coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'resource', o ->> 'resource', 'player_id', o ->> 'player_id', 'item_id', o ->> 'item_id',
             'exclusive', o ->> 'op' = 'grant_item' AND o ->> 'exclusive' = 'true'))
      FROM jsonb_array_elements(p_ops) AS o
     WHERE jsonb_typeof(o) = 'object' AND o ->> 'op' IN ('grant_item', 'revoke_item') AND o ->> 'resource' IS NOT NULL
       AND o ->> 'player_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), '[]'::jsonb));

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
      IF p_tolerant THEN
        BEGIN
          PERFORM public.format__insert_item(
            p_season_id, v_op ->> 'resource', (v_op ->> 'player_id')::uuid, v_op ->> 'item_id', (v_op ->> 'amount')::integer,
            (v_op ->> 'exclusive')::boolean, v_op ->> 'source', v_op ->> 'source_ref');
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
          IF v_msg NOT IN ('resource_capacity_reached', 'resource_item_taken') THEN
            RAISE;
          END IF;
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'resource', v_op ->> 'resource', 'player_id', v_op ->> 'player_id', 'item_id', v_op ->> 'item_id', 'reason', v_msg));
        END;
      ELSE
        PERFORM public.format__insert_item(
          p_season_id, v_op ->> 'resource', (v_op ->> 'player_id')::uuid, v_op ->> 'item_id', (v_op ->> 'amount')::integer,
          (v_op ->> 'exclusive')::boolean, v_op ->> 'source', v_op ->> 'source_ref');
      END IF;

    ELSIF v_kind = 'revoke_item' THEN
      -- Removes `amount` units, oldest rows first; a row holding more than is left to take keeps the rest. An inverse revoke
      -- (the undo of a logged grant) carries that grant's source and source_ref and only ever takes rows with exactly that
      -- source and source_ref, so a revert never removes the units another source holds of the same item; when the grant's
      -- rows are gone it takes nothing (a strict caller then raises insufficient_holding). A revoke without a source takes
      -- from any row of the holding. Every grant inserts its own row (format__insert_item does not merge) and a seat
      -- substitution rewrites player_id only, so the rows of a logged grant keep their source and source_ref.
      v_left := (v_op ->> 'amount')::integer;
      FOR v_row IN
        SELECT id, amount FROM public.format_resource_items
         WHERE season_id = p_season_id AND resource_key = v_op ->> 'resource' AND player_id = (v_op ->> 'player_id')::uuid
           AND item_id IS NOT DISTINCT FROM (v_op ->> 'item_id')
           AND (v_op ->> 'source' IS NULL
                OR (format_resource_items.source IS NOT DISTINCT FROM (v_op ->> 'source')
                    AND format_resource_items.source_ref IS NOT DISTINCT FROM (v_op ->> 'source_ref')))
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
      IF p_strict AND v_left > 0 THEN
        RAISE EXCEPTION 'insufficient_holding' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('resource', v_op ->> 'resource', 'player_id', v_op ->> 'player_id', 'item_id', v_op ->> 'item_id')::text;
      END IF;

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
      PERFORM public.format__lock_action(p_season_id, v_op ->> 'action');
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
  RETURN v_skipped;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Events
-- The application plans the ops from the format it loaded and hands the season_formats.revision of that load as
-- p_expected_revision. The check runs before the event is logged and under the same lock order as a player's save or submit
-- (the relation and action locks of the ops, then the seasons row KEY SHARE and the season_formats row SHARE): an attach, a
-- detach, an engine switch or an amendment either committed before (this call sees another revision and raises
-- format_context_stale, with the key NOT logged, so the new format can fire its own event under that key) or waits for this
-- transaction to commit (and then clears or supersedes what it wrote). Without the check an event planned for the old format
-- could land its ops in the new runtime, and its key could suppress the new format's event of the same key. A caller treats
-- the signal as "retry later": the next cron pass or the heal plans the event again against the current format.
-- A new argument is an overload, not a replacement: the six-argument form of an earlier revision of this file is dropped first,
-- so no service_role-callable overload is left that skips the check.
DROP FUNCTION IF EXISTS public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.format_fire_event(
  p_season_id uuid, p_event_key text, p_event text, p_payload jsonb, p_ops jsonb, p_fired_by uuid, p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_rows    integer;
  v_skipped jsonb;
BEGIN
  PERFORM public.format__lock_op_keys(p_season_id, p_ops);
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  INSERT INTO public.format_event_log (season_id, event_key, event, payload, ops, fired_by)
  VALUES (p_season_id, p_event_key, p_event, coalesce(p_payload, '{}'::jsonb), coalesce(p_ops, '[]'::jsonb), p_fired_by)
  ON CONFLICT (season_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;
  -- Tolerant: a grant that a concurrent writer made impossible after the planner read its snapshot is skipped and recorded in
  -- the payload (skipped_grants) instead of rolling back the event, whose other ops (and key) would be lost for good.
  v_skipped := public.format__apply_ops(p_season_id, coalesce(p_ops, '[]'::jsonb), false, true);
  IF jsonb_array_length(v_skipped) > 0 THEN
    UPDATE public.format_event_log SET payload = payload || jsonb_build_object('skipped_grants', v_skipped)
     WHERE season_id = p_season_id AND event_key = p_event_key;
  END IF;
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Player actions
CREATE OR REPLACE FUNCTION public.format__action_flag_locked(p_season_id uuid, p_action_key text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.format_flags WHERE season_id = p_season_id AND key = 'action:' || p_action_key AND value = '"locked"'::jsonb)
$$;

-- The application validates a pick against the format it loaded and hands the season_formats.revision of that load as
-- p_expected_revision; the write is refused with format_context_stale when the format changed since (see
-- format__check_revision). A new argument is an overload, not a replacement: the five-argument save and the eight-argument
-- submit of an earlier revision of this file are dropped before the new ones are created, and nothing grants, revokes or
-- comments on them.
DROP FUNCTION IF EXISTS public.format_action_save(uuid, text, uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.format_action_save(
  p_season_id uuid, p_action_key text, p_actor uuid, p_target uuid, p_picks jsonb, p_expected_revision bigint
) RETURNS public.format_action_submissions
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_row public.format_action_submissions;
BEGIN
  PERFORM public.format__lock_action(p_season_id, p_action_key);
  PERFORM public.format__assert_season_open(p_season_id);
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  IF public.format__action_flag_locked(p_season_id, p_action_key) THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  -- A save over a submitted pick makes it a draft again: the draft is not a submission, so the lock leaves it alone and a
  -- deadline policy treats the player as not having submitted. The items the submission granted go with it (otherwise the
  -- player would keep exclusive items for a pick they no longer hold), and submitted_at is cleared.
  INSERT INTO public.format_action_submissions AS s (season_id, action_key, actor_player_id, target_player_id, status, picks)
  VALUES (p_season_id, p_action_key, p_actor, p_target, 'draft', coalesce(p_picks, '[]'::jsonb))
  ON CONFLICT (season_id, action_key, actor_player_id) DO UPDATE
    SET target_player_id = EXCLUDED.target_player_id, picks = EXCLUDED.picks, status = 'draft', submitted_at = NULL,
        updated_at = now()
    WHERE s.status <> 'locked'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  -- The items go under the holding (and exclusive-key) locks like every other removal, so an adjustment's revoke of the same
  -- holding is serialised with this release and its own recheck reads the final state.
  PERFORM public.format__lock_grants(p_season_id, coalesce((
    SELECT jsonb_agg(jsonb_build_object('resource', i.resource_key, 'player_id', i.player_id::text, 'item_id', i.item_id,
                                        'exclusive', i.exclusive))
      FROM public.format_resource_items i
     WHERE i.season_id = p_season_id AND i.source = 'action' AND i.source_ref = v_row.id::text
  ), '[]'::jsonb));
  DELETE FROM public.format_resource_items
   WHERE season_id = p_season_id AND source = 'action' AND source_ref = v_row.id::text;
  RETURN v_row;
END $$;

-- A new argument is an overload: the seven-argument form is dropped before the new one is created, and nothing grants,
-- revokes or comments on it.
DROP FUNCTION IF EXISTS public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean, boolean);
CREATE OR REPLACE FUNCTION public.format_action_submit(
  p_season_id uuid, p_action_key text, p_actor uuid, p_target uuid, p_picks jsonb, p_items jsonb, p_lock boolean,
  p_expected_revision bigint, p_only_if_unsubmitted boolean DEFAULT false
) RETURNS public.format_action_submissions
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row  public.format_action_submissions;
  v_item jsonb;
BEGIN
  PERFORM public.format__lock_action(p_season_id, p_action_key);
  PERFORM public.format__assert_season_open(p_season_id);
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  IF public.format__action_flag_locked(p_season_id, p_action_key) THEN
    RAISE EXCEPTION 'action_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'items')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS i WHERE jsonb_typeof(i) <> 'object' OR NOT (i ?& ARRAY['resource', 'item_id'])) THEN
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
  -- The cron's deadline draw (p_only_if_unsubmitted) must never replace a choice the player made: a row that is already
  -- submitted (the player committed after the application read its state) is left as it is and the call raises, under
  -- the same advisory lock as every other writer of this action. A row this call has just inserted is a draft and passes.
  IF p_only_if_unsubmitted AND v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'action_already_submitted' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_action_key)::text;
  END IF;

  -- Every holding the items go to or come from (the items the earlier submission granted are deleted below), and every
  -- exclusive key among them, is locked first, sorted (format__lock_grants): two submits of different actions that grant the
  -- same resources or exclusive items in a different step order cannot wait on each other, and an adjustment's revoke of a
  -- holding is serialised with the release. format__insert_item then reads the held units under that lock and refuses a
  -- grant over the resource's capacity before it inserts; the raise rolls the whole call back, the submission row and the
  -- items already written included.
  PERFORM public.format__lock_grants(p_season_id, coalesce((
    SELECT jsonb_agg(u.x) FROM (
      SELECT jsonb_build_object('resource', i ->> 'resource', 'player_id', coalesce(p_target, p_actor)::text, 'item_id', i ->> 'item_id',
                                'exclusive', coalesce(i ->> 'exclusive', 'false') = 'true') AS x
        FROM jsonb_array_elements(p_items) AS i
      UNION ALL
      SELECT jsonb_build_object('resource', o.resource_key, 'player_id', o.player_id::text, 'item_id', o.item_id, 'exclusive', o.exclusive)
        FROM public.format_resource_items o
       WHERE o.season_id = p_season_id AND o.source = 'action' AND o.source_ref = v_row.id::text
    ) AS u
  ), '[]'::jsonb));
  DELETE FROM public.format_resource_items
   WHERE season_id = p_season_id AND source = 'action' AND source_ref = v_row.id::text;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
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
-- The eight- and nine-argument forms of earlier revisions of this file are dropped before the ten-argument one is created (a new
-- argument is an overload, not a replacement); nothing grants, revokes or comments on the old forms.
DROP FUNCTION IF EXISTS public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[]);
DROP FUNCTION IF EXISTS public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[], bigint);
CREATE OR REPLACE FUNCTION public.format_apply_adjustment(
  p_season_id uuid, p_kind text, p_target jsonb, p_delta jsonb, p_reason text, p_admin uuid, p_ops jsonb, p_guard_actions text[],
  p_guard_stages text[], p_expected_revision bigint
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_locked text[];
  v_id     uuid;
  v_rel    text;
  v_op     jsonb;
  v_domain text;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind = 'domain' THEN
    -- A domain amendment changes no runtime row: it takes the season_formats row FOR UPDATE below, and format__lock_op_keys
    -- (the relation and action locks of ops) must come BEFORE that row lock in every writer. Ops would be applied after it
    -- with their locks taken late, so a domain adjustment carries none.
    IF p_ops IS NOT NULL AND (jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) > 0) THEN
      RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'domain_ops')::text;
    END IF;
    -- Take the per-action advisory lock of every guarded action BEFORE the guard reads, in sorted order (one lock order
    -- for every caller). A concurrent submit-and-lock of one of them waits here until the amendment commits; one that
    -- already holds the lock commits first and the guard below sees its locked row. A submit that was validated against
    -- the old domain and waits here is refused afterwards: the amendment below changes season_formats.revision, which
    -- the submit checks (format__check_revision) under the same lock.
    PERFORM public.format__lock_action(p_season_id, g.k)
       FROM (SELECT DISTINCT k FROM unnest(coalesce(p_guard_actions, '{}'::text[])) AS u(k) ORDER BY k) AS g;
    -- The amendment changes season_formats, so this call takes that row FOR UPDATE and refuses an amendment prepared against
    -- another revision (a format replaced, switched or amended since the application read it). The action locks above come
    -- first: the same order as a submit (action lock, then the row) and as format_fire_event.
    PERFORM public.format__check_revision_for_update(p_season_id, p_expected_revision);
    SELECT array_agg(g.k ORDER BY g.k) INTO v_locked
      FROM unnest(coalesce(p_guard_actions, '{}'::text[])) AS g(k)
     WHERE public.format__action_flag_locked(p_season_id, g.k)
        OR EXISTS (SELECT 1 FROM public.format_action_submissions s
                    WHERE s.season_id = p_season_id AND s.action_key = g.k AND s.status = 'locked');
    IF v_locked IS NOT NULL THEN
      RAISE EXCEPTION 'domain_amendment_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('actions', to_jsonb(v_locked))::text;
    END IF;
    -- domain_in_use, decided twice like relation_has_links: the application read the held items from a snapshot, and a
    -- submit, an event grant or an adjustment can commit between that read and this call without moving the revision. Every
    -- writer of a holding takes season_formats FOR SHARE (the revision check) before it writes, so with the row held FOR
    -- UPDATE here every earlier grant is committed and every later one waits and then sees the amended revision. An entry
    -- being removed that a resource holding this domain (read from the attached spec) still holds refuses the amendment.
    v_domain := p_target ->> 'domain';
    IF v_domain IS NOT NULL AND jsonb_typeof(p_delta -> 'remove') = 'array' AND jsonb_array_length(p_delta -> 'remove') > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.format_resource_items i
         WHERE i.season_id = p_season_id
           AND i.item_id IN (SELECT jsonb_array_elements_text(p_delta -> 'remove'))
           AND i.resource_key IN (
             SELECT r ->> 'key'
               FROM public.season_formats f,
                    jsonb_array_elements(CASE WHEN jsonb_typeof(f.spec -> 'resources') = 'array' THEN f.spec -> 'resources' ELSE '[]'::jsonb END) AS r
              WHERE f.season_id = p_season_id AND jsonb_typeof(r) = 'object'
                AND r -> 'holds' ->> 'kind' = 'domain' AND r -> 'holds' ->> 'domain' = v_domain)
      ) THEN
        RAISE EXCEPTION 'domain_in_use' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('domain', v_domain)::text;
      END IF;
    END IF;
    -- The second half of domain_in_use: a stage whose team constraints count the domain has started (its stage_start fired),
    -- so teams were already checked against the old entries, whether the amendment adds or removes. The application names
    -- those stages (p_guard_stages) from the snapshot it read; a stage_start that committed after that read does not move
    -- the revision, but it is in the event log by now, because this call holds the season_formats row FOR UPDATE and every
    -- event takes that row FOR SHARE before it logs its key. The key is the one eventKey builds: 'stage_start:<stage>'.
    IF EXISTS (
      SELECT 1 FROM public.format_event_log e
       WHERE e.season_id = p_season_id
         AND e.event_key IN (SELECT 'stage_start:' || g.k FROM unnest(coalesce(p_guard_stages, '{}'::text[])) AS g(k))
    ) THEN
      RAISE EXCEPTION 'domain_in_use' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('domain', v_domain)::text;
    END IF;
  ELSE
    -- Every other kind plans its ops (and its audit row) from the format the application loaded: refuse them against another
    -- version of it, with the relation and action locks of the ops taken first (see format__lock_op_keys).
    PERFORM public.format__lock_op_keys(p_season_id, p_ops);
    PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  END IF;

  -- format__apply_ops skips a set_relation on a relation that has links (an event may fire twice) and removes fewer units
  -- than a revoke_item asks for; both are right for an event and wrong for an adjustment, whose history row would then
  -- record a change that did not happen. The application checks the same against a snapshot it read earlier, which a
  -- concurrent adjustment can outdate, so the decision is repeated here under a transaction lock (sorted, one lock order
  -- for every caller): the second of two requests waits, then sees the first one's rows and is refused. The same lock is
  -- taken by format__apply_ops itself, so an event that draws the relation (generate_relation) serialises with this too.
  IF p_kind = 'action' THEN
    -- action_state_unchanged, decided twice: a lock that landed since the application read the flag (the cron, another admin)
    -- would otherwise be recorded as a second change. The action lock (format__lock_op_keys, above) serialises the flag.
    IF p_delta ->> 'state' = 'locked' AND p_target ->> 'action' IS NOT NULL
       AND public.format__action_flag_locked(p_season_id, p_target ->> 'action') THEN
      RAISE EXCEPTION 'action_state_unchanged' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_target ->> 'action')::text;
    ELSIF p_delta ->> 'state' = 'open' AND p_target ->> 'action' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.format_flags WHERE season_id = p_season_id AND key = 'action:' || (p_target ->> 'action') AND value = '"open"'::jsonb
    ) THEN
      RAISE EXCEPTION 'action_state_unchanged' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('action', p_target ->> 'action')::text;
    END IF;
  ELSIF p_kind = 'relation' THEN
    FOR v_rel IN
      SELECT DISTINCT o ->> 'relation' AS relation_key FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_ops) = 'array' THEN p_ops ELSE '[]'::jsonb END) AS o
       WHERE o ->> 'op' = 'set_relation' ORDER BY relation_key
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('format_relation:' || p_season_id::text || ':' || v_rel, 0));
      IF EXISTS (SELECT 1 FROM public.format_relation_links WHERE season_id = p_season_id AND relation_key = v_rel) THEN
        RAISE EXCEPTION 'relation_has_links' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('relation', v_rel)::text;
      END IF;
    END LOOP;
  ELSIF p_kind = 'resource' THEN
    FOR v_op IN
      SELECT o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_ops) = 'array' THEN p_ops ELSE '[]'::jsonb END) AS o
       WHERE o ->> 'op' = 'revoke_item' ORDER BY o ->> 'resource', o ->> 'player_id', o ->> 'item_id'
    LOOP
      PERFORM public.format__lock_holding(p_season_id, v_op ->> 'resource', (v_op ->> 'player_id')::uuid);
      IF coalesce((
        SELECT sum(amount) FROM public.format_resource_items
         WHERE season_id = p_season_id AND resource_key = v_op ->> 'resource' AND player_id = (v_op ->> 'player_id')::uuid
           AND item_id IS NOT DISTINCT FROM (v_op ->> 'item_id')
      ), 0) < (v_op ->> 'amount')::integer THEN
        RAISE EXCEPTION 'insufficient_holding' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('resource', v_op ->> 'resource', 'player_id', v_op ->> 'player_id', 'item_id', v_op ->> 'item_id')::text;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.format_adjustments (season_id, kind, target, delta, reason, admin_id)
  VALUES (p_season_id, p_kind, coalesce(p_target, '{}'::jsonb), coalesce(p_delta, '{}'::jsonb), p_reason, p_admin)
  RETURNING id INTO v_id;

  -- Strict: a revoke that finds fewer units than the check above counted (a remover that does not take the same lock would
  -- be one) raises insufficient_holding and rolls the history row back with it.
  PERFORM public.format__apply_ops(p_season_id, coalesce(p_ops, '[]'::jsonb), true, false);

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
-- A check opened from a context (a deadline policy, a hook, the team audit, the pairing filter) carries the revision of that
-- context, like an event: a format replaced, switched, detached or amended since raises format_context_stale and nothing is
-- inserted, so a ghost check of the old spec never lands in the new runtime (or in a league with no format) and never burns a
-- dedupe_key of the new one. format_check_resolve depends on no context and stays unfenced.
DROP FUNCTION IF EXISTS public.format_check_open(uuid, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.format_check_open(
  p_season_id uuid, p_source text, p_rule_id text, p_dedupe_key text, p_subject jsonb, p_expected_revision bigint
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  INSERT INTO public.format_checks (season_id, source, rule_id, dedupe_key, subject)
  VALUES (p_season_id, p_source, p_rule_id, p_dedupe_key, coalesce(p_subject, '{}'::jsonb))
  ON CONFLICT (season_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The status write of a deadline forfeit. The forfeit was decided from a context of one format revision, so the revision,
-- the engine and the compare-and-set on the match's status are one transaction: a format replaced or detached or a league
-- switched off the kit after the decision never gets a match completed by it. The fields are those of a completed match
-- in the application's status write; the league is part of the key. Locks follow seasons, season_formats, matches.
CREATE OR REPLACE FUNCTION public.format_forfeit_complete(
  p_season_id uuid, p_match_id uuid, p_expected_status public.match_status, p_winner_id uuid, p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_engine text;
  v_rows   integer;
BEGIN
  IF p_match_id IS NULL OR p_expected_status IS NULL OR p_winner_id IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'forfeit')::text;
  END IF;
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  SELECT f.engine INTO v_engine FROM public.season_formats f WHERE f.season_id = p_season_id;
  IF v_engine IS DISTINCT FROM 'kit' THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.matches m
     SET status = 'completed', finalized_at = NULL, winner_id = p_winner_id,
         date_played = now(), confirmed_at = now(), auto_confirm_at = NULL
   WHERE m.id = p_match_id
     AND m.status = p_expected_status
     AND m.tournament_id IN (SELECT t.id FROM public.tournaments t WHERE t.season_id = p_season_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- An earlier revision of this file defined the four-argument form, which resolved a check by id alone. A new argument
-- is an overload, not a replacement, so the old signature (and its service_role grant) is dropped explicitly.
DROP FUNCTION IF EXISTS public.format_check_resolve(uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.format_check_resolve(p_season_id uuid, p_check_id uuid, p_status text, p_admin uuid, p_note text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_rows integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'status')::text;
  END IF;
  -- The league is part of the key: an admin of one league cannot resolve a check of another by its id. The seasons row FOR KEY
  -- SHARE makes a league delete (FOR UPDATE) wait for the resolution, so its recycle-bin entry captures the final status.
  PERFORM 1 FROM public.seasons s WHERE s.id = p_season_id FOR KEY SHARE;
  UPDATE public.format_checks SET status = p_status, resolved_by = p_admin, resolved_at = now(), note = p_note
   WHERE id = p_check_id AND season_id = p_season_id AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants and comments
REVOKE ALL ON FUNCTION
  public.format__insert_item(uuid, text, uuid, text, integer, boolean, text, text),
  public.format__lock_action(uuid, text),
  public.format__check_revision(uuid, bigint),
  public.format__check_revision_for_update(uuid, bigint),
  public.format__assert_season_open(uuid),
  public.format__lock_op_keys(uuid, jsonb),
  public.format__lock_holding(uuid, text, uuid),
  public.format__lock_exclusive(uuid, text, text),
  public.format__lock_grants(uuid, jsonb),
  public.format__resource_capacity(uuid, text),
  public.format__clear_runtime(uuid),
  public.format__apply_ops(uuid, jsonb, boolean, boolean),
  public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid, bigint),
  public.format__action_flag_locked(uuid, text),
  public.format_action_save(uuid, text, uuid, uuid, jsonb, bigint),
  public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean, bigint, boolean),
  public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[], text[], bigint),
  public.format_check_open(uuid, text, text, text, jsonb, bigint),
  public.format_forfeit_complete(uuid, uuid, public.match_status, uuid, bigint),
  public.format_check_resolve(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.format__insert_item(uuid, text, uuid, text, integer, boolean, text, text),
  public.format__lock_action(uuid, text),
  public.format__check_revision(uuid, bigint),
  public.format__check_revision_for_update(uuid, bigint),
  public.format__assert_season_open(uuid),
  public.format__lock_op_keys(uuid, jsonb),
  public.format__lock_holding(uuid, text, uuid),
  public.format__lock_exclusive(uuid, text, text),
  public.format__lock_grants(uuid, jsonb),
  public.format__resource_capacity(uuid, text),
  public.format__clear_runtime(uuid),
  public.format__apply_ops(uuid, jsonb, boolean, boolean),
  public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid, bigint),
  public.format__action_flag_locked(uuid, text),
  public.format_action_save(uuid, text, uuid, uuid, jsonb, bigint),
  public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean, bigint, boolean),
  public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[], text[], bigint),
  public.format_check_open(uuid, text, text, text, jsonb, bigint),
  public.format_forfeit_complete(uuid, uuid, public.match_status, uuid, bigint),
  public.format_check_resolve(uuid, uuid, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.format__insert_item(uuid, text, uuid, text, integer, boolean, text, text) IS
  'Internal: inserts one format_resource_items row under the holding lock; an exclusive clash raises resource_item_taken, a grant over the resource capacity of the attached spec resource_capacity_reached (P0001).';
COMMENT ON FUNCTION public.format__lock_action(uuid, text) IS
  'Internal: takes the transaction-scoped advisory lock of one action, so save, submit and the lock_action op of that action run one at a time.';
COMMENT ON FUNCTION public.format__check_revision(uuid, bigint) IS
  'Internal: raises format_context_stale unless season_formats.revision of the league equals the expected one (the row is share-locked until the transaction ends).';
COMMENT ON FUNCTION public.format__check_revision_for_update(uuid, bigint) IS
  'Internal: format__check_revision for a writer that updates the season_formats row itself (a domain amendment): the row is locked FOR UPDATE, not FOR SHARE.';
COMMENT ON FUNCTION public.format__assert_season_open(uuid) IS
  'Internal: share-locks the seasons row and raises format_season_closed when the league is completed or archived, so a player move and the close of the league cannot both win.';
COMMENT ON FUNCTION public.format__lock_op_keys(uuid, jsonb) IS
  'Internal: takes the transaction-scoped advisory locks of the relations a set_relation op draws and of the actions a lock_action op locks, sorted. An event and an adjustment take them before their revision check.';
COMMENT ON FUNCTION public.format__lock_holding(uuid, text, uuid) IS
  'Internal: takes the transaction-scoped advisory lock of one holding (league, resource, player) that every grant takes before it reads the held units.';
COMMENT ON FUNCTION public.format__lock_exclusive(uuid, text, text) IS
  'Internal: takes the transaction-scoped advisory lock of one exclusive key (league, resource, item), so two writers of overlapping exclusive items never wait on each other''s uncommitted unique key.';
COMMENT ON FUNCTION public.format__lock_grants(uuid, jsonb) IS
  'Internal: takes the holding locks (resource, player) and then the exclusive-key locks (resource, item) of an array of {resource, player_id, item_id, exclusive}, each kind sorted. Grants, revokes and the release of an earlier submission''s items all go through it.';
COMMENT ON FUNCTION public.format__resource_capacity(uuid, text) IS
  'Internal: the capacity of a resource in the attached spec of the league, or NULL.';
COMMENT ON FUNCTION public.format__clear_runtime(uuid) IS
  'Internal: deletes the rows of the nine format runtime tables of one league (attach-replace and detach).';
COMMENT ON FUNCTION public.format__apply_ops(uuid, jsonb, boolean, boolean) IS
  'Internal: applies a jsonb array of format ops in order (set_flag, set_relation, reveal_relation, grant_item, revoke_item, set_attr, adjust_points, open_action, lock_action, set_track). Unknown op or missing member raises invalid_op; a grant_item over the resource capacity raises resource_capacity_reached. p_strict: a revoke_item of more units than held raises insufficient_holding. p_tolerant: a grant that hits capacity or an exclusive holder is skipped in a savepoint and returned in the jsonb array of skipped grants.';
COMMENT ON FUNCTION public.format_fire_event(uuid, text, text, jsonb, jsonb, uuid, bigint) IS
  'Logs a format event once (event_key) and applies its ops. Returns true when it fired now, false when it had fired before. Raises format_context_stale (nothing logged, the key stays free) when the league''s format changed since p_expected_revision was read.';
COMMENT ON FUNCTION public.format__action_flag_locked(uuid, text) IS
  'Internal: true when the flag action:<key> is "locked".';
COMMENT ON FUNCTION public.format_action_save(uuid, text, uuid, uuid, jsonb, bigint) IS
  'Saves a player action pick as a draft (a submitted pick becomes a draft again and its items are released). Raises action_locked when the action flag or the actor''s submission is locked, format_context_stale when the league''s format changed since p_expected_revision was read.';
COMMENT ON FUNCTION public.format_action_submit(uuid, text, uuid, uuid, jsonb, jsonb, boolean, bigint, boolean) IS
  'Submits (and with p_lock locks) a player action pick, replacing the resource items the earlier submission granted. With p_only_if_unsubmitted an already submitted or locked pick is left alone: a submitted one raises action_already_submitted, a locked one action_locked (the lock check comes first). Raises action_locked, format_context_stale (p_expected_revision no longer matches season_formats.revision), resource_item_taken, resource_capacity_reached, action_already_submitted (the whole call rolls back).';
COMMENT ON FUNCTION public.format_apply_adjustment(uuid, text, jsonb, jsonb, text, uuid, jsonb, text[], text[], bigint) IS
  'Records an admin adjustment, applies its ops and, for kind domain, appends the delta to season_formats.amendments. Raises reason_required, format_context_stale (the league''s format changed since p_expected_revision was read), domain_amendment_locked, and for a domain amendment domain_in_use (it removes a held entry, or the stage_start of a stage in p_guard_stages is in the event log). Returns the adjustment id.';
COMMENT ON FUNCTION public.format_check_open(uuid, text, text, text, jsonb, bigint) IS
  'Opens an assisted check; returns its id, or NULL when a check with that dedupe_key already exists. Raises format_context_stale (nothing inserted, the key stays free) when the league''s format changed or was detached since p_expected_revision was read.';
COMMENT ON FUNCTION public.format_forfeit_complete(uuid, uuid, public.match_status, uuid, bigint) IS
  'Completes a match of the league as a deadline forfeit, compare-and-set on its status, in one transaction with the revision and engine check. Returns false when the match no longer has that status (nothing written). Raises format_context_stale (nothing written) when the format changed or the league left the kit engine since p_expected_revision was read.';
COMMENT ON FUNCTION public.format_check_resolve(uuid, uuid, text, uuid, text) IS
  'Resolves an open check of the league to confirmed or rejected. Returns false when it was not open or belongs to another league.';

-- ---------------------------------------------------------------------------------------------------------------
-- Phase enrollment (the roster of a phase fed by several edges)
--
-- A phase is the sum of its sources: the enrollment sync of one source reads tournaments.enrollment_source (the blocks the
-- other sources contributed), merges its own block and writes the roster and the source back. Two sources that complete
-- together would each read the other's block as missing and the last write would drop one block, so the write is a
-- compare-and-set under a row lock: tournament_enrollment_replace() locks the phase row FOR UPDATE, compares the stored
-- enrollment_source.synced_at with the one the caller read (p_expected_synced_at, NULL when it read no source) and only
-- then replaces the participants and the source, in one transaction. The timestamp is the token because the application
-- reads the source through a parser that normalises it, so the raw jsonb would not compare equal to what it read. false
-- means another sync won: the caller reads again, merges again and retries. The delete and the insert of the roster are
-- atomic here too (a failed insert no longer leaves an empty roster).
--
-- The guards of a sync that is not forced are decided here too, under the lock: the application checks "not frozen, no rounds"
-- before it spends seconds computing standings, and an admin's roster edit (which freezes the phase) or a round written in that
-- window changes neither synced_at nor the row the application read. Without p_force the function therefore refuses with
-- enrollment_frozen / enrollment_rounds_exist (P0001) when the stored source is frozen or a round exists, and it keeps the
-- stored `frozen` flag (a forced sync too) instead of the copy the application read before it computed.
-- tournament_enrollment_freeze() sets that flag with one atomic jsonb update under the same row lock (never a whole-document
-- write built from an earlier read), and does not move synced_at or the contributions.
DROP FUNCTION IF EXISTS public.tournament_enrollment_replace(uuid, jsonb, jsonb, text);
CREATE OR REPLACE FUNCTION public.tournament_enrollment_replace(
  p_tournament_id uuid, p_entries jsonb, p_source jsonb, p_expected_synced_at text, p_force boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_current jsonb;
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001';
  END IF;
  SELECT t.enrollment_source INTO v_current FROM public.tournaments t WHERE t.id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF (v_current ->> 'synced_at') IS DISTINCT FROM p_expected_synced_at THEN
    RETURN false;
  END IF;
  IF NOT coalesce(p_force, false) THEN
    IF coalesce(v_current ->> 'frozen', 'false') = 'true' THEN
      RAISE EXCEPTION 'enrollment_frozen' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = p_tournament_id) THEN
      RAISE EXCEPTION 'enrollment_rounds_exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  DELETE FROM public.tournament_participants WHERE tournament_id = p_tournament_id;
  INSERT INTO public.tournament_participants (tournament_id, player_id, seed)
  SELECT p_tournament_id, e.player_id, e.seed FROM jsonb_to_recordset(p_entries) AS e(player_id uuid, seed integer);
  UPDATE public.tournaments
     SET enrollment_source = CASE
           WHEN v_current IS NULL THEN p_source
           ELSE p_source || jsonb_build_object('frozen', coalesce(v_current ->> 'frozen', 'false') = 'true')
         END
   WHERE id = p_tournament_id;
  RETURN true;
END $$;

-- Freezes the roster of a phase: one atomic update of the frozen flag, under the row lock a replace takes. Returns true when
-- this call froze it, false when there was no source or it was frozen already.
CREATE OR REPLACE FUNCTION public.tournament_enrollment_freeze(p_tournament_id uuid)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.tournaments
     SET enrollment_source = jsonb_set(enrollment_source, '{frozen}', 'true'::jsonb)
   WHERE id = p_tournament_id AND enrollment_source IS NOT NULL AND jsonb_typeof(enrollment_source) = 'object'
     AND coalesce(enrollment_source ->> 'frozen', 'false') <> 'true';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

REVOKE ALL ON FUNCTION public.tournament_enrollment_replace(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_enrollment_replace(uuid, jsonb, jsonb, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.tournament_enrollment_freeze(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_enrollment_freeze(uuid) TO service_role;
COMMENT ON FUNCTION public.tournament_enrollment_replace(uuid, jsonb, jsonb, text, boolean) IS
  'Replaces the participants of a phase and its enrollment_source in one transaction, but only while the stored enrollment_source.synced_at still equals p_expected_synced_at (the phase row is locked FOR UPDATE). Returns false when it changed meanwhile (another sync won; read again and retry), raises tournament_not_found. Without p_force it raises enrollment_frozen / enrollment_rounds_exist when the stored source is frozen or a round exists; the stored frozen flag is kept.';
COMMENT ON FUNCTION public.tournament_enrollment_freeze(uuid) IS
  'Sets enrollment_source.frozen = true in one atomic update (synced_at and contributions untouched). False when the phase has no source or is frozen already.';

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
