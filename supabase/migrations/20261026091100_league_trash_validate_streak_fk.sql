-- League recycle bin, part 2 of 6: validates the player_streaks.last_match_id key that part 1 swapped to ON DELETE SET
-- NOT VALID (every new row was checked since part 1; this scans the existing rows with the weaker lock, per
-- docs/operations-backup.md: reads and writes continue).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.player_streaks VALIDATE CONSTRAINT player_streaks_last_match_id_fkey;
COMMIT;
