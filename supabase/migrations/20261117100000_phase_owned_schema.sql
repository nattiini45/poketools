BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TYPE public.phase_status AS ENUM ('upcoming', 'active', 'completed');

CREATE TABLE public.league_phases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  season_id uuid NOT NULL,
  bracket_type public.bracket_type NOT NULL,
  ruleset_id uuid NOT NULL,
  best_of_default integer DEFAULT 1 NOT NULL,
  is_doubles boolean DEFAULT false NOT NULL,
  team_visibility public.team_visibility DEFAULT 'hidden_until_match'::public.team_visibility NOT NULL,
  status public.phase_status DEFAULT 'upcoming'::public.phase_status NOT NULL,
  current_round integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  stage_order integer DEFAULT 0 NOT NULL,
  advancement_rule jsonb,
  bo_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
  archived boolean DEFAULT false NOT NULL,
  legacy boolean DEFAULT false NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  enrollment_source jsonb NULL,
  bracket_reset_enabled boolean NOT NULL DEFAULT true,
  format_stage_key text,
  stage_spec jsonb,
  third_place_enabled boolean NOT NULL DEFAULT false,
  format_group integer NOT NULL DEFAULT 0,
  enrollment_source_phase_id uuid GENERATED ALWAYS AS ((enrollment_source ->> 'source_phase_id')::uuid) STORED,
  CONSTRAINT league_phases_pkey PRIMARY KEY (id),
  CONSTRAINT league_phases_format_stage_key_check CHECK (format_stage_key IS NULL OR format_stage_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT league_phases_format_stage_season_check CHECK (format_stage_key IS NULL OR season_id IS NOT NULL),
  CONSTRAINT league_phases_stage_spec_check CHECK (stage_spec IS NULL OR (jsonb_typeof(stage_spec) = 'object' AND octet_length(stage_spec::text) <= 262144)),
  CONSTRAINT league_phases_format_group_check CHECK (format_group >= 0 AND format_group <= 256),
  CONSTRAINT league_phases_season_id_id_key UNIQUE (season_id, id)
);

CREATE TABLE public.phase_participants (
  phase_id uuid NOT NULL,
  player_id uuid NOT NULL,
  seed integer,
  starting_bracket text NOT NULL DEFAULT 'winners',
  CONSTRAINT phase_participants_pkey PRIMARY KEY (phase_id, player_id),
  CONSTRAINT phase_participants_starting_bracket_check CHECK (starting_bracket IN ('winners','losers'))
);

CREATE TABLE public.phase_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phase_id uuid NOT NULL,
  name text NOT NULL,
  group_number integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  season_group_id uuid,
  season_id uuid NOT NULL,
  CONSTRAINT phase_groups_pkey PRIMARY KEY (id),
  CONSTRAINT phase_groups_phase_id_id_key UNIQUE (phase_id, id)
);

CREATE TABLE public.phase_group_members (
  group_id uuid NOT NULL,
  player_id uuid NOT NULL,
  seed integer DEFAULT 0 NOT NULL,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_group_members_pkey PRIMARY KEY (group_id, player_id),
  CONSTRAINT phase_group_members_phase_player_key UNIQUE (phase_id, player_id)
);

CREATE TABLE public.phase_rounds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  phase_id uuid NOT NULL,
  round_number integer NOT NULL,
  best_of integer NOT NULL,
  status public.round_status DEFAULT 'pending'::public.round_status NOT NULL,
  pairings_generated boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deadline timestamp with time zone,
  bracket_side text NULL,
  bye_player_ids uuid[] NOT NULL DEFAULT '{}',
  CONSTRAINT phase_rounds_pkey PRIMARY KEY (id),
  CONSTRAINT phase_rounds_phase_round_number_key UNIQUE (phase_id, round_number),
  CONSTRAINT phase_rounds_bracket_side_check CHECK (bracket_side IS NULL OR bracket_side IN ('winners', 'losers', 'grand_finals')),
  CONSTRAINT phase_rounds_phase_id_id_key UNIQUE (phase_id, id)
);

CREATE TABLE public.phase_matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  round_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  player_1_id uuid NOT NULL,
  player_2_id uuid NOT NULL,
  winner_id uuid,
  status public.match_status DEFAULT 'scheduled'::public.match_status NOT NULL,
  submitter_id uuid,
  date_played timestamp with time zone,
  notes text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  social_image_url text,
  scheduled_at timestamp with time zone,
  auto_confirm_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  bracket_side text NULL,
  bracket_pos integer NULL,
  finalized_at timestamptz,
  CONSTRAINT phase_matches_pkey PRIMARY KEY (id),
  CONSTRAINT phase_matches_bracket_side_check CHECK (bracket_side IS NULL OR bracket_side IN ('winners', 'losers', 'grand_finals')),
  CONSTRAINT phase_matches_phase_id_id_key UNIQUE (phase_id, id)
);

CREATE TABLE public.phase_games (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  match_id uuid NOT NULL,
  game_number integer NOT NULL,
  winner_id uuid,
  replay_url text DEFAULT ''::text NOT NULL,
  source public.game_source DEFAULT 'manual'::public.game_source NOT NULL,
  parsed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  aggregate_applied_at timestamp with time zone,
  stats_locked boolean DEFAULT false NOT NULL,
  exclude_all_time boolean DEFAULT false NOT NULL,
  edit_lease_token uuid,
  edit_lease_until timestamptz,
  replay_hash text,
  evolution_applied_at timestamptz,
  evolution_credits jsonb,
  CONSTRAINT phase_games_pkey PRIMARY KEY (id),
  CONSTRAINT phase_games_match_id_game_number_key UNIQUE (match_id, game_number),
  CONSTRAINT phase_games_edit_lease_pair_check CHECK ((edit_lease_token IS NULL) = (edit_lease_until IS NULL)),
  CONSTRAINT phase_games_replay_hash_format_check CHECK (replay_hash IS NULL OR replay_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT phase_games_evolution_credits_marker_check CHECK (evolution_credits IS NULL
         OR (evolution_applied_at IS NOT NULL AND jsonb_typeof(evolution_credits) = 'array')),
  CONSTRAINT phase_games_match_id_id_key UNIQUE (match_id, id)
);

CREATE TABLE public.phase_battle_stats (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL,
  player_id uuid NOT NULL,
  pokemon_name text NOT NULL,
  was_brought boolean DEFAULT true NOT NULL,
  was_lead boolean DEFAULT false NOT NULL,
  kos_dealt integer DEFAULT 0 NOT NULL,
  was_koed boolean DEFAULT false NOT NULL,
  moves_used jsonb DEFAULT '[]'::jsonb NOT NULL,
  turns_active integer DEFAULT 0 NOT NULL,
  match_won boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT phase_battle_stats_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phase_id uuid NOT NULL,
  round_id uuid,
  report_type text NOT NULL,
  model_id text NOT NULL,
  content jsonb DEFAULT '{}'::jsonb NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  generation_time_ms integer,
  status text DEFAULT 'pending'::text NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT phase_reports_report_type_check CHECK ((report_type = ANY (ARRAY['round_recap'::text, 'round_forecast'::text]))),
  CONSTRAINT phase_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text]))),
  CONSTRAINT phase_reports_pkey PRIMARY KEY (id),
  CONSTRAINT phase_reports_phase_id_round_id_report_type_key UNIQUE (phase_id, round_id, report_type)
);

