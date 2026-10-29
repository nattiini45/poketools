-- Admin Assistant, step 1 (PR8): the nine admin_agent_* tables, their immutability triggers, the retention purge, the
-- turn lease, the blast-radius counters and the usage reservation. Specified in docs/poketools-spec.md 4.14 and 18.
--
-- admin_agent_conversations   one row per chat: pinned model and registry versions, the active plan, the turn lease,
--                             the blast-radius counters (blast_*) and the version for compare-and-set edits.
-- admin_agent_messages        append-only transcript, PK (conversation_id, seq); `content` holds the exact model content
--                             blocks. Nulled (with `ui`) by the retention purge only.
-- admin_agent_plans           the Plan document of a conversation (mode, status, revision, doc).
-- admin_agent_plan_revisions  append-only history of a plan, PK (plan_id, revision).
-- admin_agent_proposals       hash-bound confirmation proposals. Immutable except status, approved_* and the two
--                             execution timestamps. At most one executing proposal per conversation.
-- admin_agent_actions         the ledger: every real write and every private draft write. at-most-once dispatch is the
--                             unique (conversation_id, tool_use_id) and (proposal_id, step_key).
-- admin_agent_snapshots       the previous draft document before a draft save (30 days), for the draft-save undo.
-- admin_agent_refs            the ids a conversation has legitimately seen (provenance of staged writes).
-- admin_agent_usage           one row per model call, with the cost reserved before the call and settled after it.
--
-- Rules shared by all nine tables
--   * Service-role only (src/lib/supabase/__tests__/migration-api-grants.test.ts): RLS enabled with no policies,
--     privileges and EXECUTE granted to service_role only. service_role gets SELECT, INSERT and UPDATE, NOT DELETE:
--     rows are never deleted by the application, only by admin_agent_retention_purge() (owner rights).
--   * Admin columns (admin_id, approved_by) are ON DELETE SET NULL and every row that has one also stores admin_name
--     (precedent: audit_log.actor_id + actor_name). Deleting an admin who used the assistant is therefore never blocked
--     by a foreign key or by a trigger: the SET NULL update is one of the changes the update triggers allow.
--   * Immutability. BEFORE DELETE is forbidden on every table and BEFORE UPDATE allows only the whitelisted columns of
--     that table (admin_agent__forbid_delete / admin_agent__guard_update and the per-table extras). The retention purge
--     is the only exception: admin_agent_retention_purge() is SECURITY DEFINER and sets the transaction-local flag
--     app.retention_purge, which admin_agent__purging() honours. The flag counts only when the session user is NOT one
--     of the API roles (anon, authenticated, authenticator, service_role), so a caller cannot forge it with set_config;
--     only code running with owner rights (the purge function, a maintainer's psql) can.
--   * Errors raised by the triggers and functions use SQLSTATE P0001 with the code as message and a JSON detail, as in
--     20261024100100_format_definitions.sql and 20261026100000_ruleset_definitions.sql. Codes: ADMIN_AGENT_IMMUTABLE,
--     ADMIN_AGENT_DELETE_FORBIDDEN, ADMIN_AGENT_COUNTER_DECREASE, ADMIN_AGENT_STATUS_REGRESS, ADMIN_AGENT_APPROVAL_LOCKED,
--     ADMIN_AGENT_USAGE_SETTLED, ADMIN_AGENT_BAD_CLAIMS, ADMIN_AGENT_CONVERSATION_NOT_FOUND, ADMIN_AGENT_BAD_ARGUMENT,
--     ADMIN_AGENT_CAP_REQUIRED, ADMIN_AGENT_USAGE_NOT_FOUND.
--   * Payload hygiene (spec 4.14): never persisted in any column: webhook URLs, the season_formats seed, plaintext
--     passwords, redraft submission lists, full player rows. The size CHECKs below bound the jsonb columns (measured on
--     the jsonb TEXT form, as in 20261026100000).
--
-- League recycle bin (AGENTS.md "A league delete is a move to the recycle bin"): NO table here references seasons,
-- tournaments, matches, games or draft pools. admin_agent_actions.entity_id is a plain uuid WITHOUT a foreign key: the
-- entity may be deleted later, and a foreign key to a table of the league subtree would make every league delete fail
-- (league_trash__assert_inventory). The only parent outside this family is players (admin columns, SET NULL). The
-- tables therefore need no entry in league_trash__inventory(): it classifies the tables the league REACHES by foreign
-- key (owned, derived) plus the append-only logs keyed by scope_type/scope_id (kept), and an assistant ledger row that
-- names a trashed league is simply a row that still exists. src/lib/league-trash/__tests__/inventory.test.ts fails if
-- one of these tables ever gains a key into the league subtree.
--
-- Retention (spec 4.14, owner decision Q9), all in admin_agent_retention_purge():
--   message content (and the ui projection) nulled 180 days after the conversation's last message (rows kept);
--   approved_ip_hash and approved_user_agent nulled 90 days after approval; snapshots deleted at expires_at (30 days);
--   refs deleted with the message content; conversations (and by cascade plans, revisions, proposals, ledger rows,
--   messages, snapshots) and usage rows deleted after 2 years.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers shared by the triggers.

-- True only inside admin_agent_retention_purge() (or a maintainer's session): the flag is set AND the session user is
-- not an API role. SECURITY INVOKER on purpose: current_user is the caller's, which is the function owner inside a
-- SECURITY DEFINER function and service_role when PostgREST runs a statement.
CREATE OR REPLACE FUNCTION public.admin_agent__purging() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(current_setting('app.retention_purge', true), '') = 'on'
     AND current_user NOT IN ('anon', 'authenticated', 'authenticator', 'service_role')
$$;

CREATE OR REPLACE FUNCTION public.admin_agent__forbid_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ADMIN_AGENT_DELETE_FORBIDDEN' USING ERRCODE = 'P0001',
    DETAIL = jsonb_build_object('table', TG_TABLE_NAME)::text;
END $$;

-- Column whitelist, configured per trigger through TG_ARGV: 'col' may change freely, '?col' may only change to NULL
-- (the ON DELETE SET NULL of an admin column). Every other column must equal its old value.
CREATE OR REPLACE FUNCTION public.admin_agent__guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_free text[] := '{}';
  v_null text[] := '{}';
  v_arg  text;
  v_new  jsonb;
  v_old  jsonb;
  v_bad  text[];
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  -- TG_ARGV is NULL, not empty, for a trigger without arguments (the append-only tables).
  IF TG_NARGS > 0 THEN
    FOREACH v_arg IN ARRAY TG_ARGV LOOP
      IF left(v_arg, 1) = '?' THEN
        v_null := v_null || substr(v_arg, 2);
      ELSE
        v_free := v_free || v_arg;
      END IF;
    END LOOP;
  END IF;
  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);
  SELECT array_agg(n.key ORDER BY n.key) INTO v_bad
    FROM jsonb_each(v_new) n
   WHERE n.value IS DISTINCT FROM (v_old -> n.key)
     AND n.key <> ALL (v_free)
     AND (n.key <> ALL (v_null) OR n.value <> 'null'::jsonb);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ADMIN_AGENT_IMMUTABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('table', TG_TABLE_NAME, 'columns', to_jsonb(v_bad))::text;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Conversations

CREATE TABLE public.admin_agent_conversations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  admin_name            text        NOT NULL,
  -- Written by the smallest model; always rendered as data.
  title                 text,
  status                text        NOT NULL DEFAULT 'active',
  ui_locale             text        NOT NULL,
  -- A validated seed only: a whitelisted key plus ids, never free text from a URL.
  context               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Pinned at creation, never switched mid-conversation.
  model                 text        NOT NULL,
  effort                text        NOT NULL,
  tool_set              text        NOT NULL,
  tool_registry_version text        NOT NULL,
  system_prompt_version text        NOT NULL,
  -- FK added below (plans reference the conversation).
  active_plan_id        uuid,
  -- Last message sequence number (monotonic).
  seq_head              integer     NOT NULL DEFAULT 0,
  -- The turn lease (plan 3.4): a turn runs only while it holds an unexpired lease. See admin_agent_acquire_turn_lease.
  turn_lease_until      timestamptz,
  -- Compare-and-set counter for title and status edits (monotonic).
  version               integer     NOT NULL DEFAULT 1,
  -- Blast-radius counters (plan 6.4), incremented ONLY by admin_agent_claim_budget at proposal claim time.
  blast_league_creates     integer  NOT NULL DEFAULT 0,
  blast_tournament_creates integer  NOT NULL DEFAULT 0,
  blast_ruleset_creates    integer  NOT NULL DEFAULT 0,
  blast_format_creates     integer  NOT NULL DEFAULT 0,
  blast_golive_executions  integer  NOT NULL DEFAULT 0,
  blast_pin_targets        integer  NOT NULL DEFAULT 0,
  last_message_at       timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_conversations_admin_name_len   CHECK (char_length(admin_name) <= 1000),
  CONSTRAINT admin_agent_conversations_title_len        CHECK (title IS NULL OR char_length(title) <= 300),
  CONSTRAINT admin_agent_conversations_status_check     CHECK (status IN ('active', 'archived')),
  CONSTRAINT admin_agent_conversations_locale_check     CHECK (ui_locale IN ('en', 'de')),
  CONSTRAINT admin_agent_conversations_context_object   CHECK (jsonb_typeof(context) = 'object'),
  CONSTRAINT admin_agent_conversations_context_size     CHECK (octet_length(context::text) <= 8192),
  CONSTRAINT admin_agent_conversations_model_len        CHECK (char_length(model) BETWEEN 1 AND 100),
  CONSTRAINT admin_agent_conversations_effort_len       CHECK (char_length(effort) BETWEEN 1 AND 32),
  CONSTRAINT admin_agent_conversations_tool_set_check   CHECK (tool_set IN ('site', 'scoped')),
  CONSTRAINT admin_agent_conversations_versions_len     CHECK (char_length(tool_registry_version) BETWEEN 1 AND 64
                                                           AND char_length(system_prompt_version) BETWEEN 1 AND 64),
  CONSTRAINT admin_agent_conversations_seq_head_check   CHECK (seq_head >= 0),
  CONSTRAINT admin_agent_conversations_version_check    CHECK (version >= 1),
  CONSTRAINT admin_agent_conversations_blast_check      CHECK (blast_league_creates >= 0 AND blast_tournament_creates >= 0
                                                           AND blast_ruleset_creates >= 0 AND blast_format_creates >= 0
                                                           AND blast_golive_executions >= 0 AND blast_pin_targets >= 0)
);

