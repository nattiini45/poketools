-- Match outcomes (Format Studio engine, M1): HOW a match ended, next to who won it (matches.winner_id).
--
--   match_outcomes          One row per decided or unresolvable match:
--                             kind      played | forfeit | no_show | unresolved
--                             p1_faints / p2_faints  the Pokémon of player 1 / player 2 that fainted, summed over the
--                                       match's games (every battle_stats row with was_koed: recoil, hazards, Destiny
--                                       Bond and self-KOs all count). NULL when unknown (an admin result without games)
--                                       and always NULL for forfeit / no_show / unresolved.
--                             source    replay | manual | admin
--                             reason    required for an admin row; the replay engine's code for an unresolved one.
--                           Standings read faints from here, never from battle_stats at read time. An unresolved row
--                           belongs to a disputed match and is never scored.
--   match_outcome_record()  The only writer. A finalize write (source replay / manual) never replaces an admin row; an
--                           admin write (p_force) always does, except a staged one (p_open_only) for a match that is
--                           already completed. Returns 'written' or 'kept'. p_open_only is a check made inside this
--                           one call: it is NOT atomic with the caller's later status update (a separate request), so
--                           a caller whose status update then loses must take its own staged row back itself.
--
-- League recycle bin: match_outcomes is an owned table (match_id IN {matches}), restored after matches; set_by points at
-- players, which the 'players' junction already protects. Grants: service_role only.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.match_outcomes (
  match_id  uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  kind      text NOT NULL,
  p1_faints smallint,
  p2_faints smallint,
  source    text NOT NULL,
  reason    text,
  set_by    uuid REFERENCES public.players(id) ON DELETE SET NULL,
  set_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_outcomes_kind_check CHECK (kind IN ('played', 'forfeit', 'no_show', 'unresolved')),
  CONSTRAINT match_outcomes_source_check CHECK (source IN ('replay', 'manual', 'admin')),
  CONSTRAINT match_outcomes_faints_range CHECK (
    (p1_faints IS NULL OR p1_faints BETWEEN 0 AND 90) AND (p2_faints IS NULL OR p2_faints BETWEEN 0 AND 90)
  ),
  CONSTRAINT match_outcomes_faints_played_only CHECK (kind = 'played' OR (p1_faints IS NULL AND p2_faints IS NULL)),
  CONSTRAINT match_outcomes_reason_length CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT match_outcomes_admin_reason CHECK (source <> 'admin' OR reason IS NOT NULL)
);
CREATE INDEX idx_match_outcomes_set_by ON public.match_outcomes (set_by) WHERE set_by IS NOT NULL;
ALTER TABLE public.match_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.match_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.match_outcomes TO service_role;
COMMENT ON TABLE public.match_outcomes IS
  'How a match ended (played / forfeit / no_show / unresolved) with the faint tally per side. Written only through match_outcome_record(). Service-role only. No RLS policies by design.';

-- An earlier revision of this file defined the 8-argument form; CREATE OR REPLACE with a longer argument list would leave
-- it behind as a second overload (PostgREST: PGRST203 on every call that omits p_open_only), so drop it first.
DROP FUNCTION IF EXISTS public.match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid);

CREATE OR REPLACE FUNCTION public.match_outcome_record(
  p_match_id  uuid,
  p_kind      text,
  p_source    text,
  p_force     boolean,
  p_p1_faints smallint DEFAULT NULL,
  p_p2_faints smallint DEFAULT NULL,
  p_reason    text DEFAULT NULL,
  p_set_by    uuid DEFAULT NULL,
  p_open_only boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  -- p_open_only (an admin result staged BEFORE the status flip): never write for a match that is already completed,
  -- the completing request owns the row. The share lock makes the check-then-write below atomic against a completion
  -- that is mid-transaction right now (its update waits for this call, or has committed and the row no longer
  -- qualifies). It is released when this call returns, so it does NOT make the staged row atomic with the caller's
  -- status update, which is a separate request: a completion that commits in between (a player's confirmation) leaves
  -- the staged row behind, and a finalize write never replaces an admin row. The caller therefore takes its staged row
  -- back itself when its status update loses (keyed by set_at, see stageAdminOutcome).
  IF p_open_only THEN
    PERFORM 1 FROM public.matches m WHERE m.id = p_match_id AND m.status <> 'completed' FOR SHARE;
    IF NOT FOUND THEN RETURN 'kept'; END IF;
  END IF;

  IF p_force THEN
    INSERT INTO public.match_outcomes AS o (match_id, kind, p1_faints, p2_faints, source, reason, set_by, set_at)
    VALUES (p_match_id, p_kind, p_p1_faints, p_p2_faints, p_source, p_reason, p_set_by, now())
    ON CONFLICT (match_id) DO UPDATE
      SET kind = EXCLUDED.kind, p1_faints = EXCLUDED.p1_faints, p2_faints = EXCLUDED.p2_faints,
          source = EXCLUDED.source, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
    RETURN 'written';
  END IF;

  INSERT INTO public.match_outcomes AS o (match_id, kind, p1_faints, p2_faints, source, reason, set_by, set_at)
  VALUES (p_match_id, p_kind, p_p1_faints, p_p2_faints, p_source, p_reason, p_set_by, now())
  ON CONFLICT (match_id) DO UPDATE
    SET kind = EXCLUDED.kind, p1_faints = EXCLUDED.p1_faints, p2_faints = EXCLUDED.p2_faints,
        source = EXCLUDED.source, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at
    WHERE o.source <> 'admin';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN CASE WHEN v_rows > 0 THEN 'written' ELSE 'kept' END;
END $$;
REVOKE ALL ON FUNCTION public.match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean) TO service_role;
COMMENT ON FUNCTION public.match_outcome_record(uuid, text, text, boolean, smallint, smallint, text, uuid, boolean) IS
  'The only writer of match_outcomes. p_force=false (finalize, replay engine) never replaces an admin row; p_force=true (admin) always writes; p_open_only=true writes only while the match is not completed (checked inside this call, not atomic with a later status update). Returns written | kept.';

-- ---------------------------------------------------------------------------------------------------------------
-- The recycle bin classifies match_outcomes. These definitions replace 20261026091000's; the inventory test reads the
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
    (99, 'wiki_note_reports',         NULL,                            NULL)
  ) AS v(step, rel, filter, defer)
$$;

REVOKE ALL ON FUNCTION public.league_trash__inventory(), public.league_trash__restore_plan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__inventory(), public.league_trash__restore_plan() TO service_role;

COMMIT;
