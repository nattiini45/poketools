-- In-app notifications of a kit league (docs/format-kit.md, "Notifications"). Until now a rule's `notify` effect was planned and
-- delivered nowhere, and a player learned of a challenge only by opening the play page.
--
-- One table, `format_notifications`: one row per recipient and event. A row holds a kind and ids (and, for a rule's notice,
-- the format's own bilingual text), never rendered text: the name of the other player and the language are decided when the
-- row is read, through the same masks as the player views.
--
-- Delivery is written in the transaction of the event it reports, so an event cannot be applied without its notifications
-- or the other way round. `UNIQUE (player_id, dedupe_key)` with ON CONFLICT DO NOTHING makes every path idempotent:
--
--   format_fire_event_notify(...)    format_fire_event, then one row per recipient of each planned `notify`, only when the
--                                    event had not fired. Key `rule:<revision>:<event key>:<rule id>:<effect index>`. The
--                                    revision is part of the key because a re-attach clears the fired keys: the same event
--                                    of a NEW format may notify again, a retry of the same one never does.
--   format_challenges__notify()      A trigger on format_challenges. Key `challenge:<id>:<status>`. A trigger because a
--                                    challenge changes status in many places (create and respond and cancel each expire or
--                                    cancel lapsed rows, the cron sweeps), and every one of them must notify.
--
-- format_challenge_cancel is replaced only to name who cancelled (a transaction-local setting the trigger reads): a challenger
-- who withdraws is not told about it, an admin's cancel tells both players.
--
-- A league restore is no new event: it inserts the challenge rows again, with the created_at they had. The trigger's insert
-- branch only reacts to a row created in this very transaction (`created_at = now()`: the column default), and the
-- restore's own notification rows come back from the trash unchanged.
--
-- The table references seasons, so it is classified in the recycle bin (owned, restored last).
--
-- Grants: service_role only. No RLS policies by design.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.format_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  dedupe_key text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CONSTRAINT format_notifications_kind_check CHECK (
    kind IN ('rule_notice', 'challenge_created', 'challenge_accepted', 'challenge_declined', 'challenge_expired', 'challenge_cancelled')
  ),
  CONSTRAINT format_notifications_dedupe UNIQUE (player_id, dedupe_key)
);
CREATE INDEX idx_format_notifications_inbox ON public.format_notifications (player_id, created_at DESC, id DESC);
CREATE INDEX idx_format_notifications_unread ON public.format_notifications (player_id) WHERE read_at IS NULL;
CREATE INDEX idx_format_notifications_season ON public.format_notifications (season_id);
CREATE INDEX idx_format_notifications_created ON public.format_notifications (created_at);

ALTER TABLE public.format_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.format_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.format_notifications TO service_role;
COMMENT ON TABLE public.format_notifications IS
  'In-app notifications of a kit league, one row per recipient and event (dedupe_key is the idempotency key). Written by format_fire_event_notify() and the format_challenges trigger. Service-role only. No RLS policies by design.';

-- ---------------------------------------------------------------------------------------------------------------
-- A fired event and its notifications, in one transaction. format_fire_event is called unchanged, with a completion's fence
-- passed on: false (the event had fired before) writes nothing. A recipient deleted since the plan is skipped by the join, and
-- the row lock closes the window between that read and the foreign-key check, so a delete cannot roll the event back.
-- The eight-argument form of an earlier revision of this file is dropped first (a new argument is an overload, not a replacement).
DROP FUNCTION IF EXISTS public.format_fire_event_notify(uuid, text, text, jsonb, jsonb, uuid, bigint, jsonb);
CREATE OR REPLACE FUNCTION public.format_fire_event_notify(
  p_season_id uuid, p_event_key text, p_event text, p_payload jsonb, p_ops jsonb, p_fired_by uuid, p_expected_revision bigint, p_notifications jsonb,
  p_fence_match uuid DEFAULT NULL, p_fence_confirmed_at timestamptz DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_notifications IS NULL OR jsonb_typeof(p_notifications) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'notify')::text;
  END IF;
  IF NOT public.format_fire_event(p_season_id, p_event_key, p_event, p_payload, p_ops, p_fired_by, p_expected_revision, p_fence_match, p_fence_confirmed_at) THEN
    RETURN false;
  END IF;
  INSERT INTO public.format_notifications (season_id, player_id, kind, dedupe_key, payload)
  SELECT p_season_id, pl.id, 'rule_notice',
         'rule:' || p_expected_revision::text || ':' || p_event_key || ':' || (n ->> 'rule') || ':' || (n ->> 'effect'),
         jsonb_build_object('message', n -> 'message')
    FROM jsonb_array_elements(p_notifications) n
   CROSS JOIN LATERAL jsonb_array_elements_text(n -> 'players') recipient(id)
    JOIN public.players pl ON pl.id = recipient.id::uuid
     FOR KEY SHARE OF pl
  ON CONFLICT ON CONSTRAINT format_notifications_dedupe DO NOTHING;
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Who hears of a challenge. `format.challenge_actor` is set by format_challenge_cancel only: the challenger's id, or 'admin'.
CREATE OR REPLACE FUNCTION public.format_challenges__notify()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_kind       text;
  v_defender   boolean := false;
  v_challenger boolean := false;
  r            record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.created_at <> now() THEN RETURN NULL; END IF;
    v_kind := 'challenge_created';
    v_defender := true;
  ELSE
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
    CASE NEW.status
      WHEN 'accepted' THEN v_kind := 'challenge_accepted'; v_challenger := true;
      WHEN 'declined' THEN v_kind := 'challenge_declined'; v_challenger := true;
      WHEN 'expired' THEN v_kind := 'challenge_expired'; v_defender := true; v_challenger := true;
      WHEN 'cancelled' THEN
        v_kind := 'challenge_cancelled';
        v_defender := true;
        v_challenger := current_setting('format.challenge_actor', true) IS DISTINCT FROM NEW.challenger_id::text;
      ELSE RETURN NULL;
    END CASE;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      (v_defender, NEW.defender_id, 'defender', NEW.challenger_id),
      (v_challenger, NEW.challenger_id, 'challenger', NEW.defender_id)
    ) AS recipient(told, player_id, role, counterparty_id)
     WHERE recipient.told
  LOOP
    INSERT INTO public.format_notifications (season_id, player_id, kind, dedupe_key, payload)
    VALUES (NEW.season_id, r.player_id, v_kind, 'challenge:' || NEW.id::text || ':' || NEW.status,
            jsonb_build_object('role', r.role, 'counterparty_id', r.counterparty_id))
    ON CONFLICT ON CONSTRAINT format_notifications_dedupe DO NOTHING;
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_format_challenges_notify AFTER INSERT OR UPDATE OF status ON public.format_challenges
  FOR EACH ROW EXECUTE FUNCTION public.format_challenges__notify();