CREATE TABLE public.phase_match_outcomes (
  match_id uuid,
  kind text NOT NULL,
  p1_faints smallint,
  p2_faints smallint,
  source text NOT NULL,
  reason text,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phase_match_outcomes_kind_check CHECK (kind IN ('played', 'forfeit', 'no_show', 'unresolved')),
  CONSTRAINT phase_match_outcomes_source_check CHECK (source IN ('replay', 'manual', 'admin')),
  CONSTRAINT phase_match_outcomes_faints_range CHECK (
    (p1_faints IS NULL OR p1_faints BETWEEN 0 AND 90) AND (p2_faints IS NULL OR p2_faints BETWEEN 0 AND 90)
  ),
  CONSTRAINT phase_match_outcomes_faints_played_only CHECK (kind = 'played' OR (p1_faints IS NULL AND p2_faints IS NULL)),
  CONSTRAINT phase_match_outcomes_reason_length CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT phase_match_outcomes_admin_reason CHECK (source <> 'admin' OR reason IS NOT NULL),
  CONSTRAINT phase_match_outcomes_pkey PRIMARY KEY (match_id)
);

CREATE TABLE public.phase_match_proposals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  match_id uuid NOT NULL,
  proposer_id uuid NOT NULL,
  responder_id uuid NOT NULL,
  proposed_at timestamp with time zone NOT NULL,
  message text DEFAULT ''::text NOT NULL,
  status public.match_proposal_status DEFAULT 'pending'::public.match_proposal_status NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  responded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT phase_match_proposals_distinct_players CHECK ((proposer_id <> responder_id)),
  CONSTRAINT phase_match_proposals_message_length CHECK ((char_length(message) <= 1000)),
  CONSTRAINT phase_match_proposals_response_status CHECK ((((status = ANY (ARRAY['accepted'::public.match_proposal_status, 'rejected'::public.match_proposal_status, 'expired'::public.match_proposal_status, 'cancelled'::public.match_proposal_status])) AND (responded_at IS NOT NULL)) OR ((status = 'pending'::public.match_proposal_status) AND (responded_at IS NULL)))),
  CONSTRAINT phase_match_proposals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_match_analyses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  match_id uuid NOT NULL,
  model_id text NOT NULL,
  analysis jsonb DEFAULT '{}'::jsonb NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  generation_time_ms integer,
  status text DEFAULT 'pending'::text NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT phase_match_analyses_match_id_key UNIQUE (match_id),
  CONSTRAINT phase_match_analyses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_match_prep_analyses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  match_id uuid NOT NULL,
  player_id uuid NOT NULL,
  model_id text NOT NULL,
  analysis jsonb DEFAULT '{}'::jsonb NOT NULL,
  has_user_team boolean DEFAULT false NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  generation_time_ms integer,
  status text DEFAULT 'pending'::text NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT phase_match_prep_analyses_match_id_player_id_key UNIQUE (match_id, player_id),
  CONSTRAINT phase_match_prep_analyses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_match_prep_teams (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  match_id uuid NOT NULL,
  player_id uuid NOT NULL,
  pokemon jsonb DEFAULT '[]'::jsonb NOT NULL,
  import_source public.team_import_source DEFAULT 'manual'::public.team_import_source NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT phase_match_prep_teams_match_id_player_id_key UNIQUE (match_id, player_id),
  CONSTRAINT phase_match_prep_teams_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_match_evolution_snapshots (
  id uuid  DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  player_id uuid NOT NULL,
  tracker_id uuid,
  base_pokemon text NOT NULL,
  species_at_match text NOT NULL,
  stage_at_match smallint NOT NULL,
  progress_before int NOT NULL DEFAULT 0,
  progress_after int NOT NULL DEFAULT 0,
  real_kos smallint NOT NULL DEFAULT 0,
  draft_tokens_delta smallint NOT NULL DEFAULT 0,
  kill_tokens_delta smallint NOT NULL DEFAULT 0,
  cosmo_points_delta smallint NOT NULL DEFAULT 0,
  evolution_triggered boolean NOT NULL DEFAULT false,
  suspension_triggered boolean NOT NULL DEFAULT false,
  brought boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  line_id text,
  CONSTRAINT phase_match_evolution_snapshots_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_epb_animation_views (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  player_id uuid NOT NULL,
  match_id uuid NOT NULL,
  viewed_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT phase_epb_animation_views_player_match_key UNIQUE (player_id, match_id),
  CONSTRAINT phase_epb_animation_views_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_broadcast_moments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid,
  match_id uuid NOT NULL,
  turn_number integer,
  moment_type text NOT NULL,
  description text,
  pokemon_name text,
  timestamp timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  CONSTRAINT phase_broadcast_moments_moment_type_check CHECK ((moment_type = ANY (ARRAY['turning_point'::text, 'big_ko'::text, 'misplay'::text, 'clutch'::text, 'highlight'::text]))),
  CONSTRAINT phase_broadcast_moments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_teams (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  player_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  season_id uuid,
  pokemon jsonb DEFAULT '[]'::jsonb NOT NULL,
  import_source public.team_import_source DEFAULT 'manual'::public.team_import_source NOT NULL,
  locked boolean DEFAULT false NOT NULL,
  draft_pool_id uuid,
  is_draft_team boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  match_id uuid,
  share_token uuid,
  share_enabled_at timestamp with time zone,
  library_published_at timestamp with time zone,
  library_title text,
  library_description text,
  library_tags text[],
  forked_from_team_id uuid,
  name text NOT NULL DEFAULT '',
  forked_from_phase_team_id uuid,
  CONSTRAINT phase_teams_pkey PRIMARY KEY (id),
  CONSTRAINT phase_teams_share_token_key UNIQUE (share_token),
  CONSTRAINT phase_teams_fork_source_check CHECK (num_nonnulls(forked_from_team_id, forked_from_phase_team_id) <= 1)
);

CREATE TABLE public.phase_cast_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  match_id uuid,
  phase_id uuid NOT NULL,
  season_id uuid,
  name text DEFAULT 'Untitled Session'::text NOT NULL,
  mode text DEFAULT 'cast'::text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  player1_id uuid,
  player1_name text,
  player1_avatar_url text,
  player2_id uuid,
  player2_name text,
  player2_avatar_url text,
  player1_team jsonb DEFAULT '[]'::jsonb NOT NULL,
  player2_team jsonb DEFAULT '[]'::jsonb NOT NULL,
  tracker_state jsonb,
  overlay_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  format text DEFAULT 'gen9ou'::text NOT NULL,
  generation integer DEFAULT 9 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  caster_notes jsonb DEFAULT '{}'::jsonb,
  realtime_key uuid DEFAULT gen_random_uuid() NOT NULL,
  CONSTRAINT phase_cast_sessions_mode_check CHECK ((mode = ANY (ARRAY['cast'::text, 'solo'::text, 'replaycast'::text]))),
  CONSTRAINT phase_cast_sessions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'live'::text, 'archived'::text]))),
  CONSTRAINT phase_cast_sessions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_admins (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  player_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_admins_pkey PRIMARY KEY (id),
  CONSTRAINT phase_admins_phase_player_key UNIQUE (phase_id, player_id)
);