CREATE INDEX idx_admin_agent_conversations_admin_last ON public.admin_agent_conversations (admin_id, last_message_at DESC);
CREATE INDEX idx_admin_agent_conversations_last_message ON public.admin_agent_conversations (last_message_at);
CREATE INDEX idx_admin_agent_conversations_active_plan ON public.admin_agent_conversations (active_plan_id) WHERE active_plan_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Messages (append-only)

CREATE TABLE public.admin_agent_messages (
  conversation_id   uuid        NOT NULL REFERENCES public.admin_agent_conversations(id) ON DELETE CASCADE,
  seq               integer     NOT NULL,
  role              text        NOT NULL,
  kind              text        NOT NULL,
  -- The exact model content blocks (thinking included), so history replays byte-exact. NULL only after the retention
  -- purge (content_purged_at is then set).
  content           jsonb,
  content_purged_at timestamptz,
  -- Structured projection for the UI; no localized prose except the model's own text. Nulled with `content`.
  ui                jsonb,
  model             text,
  stop_reason       text,
  usage             jsonb,
  -- A retried POST is idempotent: unique per conversation.
  client_msg_id     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_messages_pkey                PRIMARY KEY (conversation_id, seq),
  CONSTRAINT admin_agent_messages_seq_check           CHECK (seq >= 1),
  CONSTRAINT admin_agent_messages_role_check          CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT admin_agent_messages_kind_check          CHECK (kind IN ('chat', 'tool_results', 'harness_event')),
  CONSTRAINT admin_agent_messages_content_present     CHECK (content IS NOT NULL OR content_purged_at IS NOT NULL),
  CONSTRAINT admin_agent_messages_content_size        CHECK (content IS NULL OR octet_length(content::text) <= 1048576),
  CONSTRAINT admin_agent_messages_ui_size             CHECK (ui IS NULL OR octet_length(ui::text) <= 262144),
  CONSTRAINT admin_agent_messages_usage_size          CHECK (usage IS NULL OR octet_length(usage::text) <= 8192),
  CONSTRAINT admin_agent_messages_client_msg_id_len   CHECK (client_msg_id IS NULL OR char_length(client_msg_id) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX uq_admin_agent_messages_client_msg ON public.admin_agent_messages (conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Plans and their revisions

CREATE TABLE public.admin_agent_plans (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid        NOT NULL REFERENCES public.admin_agent_conversations(id) ON DELETE CASCADE,
  admin_id          uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  admin_name        text        NOT NULL,
  mode              text        NOT NULL,
  status            text        NOT NULL DEFAULT 'drafting',
  -- Every edit bumps `revision`; admin_agent_plan_revisions keeps the history.
  revision          integer     NOT NULL DEFAULT 1,
  doc               jsonb       NOT NULL,
  doc_hash          text        NOT NULL,
  build_started_at  timestamptz,
  build_finished_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_plans_admin_name_len CHECK (char_length(admin_name) <= 1000),
  CONSTRAINT admin_agent_plans_mode_check     CHECK (mode IN ('create', 'amend')),
  CONSTRAINT admin_agent_plans_status_check   CHECK (status IN ('drafting', 'ready', 'building', 'partial', 'built', 'abandoned')),
  CONSTRAINT admin_agent_plans_revision_check CHECK (revision >= 1),
  CONSTRAINT admin_agent_plans_doc_object     CHECK (jsonb_typeof(doc) = 'object'),
  CONSTRAINT admin_agent_plans_doc_size       CHECK (octet_length(doc::text) <= 262144),
  CONSTRAINT admin_agent_plans_doc_hash_check CHECK (doc_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_admin_agent_plans_conversation ON public.admin_agent_plans (conversation_id);
CREATE INDEX idx_admin_agent_plans_admin ON public.admin_agent_plans (admin_id);

ALTER TABLE public.admin_agent_conversations
  ADD CONSTRAINT admin_agent_conversations_active_plan_id_fkey
  FOREIGN KEY (active_plan_id) REFERENCES public.admin_agent_plans(id) ON DELETE SET NULL;

CREATE TABLE public.admin_agent_plan_revisions (
  plan_id    uuid        NOT NULL REFERENCES public.admin_agent_plans(id) ON DELETE CASCADE,
  revision   integer     NOT NULL,
  doc        jsonb       NOT NULL,
  patch      jsonb,
  author     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_plan_revisions_pkey         PRIMARY KEY (plan_id, revision),
  CONSTRAINT admin_agent_plan_revisions_revision     CHECK (revision >= 1),
  CONSTRAINT admin_agent_plan_revisions_doc_object   CHECK (jsonb_typeof(doc) = 'object'),
  CONSTRAINT admin_agent_plan_revisions_doc_size     CHECK (octet_length(doc::text) <= 262144),
  CONSTRAINT admin_agent_plan_revisions_patch_size   CHECK (patch IS NULL OR octet_length(patch::text) <= 262144),
  CONSTRAINT admin_agent_plan_revisions_author_check CHECK (author IN ('agent', 'admin', 'system'))
);

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Proposals

CREATE TABLE public.admin_agent_proposals (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid        NOT NULL REFERENCES public.admin_agent_conversations(id) ON DELETE CASCADE,
  -- The proposing admin.
  admin_id              uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  admin_name            text        NOT NULL,
  kind                  text        NOT NULL,
  -- Spec 4.14 names this column `class` (plan 4.6 calls it tier).
  class                 text        NOT NULL,
  -- Build proposals only.
  plan_id               uuid        REFERENCES public.admin_agent_plans(id),
  plan_revision         integer,
  status                text        NOT NULL DEFAULT 'proposed',
  -- Checked at approve: a deploy that changes the tool registry makes a pending proposal stale.
  tool_registry_version text        NOT NULL,
  -- Immutable. Data, never logic: approve re-resolves every op in code.
  steps                 jsonb       NOT NULL,
  proposal_hash         text        NOT NULL,
  preview               jsonb       NOT NULL,
  preview_hash          text        NOT NULL,
  -- sha256 of the 256-bit approval token; the token itself is never stored.
  token_hash            text        NOT NULL,
  acks_required         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  expires_at            timestamptz NOT NULL,
  executing_started_at  timestamptz,
  finished_at           timestamptz,
  approved_by           uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  -- Keyed hash and truncated string; both purged 90 days after approval.
  approved_ip_hash      text,
  approved_user_agent   text,
  -- Tool plus target: staging the same one again marks the older proposal superseded.
  supersede_key         text,
  locale                text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_proposals_admin_name_len    CHECK (char_length(admin_name) <= 1000),
  CONSTRAINT admin_agent_proposals_kind_check        CHECK (kind IN ('build', 'action', 'undo')),
  CONSTRAINT admin_agent_proposals_class_check       CHECK (class IN ('B', 'G')),
  CONSTRAINT admin_agent_proposals_plan_pair         CHECK ((plan_id IS NULL) = (plan_revision IS NULL)),
  CONSTRAINT admin_agent_proposals_build_plan        CHECK (kind <> 'build' OR plan_id IS NOT NULL),
  CONSTRAINT admin_agent_proposals_plan_revision     CHECK (plan_revision IS NULL OR plan_revision >= 1),
  CONSTRAINT admin_agent_proposals_status_check      CHECK (status IN ('proposed', 'executing', 'completed', 'partial', 'failed', 'declined',
                                                                       'expired', 'superseded', 'stale', 'unknown')),
  CONSTRAINT admin_agent_proposals_registry_len      CHECK (char_length(tool_registry_version) BETWEEN 1 AND 64),
  -- At most 40 steps per Build; an undo holds up to 20; a Go-live (G) proposal is exactly one call, except an undo (plan 4.5).
  CONSTRAINT admin_agent_proposals_steps_array       CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 40),
  CONSTRAINT admin_agent_proposals_steps_size        CHECK (octet_length(steps::text) <= 1048576),
  CONSTRAINT admin_agent_proposals_undo_steps        CHECK (kind <> 'undo' OR jsonb_array_length(steps) <= 20),
  CONSTRAINT admin_agent_proposals_g_one_step        CHECK (class <> 'G' OR kind = 'undo' OR jsonb_array_length(steps) = 1),
  CONSTRAINT admin_agent_proposals_hashes            CHECK (proposal_hash ~ '^[0-9a-f]{64}$' AND preview_hash ~ '^[0-9a-f]{64}$'
                                                        AND token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_agent_proposals_preview_object    CHECK (jsonb_typeof(preview) = 'object'),
  CONSTRAINT admin_agent_proposals_preview_size      CHECK (octet_length(preview::text) <= 262144),
  CONSTRAINT admin_agent_proposals_acks_array        CHECK (jsonb_typeof(acks_required) = 'array'),
  CONSTRAINT admin_agent_proposals_acks_size         CHECK (octet_length(acks_required::text) <= 16384),
  CONSTRAINT admin_agent_proposals_user_agent_len    CHECK (approved_user_agent IS NULL OR char_length(approved_user_agent) <= 512),
  CONSTRAINT admin_agent_proposals_ip_hash_len       CHECK (approved_ip_hash IS NULL OR char_length(approved_ip_hash) <= 128),
  CONSTRAINT admin_agent_proposals_supersede_len     CHECK (supersede_key IS NULL OR char_length(supersede_key) <= 256),
  CONSTRAINT admin_agent_proposals_locale_check      CHECK (locale IN ('en', 'de'))
);

-- One executing proposal per conversation (the claim's replay protection and the reaper's key; plan 4.5).
CREATE UNIQUE INDEX uq_admin_agent_proposals_executing ON public.admin_agent_proposals (conversation_id) WHERE status = 'executing';
CREATE INDEX idx_admin_agent_proposals_conversation ON public.admin_agent_proposals (conversation_id, created_at DESC);
CREATE INDEX idx_admin_agent_proposals_admin ON public.admin_agent_proposals (admin_id);
CREATE INDEX idx_admin_agent_proposals_approved_by ON public.admin_agent_proposals (approved_by);
CREATE INDEX idx_admin_agent_proposals_plan ON public.admin_agent_proposals (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_admin_agent_proposals_pending ON public.admin_agent_proposals (expires_at) WHERE status IN ('proposed', 'executing');

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Actions (the ledger)

CREATE TABLE public.admin_agent_actions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.admin_agent_conversations(id) ON DELETE CASCADE,
  admin_id        uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  -- Read by the league-admin history view as the actor name.
  admin_name      text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Private draft writes (D) and plan edits: unique with the conversation.
  tool_use_id     text,
  tool_name       text        NOT NULL,
  class           text        NOT NULL,
  proposal_id     uuid        REFERENCES public.admin_agent_proposals(id),
  step_key        text,
  method          text,
  path            text,
  args            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  args_hash       text        NOT NULL,
  status          text        NOT NULL DEFAULT 'executing',
  http_status     integer,
  outcome_kind    text,
  error_code      text,
  result          jsonb,
  before          jsonb,
  after           jsonb,
  after_fingerprint text,
  -- The compensating recipe, and its live precondition class.
  undo            jsonb,
  reversibility   text,
  -- The read-back that confirmed the write.
  verify          jsonb,
  entity_type     text,
  -- NO foreign key, on purpose (see the header: league recycle bin).
  entity_id       uuid,
  CONSTRAINT admin_agent_actions_admin_name_len   CHECK (char_length(admin_name) <= 1000),
  CONSTRAINT admin_agent_actions_tool_use_len     CHECK (tool_use_id IS NULL OR char_length(tool_use_id) BETWEEN 1 AND 128),
  CONSTRAINT admin_agent_actions_tool_name_len    CHECK (char_length(tool_name) BETWEEN 1 AND 100),
  CONSTRAINT admin_agent_actions_class_check      CHECK (class IN ('D', 'B', 'G')),
  CONSTRAINT admin_agent_actions_step_pair        CHECK ((proposal_id IS NULL) = (step_key IS NULL)),
  CONSTRAINT admin_agent_actions_step_key_len     CHECK (step_key IS NULL OR char_length(step_key) BETWEEN 1 AND 128),
  CONSTRAINT admin_agent_actions_method_check     CHECK (method IS NULL OR method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT admin_agent_actions_path_len         CHECK (path IS NULL OR char_length(path) <= 1024),
  CONSTRAINT admin_agent_actions_args_size        CHECK (octet_length(args::text) <= 65536),
  CONSTRAINT admin_agent_actions_args_hash_check  CHECK (args_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_agent_actions_status_check     CHECK (status IN ('executing', 'ok', 'failed', 'unknown', 'skipped', 'undone')),
  CONSTRAINT admin_agent_actions_http_status      CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  CONSTRAINT admin_agent_actions_text_len         CHECK ((outcome_kind IS NULL OR char_length(outcome_kind) <= 64)
                                                     AND (error_code IS NULL OR char_length(error_code) <= 128)
                                                     AND (after_fingerprint IS NULL OR char_length(after_fingerprint) <= 128)
                                                     AND (reversibility IS NULL OR char_length(reversibility) <= 64)
                                                     AND (entity_type IS NULL OR char_length(entity_type) <= 64)),
  CONSTRAINT admin_agent_actions_json_size        CHECK ((result IS NULL OR octet_length(result::text) <= 65536)
                                                     AND (before IS NULL OR octet_length(before::text) <= 65536)
                                                     AND (after IS NULL OR octet_length(after::text) <= 65536)
                                                     AND (undo IS NULL OR octet_length(undo::text) <= 65536)
                                                     AND (verify IS NULL OR octet_length(verify::text) <= 65536)),
  -- At-most-once dispatch: insert first, dispatch only if the insert won.
  CONSTRAINT admin_agent_actions_tool_use_key     UNIQUE (conversation_id, tool_use_id),
  CONSTRAINT admin_agent_actions_step_key         UNIQUE (proposal_id, step_key)
);

CREATE INDEX idx_admin_agent_actions_conversation ON public.admin_agent_actions (conversation_id, created_at);
CREATE INDEX idx_admin_agent_actions_admin ON public.admin_agent_actions (admin_id, created_at DESC);
CREATE INDEX idx_admin_agent_actions_entity ON public.admin_agent_actions (entity_type, entity_id, created_at DESC) WHERE entity_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Snapshots

CREATE TABLE public.admin_agent_snapshots (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The draft-save ledger row; one snapshot per action.
  action_id  uuid        NOT NULL UNIQUE REFERENCES public.admin_agent_actions(id) ON DELETE CASCADE,
  -- The previous Format Studio or Ruleset Studio draft document (up to 256 KiB).
  document   jsonb       NOT NULL,
  doc_hash   text        NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_snapshots_document_size CHECK (octet_length(document::text) <= 262144),
  CONSTRAINT admin_agent_snapshots_hash_check    CHECK (doc_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_admin_agent_snapshots_expires ON public.admin_agent_snapshots (expires_at);

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Refs

CREATE TABLE public.admin_agent_refs (
  conversation_id uuid        NOT NULL REFERENCES public.admin_agent_conversations(id) ON DELETE CASCADE,
  ref_kind        text        NOT NULL,
  ref_id          uuid        NOT NULL,
  label           text,
  source          text        NOT NULL,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_agent_refs_pkey         PRIMARY KEY (conversation_id, ref_kind, ref_id),
  CONSTRAINT admin_agent_refs_kind_len     CHECK (char_length(ref_kind) BETWEEN 1 AND 64),
  CONSTRAINT admin_agent_refs_label_len    CHECK (label IS NULL OR char_length(label) <= 300),
  CONSTRAINT admin_agent_refs_source_check CHECK (source IN ('user_message', 'tool_result', 'proposal_step'))
);

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Usage

CREATE TABLE public.admin_agent_usage (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  admin_name              text        NOT NULL,
  -- SET NULL only so that a purge of an old conversation cannot be blocked; usage outlives it by design (the cap sums).
  conversation_id         uuid        REFERENCES public.admin_agent_conversations(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  purpose                 text        NOT NULL,
  model                   text        NOT NULL,
  -- The four meters of the API usage object.
  input_tokens            bigint      NOT NULL DEFAULT 0,
  cache_write_5m_tokens   bigint      NOT NULL DEFAULT 0,
  cache_write_1h_tokens   bigint      NOT NULL DEFAULT 0,
  cache_read_tokens       bigint      NOT NULL DEFAULT 0,
  output_tokens           bigint      NOT NULL DEFAULT 0,
  -- Reserved before the call (admin_agent_reserve_usage), settled after (admin_agent_settle_usage). Until a row is
  -- settled the reservation counts as spent: a crashed call can only make the cap stricter.
  reserved_usd_micro      bigint      NOT NULL DEFAULT 0,
  cost_usd_micro          bigint      NOT NULL DEFAULT 0,
  stop_reason             text,
  settled_at              timestamptz,
  CONSTRAINT admin_agent_usage_admin_name_len CHECK (char_length(admin_name) <= 1000),
  CONSTRAINT admin_agent_usage_purpose_check  CHECK (purpose IN ('turn', 'title', 'judge')),
  CONSTRAINT admin_agent_usage_model_len      CHECK (char_length(model) BETWEEN 1 AND 100),
  CONSTRAINT admin_agent_usage_amounts_check  CHECK (input_tokens >= 0 AND cache_write_5m_tokens >= 0 AND cache_write_1h_tokens >= 0
                                                 AND cache_read_tokens >= 0 AND output_tokens >= 0
                                                 AND reserved_usd_micro >= 0 AND cost_usd_micro >= 0),
  CONSTRAINT admin_agent_usage_stop_reason    CHECK (stop_reason IS NULL OR char_length(stop_reason) <= 64)
);

CREATE INDEX idx_admin_agent_usage_admin_created ON public.admin_agent_usage (admin_id, created_at);
CREATE INDEX idx_admin_agent_usage_created ON public.admin_agent_usage (created_at);
CREATE INDEX idx_admin_agent_usage_conversation ON public.admin_agent_usage (conversation_id) WHERE conversation_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Per-table extras of the update guard (monotonic counters, no status regress, settle once). They add rules the column
-- whitelist cannot express. The purge bypasses them like the whitelist.

CREATE OR REPLACE FUNCTION public.admin_agent_conversations__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF NEW.seq_head < OLD.seq_head OR NEW.version < OLD.version
     OR NEW.blast_league_creates < OLD.blast_league_creates OR NEW.blast_tournament_creates < OLD.blast_tournament_creates
     OR NEW.blast_ruleset_creates < OLD.blast_ruleset_creates OR NEW.blast_format_creates < OLD.blast_format_creates
     OR NEW.blast_golive_executions < OLD.blast_golive_executions OR NEW.blast_pin_targets < OLD.blast_pin_targets THEN
    RAISE EXCEPTION 'ADMIN_AGENT_COUNTER_DECREASE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('conversation_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_agent_plans__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'ADMIN_AGENT_COUNTER_DECREASE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('plan_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

-- Only content, ui and content_purged_at may change, only to NULL / a purge stamp, and only through the purge. This
-- check holds INSIDE the purge too: it can null message content and nothing else.
CREATE OR REPLACE FUNCTION public.admin_agent_messages__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_drop text[] := ARRAY['content', 'ui', 'content_purged_at'];
BEGIN
  IF (to_jsonb(NEW) - v_drop) IS DISTINCT FROM (to_jsonb(OLD) - v_drop) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_IMMUTABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('table', TG_TABLE_NAME, 'conversation_id', OLD.conversation_id, 'seq', OLD.seq)::text;
  END IF;
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.ui IS DISTINCT FROM OLD.ui
     OR NEW.content_purged_at IS DISTINCT FROM OLD.content_purged_at THEN
    IF NOT public.admin_agent__purging() OR NEW.content IS NOT NULL OR NEW.ui IS NOT NULL OR NEW.content_purged_at IS NULL THEN
      RAISE EXCEPTION 'ADMIN_AGENT_IMMUTABLE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('table', TG_TABLE_NAME, 'conversation_id', OLD.conversation_id, 'seq', OLD.seq)::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- status never goes back to 'proposed' (the atomic claim relies on it); once approved_at / approved_by are set they can
-- only be cleared by the ON DELETE SET NULL of the approving admin.
CREATE OR REPLACE FUNCTION public.admin_agent_proposals__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'proposed' AND OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('proposal_id', OLD.id, 'from', OLD.status)::text;
  END IF;
  IF (OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
     OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> OLD.approved_by) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_APPROVAL_LOCKED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('proposal_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

-- A row never returns to 'executing', and only an 'ok' row becomes 'undone'.
CREATE OR REPLACE FUNCTION public.admin_agent_actions__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF (NEW.status = 'executing' AND OLD.status <> 'executing') OR (NEW.status = 'undone' AND OLD.status <> 'ok' AND OLD.status <> 'undone') THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('action_id', OLD.id, 'from', OLD.status, 'to', NEW.status)::text;
  END IF;
  RETURN NEW;
END $$;

-- A reservation is settled exactly once; the settled row is frozen.
CREATE OR REPLACE FUNCTION public.admin_agent_usage__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF OLD.settled_at IS NOT NULL AND (NEW.input_tokens <> OLD.input_tokens OR NEW.cache_write_5m_tokens <> OLD.cache_write_5m_tokens
     OR NEW.cache_write_1h_tokens <> OLD.cache_write_1h_tokens OR NEW.cache_read_tokens <> OLD.cache_read_tokens
     OR NEW.output_tokens <> OLD.output_tokens OR NEW.cost_usd_micro <> OLD.cost_usd_micro
     OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason OR NEW.settled_at IS DISTINCT FROM OLD.settled_at) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_USAGE_SETTLED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('usage_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Triggers. BEFORE DELETE on every table; BEFORE UPDATE with the column whitelist of the table (`?col` = may only
-- change to NULL). Everything not listed is immutable, e.g. a conversation's model, effort, tool_set and context, a
-- proposal's steps and hashes, a ledger row's args.

CREATE TRIGGER trg_admin_agent_conversations_updated BEFORE UPDATE ON public.admin_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_admin_agent_plans_updated BEFORE UPDATE ON public.admin_agent_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_admin_agent_conversations_no_delete BEFORE DELETE ON public.admin_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_messages_no_delete BEFORE DELETE ON public.admin_agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_plans_no_delete BEFORE DELETE ON public.admin_agent_plans
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_plan_revisions_no_delete BEFORE DELETE ON public.admin_agent_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_proposals_no_delete BEFORE DELETE ON public.admin_agent_proposals
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_actions_no_delete BEFORE DELETE ON public.admin_agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_snapshots_no_delete BEFORE DELETE ON public.admin_agent_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_refs_no_delete BEFORE DELETE ON public.admin_agent_refs
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();
CREATE TRIGGER trg_admin_agent_usage_no_delete BEFORE DELETE ON public.admin_agent_usage
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete();

CREATE TRIGGER trg_admin_agent_conversations_guard BEFORE UPDATE ON public.admin_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update(
    '?admin_id', 'title', 'status', 'active_plan_id', 'seq_head', 'turn_lease_until', 'version',
    'blast_league_creates', 'blast_tournament_creates', 'blast_ruleset_creates', 'blast_format_creates',
    'blast_golive_executions', 'blast_pin_targets', 'last_message_at', 'updated_at');
CREATE TRIGGER trg_admin_agent_conversations_guard_extra BEFORE UPDATE ON public.admin_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent_conversations__guard();

CREATE TRIGGER trg_admin_agent_messages_guard BEFORE UPDATE ON public.admin_agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent_messages__guard();

CREATE TRIGGER trg_admin_agent_plans_guard BEFORE UPDATE ON public.admin_agent_plans
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update(
    '?admin_id', 'status', 'revision', 'doc', 'doc_hash', 'build_started_at', 'build_finished_at', 'updated_at');
CREATE TRIGGER trg_admin_agent_plans_guard_extra BEFORE UPDATE ON public.admin_agent_plans
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent_plans__guard();

-- A plan revision is append-only: nothing may change.
CREATE TRIGGER trg_admin_agent_plan_revisions_guard BEFORE UPDATE ON public.admin_agent_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update();

CREATE TRIGGER trg_admin_agent_proposals_guard BEFORE UPDATE ON public.admin_agent_proposals
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update(
    '?admin_id', 'status', 'approved_by', 'approved_at', 'approved_ip_hash', 'approved_user_agent', 'finished_at', 'executing_started_at');
CREATE TRIGGER trg_admin_agent_proposals_guard_extra BEFORE UPDATE ON public.admin_agent_proposals
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent_proposals__guard();

-- The ledger: the outcome columns are filled after the dispatch (insert first, then update). args, args_hash, the step
-- key, the tool and the class are fixed at insert.
CREATE TRIGGER trg_admin_agent_actions_guard BEFORE UPDATE ON public.admin_agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update(
    '?admin_id', 'status', 'http_status', 'outcome_kind', 'error_code', 'result', 'before', 'after', 'after_fingerprint',
    'undo', 'reversibility', 'verify', 'entity_type', 'entity_id');
CREATE TRIGGER trg_admin_agent_actions_guard_extra BEFORE UPDATE ON public.admin_agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent_actions__guard();

CREATE TRIGGER trg_admin_agent_snapshots_guard BEFORE UPDATE ON public.admin_agent_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update();
CREATE TRIGGER trg_admin_agent_refs_guard BEFORE UPDATE ON public.admin_agent_refs
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update();

CREATE TRIGGER trg_admin_agent_usage_guard BEFORE UPDATE ON public.admin_agent_usage
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent__guard_update(
    '?admin_id', '?conversation_id', 'input_tokens', 'cache_write_5m_tokens', 'cache_write_1h_tokens', 'cache_read_tokens',
    'output_tokens', 'cost_usd_micro', 'stop_reason', 'settled_at');
CREATE TRIGGER trg_admin_agent_usage_guard_extra BEFORE UPDATE ON public.admin_agent_usage
  FOR EACH ROW EXECUTE FUNCTION public.admin_agent_usage__guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Retention purge. The ONLY code path that deletes rows or nulls message content. Owner rights; sets the
-- transaction-local flag the triggers honour and clears it again. Batched: every statement touches at most p_limit rows,
-- so the job is called repeatedly until it reports zeros. The day arguments have floors so that a caller bug cannot
-- wipe the tables, and p_now may not run ahead of the clock when the caller comes through the API; a test back-dates
-- last_message_at / expires_at / approved_at instead.
--   messages_nulled        content + ui nulled, content_purged_at stamped (conversation idle for p_message_days)
--   approvals_scrubbed     approved_ip_hash / approved_user_agent nulled (p_approval_days after approval)
--   snapshots_deleted      expired snapshots
--   refs_deleted           refs of conversations idle for p_message_days
--   usage_deleted          usage rows older than p_audit_days
--   conversations_deleted  conversations idle for p_audit_days, with plans, revisions, proposals, ledger rows,
--                          messages and snapshots by cascade
CREATE OR REPLACE FUNCTION public.admin_agent_retention_purge(
  p_now           timestamptz DEFAULT now(),
  p_limit         integer     DEFAULT 1000,
  p_message_days  integer     DEFAULT 180,
  p_approval_days integer     DEFAULT 90,
  p_audit_days    integer     DEFAULT 730)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n   integer;
  v_out jsonb := '{}'::jsonb;
BEGIN
  IF p_now IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100000
     OR p_message_days IS NULL OR p_message_days < 30
     OR p_approval_days IS NULL OR p_approval_days < 30
     OR p_audit_days IS NULL OR p_audit_days < 30 THEN
    RAISE EXCEPTION 'ADMIN_AGENT_BAD_ARGUMENT' USING ERRCODE = 'P0001';
  END IF;
  -- The day floors do not protect against a far-future p_now (every row would be due). Through the API (the session
  -- user is an API role; current_user is the function owner here) the clock may be at most a minute ahead; only a
  -- maintainer's own session may pass an arbitrary time.
  IF p_now > clock_timestamp() + interval '1 minute'
     AND session_user IN ('anon', 'authenticated', 'authenticator', 'service_role') THEN
    RAISE EXCEPTION 'ADMIN_AGENT_BAD_ARGUMENT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('argument', 'p_now', 'reason', 'in_the_future')::text;
  END IF;
  PERFORM set_config('app.retention_purge', 'on', true);

  UPDATE public.admin_agent_messages m
     SET content = NULL, ui = NULL, content_purged_at = p_now
    FROM (SELECT x.conversation_id, x.seq
            FROM public.admin_agent_messages x
            JOIN public.admin_agent_conversations c ON c.id = x.conversation_id
           WHERE x.content_purged_at IS NULL
             AND c.last_message_at < p_now - make_interval(days => p_message_days)
           ORDER BY x.created_at
           LIMIT p_limit) due
   WHERE m.conversation_id = due.conversation_id AND m.seq = due.seq;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('messages_nulled', v_n);

  UPDATE public.admin_agent_proposals
     SET approved_ip_hash = NULL, approved_user_agent = NULL
   WHERE id IN (SELECT p.id FROM public.admin_agent_proposals p
                 WHERE p.approved_at < p_now - make_interval(days => p_approval_days)
                   AND (p.approved_ip_hash IS NOT NULL OR p.approved_user_agent IS NOT NULL)
                 LIMIT p_limit);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('approvals_scrubbed', v_n);

  DELETE FROM public.admin_agent_snapshots
   WHERE id IN (SELECT s.id FROM public.admin_agent_snapshots s WHERE s.expires_at < p_now LIMIT p_limit);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('snapshots_deleted', v_n);

  DELETE FROM public.admin_agent_refs
   WHERE (conversation_id, ref_kind, ref_id) IN (
           SELECT r.conversation_id, r.ref_kind, r.ref_id
             FROM public.admin_agent_refs r
             JOIN public.admin_agent_conversations c ON c.id = r.conversation_id
            WHERE c.last_message_at < p_now - make_interval(days => p_message_days)
            LIMIT p_limit);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('refs_deleted', v_n);

  DELETE FROM public.admin_agent_usage
   WHERE id IN (SELECT u.id FROM public.admin_agent_usage u WHERE u.created_at < p_now - make_interval(days => p_audit_days) LIMIT p_limit);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('usage_deleted', v_n);

  DELETE FROM public.admin_agent_conversations
   WHERE id IN (SELECT c.id FROM public.admin_agent_conversations c
                 WHERE c.last_message_at < p_now - make_interval(days => p_audit_days) LIMIT p_limit);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || jsonb_build_object('conversations_deleted', v_n);

  PERFORM set_config('app.retention_purge', 'off', true);
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Blast-radius counters (plan 6.4): all claims of one proposal succeed together or none does. The conversation row is
-- locked, every counter is checked against its cap, and only then are they incremented, in one transaction, so two
-- proposals claimed at the same moment cannot both pass. A claim is [{"counter": "league_creates", "amount": 1,
-- "cap": 3}, ...]; counters: league_creates, tournament_creates, ruleset_creates, format_creates, golive_executions,
-- pin_targets (the blast_* columns). Several entries for one counter add up and are held to the smallest cap.
-- Returns (true, NULL, NULL, NULL), or (false, <first counter over its cap>, <its value>, <its cap>) with nothing
-- changed. There is no refund: the counters count claims, not successes.
CREATE OR REPLACE FUNCTION public.admin_agent_claim_budget(p_conversation_id uuid, p_claims jsonb)
RETURNS TABLE (out_ok boolean, out_counter text, out_value integer, out_cap integer)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_allowed CONSTANT text[] := ARRAY['league_creates', 'tournament_creates', 'ruleset_creates', 'format_creates', 'golive_executions', 'pin_targets'];
  v_row     jsonb;
  c         record;
  v_value   integer;
BEGIN
  IF p_claims IS NULL OR jsonb_typeof(p_claims) <> 'array' OR jsonb_array_length(p_claims) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'ADMIN_AGENT_BAD_CLAIMS' USING ERRCODE = 'P0001';
  END IF;
  FOR c IN SELECT * FROM jsonb_to_recordset(p_claims) AS x(counter text, amount integer, cap integer) LOOP
    IF c.counter IS NULL OR c.counter <> ALL (v_allowed) OR c.amount IS NULL OR c.amount < 1 OR c.cap IS NULL OR c.cap < 0 THEN
      RAISE EXCEPTION 'ADMIN_AGENT_BAD_CLAIMS' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('counter', c.counter)::text;
    END IF;
  END LOOP;

  SELECT to_jsonb(cv) INTO v_row FROM public.admin_agent_conversations cv WHERE cv.id = p_conversation_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AGENT_CONVERSATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  FOR c IN
    SELECT x.counter, sum(x.amount)::integer AS amount, min(x.cap)::integer AS cap
      FROM jsonb_to_recordset(p_claims) AS x(counter text, amount integer, cap integer)
     GROUP BY x.counter ORDER BY x.counter
  LOOP
    v_value := (v_row ->> ('blast_' || c.counter))::integer;
    IF v_value + c.amount > c.cap THEN
      RETURN QUERY SELECT false, c.counter, v_value, c.cap;
      RETURN;
    END IF;
  END LOOP;

  FOR c IN
    SELECT x.counter, sum(x.amount)::integer AS amount
      FROM jsonb_to_recordset(p_claims) AS x(counter text, amount integer, cap integer)
     GROUP BY x.counter ORDER BY x.counter
  LOOP
    EXECUTE format('UPDATE public.admin_agent_conversations SET %I = %I + $1 WHERE id = $2', 'blast_' || c.counter, 'blast_' || c.counter)
      USING c.amount, p_conversation_id;
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, NULL::integer, NULL::integer;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Turn lease (plan 3.4). A turn takes the lease at request start and releases it in `finally`; the lease also expires
-- on its own. One turn in flight per admin across conversations (plan 6.4): the admin's lock serialises the check.
-- Returns the lease expiry (millisecond precision, so it survives a JSON round trip and can be handed back to release)
-- or NULL plus the reason: 'not_found' (no such conversation, or it belongs to another admin), 'conversation_busy',
-- 'admin_busy' (another conversation of the admin holds a live lease).
CREATE OR REPLACE FUNCTION public.admin_agent_acquire_turn_lease(p_conversation_id uuid, p_admin_id uuid, p_lease_seconds integer DEFAULT 320)
RETURNS TABLE (out_lease_until timestamptz, out_busy text)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_owner timestamptz;
  v_admin uuid;
  v_now   timestamptz := clock_timestamp();
  v_until timestamptz;
BEGIN
  IF p_conversation_id IS NULL OR p_admin_id IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 900 THEN
    RAISE EXCEPTION 'ADMIN_AGENT_BAD_ARGUMENT' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('admin_agent_turn:' || p_admin_id::text));
  SELECT c.admin_id, c.turn_lease_until INTO v_admin, v_owner
    FROM public.admin_agent_conversations c WHERE c.id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_admin IS DISTINCT FROM p_admin_id THEN
    RETURN QUERY SELECT NULL::timestamptz, 'not_found'::text;
    RETURN;
  END IF;
  IF v_owner IS NOT NULL AND v_owner > v_now THEN
    RETURN QUERY SELECT NULL::timestamptz, 'conversation_busy'::text;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_agent_conversations o
              WHERE o.admin_id = p_admin_id AND o.id <> p_conversation_id AND o.turn_lease_until > v_now) THEN
    RETURN QUERY SELECT NULL::timestamptz, 'admin_busy'::text;
    RETURN;
  END IF;
  v_until := date_trunc('milliseconds', v_now + make_interval(secs => p_lease_seconds));
  UPDATE public.admin_agent_conversations SET turn_lease_until = v_until WHERE id = p_conversation_id;
  RETURN QUERY SELECT v_until, NULL::text;
END $$;

-- Releases the lease only if it is still the caller's (a successor that took over after expiry keeps its own).
CREATE OR REPLACE FUNCTION public.admin_agent_release_turn_lease(p_conversation_id uuid, p_lease_until timestamptz)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.admin_agent_conversations SET turn_lease_until = NULL
   WHERE id = p_conversation_id AND turn_lease_until = p_lease_until;
  RETURN FOUND;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Usage reservation (plan 6.4). Reserve before a model call: under one global lock, sums what was spent and reserved
-- (a settled row counts its cost, an unsettled one its reservation) and refuses when the new estimate would pass a cap;
-- otherwise inserts the reservation row. Every cap is required (NULL would silently disable it): fail closed.
-- The caller passes the window starts (p_day_since, p_month_since) so that the window policy lives in the app.
-- Returns (usage id, NULL, NULL, NULL) or (NULL, 'conversation' | 'admin_day' | 'admin_month' | 'global_day', used, cap).
CREATE OR REPLACE FUNCTION public.admin_agent_reserve_usage(
  p_admin_id uuid, p_admin_name text, p_conversation_id uuid, p_purpose text, p_model text,
  p_estimate_usd_micro bigint,
  p_cap_conversation bigint, p_cap_admin_day bigint, p_cap_admin_month bigint, p_cap_global_day bigint,
  p_day_since timestamptz, p_month_since timestamptz)
RETURNS TABLE (out_usage_id uuid, out_exceeded text, out_used bigint, out_cap bigint)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_used bigint;
  v_id   uuid;
BEGIN
  IF p_cap_conversation IS NULL OR p_cap_admin_day IS NULL OR p_cap_admin_month IS NULL OR p_cap_global_day IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AGENT_CAP_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_admin_id IS NULL OR p_admin_name IS NULL OR p_purpose IS NULL OR p_model IS NULL OR p_estimate_usd_micro IS NULL
     OR p_estimate_usd_micro < 0 OR p_day_since IS NULL OR p_month_since IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AGENT_BAD_ARGUMENT' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('admin_agent_usage'));

  IF p_conversation_id IS NOT NULL THEN
    SELECT coalesce(sum(CASE WHEN u.settled_at IS NULL THEN u.reserved_usd_micro ELSE u.cost_usd_micro END), 0) INTO v_used
      FROM public.admin_agent_usage u WHERE u.conversation_id = p_conversation_id;
    IF v_used + p_estimate_usd_micro > p_cap_conversation THEN
      RETURN QUERY SELECT NULL::uuid, 'conversation'::text, v_used, p_cap_conversation;
      RETURN;
    END IF;
  END IF;
  SELECT coalesce(sum(CASE WHEN u.settled_at IS NULL THEN u.reserved_usd_micro ELSE u.cost_usd_micro END), 0) INTO v_used
    FROM public.admin_agent_usage u WHERE u.admin_id = p_admin_id AND u.created_at >= p_day_since;
  IF v_used + p_estimate_usd_micro > p_cap_admin_day THEN
    RETURN QUERY SELECT NULL::uuid, 'admin_day'::text, v_used, p_cap_admin_day;
    RETURN;
  END IF;
  SELECT coalesce(sum(CASE WHEN u.settled_at IS NULL THEN u.reserved_usd_micro ELSE u.cost_usd_micro END), 0) INTO v_used
    FROM public.admin_agent_usage u WHERE u.admin_id = p_admin_id AND u.created_at >= p_month_since;
  IF v_used + p_estimate_usd_micro > p_cap_admin_month THEN
    RETURN QUERY SELECT NULL::uuid, 'admin_month'::text, v_used, p_cap_admin_month;
    RETURN;
  END IF;
  SELECT coalesce(sum(CASE WHEN u.settled_at IS NULL THEN u.reserved_usd_micro ELSE u.cost_usd_micro END), 0) INTO v_used
    FROM public.admin_agent_usage u WHERE u.created_at >= p_day_since;
  IF v_used + p_estimate_usd_micro > p_cap_global_day THEN
    RETURN QUERY SELECT NULL::uuid, 'global_day'::text, v_used, p_cap_global_day;
    RETURN;
  END IF;

  INSERT INTO public.admin_agent_usage (admin_id, admin_name, conversation_id, purpose, model, reserved_usd_micro)
  VALUES (p_admin_id, p_admin_name, p_conversation_id, p_purpose, p_model, p_estimate_usd_micro)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, NULL::text, NULL::bigint, NULL::bigint;
END $$;

-- Settles a reservation once with the real meters and cost (cost 0 releases a call that was never made).
CREATE OR REPLACE FUNCTION public.admin_agent_settle_usage(
  p_usage_id uuid, p_input_tokens bigint, p_cache_write_5m_tokens bigint, p_cache_write_1h_tokens bigint,
  p_cache_read_tokens bigint, p_output_tokens bigint, p_cost_usd_micro bigint, p_stop_reason text)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.admin_agent_usage
     SET input_tokens = p_input_tokens, cache_write_5m_tokens = p_cache_write_5m_tokens,
         cache_write_1h_tokens = p_cache_write_1h_tokens, cache_read_tokens = p_cache_read_tokens,
         output_tokens = p_output_tokens, cost_usd_micro = p_cost_usd_micro, stop_reason = p_stop_reason,
         settled_at = clock_timestamp()
   WHERE id = p_usage_id AND settled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_AGENT_USAGE_NOT_FOUND' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('usage_id', p_usage_id)::text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- RLS on, no policies, service_role only (tables and functions). The tables are revoked from service_role first: Supabase's default
-- privileges hand it ALL (DELETE and TRUNCATE included) on every new table, and the grant below must be the whole list.
ALTER TABLE public.admin_agent_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_proposals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_actions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_refs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_usage          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_agent_conversations  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_messages       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_plans          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_plan_revisions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_proposals      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_actions        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_snapshots      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_refs           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_agent_usage          FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_conversations  TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_messages       TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_plans          TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_plan_revisions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_proposals      TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_actions        TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_snapshots      TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_refs           TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_agent_usage          TO service_role;

REVOKE ALL ON FUNCTION public.admin_agent__purging() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent__forbid_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent__guard_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_conversations__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_plans__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_messages__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_proposals__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_actions__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_usage__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_retention_purge(timestamptz, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_claim_budget(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_acquire_turn_lease(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_release_turn_lease(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_reserve_usage(uuid, text, uuid, text, text, bigint, bigint, bigint, bigint, bigint, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_settle_usage(uuid, bigint, bigint, bigint, bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_agent__purging() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent__forbid_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent__guard_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_conversations__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_plans__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_messages__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_proposals__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_actions__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_usage__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_retention_purge(timestamptz, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_claim_budget(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_acquire_turn_lease(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_release_turn_lease(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_reserve_usage(uuid, text, uuid, text, text, bigint, bigint, bigint, bigint, bigint, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_settle_usage(uuid, bigint, bigint, bigint, bigint, bigint, bigint, text) TO service_role;

COMMENT ON TABLE public.admin_agent_conversations IS
  'Service-role only. Admin Assistant conversations (docs/poketools-spec.md 4.14). Not agent_conversations (the player agent). Isolation between admins is code, not RLS. No RLS policies by design.';
COMMENT ON TABLE public.admin_agent_messages IS
  'Service-role only. Append-only Admin Assistant transcript; content and ui are nulled by admin_agent_retention_purge() 180 days after the last message.';
COMMENT ON TABLE public.admin_agent_plans IS
  'Service-role only. The Plan document of an Admin Assistant conversation.';
COMMENT ON TABLE public.admin_agent_plan_revisions IS
  'Service-role only. Append-only history of a plan.';
COMMENT ON TABLE public.admin_agent_proposals IS
  'Service-role only. Hash-bound confirmation proposals; immutable except status, approved_* and the execution timestamps.';
COMMENT ON TABLE public.admin_agent_actions IS
  'Service-role only. The Admin Assistant ledger: every real write and private draft write. entity_id has no foreign key on purpose (league recycle bin rule in AGENTS.md).';
COMMENT ON TABLE public.admin_agent_snapshots IS
  'Service-role only. The previous draft document before a draft save, 30-day retention, for the draft-save undo.';
COMMENT ON TABLE public.admin_agent_refs IS
  'Service-role only. The ids a conversation has legitimately seen (provenance of staged writes).';
COMMENT ON TABLE public.admin_agent_usage IS
  'Service-role only. One row per model call: meters, cost, and the cost reserved before the call (admin_agent_reserve_usage / admin_agent_settle_usage).';
COMMENT ON COLUMN public.admin_agent_actions.entity_id IS
  'The entity a write created or changed. NO foreign key: the entity may be deleted later, and a key into the league subtree would make every league delete fail.';
COMMENT ON FUNCTION public.admin_agent_retention_purge(timestamptz, integer, integer, integer, integer) IS
  'Service-role only. The only code path that deletes admin_agent_* rows or nulls message content; sets the transaction-local flag app.retention_purge that the triggers honour. Batched by p_limit.';

COMMIT;
