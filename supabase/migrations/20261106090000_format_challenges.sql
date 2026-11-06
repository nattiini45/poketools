-- Challenge ladder (Format Studio engine, M4c): the challenges of a `pairing.challenge` stage, and two more check sources.
--
--   format_challenges        One challenge: challenger -> defender in a phase. status open -> accepted | declined | expired |
--                            cancelled. `round` is the phase round that was open when it was made; `match_id` is the match
--                            an accepted challenge created. `expires_at` is the end of the accept window.
--
-- Writers (service role only, one transaction each):
--
--   format_challenge_create(season, phase, challenger, defender, challenger_rank, defender_rank, rank_range, max_open,
--                           cooldown_rounds, accept_window_hours)
--       Under an advisory lock on the phase. Lapsed open challenges of the phase are expired first. The ranks are the
--       players' places in the stage standings (computed by the app: the standings are not SQL).
--   format_challenge_respond(season, challenge, player, accept)
--       Only the defender, only while open; a challenge id of another league is challenge_not_found. Accept inserts a
--       `scheduled` match (challenger = player 1) into the phase's highest round that is not completed. A response after `expires_at` stores `expired` and returns that row (the app
--       raises challenge_expired; the status is kept, which a RAISE would roll back).
--   format_challenge_cancel(season, challenge, player)
--       The challenger (player NULL = an admin acting for them) withdraws an open challenge of that league: a challenge
--       id of another league is challenge_not_found, so an admin route scoped to one league cannot reach another's.
--       One whose expires_at has passed is stored as expired (which the cooldown counts) and returned, like respond; the
--       app raises challenge_expired. A withdrawn (cancelled) challenge does not count towards the cooldown.
--   format_challenges_expire(season)
--       Marks every open challenge past `expires_at` (of one league, or of all when NULL) expired; returns how many.
--
-- Domain errors are `RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001', DETAIL = <json text>`: challenge_self,
-- challenge_phase_not_found, challenge_phase_closed, challenge_not_participant (DETAIL {"player_id"}),
-- challenge_no_open_round, challenge_rank_range (DETAIL {"rank_range", "distance"}), challenge_max_open
-- (DETAIL {"max_open"}), challenge_already_open, challenge_cooldown (DETAIL {"cooldown_rounds"}), challenge_not_found,
-- challenge_not_defender, challenge_not_challenger, challenge_not_open (DETAIL {"status"}).
--
-- format_checks.source gains 'pairing_forbidden' (a filtered round paired or dropped pairs the filter rejects) and
-- 'deadline_missed' (a deadline policy fired for a missed match, team or action) and 'team_audit' (a played team broke
-- the stage's team rules, differs from the replay, or could not be audited).
--
-- League recycle bin: format_challenges is owned (season_id = $1) and cascades with the league. It points at tournaments
-- (the phase), players and matches, so it restores after the matches (step 109). Deleting a match keeps the challenge
-- (match_id SET NULL); deleting a player removes their challenges (ON DELETE CASCADE), like the other format tables.
--
-- Grants: service_role only. No RLS policies by design.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.format_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  phase_id      uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  challenger_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  defender_id   uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'open',
  round         integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  responded_at  timestamptz,
  match_id      uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  CONSTRAINT format_challenges_status_check CHECK (status IN ('open', 'accepted', 'declined', 'expired', 'cancelled')),
  CONSTRAINT format_challenges_distinct CHECK (challenger_id <> defender_id),
  CONSTRAINT format_challenges_round_check CHECK (round >= 1)
);
CREATE INDEX idx_format_challenges_phase ON public.format_challenges (phase_id, challenger_id, created_at);
CREATE INDEX idx_format_challenges_season ON public.format_challenges (season_id, created_at, id);
CREATE INDEX idx_format_challenges_challenger ON public.format_challenges (challenger_id);
CREATE INDEX idx_format_challenges_defender ON public.format_challenges (defender_id);
CREATE INDEX idx_format_challenges_match ON public.format_challenges (match_id) WHERE match_id IS NOT NULL;
CREATE INDEX idx_format_challenges_open_expiry ON public.format_challenges (expires_at) WHERE status = 'open';

