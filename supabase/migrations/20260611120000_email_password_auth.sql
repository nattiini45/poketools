-- Email/password auth support: players may be identified by either a Discord
-- ID or a Supabase Auth user (auth_user_id), but never neither.
-- No FK to auth.users: an ON DELETE SET NULL could violate the identity CHECK;
-- auth-user deletion is cascaded in app code (player delete route).

ALTER TABLE public.players ALTER COLUMN discord_id DROP NOT NULL;

ALTER TABLE public.players
  ADD CONSTRAINT players_auth_user_id_key UNIQUE (auth_user_id);

ALTER TABLE public.players
  ADD CONSTRAINT players_identity_check
  CHECK (discord_id IS NOT NULL OR auth_user_id IS NOT NULL);
