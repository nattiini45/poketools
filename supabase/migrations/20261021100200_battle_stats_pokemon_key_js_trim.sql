-- The battle_stats one-row-per-Pokémon key trims what the app trims (PR #12 review on
-- 20261020100100_battle_stats_unique_pokemon.sql, audit lead CF-06).
--
-- 20261020100100 keyed the unique index battle_stats_game_player_pokemon_key on lower(btrim(pokemon_name)). btrim
-- strips only spaces, while the request schemas compare battleStatPokemonKey(name) = name.trim().toLowerCase()
-- (src/lib/validation/schemas.ts), and JavaScript's trim strips every WhiteSpace and LineTerminator code point. So a
-- writer that skips the schemas could store '<TAB>Pikachu' (or a no-break-space variant) beside 'Pikachu' in one game.
--
-- The index is rebuilt under the same name (createBattleStats, src/lib/supabase/queries/games.ts, maps a violation of
-- that name to 409 battle_stats_duplicate_pokemon) on
--   lower(regexp_replace(pokemon_name, '^[set]+|[set]+$', '', 'g'))
-- where [set] is exactly JavaScript's trim set (ECMA-262 WhiteSpace + LineTerminator, all in the BMP):
--   U+0009-U+000D (TAB LF VT FF CR), U+0020, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F,
--   U+3000, U+FEFF.
-- The set is written as explicit regex character-entry escapes, not \s or [[:space:]] (those follow the database
-- locale, e.g. they may take U+0085, which JavaScript keeps). The test
-- src/lib/validation/__tests__/battle-stats-pokemon-key.test.ts reads this file and checks the set against
-- String.prototype.trim for every BMP code point; the local stack strips exactly these 25 code points.
-- regexp_replace and lower are IMMUTABLE, so the expression is indexable.
--
-- Live-safe: every key that 20261020100100 kept apart and this one merges differs only in leading or trailing
-- whitespace other than spaces. The DO block checks the new key and fails loudly, never deletes: resolve a reported
-- game through the admin game editor (which replaces the game's rows) first.
--
-- DROP and CREATE run in one transaction, so no writer ever sees battle_stats without the backstop. Locks: DROP INDEX
-- takes an ACCESS EXCLUSIVE lock on battle_stats until COMMIT and the rebuild scans the table (reads and writes wait;
-- check the live row count before applying, docs/operations-backup.md).
--
-- No new grants; RLS on battle_stats is unchanged.
BEGIN;

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.battle_stats
     GROUP BY game_id, player_id,
              lower(regexp_replace(pokemon_name,
                '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
                '', 'g'))
    HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'battle_stats holds % (game_id, player_id, Pokémon) keys with more than one row; fix those games through the admin game editor first', n;
  END IF;
END $$;

DROP INDEX IF EXISTS public.battle_stats_game_player_pokemon_key;

CREATE UNIQUE INDEX battle_stats_game_player_pokemon_key
  ON public.battle_stats (game_id, player_id,
    lower(regexp_replace(pokemon_name,
      '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
      '', 'g')));

COMMIT;