CREATE TABLE public.phase_discord_webhooks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  webhook_url text NOT NULL,
  label text DEFAULT 'General'::text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  event_filter text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  format_options jsonb DEFAULT '{"spoiler_results": true, "show_replay_link": true, "attach_match_card": true, "ping_next_drafter": false, "show_pokemon_details": true}'::jsonb NOT NULL,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_discord_webhooks_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_social_integrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  label text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  event_filter text[] DEFAULT '{}'::text[] NOT NULL,
  post_options jsonb DEFAULT '{"include_hashtags": false, "include_replay_link": true}'::jsonb NOT NULL,
  credential_hint text,
  credentials_encrypted text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_social_integrations_provider_check CHECK ((provider = ANY (ARRAY['x'::text, 'threads'::text, 'bluesky'::text]))),
  CONSTRAINT phase_social_integrations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_wiki_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity_type text NOT NULL,
  entity_name text NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL,
  approved boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  rejected_by uuid,
  rejected_at timestamp with time zone,
  rejection_reason text,
  moderation_flags text[] DEFAULT '{}'::text[] NOT NULL,
  resubmission_blocked_at timestamptz,
  resubmission_blocked_by uuid,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_wiki_notes_entity_type_check CHECK ((entity_type = ANY (ARRAY['pokemon'::text, 'move'::text, 'item'::text, 'ability'::text, 'tera'::text]))),
  CONSTRAINT phase_wiki_notes_pkey PRIMARY KEY (id),
  CONSTRAINT phase_wiki_notes_resubmission_block_rejected_check CHECK (resubmission_blocked_at IS NULL OR (approved = false AND rejected_at IS NOT NULL))
);

CREATE TABLE public.phase_wiki_note_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  note_id uuid NOT NULL,
  reporter_id uuid NOT NULL,
  reason text NOT NULL,
  details text,
  status text DEFAULT 'open'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT phase_wiki_note_reports_details_check CHECK (((details IS NULL) OR (char_length(details) <= 500))),
  CONSTRAINT phase_wiki_note_reports_reason_check CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 80))),
  CONSTRAINT phase_wiki_note_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text]))),
  CONSTRAINT phase_wiki_note_reports_note_id_reporter_id_key UNIQUE (note_id, reporter_id),
  CONSTRAINT phase_wiki_note_reports_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_aggregates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pokemon_name text NOT NULL,
  total_appearances integer DEFAULT 0 NOT NULL,
  total_brought integer DEFAULT 0 NOT NULL,
  total_led integer DEFAULT 0 NOT NULL,
  total_kos_dealt integer DEFAULT 0 NOT NULL,
  total_koed integer DEFAULT 0 NOT NULL,
  total_wins integer DEFAULT 0 NOT NULL,
  total_games integer DEFAULT 0 NOT NULL,
  move_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_aggregates_pkey PRIMARY KEY (id),
  CONSTRAINT phase_aggregates_species_key UNIQUE (phase_id, pokemon_name)
);

CREATE TABLE public.phase_player_aggregates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  player_id uuid NOT NULL,
  pokemon_name text NOT NULL,
  total_appearances integer DEFAULT 0 NOT NULL,
  total_brought integer DEFAULT 0 NOT NULL,
  total_led integer DEFAULT 0 NOT NULL,
  total_kos_dealt integer DEFAULT 0 NOT NULL,
  total_koed integer DEFAULT 0 NOT NULL,
  total_wins integer DEFAULT 0 NOT NULL,
  total_games integer DEFAULT 0 NOT NULL,
  move_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  phase_id uuid NOT NULL,
  CONSTRAINT phase_player_aggregates_pkey PRIMARY KEY (id),
  CONSTRAINT phase_player_aggregates_species_key UNIQUE (phase_id, player_id, pokemon_name)
);

CREATE TABLE public.phase_aggregate_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  season_id uuid NOT NULL,
  operation text DEFAULT 'increment'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 3 NOT NULL,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  match_id uuid NOT NULL,
  CONSTRAINT phase_aggregate_jobs_operation_check CHECK ((operation = ANY (ARRAY['increment'::text, 'decrement'::text]))),
  CONSTRAINT phase_aggregate_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
  CONSTRAINT phase_aggregate_jobs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.phase_rating_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  player_id uuid NOT NULL,
  match_id uuid NOT NULL,
  rating_before numeric(7,2) NOT NULL,
  rating_after numeric(7,2) NOT NULL,
  rd_before numeric(7,2) NOT NULL,
  rd_after numeric(7,2) NOT NULL,
  opponent_id uuid NOT NULL,
  opponent_rating numeric(7,2) NOT NULL,
  result text NOT NULL,
  rating_change numeric(7,2) GENERATED ALWAYS AS ((rating_after - rating_before)) STORED,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT phase_rating_history_result_check CHECK ((result = ANY (ARRAY['win'::text, 'loss'::text, 'draw'::text]))),
  CONSTRAINT phase_rating_history_pkey PRIMARY KEY (id),
  CONSTRAINT phase_rating_history_player_match_unique UNIQUE (player_id, match_id)
);

