-- players.sessions_valid_after: the account-level session epoch.
--
-- A session token carries the time it was issued by a sign-in (`authAt`). A token issued before this
-- value is dead: the guards answer 401 and the session ends. The application moves the value forward on
-- a password reset, a ban or suspension, a guest claim and "sign out everywhere"; it never moves it back,
-- so an unsuspend does not revive an old token.
--
-- '-infinity' means no revocation yet: every existing row keeps accepting every token. The default is a
-- constant, so the column is added without rewriting the table. The value is written with the application
-- clock, the same clock that stamps `authAt`.
--
-- Grants: none added. anon and authenticated hold no privilege on `players` (20261008081443); a new
-- column on that table inherits nothing for them. RLS stays enabled.
-- DEPLOY ORDER: this file before the code that selects the column (the session read would fail without it).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS sessions_valid_after timestamp with time zone NOT NULL DEFAULT '-infinity';

COMMIT;
