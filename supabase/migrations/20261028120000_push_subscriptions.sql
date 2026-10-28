-- Web Push subscriptions for draft turn alerts (docs/push.md).
--
-- One row per browser/device a player enabled push on. The row holds the browser vendor's push endpoint and the two
-- public key parts the sender needs to encrypt a payload for it (p256dh, auth). They are personal data of the same
-- class as a device token: they exist until the player removes the device, the push service reports the endpoint
-- gone (404/410), repeated sends fail, or the player is deleted (ON DELETE CASCADE).
--
--   endpoint          the push service URL, unique across all players: a browser that signs in as another player
--                     re-binds its endpoint to that player (an upsert on this column). https only, length-capped.
--   locale            'en' | 'de', the UI language at subscribe time; the alert text is built server-side in it.
--   user_agent_label  a short label derived on the server ("Chrome on Android"); the raw User-Agent is never stored.
--   last_success_at   the last time the push service accepted a message for this endpoint.
--   failure_count     consecutive failed sends; reset on success, the row is deleted after a threshold.
--
-- The per-player device cap (oldest dropped) lives in the application (src/lib/supabase/queries/push-subscriptions.ts).
--
-- Service-role only: RLS enabled with no policies, privileges granted to service_role only
-- (AGENTS.md "Never Do"; src/lib/supabase/__tests__/migration-api-grants.test.ts). The table references only
-- players, so the league recycle bin inventory needs no entry.
BEGIN;

CREATE TABLE public.push_subscriptions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  endpoint         text        NOT NULL,
  p256dh           text        NOT NULL,
  auth             text        NOT NULL,
  locale           text        NOT NULL DEFAULT 'en',
  user_agent_label text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  failure_count    integer     NOT NULL DEFAULT 0,
  CONSTRAINT push_subscriptions_endpoint_key        UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_https      CHECK (endpoint ~ '^https://'),
  CONSTRAINT push_subscriptions_endpoint_length     CHECK (char_length(endpoint) <= 1024),
  CONSTRAINT push_subscriptions_p256dh_length       CHECK (char_length(p256dh) BETWEEN 1 AND 256),
  CONSTRAINT push_subscriptions_auth_length         CHECK (char_length(auth) BETWEEN 1 AND 64),
  CONSTRAINT push_subscriptions_locale_check        CHECK (locale IN ('en', 'de')),
  CONSTRAINT push_subscriptions_label_length        CHECK (user_agent_label IS NULL OR char_length(user_agent_label) <= 80),
  CONSTRAINT push_subscriptions_failure_count_check CHECK (failure_count >= 0)
);

-- "My devices" and the per-player cap read one player's rows, oldest first.
CREATE INDEX idx_push_subscriptions_player ON public.push_subscriptions (player_id, created_at);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO service_role;
COMMENT ON TABLE public.push_subscriptions IS
  'Service-role only. Web Push endpoints and keys of a player''s devices (draft turn alerts). No RLS policies by design.';

COMMIT;