-- The body of 20261106090000's format_challenge_cancel (kept in step with it), plus the set_config before the withdrawal.
CREATE OR REPLACE FUNCTION public.format_challenge_cancel(p_season_id uuid, p_challenge_id uuid, p_player uuid)
RETURNS public.format_challenges
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_row public.format_challenges;
BEGIN
  -- A player's withdrawal is a move; the system's (p_player NULL) is housekeeping and runs in a closed league too.
  IF p_player IS NOT NULL THEN
    PERFORM public.format__assert_season_open(p_season_id);
  END IF;
  PERFORM 1 FROM public.seasons s WHERE s.id = p_season_id FOR KEY SHARE;
  SELECT * INTO v_row FROM public.format_challenges WHERE id = p_challenge_id AND season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'challenge_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_player IS NOT NULL AND p_player <> v_row.challenger_id THEN
    RAISE EXCEPTION 'challenge_not_challenger' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'challenge_not_open' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('status', v_row.status)::text;
  END IF;
  -- A challenge whose accept window has run out is expired, not withdrawn, even when nothing has marked it yet: the
  -- cooldown counts an expired challenge and ignores a cancelled one, so storing 'cancelled' here would let the challenger
  -- challenge the same defender again at once. Like respond, the function stores the status and returns that row (a RAISE
  -- would roll the status back); the application raises challenge_expired for it.
  IF v_row.expires_at <= now() THEN
    UPDATE public.format_challenges SET status = 'expired' WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  PERFORM set_config('format.challenge_actor', coalesce(p_player::text, 'admin'), true);
  UPDATE public.format_challenges SET status = 'cancelled', responded_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION
  public.format_fire_event_notify(uuid, text, text, jsonb, jsonb, uuid, bigint, jsonb, uuid, timestamptz),
  public.format_challenges__notify()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.format_fire_event_notify(uuid, text, text, jsonb, jsonb, uuid, bigint, jsonb, uuid, timestamptz)
TO service_role;

COMMENT ON FUNCTION public.format_fire_event_notify(uuid, text, text, jsonb, jsonb, uuid, bigint, jsonb, uuid, timestamptz) IS
  'format_fire_event plus one format_notifications row per recipient of each planned notify, in one transaction; false and nothing written when the event had fired.';
COMMENT ON FUNCTION public.format_challenges__notify() IS
  'Writes the format_notifications rows of a challenge that was created or changed status. Idempotent by challenge and status.';

-- ---------------------------------------------------------------------------------------------------------------
-- The recycle bin classifies the new table. These definitions replace 20261106090000's; the inventory test reads the
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
    ('format_challenges',         'owned',   'season_id = $1'),
    ('format_notifications',      'owned',   'season_id = $1'),
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
    (108, 'format_adjustments',        NULL,                            NULL),
    (109, 'format_challenges',         NULL,                            NULL),
    (110, 'format_notifications',      NULL,                            NULL)
  ) AS v(step, rel, filter, defer)
$$;

COMMIT;
