-- Swiss and round robin byes are stored on the round that gave them.
--
-- Before, a pairing result's bye_player_ids (swiss.ts / round-robin.ts) created no match and was kept nowhere. The
-- Swiss "no second bye" check (havePlayed(history, player, BYE_PLAYER_ID)) therefore never fired, so the bottom player
-- could draw the bye every round, and the bye earned nothing in the standings.
-- After:
--   rounds.bye_player_ids  the players who sat the round out with a bye (empty for a round without one). It holds
--                          players.id values; there is no foreign key on an array, so the application writes only ids
--                          of the tournament's participants. Only the Swiss and round robin generators fill it;
--                          elimination byes are structural (a pre-advanced slot) and stay out of it.
--                          Swiss pairing reads it as "has had a bye", and Swiss standings count it as a win (no games,
--                          no kills and no opponent, so it adds nothing to Buchholz). Round robin standings ignore it.
--                          Deleting the round deletes its byes with it.
-- Existing rounds get '{}', so every completed season's standings stay as they were.
-- No grants: the column inherits the table privileges of public.rounds. The API roles (anon, authenticated) hold no
-- table grants there (20261008081443_close_public_api_roles.sql), so only service_role reads or writes it; the
-- baseline 'Public read rounds' RLS policy is irrelevant without a grant.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the application code. A round with a bye (every round of an odd
-- round robin, an odd Swiss round, a manual round with one unpaired player) inserts bye_player_ids; before the column
-- exists that insert fails with a missing-column error. Rounds without a bye omit the column and are safe either way.
BEGIN;

ALTER TABLE public.rounds
  ADD COLUMN bye_player_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.rounds.bye_player_ids IS
  'Players who sat this round out with a bye (Swiss / round robin). Swiss pairing skips a player who already has one; Swiss standings count it as a win. Elimination byes are structural and not stored here.';

COMMIT;
