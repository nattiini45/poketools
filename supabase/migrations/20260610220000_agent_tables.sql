-- ---------------------------------------------------------------------------
-- AI Agent — user memory & profile tables (PRD §6, v1 schema)
-- ---------------------------------------------------------------------------
-- Adds the three v1 tables backing the rebuilt AI agent's per-player memory:
--   * user_agent_profile  — one row per player (preferences, persona, model priority)
--   * agent_conversations — rolling 30-day conversation store
--   * agent_suggestions   — consolidated team/strategy proposals per conversation
--
-- Keying: this app uses NextAuth + Discord OAuth, NOT Supabase Auth. There is
-- no auth.users table, so all foreign keys reference players(id). Authorization
-- is enforced in API routes via requirePlayer(); RLS is defense-in-depth only.
-- Tables are service-role-only — no auth.uid() policies (always null here).
-- Mirrors the service-role policy form used in the baseline migration
-- (20260608100000_baseline_professional_schema.sql / 20260608100003_advisor_fixes.sql).
-- ---------------------------------------------------------------------------

-- One row per player
CREATE TABLE user_agent_profile (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  favorite_pokemon TEXT[] DEFAULT '{}',
  preferred_formats TEXT[] DEFAULT '{}',
  play_style_tags TEXT[] DEFAULT '{}',
  default_persona TEXT NOT NULL DEFAULT 'linden_teambuilding',
  model_priority JSONB NOT NULL DEFAULT '["mimo-v2.5-pro","deepseek-v4-pro","claude-haiku-4-5"]',
  opt_in_data_collection BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rolling conversation store (30-day active window)
CREATE TABLE agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  persona TEXT NOT NULL,
  messages JSONB NOT NULL,            -- [{ role, content, tool_calls, tool_results }]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_agent_conversations_player ON agent_conversations (player_id, last_message_at DESC);

-- One row per suggestion (consolidated proposal blob)
CREATE TABLE agent_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE SET NULL,   -- if targeting an upcoming match
  context_format TEXT NOT NULL,
  proposed_team JSONB,               -- single consolidated blob: [{ species, item, ability, moves, evs, ivs, nature } × n]
  reasoning TEXT,
  topic_tags TEXT[] DEFAULT '{}',
  user_accepted_at TIMESTAMPTZ,
  user_rejected_at TIMESTAMPTZ,
  suggested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_suggestions_player_match ON agent_suggestions (player_id, match_id);
CREATE INDEX idx_agent_suggestions_player_time ON agent_suggestions (player_id, suggested_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: service-role-only (authorization enforced in API routes)
-- ---------------------------------------------------------------------------

ALTER TABLE user_agent_profile  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_suggestions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access user_agent_profile"
  ON public.user_agent_profile FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access agent_conversations"
  ON public.agent_conversations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access agent_suggestions"
  ON public.agent_suggestions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- updated_at maintenance — keep user_agent_profile.updated_at fresh on UPDATE.
-- Reuses the shared trigger function from the baseline migration
-- (20260608100000_baseline_professional_schema.sql), mirroring its trg_<table>_updated naming.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER "trg_user_agent_profile_updated"
  BEFORE UPDATE ON "public"."user_agent_profile"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();