ALTER TABLE public.format_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.format_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.format_challenges TO service_role;
COMMENT ON TABLE public.format_challenges IS
  'Challenges of a challenge-ladder stage (open, accepted, declined, expired, cancelled); an accepted one points at the match it created. Written by format_challenge_*(). Service-role only. No RLS policies by design.';

ALTER TABLE public.format_checks DROP CONSTRAINT format_checks_source_check;
ALTER TABLE public.format_checks ADD CONSTRAINT format_checks_source_check CHECK (
  source IN ('unresolved_outcome', 'standings_tie', 'pairing_rematch', 'pairing_forbidden', 'deadline_missed', 'team_audit', 'expr')
);

-- ---------------------------------------------------------------------------------------------------------------
-- The highest round of the phase that is not completed: where an accepted challenge plays.
CREATE OR REPLACE FUNCTION public.format__open_round(p_phase_id uuid)
RETURNS TABLE (id uuid, round_number integer)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT r.id, r.round_number FROM public.rounds r
   WHERE r.tournament_id = p_phase_id AND r.status <> 'completed'
   ORDER BY r.round_number DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.format_challenge_create(
  p_season_id uuid, p_phase_id uuid, p_challenger uuid, p_defender uuid,
  p_challenger_rank integer, p_defender_rank integer,
  p_rank_range integer, p_max_open integer, p_cooldown_rounds integer, p_accept_window_hours integer
) RETURNS public.format_challenges
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_status   public.tournament_status;
  v_round    integer;
  v_distance integer;
  v_row      public.format_challenges;