ALTER TABLE public.league_phases ADD CONSTRAINT league_phases_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

ALTER TABLE public.league_phases ADD CONSTRAINT league_phases_ruleset_id_fkey FOREIGN KEY (ruleset_id) REFERENCES public.ruleset_definition_versions(id);

ALTER TABLE public.league_phases ADD CONSTRAINT league_phases_enrollment_source_fkey FOREIGN KEY (season_id, enrollment_source_phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE RESTRICT;

CREATE INDEX phase_idx_league_phases_season_stage ON public.league_phases USING btree (season_id, stage_order);

CREATE INDEX phase_idx_league_phases_ruleset_id ON public.league_phases (ruleset_id);

CREATE UNIQUE INDEX phase_uq_league_phases_season_format_stage ON public.league_phases (season_id, format_stage_key, format_group)
  WHERE format_stage_key IS NOT NULL;

ALTER TABLE public.league_phases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.league_phases FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.league_phases TO service_role;

ALTER TABLE public.phase_participants ADD CONSTRAINT phase_participants_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_participants ADD CONSTRAINT phase_participants_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX phase_participants_seed_unique ON public.phase_participants USING btree (phase_id, seed) WHERE (seed IS NOT NULL);

CREATE INDEX idx_phase_participants_player_id ON public.phase_participants (player_id);

ALTER TABLE public.phase_participants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_participants FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_participants TO service_role;

ALTER TABLE public.phase_groups ADD CONSTRAINT phase_groups_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

ALTER TABLE public.phase_groups ADD CONSTRAINT phase_groups_season_group_fkey FOREIGN KEY (season_group_id, season_id) REFERENCES public.season_groups(id, season_id) ON DELETE RESTRICT;

ALTER TABLE public.phase_groups ADD CONSTRAINT phase_groups_phase_season_fkey FOREIGN KEY (season_id, phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE CASCADE;

CREATE INDEX idx_phase_groups_phase ON public.phase_groups USING btree (phase_id);

CREATE UNIQUE INDEX uq_phase_groups_season_group ON public.phase_groups (phase_id, season_group_id)
  WHERE season_group_id IS NOT NULL;

CREATE INDEX idx_phase_groups_season_group ON public.phase_groups (season_group_id)
  WHERE season_group_id IS NOT NULL;

CREATE UNIQUE INDEX uq_phase_groups_phase_group_number ON public.phase_groups (phase_id, group_number);

CREATE INDEX phase_groups_season_group_id_fk_idx ON public.phase_groups (season_group_id, season_id);

CREATE INDEX phase_groups_season_id_fk_idx ON public.phase_groups (season_id, phase_id);

ALTER TABLE public.phase_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_groups FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_groups TO service_role;

ALTER TABLE public.phase_group_members ADD CONSTRAINT phase_group_members_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_group_members ADD CONSTRAINT phase_group_members_group_fkey FOREIGN KEY (phase_id, group_id) REFERENCES public.phase_groups(phase_id, id) ON DELETE CASCADE;

ALTER TABLE public.phase_group_members ADD CONSTRAINT phase_group_members_participant_fkey FOREIGN KEY (phase_id, player_id) REFERENCES public.phase_participants(phase_id, player_id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX idx_phase_group_members_player_id ON public.phase_group_members (player_id);

ALTER TABLE public.phase_group_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_group_members FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_group_members TO service_role;

ALTER TABLE public.phase_rounds ADD CONSTRAINT phase_rounds_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_rounds_deadline ON public.phase_rounds USING btree (deadline) WHERE (deadline IS NOT NULL);

CREATE INDEX idx_phase_rounds_phase_id ON public.phase_rounds (phase_id);

ALTER TABLE public.phase_rounds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_rounds FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_rounds TO service_role;

ALTER TABLE public.phase_matches ADD CONSTRAINT phase_matches_player_1_id_fkey FOREIGN KEY (player_1_id) REFERENCES public.players(id);

ALTER TABLE public.phase_matches ADD CONSTRAINT phase_matches_player_2_id_fkey FOREIGN KEY (player_2_id) REFERENCES public.players(id);

ALTER TABLE public.phase_matches ADD CONSTRAINT phase_matches_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

ALTER TABLE public.phase_matches ADD CONSTRAINT phase_matches_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_matches ADD CONSTRAINT phase_matches_submitter_id_fkey FOREIGN KEY (submitter_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_matches ADD CONSTRAINT phase_matches_phase_round_fkey FOREIGN KEY (phase_id, round_id) REFERENCES public.phase_rounds(phase_id, id) ON DELETE CASCADE;

CREATE INDEX idx_phase_matches_auto_confirm_at ON public.phase_matches USING btree (auto_confirm_at) WHERE (auto_confirm_at IS NOT NULL);

CREATE INDEX idx_phase_matches_round ON public.phase_matches USING btree (round_id);

CREATE INDEX idx_phase_matches_scheduled_at ON public.phase_matches USING btree (scheduled_at) WHERE (scheduled_at IS NOT NULL);

CREATE INDEX idx_phase_matches_status ON public.phase_matches USING btree (status);

CREATE INDEX idx_phase_matches_phase ON public.phase_matches USING btree (phase_id);

CREATE INDEX idx_phase_matches_player_1_id ON public.phase_matches (player_1_id);

CREATE INDEX idx_phase_matches_player_2_id ON public.phase_matches (player_2_id);

CREATE INDEX idx_phase_matches_submitter_id ON public.phase_matches (submitter_id);

CREATE INDEX idx_phase_matches_winner_id ON public.phase_matches (winner_id);

CREATE UNIQUE INDEX phase_matches_round_side_pos_unique ON public.phase_matches (round_id, bracket_side, bracket_pos)
  WHERE bracket_pos IS NOT NULL;

CREATE INDEX phase_matches_completed_unfinalized_idx ON public.phase_matches (updated_at)
  WHERE status = 'completed' AND finalized_at IS NULL;

ALTER TABLE public.phase_matches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_matches FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_matches TO service_role;

ALTER TABLE public.phase_games ADD CONSTRAINT phase_games_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_games ADD CONSTRAINT phase_games_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.players(id) ON DELETE SET NULL;

CREATE INDEX idx_phase_games_aggregate_applied_at ON public.phase_games USING btree (aggregate_applied_at) WHERE (aggregate_applied_at IS NOT NULL);

CREATE INDEX idx_phase_games_match ON public.phase_games USING btree (match_id);

CREATE INDEX idx_phase_games_stats_locked ON public.phase_games USING btree (stats_locked) WHERE (stats_locked = true);

CREATE INDEX idx_phase_games_winner_id ON public.phase_games (winner_id);

CREATE UNIQUE INDEX phase_games_replay_hash_key ON public.phase_games (replay_hash)
  WHERE replay_hash IS NOT NULL;

ALTER TABLE public.phase_games ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_games FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_games TO service_role;

ALTER TABLE public.phase_battle_stats ADD CONSTRAINT phase_battle_stats_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.phase_games(id) ON DELETE CASCADE;

ALTER TABLE public.phase_battle_stats ADD CONSTRAINT phase_battle_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_battle_stats_game ON public.phase_battle_stats USING btree (game_id);

CREATE INDEX idx_phase_battle_stats_player ON public.phase_battle_stats USING btree (player_id);

CREATE UNIQUE INDEX phase_battle_stats_game_player_pokemon_key ON public.phase_battle_stats (game_id, player_id,
    lower(regexp_replace(pokemon_name,
      '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
      '', 'g')));

ALTER TABLE public.phase_battle_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_battle_stats FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_battle_stats TO service_role;

ALTER TABLE public.phase_reports ADD CONSTRAINT phase_reports_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

ALTER TABLE public.phase_reports ADD CONSTRAINT phase_reports_phase_round_fkey FOREIGN KEY (phase_id, round_id) REFERENCES public.phase_rounds(phase_id, id) ON DELETE CASCADE;

CREATE INDEX idx_phase_reports_status ON public.phase_reports USING btree (status);

CREATE INDEX idx_phase_reports_phase ON public.phase_reports USING btree (phase_id);

CREATE INDEX idx_phase_reports_round_id ON public.phase_reports (round_id);

ALTER TABLE public.phase_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_reports FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_reports TO service_role;

ALTER TABLE public.phase_match_outcomes ADD CONSTRAINT phase_match_outcomes_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_match_outcomes ADD CONSTRAINT phase_match_outcomes_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.players(id) ON DELETE SET NULL;

CREATE INDEX idx_phase_match_outcomes_set_by ON public.phase_match_outcomes (set_by) WHERE set_by IS NOT NULL;

ALTER TABLE public.phase_match_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_match_outcomes FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_match_outcomes TO service_role;

ALTER TABLE public.phase_match_proposals ADD CONSTRAINT phase_match_proposals_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_match_proposals ADD CONSTRAINT phase_match_proposals_proposer_id_fkey FOREIGN KEY (proposer_id) REFERENCES public.players(id);

ALTER TABLE public.phase_match_proposals ADD CONSTRAINT phase_match_proposals_responder_id_fkey FOREIGN KEY (responder_id) REFERENCES public.players(id);

CREATE INDEX idx_phase_match_proposals_expired_pending ON public.phase_match_proposals USING btree (expires_at) WHERE (status = 'pending'::public.match_proposal_status);

CREATE INDEX idx_phase_match_proposals_match ON public.phase_match_proposals USING btree (match_id);

CREATE UNIQUE INDEX idx_phase_match_proposals_pending_proposer ON public.phase_match_proposals USING btree (match_id, proposer_id) WHERE (status = 'pending'::public.match_proposal_status);

CREATE UNIQUE INDEX idx_phase_match_proposals_pending_responder ON public.phase_match_proposals USING btree (match_id, responder_id) WHERE (status = 'pending'::public.match_proposal_status);

CREATE INDEX idx_phase_match_proposals_responder_pending ON public.phase_match_proposals USING btree (responder_id, expires_at) WHERE (status = 'pending'::public.match_proposal_status);

CREATE INDEX idx_phase_match_proposals_proposer_id ON public.phase_match_proposals (proposer_id);

CREATE INDEX phase_match_proposals_responder_id_fk_idx ON public.phase_match_proposals (responder_id);

ALTER TABLE public.phase_match_proposals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_match_proposals FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_match_proposals TO service_role;

ALTER TABLE public.phase_match_analyses ADD CONSTRAINT phase_match_analyses_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_match_analyses_match_id ON public.phase_match_analyses USING btree (match_id);

CREATE INDEX idx_phase_match_analyses_status ON public.phase_match_analyses USING btree (status);

ALTER TABLE public.phase_match_analyses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_match_analyses FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_match_analyses TO service_role;

ALTER TABLE public.phase_match_prep_analyses ADD CONSTRAINT phase_match_prep_analyses_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_match_prep_analyses ADD CONSTRAINT phase_match_prep_analyses_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_match_prep_analyses_match_player ON public.phase_match_prep_analyses USING btree (match_id, player_id);

CREATE INDEX idx_phase_match_prep_analyses_status ON public.phase_match_prep_analyses USING btree (status);

CREATE INDEX idx_phase_match_prep_analyses_player_id ON public.phase_match_prep_analyses (player_id);

ALTER TABLE public.phase_match_prep_analyses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_match_prep_analyses FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_match_prep_analyses TO service_role;

ALTER TABLE public.phase_match_prep_teams ADD CONSTRAINT phase_match_prep_teams_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_match_prep_teams ADD CONSTRAINT phase_match_prep_teams_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_match_prep_teams_player ON public.phase_match_prep_teams USING btree (player_id);

ALTER TABLE public.phase_match_prep_teams ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_match_prep_teams FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_match_prep_teams TO service_role;

ALTER TABLE public.phase_match_evolution_snapshots ADD CONSTRAINT phase_match_evolution_snapshots_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_match_evolution_snapshots ADD CONSTRAINT phase_match_evolution_snapshots_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);

ALTER TABLE public.phase_match_evolution_snapshots ADD CONSTRAINT phase_match_evolution_snapshots_tracker_id_fkey FOREIGN KEY (tracker_id) REFERENCES public.evolution_tracker(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_phase_match_evolution_snapshots_line ON public.phase_match_evolution_snapshots (match_id, player_id, line_id) WHERE line_id IS NOT NULL;

CREATE UNIQUE INDEX uq_phase_match_evolution_snapshots_legacy_base ON public.phase_match_evolution_snapshots (match_id, player_id, base_pokemon) WHERE line_id IS NULL;

CREATE INDEX idx_phase_match_evolution_snapshots_tracker_id ON public.phase_match_evolution_snapshots (tracker_id);

CREATE INDEX phase_match_evolution_snapshots_match_id_fk_idx ON public.phase_match_evolution_snapshots (match_id);

CREATE INDEX phase_match_evolution_snapshots_player_id_fk_idx ON public.phase_match_evolution_snapshots (player_id);

ALTER TABLE public.phase_match_evolution_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_match_evolution_snapshots FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_match_evolution_snapshots TO service_role;

ALTER TABLE public.phase_epb_animation_views ADD CONSTRAINT phase_epb_animation_views_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_epb_animation_views ADD CONSTRAINT phase_epb_animation_views_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_epb_animation_views_match_id ON public.phase_epb_animation_views (match_id);

ALTER TABLE public.phase_epb_animation_views ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_epb_animation_views FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_epb_animation_views TO service_role;

ALTER TABLE public.phase_broadcast_moments ADD CONSTRAINT phase_broadcast_moments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_broadcast_moments ADD CONSTRAINT phase_broadcast_moments_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_broadcast_moments ADD CONSTRAINT phase_broadcast_moments_match_game_fkey FOREIGN KEY (match_id, game_id) REFERENCES public.phase_games(match_id, id) ON DELETE CASCADE;

CREATE INDEX idx_phase_broadcast_moments_game ON public.phase_broadcast_moments USING btree (game_id);

CREATE INDEX idx_phase_broadcast_moments_match ON public.phase_broadcast_moments USING btree (match_id);

CREATE INDEX idx_phase_broadcast_moments_created_by ON public.phase_broadcast_moments (created_by);

ALTER TABLE public.phase_broadcast_moments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_broadcast_moments FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_broadcast_moments TO service_role;

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_fk_phase_teams_draft_pool FOREIGN KEY (draft_pool_id) REFERENCES public.draft_pools(id);

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_forked_from_team_id_fkey FOREIGN KEY (forked_from_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id);

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_phase_match_fkey FOREIGN KEY (phase_id, match_id) REFERENCES public.phase_matches(phase_id, id) ON DELETE SET NULL (match_id);

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_phase_season_fkey FOREIGN KEY (season_id, phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE RESTRICT;

ALTER TABLE public.phase_teams ADD CONSTRAINT phase_teams_forked_from_phase_team_id_fkey FOREIGN KEY (forked_from_phase_team_id) REFERENCES public.phase_teams(id) ON DELETE SET NULL;

CREATE INDEX idx_phase_teams_forked_from ON public.phase_teams USING btree (forked_from_team_id) WHERE (forked_from_team_id IS NOT NULL);

CREATE INDEX idx_phase_teams_library_published ON public.phase_teams USING btree (library_published_at DESC) WHERE (library_published_at IS NOT NULL);

CREATE INDEX idx_phase_teams_library_tags ON public.phase_teams USING gin (library_tags) WHERE (library_tags IS NOT NULL);

CREATE INDEX idx_phase_teams_player ON public.phase_teams USING btree (player_id);

CREATE INDEX idx_phase_teams_share_token ON public.phase_teams USING btree (share_token) WHERE (share_token IS NOT NULL);

CREATE INDEX idx_phase_teams_phase ON public.phase_teams USING btree (phase_id);

CREATE UNIQUE INDEX phase_teams_player_match_unique ON public.phase_teams USING btree (player_id, match_id) WHERE (match_id IS NOT NULL);

CREATE INDEX idx_phase_teams_draft_pool_id ON public.phase_teams (draft_pool_id);

CREATE INDEX idx_phase_teams_match_id ON public.phase_teams (match_id);

CREATE INDEX idx_phase_teams_season_id ON public.phase_teams (season_id);

CREATE INDEX idx_phase_teams_pokemon_match_linked ON public.phase_teams USING gin (pokemon jsonb_path_ops)
  WHERE match_id IS NOT NULL;

CREATE INDEX phase_teams_forked_from_phase_team_id_fk_idx ON public.phase_teams (forked_from_phase_team_id);

ALTER TABLE public.phase_teams ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_teams FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_teams TO service_role;

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_player1_id_fkey FOREIGN KEY (player1_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_player2_id_fkey FOREIGN KEY (player2_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_phase_match_fkey FOREIGN KEY (phase_id, match_id) REFERENCES public.phase_matches(phase_id, id) ON DELETE SET NULL (match_id);

ALTER TABLE public.phase_cast_sessions ADD CONSTRAINT phase_cast_sessions_phase_season_fkey FOREIGN KEY (season_id, phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE RESTRICT;

CREATE INDEX idx_phase_cast_sessions_match ON public.phase_cast_sessions USING btree (match_id) WHERE (match_id IS NOT NULL);

CREATE INDEX idx_phase_cast_sessions_owner ON public.phase_cast_sessions USING btree (owner_id);

CREATE UNIQUE INDEX idx_phase_cast_sessions_realtime_key ON public.phase_cast_sessions USING btree (realtime_key);

CREATE INDEX idx_phase_cast_sessions_status ON public.phase_cast_sessions USING btree (owner_id, status);

CREATE INDEX idx_phase_cast_sessions_player1_id ON public.phase_cast_sessions (player1_id);

CREATE INDEX idx_phase_cast_sessions_player2_id ON public.phase_cast_sessions (player2_id);

CREATE INDEX idx_phase_cast_sessions_season_id ON public.phase_cast_sessions (season_id);

CREATE INDEX idx_phase_cast_sessions_phase_id ON public.phase_cast_sessions (phase_id);

ALTER TABLE public.phase_cast_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_cast_sessions FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_cast_sessions TO service_role;

ALTER TABLE public.phase_admins ADD CONSTRAINT phase_admins_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_admins ADD CONSTRAINT phase_admins_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_admins_player ON public.phase_admins USING btree (player_id);

ALTER TABLE public.phase_admins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_admins FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_admins TO service_role;

ALTER TABLE public.phase_discord_webhooks ADD CONSTRAINT phase_discord_webhooks_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX phase_discord_webhooks_phase_id_fk_idx ON public.phase_discord_webhooks (phase_id);

ALTER TABLE public.phase_discord_webhooks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_discord_webhooks FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_discord_webhooks TO service_role;

ALTER TABLE public.phase_social_integrations ADD CONSTRAINT phase_social_integrations_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_social_integrations_provider ON public.phase_social_integrations USING btree (provider);

CREATE INDEX phase_social_integrations_phase_id_fk_idx ON public.phase_social_integrations (phase_id);

ALTER TABLE public.phase_social_integrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_social_integrations FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_social_integrations TO service_role;

ALTER TABLE public.phase_wiki_notes ADD CONSTRAINT phase_wiki_notes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_wiki_notes ADD CONSTRAINT phase_wiki_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_wiki_notes ADD CONSTRAINT phase_wiki_notes_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_wiki_notes ADD CONSTRAINT phase_wiki_notes_resubmission_blocked_by_fkey FOREIGN KEY (resubmission_blocked_by) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.phase_wiki_notes ADD CONSTRAINT phase_wiki_notes_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_wiki_notes_entity ON public.phase_wiki_notes USING btree (entity_type, entity_name);

CREATE INDEX idx_phase_wiki_notes_pending_moderation ON public.phase_wiki_notes USING btree (created_at DESC) WHERE ((approved = false) AND (rejected_at IS NULL));

CREATE INDEX idx_phase_wiki_notes_rejected ON public.phase_wiki_notes USING btree (rejected_at DESC) WHERE (rejected_at IS NOT NULL);

CREATE INDEX idx_phase_wiki_notes_approved_by ON public.phase_wiki_notes (approved_by);

CREATE INDEX idx_phase_wiki_notes_author_id ON public.phase_wiki_notes (author_id);

CREATE INDEX idx_phase_wiki_notes_rejected_by ON public.phase_wiki_notes (rejected_by);

CREATE INDEX idx_phase_wiki_notes_resubmission_blocked_by ON public.phase_wiki_notes (resubmission_blocked_by)
  WHERE resubmission_blocked_by IS NOT NULL;

CREATE INDEX phase_wiki_notes_resubmission_blocked_by_fk_idx ON public.phase_wiki_notes (resubmission_blocked_by);

CREATE INDEX phase_wiki_notes_phase_id_fk_idx ON public.phase_wiki_notes (phase_id);

ALTER TABLE public.phase_wiki_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_wiki_notes FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_wiki_notes TO service_role;

ALTER TABLE public.phase_wiki_note_reports ADD CONSTRAINT phase_wiki_note_reports_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.phase_wiki_notes(id) ON DELETE CASCADE;

ALTER TABLE public.phase_wiki_note_reports ADD CONSTRAINT phase_wiki_note_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_wiki_note_reports_note ON public.phase_wiki_note_reports USING btree (note_id);

CREATE INDEX idx_phase_wiki_note_reports_status ON public.phase_wiki_note_reports USING btree (status, created_at DESC);

CREATE INDEX idx_phase_wiki_note_reports_reporter_id ON public.phase_wiki_note_reports (reporter_id);

ALTER TABLE public.phase_wiki_note_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_wiki_note_reports FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_wiki_note_reports TO service_role;

ALTER TABLE public.phase_aggregates ADD CONSTRAINT phase_aggregates_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

ALTER TABLE public.phase_aggregates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_aggregates FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_aggregates TO service_role;

ALTER TABLE public.phase_player_aggregates ADD CONSTRAINT phase_player_aggregates_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.phase_player_aggregates ADD CONSTRAINT phase_player_aggregates_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX phase_idx_player_agg_player ON public.phase_player_aggregates USING btree (player_id);

CREATE INDEX phase_idx_player_agg_pokemon ON public.phase_player_aggregates USING btree (pokemon_name);

ALTER TABLE public.phase_player_aggregates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_player_aggregates FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_player_aggregates TO service_role;

ALTER TABLE public.phase_aggregate_jobs ADD CONSTRAINT phase_aggregate_jobs_match_game_fkey FOREIGN KEY (match_id, game_id) REFERENCES public.phase_games(match_id, id) ON DELETE CASCADE;

ALTER TABLE public.phase_aggregate_jobs ADD CONSTRAINT phase_aggregate_jobs_phase_match_fkey FOREIGN KEY (phase_id, match_id) REFERENCES public.phase_matches(phase_id, id) ON DELETE CASCADE;

ALTER TABLE public.phase_aggregate_jobs ADD CONSTRAINT phase_aggregate_jobs_phase_season_fkey FOREIGN KEY (season_id, phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE CASCADE;

CREATE INDEX idx_phase_aggregate_jobs_game_id ON public.phase_aggregate_jobs USING btree (game_id) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));

CREATE INDEX idx_phase_aggregate_jobs_status_created ON public.phase_aggregate_jobs USING btree (status, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));

CREATE INDEX idx_phase_aggregate_jobs_phase ON public.phase_aggregate_jobs USING btree (phase_id) WHERE (status = 'pending'::text);

CREATE INDEX idx_phase_aggregate_jobs_game_id_all ON public.phase_aggregate_jobs (game_id);

CREATE INDEX phase_aggregate_jobs_match_id_fk_idx ON public.phase_aggregate_jobs (match_id, game_id);

CREATE INDEX phase_aggregate_jobs_phase_id_fk_idx ON public.phase_aggregate_jobs (phase_id, match_id);

CREATE INDEX phase_aggregate_jobs_season_id_fk_idx ON public.phase_aggregate_jobs (season_id, phase_id);

ALTER TABLE public.phase_aggregate_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_aggregate_jobs FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_aggregate_jobs TO service_role;

ALTER TABLE public.phase_rating_history ADD CONSTRAINT phase_rating_history_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.phase_matches(id) ON DELETE CASCADE;

ALTER TABLE public.phase_rating_history ADD CONSTRAINT phase_rating_history_opponent_id_fkey FOREIGN KEY (opponent_id) REFERENCES public.players(id);

ALTER TABLE public.phase_rating_history ADD CONSTRAINT phase_rating_history_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX idx_phase_rating_history_match ON public.phase_rating_history USING btree (match_id);

CREATE INDEX idx_phase_rating_history_player ON public.phase_rating_history USING btree (player_id, recorded_at DESC);

CREATE INDEX idx_phase_rating_history_opponent_id ON public.phase_rating_history (opponent_id);

ALTER TABLE public.phase_rating_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phase_rating_history FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phase_rating_history TO service_role;

ALTER TABLE public.player_streaks ADD COLUMN last_phase_match_id uuid CONSTRAINT player_streaks_last_phase_match_id_fkey REFERENCES public.phase_matches(id) ON DELETE SET NULL;

CREATE INDEX player_streaks_last_phase_match_id_idx ON public.player_streaks (last_phase_match_id) WHERE last_phase_match_id IS NOT NULL;

ALTER TABLE public.player_streaks ADD CONSTRAINT player_streaks_phase_pointer_1_check CHECK (num_nonnulls(last_match_id, last_phase_match_id) <= 1);

ALTER TABLE public.agent_suggestions ADD COLUMN phase_match_id uuid CONSTRAINT agent_suggestions_phase_match_id_fkey REFERENCES public.phase_matches(id) ON DELETE SET NULL;

CREATE INDEX agent_suggestions_phase_match_id_idx ON public.agent_suggestions (phase_match_id) WHERE phase_match_id IS NOT NULL;

ALTER TABLE public.agent_suggestions ADD CONSTRAINT agent_suggestions_phase_pointer_1_check CHECK (num_nonnulls(match_id, phase_match_id) <= 1);

ALTER TABLE public.teams ADD COLUMN phase_match_id uuid CONSTRAINT teams_phase_match_id_fkey REFERENCES public.phase_matches(id) ON DELETE SET NULL;

CREATE INDEX teams_phase_match_id_idx ON public.teams (phase_match_id) WHERE phase_match_id IS NOT NULL;

ALTER TABLE public.teams ADD COLUMN forked_from_phase_team_id uuid CONSTRAINT teams_forked_from_phase_team_id_fkey REFERENCES public.phase_teams(id) ON DELETE SET NULL;

CREATE INDEX teams_forked_from_phase_team_id_idx ON public.teams (forked_from_phase_team_id) WHERE forked_from_phase_team_id IS NOT NULL;

ALTER TABLE public.teams ADD CONSTRAINT teams_phase_pointer_1_check CHECK (num_nonnulls(match_id, phase_match_id) <= 1);

ALTER TABLE public.teams ADD CONSTRAINT teams_phase_pointer_2_check CHECK (num_nonnulls(forked_from_team_id, forked_from_phase_team_id) <= 1);

ALTER TABLE public.teams ADD CONSTRAINT teams_phase_pointer_3_check CHECK (phase_match_id IS NULL OR tournament_id IS NULL);

ALTER TABLE public.cast_sessions ADD COLUMN phase_id uuid CONSTRAINT cast_sessions_phase_id_fkey REFERENCES public.league_phases(id) ON DELETE SET NULL;

CREATE INDEX cast_sessions_phase_id_idx ON public.cast_sessions (phase_id) WHERE phase_id IS NOT NULL;

ALTER TABLE public.cast_sessions ADD COLUMN phase_match_id uuid CONSTRAINT cast_sessions_phase_match_id_fkey REFERENCES public.phase_matches(id) ON DELETE SET NULL;

CREATE INDEX cast_sessions_phase_match_id_idx ON public.cast_sessions (phase_match_id) WHERE phase_match_id IS NOT NULL;

ALTER TABLE public.cast_sessions ADD CONSTRAINT cast_sessions_phase_pointer_1_check CHECK (num_nonnulls(match_id, phase_match_id) <= 1);

ALTER TABLE public.cast_sessions ADD CONSTRAINT cast_sessions_phase_pointer_2_check CHECK (num_nonnulls(tournament_id, phase_id) <= 1);

ALTER TABLE public.cast_sessions ADD CONSTRAINT cast_sessions_phase_pointer_3_check CHECK (phase_match_id IS NULL OR (phase_id IS NOT NULL AND tournament_id IS NULL));

ALTER TABLE public.cast_sessions ADD CONSTRAINT cast_sessions_phase_pointer_4_check CHECK (phase_id IS NULL OR match_id IS NULL);

ALTER TABLE public.format_challenges ADD COLUMN league_phase_id uuid CONSTRAINT format_challenges_league_phase_id_fkey REFERENCES public.league_phases(id) ON DELETE CASCADE;

CREATE INDEX format_challenges_league_phase_id_idx ON public.format_challenges (league_phase_id) WHERE league_phase_id IS NOT NULL;

ALTER TABLE public.format_challenges ADD COLUMN phase_match_id uuid CONSTRAINT format_challenges_phase_match_id_fkey REFERENCES public.phase_matches(id) ON DELETE SET NULL;

CREATE INDEX format_challenges_phase_match_id_idx ON public.format_challenges (phase_match_id) WHERE phase_match_id IS NOT NULL;

ALTER TABLE public.format_challenges ADD CONSTRAINT format_challenges_phase_pointer_1_check CHECK (phase_match_id IS NULL OR league_phase_id IS NOT NULL);

ALTER TABLE public.format_challenges ADD CONSTRAINT format_challenges_phase_pointer_2_check CHECK (num_nonnulls(match_id, phase_match_id) <= 1);

ALTER TABLE public.format_challenges ADD CONSTRAINT format_challenges_phase_pointer_3_check CHECK (league_phase_id IS NULL OR league_phase_id = phase_id);

ALTER TABLE public.cast_sessions ADD CONSTRAINT cast_sessions_phase_match_fkey FOREIGN KEY (phase_id, phase_match_id) REFERENCES public.phase_matches(phase_id, id) ON DELETE SET NULL (phase_match_id);

ALTER TABLE public.cast_sessions ADD CONSTRAINT cast_sessions_phase_season_fkey FOREIGN KEY (season_id, phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE RESTRICT;

ALTER TABLE public.format_challenges ADD CONSTRAINT format_challenges_league_phase_fkey FOREIGN KEY (season_id, league_phase_id) REFERENCES public.league_phases(season_id, id) ON DELETE CASCADE;

ALTER TABLE public.format_challenges ADD CONSTRAINT format_challenges_phase_match_fkey FOREIGN KEY (league_phase_id, phase_match_id) REFERENCES public.phase_matches(phase_id, id) ON DELETE SET NULL (phase_match_id);

CREATE UNIQUE INDEX teams_player_phase_match_unique ON public.teams (player_id, phase_match_id) WHERE phase_match_id IS NOT NULL;

COMMIT;
