-- One battle_stats row per Pokémon per player per game (owner decision 2026-10-20 on audit lead CF-06,
-- docs/security/audit-2026-10-20/README.md).
--
-- CF-06: repeated battle-stat rows let one participant multiply recorded KOs, evolution progress and aggregates. 0.2.2
-- closed it in the request schemas (src/lib/validation/schemas.ts: at most one block per player, no Pokémon twice in a
-- block, compared as pokemon_name.trim().toLowerCase()); the admin game edit schema now applies the same rule. This
-- migration is the database backstop for any writer that skips those schemas.
--
-- UNIQUE INDEX battle_stats_game_player_pokemon_key ON battle_stats (game_id, player_id, lower(btrim(pokemon_name))):
-- the case- and padding-insensitive key of the app check. createBattleStats (src/lib/supabase/queries/games.ts) maps
-- a violation to 409 battle_stats_duplicate_pokemon; the failed insert writes no row. The replay parser emits one row
-- per Pokémon per side (one tracker per species name), so a replay result never reaches it.
--
-- The DO block checks the normalised key the
-- index enforces (case or padding variants included) and fails loudly, never deletes: resolve a reported game through
-- the admin game editor (which replaces the game's rows) first.
--
-- idx_battle_stats_game (game_id) stays: the new index leads with game_id too, but dropping an index is a separate
-- decision. Locks: CREATE UNIQUE INDEX takes a SHARE lock on battle_stats while it builds (writes wait;
-- check the live row count before applying, docs/operations-backup.md).
--
-- No new grants: anon and authenticated hold nothing on public.battle_stats (20261008081443_close_public_api_roles.sql);
-- service_role is unaffected. RLS on battle_stats is unchanged.
BEGIN;

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.battle_stats
     GROUP BY game_id, player_id, lower(btrim(pokemon_name))
    HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'battle_stats holds % (game_id, player_id, Pokémon) keys with more than one row; fix those games through the admin game editor first', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS battle_stats_game_player_pokemon_key
  ON public.battle_stats (game_id, player_id, lower(btrim(pokemon_name)));

COMMIT;