BEGIN
  IF p_challenger IS NULL OR p_defender IS NULL OR p_challenger_rank IS NULL OR p_defender_rank IS NULL
     OR p_challenger_rank < 1 OR p_defender_rank < 1
     OR p_rank_range IS NULL OR p_rank_range < 1 OR p_max_open IS NULL OR p_max_open < 1
     OR p_cooldown_rounds IS NULL OR p_cooldown_rounds < 0 OR p_accept_window_hours IS NULL OR p_accept_window_hours < 1 THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'challenge')::text;
  END IF;
  IF p_challenger = p_defender THEN
    RAISE EXCEPTION 'challenge_self' USING ERRCODE = 'P0001';
  END IF;

  -- One writer per phase at a time: max_open and the cooldown are counts over the phase's challenges.
  PERFORM pg_advisory_xact_lock(hashtextextended('format_challenge:' || p_phase_id::text, 0));

  SELECT t.status INTO v_status FROM public.tournaments t WHERE t.id = p_phase_id AND t.season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'challenge_phase_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'challenge_phase_closed' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE tournament_id = p_phase_id AND player_id = p_challenger) THEN
    RAISE EXCEPTION 'challenge_not_participant' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('player_id', p_challenger)::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE tournament_id = p_phase_id AND player_id = p_defender) THEN
    RAISE EXCEPTION 'challenge_not_participant' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('player_id', p_defender)::text;
  END IF;

  SELECT o.round_number INTO v_round FROM public.format__open_round(p_phase_id) o;
  IF v_round IS NULL THEN
    RAISE EXCEPTION 'challenge_no_open_round' USING ERRCODE = 'P0001';
  END IF;

  -- A challenge is up the ladder: the defender ranks above the challenger, at most rank_range places.
  v_distance := p_challenger_rank - p_defender_rank;
  IF v_distance < 1 OR v_distance > p_rank_range THEN
    RAISE EXCEPTION 'challenge_rank_range' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('rank_range', p_rank_range, 'distance', v_distance)::text;
  END IF;

  -- A lapsed open challenge is no longer open: it neither counts against max_open nor blocks the pair.
  UPDATE public.format_challenges SET status = 'expired'
   WHERE phase_id = p_phase_id AND status = 'open' AND expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM public.format_challenges
     WHERE phase_id = p_phase_id AND status = 'open'
       AND ((challenger_id = p_challenger AND defender_id = p_defender) OR (challenger_id = p_defender AND defender_id = p_challenger))
  ) THEN
    RAISE EXCEPTION 'challenge_already_open' USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM public.format_challenges WHERE phase_id = p_phase_id AND challenger_id = p_challenger AND status = 'open') >= p_max_open THEN
    RAISE EXCEPTION 'challenge_max_open' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('max_open', p_max_open)::text;
  END IF;

  -- Cooldown: the same challenger may challenge the same defender again only after cooldown_rounds rounds (a withdrawn
  -- challenge does not count).
  IF p_cooldown_rounds > 0 AND EXISTS (
    SELECT 1 FROM public.format_challenges
     WHERE phase_id = p_phase_id AND challenger_id = p_challenger AND defender_id = p_defender
       AND status <> 'cancelled' AND v_round - round < p_cooldown_rounds
  ) THEN
    RAISE EXCEPTION 'challenge_cooldown' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('cooldown_rounds', p_cooldown_rounds)::text;
  END IF;

  INSERT INTO public.format_challenges (season_id, phase_id, challenger_id, defender_id, round, expires_at)
  VALUES (p_season_id, p_phase_id, p_challenger, p_defender, v_round, now() + make_interval(hours => p_accept_window_hours))
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- An earlier revision of this file defined respond (challenge, player, accept) and cancel (challenge, player), which
-- found a challenge by id alone. A new argument is an overload, not a replacement, so the old signatures (and their
-- service_role grants) are dropped explicitly.
DROP FUNCTION IF EXISTS public.format_challenge_respond(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.format_challenge_cancel(uuid, uuid);

CREATE OR REPLACE FUNCTION public.format_challenge_respond(p_season_id uuid, p_challenge_id uuid, p_player uuid, p_accept boolean)
RETURNS public.format_challenges
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row      public.format_challenges;
  v_status   public.tournament_status;
  v_round_id uuid;
  v_match_id uuid;
BEGIN
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', 'challenge')::text;
  END IF;
  SELECT * INTO v_row FROM public.format_challenges WHERE id = p_challenge_id AND season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'challenge_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_player IS DISTINCT FROM v_row.defender_id THEN
    RAISE EXCEPTION 'challenge_not_defender' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'challenge_not_open' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('status', v_row.status)::text;
  END IF;

  IF v_row.expires_at <= now() THEN
    UPDATE public.format_challenges SET status = 'expired' WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF NOT p_accept THEN
    UPDATE public.format_challenges SET status = 'declined', responded_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  SELECT t.status INTO v_status FROM public.tournaments t WHERE t.id = v_row.phase_id;
  IF v_status IS NULL OR v_status = 'completed' THEN
    RAISE EXCEPTION 'challenge_phase_closed' USING ERRCODE = 'P0001';
  END IF;
  SELECT o.id INTO v_round_id FROM public.format__open_round(v_row.phase_id) o;
  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'challenge_no_open_round' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.matches (round_id, tournament_id, player_1_id, player_2_id)
  VALUES (v_round_id, v_row.phase_id, v_row.challenger_id, v_row.defender_id)
  RETURNING id INTO v_match_id;
  UPDATE public.format_challenges SET status = 'accepted', responded_at = now(), match_id = v_match_id
   WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.format_challenge_cancel(p_season_id uuid, p_challenge_id uuid, p_player uuid)
RETURNS public.format_challenges
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_row public.format_challenges;
BEGIN
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
  UPDATE public.format_challenges SET status = 'cancelled', responded_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.format_challenges_expire(p_season_id uuid)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.format_challenges SET status = 'expired'
   WHERE status = 'open' AND expires_at <= now() AND (p_season_id IS NULL OR season_id = p_season_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION
  public.format__open_round(uuid),
  public.format_challenge_create(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer, integer),
  public.format_challenge_respond(uuid, uuid, uuid, boolean),
  public.format_challenge_cancel(uuid, uuid, uuid),
  public.format_challenges_expire(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.format__open_round(uuid),
  public.format_challenge_create(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer, integer),
  public.format_challenge_respond(uuid, uuid, uuid, boolean),
  public.format_challenge_cancel(uuid, uuid, uuid),
  public.format_challenges_expire(uuid)
  TO service_role;

COMMENT ON FUNCTION public.format__open_round(uuid) IS
  'Internal: the highest round of a phase that is not completed (id, round_number), or no row.';
COMMENT ON FUNCTION public.format_challenge_create(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer, integer) IS
  'Creates a challenge in the phase''s open round under a per-phase lock, enforcing rank_range, max_open, the cooldown and one open challenge per pair. Raises the challenge_* codes (P0001).';
COMMENT ON FUNCTION public.format_challenge_respond(uuid, uuid, uuid, boolean) IS
  'The defender accepts (a scheduled match is inserted into the open round) or declines an open challenge of the given league; a challenge of another league is challenge_not_found. After expires_at it stores and returns status expired.';
COMMENT ON FUNCTION public.format_challenge_cancel(uuid, uuid, uuid) IS
  'The challenger (or an admin, player NULL) withdraws an open challenge of the given league; a challenge of another league is challenge_not_found. After expires_at it stores and returns status expired (which the cooldown counts) instead of cancelled.';
COMMENT ON FUNCTION public.format_challenges_expire(uuid) IS
  'Marks open challenges past expires_at expired, for one league or (NULL) all; returns how many. Called by the cron pass.';

-- ---------------------------------------------------------------------------------------------------------------
-- The recycle bin classifies the new table. These definitions replace 20261105090000's; the inventory test reads the
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
    (109, 'format_challenges',         NULL,                            NULL)
  ) AS v(step, rel, filter, defer)
$$;

REVOKE ALL ON FUNCTION public.league_trash__inventory(), public.league_trash__restore_plan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__inventory(), public.league_trash__restore_plan() TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Clock shift on restore: an open challenge's accept window stood still in the trash like every other running deadline.
-- Replaces 20261026091000's definition.
CREATE OR REPLACE FUNCTION public.league_trash__shift(p_rel text, p_row jsonb, p_shift interval)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r jsonb := p_row;
BEGIN
  IF p_rel = 'draft_pools' AND r ->> 'phase' <> 'complete' THEN
    r := public.league_trash__shift_col(r, 'submission_deadline_at', p_shift);
    r := public.league_trash__shift_col(r, 'token_purchase_closes_at', p_shift);
  ELSIF p_rel = 'draft_slots' AND r ->> 'status' = 'active' THEN
    r := public.league_trash__shift_col(r, 'deadline_at', p_shift);
  ELSIF p_rel = 'matches' AND r ->> 'status' = 'pending_confirmation' THEN
    r := public.league_trash__shift_col(r, 'auto_confirm_at', p_shift);
  ELSIF p_rel = 'match_proposals' AND r ->> 'status' = 'pending' THEN
    r := public.league_trash__shift_col(r, 'expires_at', p_shift);
  ELSIF p_rel = 'rounds' AND r ->> 'status' <> 'completed' THEN
    r := public.league_trash__shift_col(r, 'deadline', p_shift);
  ELSIF p_rel = 'format_challenges' AND r ->> 'status' = 'open' THEN
    r := public.league_trash__shift_col(r, 'expires_at', p_shift);
  END IF;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.league_trash__shift(text, jsonb, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__shift(text, jsonb, interval) TO service_role;

-- The restore shifts the clocks of format_challenges too: the body of 20261026091000's league_trash_restore, unchanged
-- except for the list of tables whose rows go through league_trash__shift.
CREATE OR REPLACE FUNCTION public.league_trash_restore(p_trash_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t public.league_trash; p record; f record; e jsonb; v_rows jsonb; v_colsj jsonb; v_miss text[]; v_sql text; v_parent text; v_lost jsonb := '[]';
  v_n bigint; v_shift interval; v_restored jsonb := '{}'::jsonb; v_warn jsonb := '[]'::jsonb; v_ids uuid[]; v_released bigint;
  v_sid uuid; v_queue uuid[] := '{}'; v_bad jsonb; v_jobs bigint := 0;
BEGIN
  SELECT season_id INTO v_sid FROM public.league_trash WHERE id = p_trash_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_sid::text));              -- same order as the delete: advisory lock, then the rows
  SELECT * INTO t FROM public.league_trash WHERE id = p_trash_id FOR UPDATE;   -- waits for a running expiry / restore
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF t.purge_after <= p_now THEN RAISE EXCEPTION 'LEAGUE_TRASH_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = t.season_id) THEN RAISE EXCEPTION 'LEAGUE_TRASH_SEASON_EXISTS' USING ERRCODE = 'P0001'; END IF;
  IF t.rebuild_pending THEN RAISE EXCEPTION 'LEAGUE_TRASH_REBUILD_PENDING' USING ERRCODE = 'P0001'; END IF;
  v_shift := p_now - t.deleted_at;

  -- Every captured table with rows must be restorable (in the plan, and still a table).
  SELECT array_agg(lt.rel ORDER BY lt.rel) INTO v_miss FROM public.league_trash_tables lt
   WHERE lt.trash_id = p_trash_id AND lt.n > 0
     AND (lt.rel NOT IN (SELECT pl.rel FROM public.league_trash__restore_plan() pl) OR to_regclass('public.' || quote_ident(lt.rel)) IS NULL);
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_PLAN_MISMATCH' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('missing', to_jsonb(v_miss))::text;
  END IF;

  -- Preflight: schema drift (a NOT NULL column without default that the snapshot does not carry) and columns the
  -- snapshot has that the table lost (ignored, reported).
  FOR p IN SELECT DISTINCT pl.rel FROM public.league_trash__restore_plan() pl ORDER BY pl.rel LOOP
    SELECT lt.cols INTO v_colsj FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel AND lt.n > 0;
    IF v_colsj IS NULL THEN CONTINUE; END IF;
    SELECT array_agg(a.attname) INTO v_miss FROM pg_attribute a
     WHERE a.attrelid = ('public.' || quote_ident(p.rel))::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attnotnull AND a.attgenerated = '' AND a.attidentity = ''
       AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
       AND NOT (v_colsj ? a.attname);
    IF v_miss IS NOT NULL THEN
      RAISE EXCEPTION 'LEAGUE_TRASH_SCHEMA_DRIFT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('rel', p.rel, 'columns', v_miss)::text;
    END IF;
    SELECT array_agg(c) INTO v_miss FROM jsonb_array_elements_text(v_colsj) c
     WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = ('public.' || quote_ident(p.rel))::regclass
                          AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '');
    IF v_miss IS NOT NULL THEN
      v_warn := v_warn || jsonb_build_object('code', 'columns_ignored', 'rel', p.rel, 'columns', to_jsonb(v_miss));
    END IF;
  END LOOP;

  FOR p IN SELECT * FROM public.league_trash__restore_plan() ORDER BY step LOOP
    v_rows := NULL; v_colsj := NULL;
    SELECT lt.rows, lt.cols INTO v_rows, v_colsj FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel AND lt.n > 0;
    IF v_rows IS NULL THEN CONTINUE; END IF;

    IF p.rel IN ('draft_pools', 'draft_slots', 'matches', 'match_proposals', 'rounds', 'format_challenges') THEN
      SELECT coalesce(jsonb_agg(public.league_trash__shift(p.rel, x, v_shift)), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;
    IF p.rel = 'games' THEN
      -- A game with battle stats in a non-scheduled match is what the scope rebuild counts: it comes back unmarked
      -- with one pending increment job (inserted below), so the worker rebuilds the aggregates atomically. A replay
      -- hash that a newer game has taken since is released.
      SELECT coalesce(array_agg(DISTINCT (x ->> 'id')::uuid), '{}') INTO v_queue
        FROM jsonb_array_elements(v_rows) x
       WHERE (x ->> 'match_id')::uuid IN (SELECT (m ->> 'id')::uuid FROM public.league_trash_tables lm, jsonb_array_elements(lm.rows) m
                                           WHERE lm.trash_id = p_trash_id AND lm.rel = 'matches' AND m ->> 'status' <> 'scheduled')
         AND (x ->> 'id')::uuid IN (SELECT (b ->> 'game_id')::uuid FROM public.league_trash_tables lb, jsonb_array_elements(lb.rows) b
                                     WHERE lb.trash_id = p_trash_id AND lb.rel = 'battle_stats');
      SELECT count(*) INTO v_released FROM jsonb_array_elements(v_rows) x
       WHERE x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash');
      IF v_released > 0 THEN v_warn := v_warn || jsonb_build_object('code', 'replay_hash_released', 'count', v_released); END IF;
      SELECT coalesce(jsonb_agg(
               CASE WHEN (x ->> 'id')::uuid = ANY (v_queue) THEN jsonb_set(x, '{aggregate_applied_at}', 'null'::jsonb) ELSE x END
               || CASE WHEN x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash')
                       THEN '{"replay_hash": null}'::jsonb ELSE '{}'::jsonb END), '[]'::jsonb)
        INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;

    -- Parents outside the league (players, list versions, rulesets, definitions...): NOT NULL => abort, nullable => NULL + warning.
    FOR f IN SELECT a.attname AS col, pr.relname AS parent, pa.attname AS pcol, NOT a.attnotnull AS nullable
               FROM pg_constraint c
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
               JOIN pg_class pr ON pr.oid = c.confrelid
               JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
              WHERE c.contype = 'f' AND c.conrelid = ('public.' || quote_ident(p.rel))::regclass AND array_length(c.conkey, 1) = 1
                AND pr.relname NOT IN (SELECT pl.rel FROM public.league_trash__restore_plan() pl) LOOP
      EXECUTE format('SELECT array_agg(DISTINCT s.x) FROM (SELECT (e ->> %L)::uuid AS x FROM jsonb_array_elements($1) e) s
                       WHERE s.x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I pr WHERE pr.%I = s.x)', f.col, f.parent, f.pcol)
        USING v_rows INTO v_ids;
      IF v_ids IS NOT NULL THEN
        IF NOT f.nullable THEN
          RAISE EXCEPTION 'LEAGUE_TRASH_PARENT_MISSING' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('rel', p.rel, 'column', f.col, 'parent', f.parent, 'ids', to_jsonb(v_ids[1:20]))::text;
        END IF;
        SELECT jsonb_agg(CASE WHEN (x ->> f.col)::uuid = ANY (v_ids) THEN jsonb_set(x, ARRAY[f.col], 'null'::jsonb) ELSE x END) INTO v_rows FROM jsonb_array_elements(v_rows) x;
        v_warn := v_warn || jsonb_build_object('code', 'parent_missing_nulled', 'rel', p.rel, 'column', f.col, 'count', cardinality(v_ids));
      END IF;
    END LOOP;

    IF p.rel = ANY (public.league_trash__archive_tables()) THEN
      -- The owner-rights insert reads the rows from the trash entry: hand it the adjusted ones (the entry goes away with
      -- this transaction, restored or rolled back).
      UPDATE public.league_trash_tables SET rows = v_rows WHERE trash_id = p_trash_id AND rel = p.rel;
      v_n := public.league_trash__insert_archive_rows(p_trash_id, p.step);
    ELSE
      v_n := public.league_trash__insert_rows(p.rel, p.filter, v_colsj, p.defer, v_rows);
    END IF;
    v_restored := jsonb_set(v_restored, ARRAY[p.rel], to_jsonb(coalesce((v_restored ->> p.rel)::bigint, 0) + v_n));

    IF p.rel = 'games' AND cardinality(v_queue) > 0 THEN
      INSERT INTO public.aggregate_jobs (game_id, tournament_id, season_id, operation, status)
        SELECT g.id, m.tournament_id, tn.season_id, 'increment', 'pending'
          FROM public.games g JOIN public.matches m ON m.id = g.match_id JOIN public.tournaments tn ON tn.id = m.tournament_id
         WHERE g.id = ANY (v_queue);
      GET DIAGNOSTICS v_jobs = ROW_COUNT;
    END IF;
  END LOOP;

  -- Second pass for the cyclic columns (redraft_slots.filled_by_pick_id <-> draft_picks.redraft_slot_id).
  FOR p IN SELECT * FROM public.league_trash__restore_plan() WHERE defer IS NOT NULL LOOP
    FOR v_sql IN SELECT format('UPDATE public.%1$I t SET %2$I = r.%2$I FROM jsonb_populate_recordset(NULL::public.%1$I, $1) r WHERE t.id = r.id AND r.%2$I IS NOT NULL', p.rel, c)
                   FROM unnest(p.defer) c LOOP
      EXECUTE v_sql USING (SELECT lt.rows FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel);
    END LOOP;
  END LOOP;

  -- Nothing may be lost silently: every captured table came back with exactly the captured number of rows.
  SELECT jsonb_agg(jsonb_build_object('rel', lt.rel, 'captured', lt.n, 'restored', coalesce((v_restored ->> lt.rel)::bigint, 0)) ORDER BY lt.rel)
    INTO v_bad FROM public.league_trash_tables lt
   WHERE lt.trash_id = p_trash_id AND lt.n > 0 AND coalesce((v_restored ->> lt.rel)::bigint, 0) <> lt.n;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_PLAN_MISMATCH' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mismatched', v_bad)::text;
  END IF;

  -- Re-link the outside rows that were unlinked (only when the row still exists and its column is still NULL). A
  -- pointer a later migration removed from league_trash__pointers() (no row: v_parent NULL) is not re-linked; it is
  -- reported as a pointer_unknown warning instead of failing the restore.
  FOR e IN SELECT x FROM jsonb_array_elements(t.unlinked) x LOOP
    SELECT pt.parent INTO v_parent FROM public.league_trash__pointers() pt WHERE pt.rel = e ->> 'rel' AND pt.col = e ->> 'col';
    IF v_parent IS NULL THEN
      v_lost := v_lost || jsonb_build_array(e);
      CONTINUE;
    END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I IS NULL AND EXISTS (SELECT 1 FROM public.%I WHERE id = $1)',
                   e ->> 'rel', e ->> 'col', e ->> 'col', v_parent) USING (e ->> 'old')::uuid, (e ->> 'id')::uuid;
  END LOOP;

  v_warn := v_warn || coalesce((
    SELECT jsonb_agg(jsonb_build_object('code', 'pointer_unknown', 'rel', s.rel, 'column', s.col, 'count', s.n) ORDER BY s.rel, s.col)
      FROM (SELECT x ->> 'rel' AS rel, x ->> 'col' AS col, count(*) AS n FROM jsonb_array_elements(v_lost) x GROUP BY 1, 2) s), '[]');

  INSERT INTO public.league_trash_restore_rebuilds (season_id, trash_id, season_name, restored_at, phase_ids, player_ids)
  VALUES (t.season_id, t.id, t.season_name, p_now, t.phase_ids, t.player_ids)
  ON CONFLICT (season_id) DO UPDATE
    SET trash_id = EXCLUDED.trash_id, season_name = EXCLUDED.season_name, restored_at = EXCLUDED.restored_at,
        phase_ids = EXCLUDED.phase_ids, player_ids = EXCLUDED.player_ids;
  DELETE FROM public.league_trash WHERE id = p_trash_id;           -- cascades the captured rows and the junction rows
  RETURN jsonb_build_object(
    'season_id', t.season_id, 'season_name', t.season_name, 'restored', v_restored,
    'shift_seconds', extract(epoch FROM v_shift), 'player_ids', to_jsonb(t.player_ids), 'phase_ids', to_jsonb(t.phase_ids),
    'paused_pools', t.frozen_pools,   -- the drafts the delete paused; one an admin had paused before stays out of it
    'queued_aggregate_jobs', v_jobs, 'schema_version_at_delete', t.schema_version, 'warnings', v_warn);
END $$;

REVOKE ALL ON FUNCTION public.league_trash_restore(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash_restore(uuid, timestamptz) TO service_role;

COMMIT;
