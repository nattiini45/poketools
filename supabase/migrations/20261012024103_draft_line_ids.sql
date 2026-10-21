-- Draft line identity (EvoLiga draft tool, Prompt 0 §3; draft-backend §4.1, package B-LINE, migration M1).
-- Stable text line_id on point-buy list entries, evolution trackers and draft picks; tracker uniqueness per line.
--
-- line_id = epb_fold_id(base) || '--' || epb_fold_id(final stage), final stage = stage 3, else stage 2.
-- epb_fold_id is byte-identical to toID in src/lib/pkmn/i18n/id.ts: ♀ → f, ♂ → m, NFKD, strip U+0300–U+036F,
-- lowercase, drop [^a-z0-9]. (The design text said NFD; the landed toID uses NFKD, and the SQL follows it.)
-- A trigger fills line_id on insert and refuses a supplied line_id that differs from the SQL computation,
-- so a TS/SQL fold drift fails the import instead of storing two spellings.
--
-- Placeholder version: renamed to the recorded version at apply time (APPLY package). Sorts after
-- 20261010110000_seasons_language.sql. Not applied by B-LINE.
BEGIN;

CREATE OR REPLACE FUNCTION public.epb_fold_id(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
           lower(regexp_replace(
             normalize(replace(replace(p_name, U&'\2640', 'f'), U&'\2642', 'm'), NFKD),
             '[̀-ͯ]', '', 'g')),
           '[^a-z0-9]+', '', 'g')
$$;
COMMENT ON FUNCTION public.epb_fold_id(text) IS
  'Pokémon id fold; identical to toID in src/lib/pkmn/i18n/id.ts (Flabébé -> flabebe, Nidoran♀ -> nidoranf).';

CREATE OR REPLACE FUNCTION public.epb_line_id(p_base text, p_stage2 text, p_stage3 text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.epb_fold_id(p_base) || '--' || public.epb_fold_id(COALESCE(p_stage3, p_stage2))
$$;
COMMENT ON FUNCTION public.epb_line_id(text, text, text) IS
  'Draft line id; identical to toLineId/lineIdOfEntry in src/lib/draft/line-identity.ts.';

-- 1. list entries
ALTER TABLE public.point_buy_list_entries ADD COLUMN IF NOT EXISTS line_id text;
ALTER TABLE public.point_buy_list_entries DISABLE TRIGGER trg_pble_immutable;   -- derived identity, not a content change
UPDATE public.point_buy_list_entries
   SET line_id = public.epb_line_id(base_pokemon, stage2_pokemon, stage3_pokemon)
 WHERE line_id IS NULL;
UPDATE public.point_buy_list_entries                                              -- Flabébé species id fix ('flabb')
   SET species_ids = jsonb_set(species_ids, '{base}', '"flabebe"')
 WHERE species_ids->>'base' = 'flabb';
ALTER TABLE public.point_buy_list_entries ENABLE TRIGGER trg_pble_immutable;
ALTER TABLE public.point_buy_list_entries ALTER COLUMN line_id SET NOT NULL;
ALTER TABLE public.point_buy_list_entries
  ADD CONSTRAINT point_buy_list_entries_line_id_format CHECK (line_id ~ '^[a-z0-9]+--[a-z0-9]+$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_pble_version_line_id ON public.point_buy_list_entries (list_version_id, line_id);
COMMENT ON COLUMN public.point_buy_list_entries.line_id IS
  'Stable draft line id toID(base)--toID(final stage); filled and checked by trg_pble_line_id.';

CREATE OR REPLACE FUNCTION public.pble_set_line_id() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_expected text := public.epb_line_id(NEW.base_pokemon, NEW.stage2_pokemon, NEW.stage3_pokemon);
BEGIN
  IF NEW.line_id IS NULL THEN NEW.line_id := v_expected;
  ELSIF NEW.line_id <> v_expected THEN
    RAISE EXCEPTION 'line_id % does not match computed %', NEW.line_id, v_expected USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pble_line_id BEFORE INSERT OR UPDATE ON public.point_buy_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.pble_set_line_id();

-- 2. trackers
ALTER TABLE public.evolution_tracker
  ADD COLUMN IF NOT EXISTS line_id text,
  ADD COLUMN IF NOT EXISTS transferred_evo_progress smallint NOT NULL DEFAULT 0
    CONSTRAINT evolution_tracker_transferred_nonneg CHECK (transferred_evo_progress >= 0),
  ADD COLUMN IF NOT EXISTS redraft_slot_id uuid;                                  -- FK added in M3
UPDATE public.evolution_tracker t SET line_id = e.line_id
  FROM public.seasons s, public.point_buy_list_entries e
 WHERE t.line_id IS NULL AND t.season_id = s.id AND e.list_version_id = s.point_buy_list_id
   AND e.base_pokemon = t.base_pokemon
   AND ( (t.locked_stage3_pokemon IS NOT NULL AND e.stage3_pokemon = t.locked_stage3_pokemon)
      OR (t.locked_stage3_pokemon IS NULL AND (SELECT count(*) FROM public.point_buy_list_entries e2
            WHERE e2.list_version_id = e.list_version_id AND e2.base_pokemon = t.base_pokemon) = 1) );
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.evolution_tracker t JOIN public.seasons s ON s.id = t.season_id
   WHERE s.point_buy_list_id IS NOT NULL AND t.line_id IS NULL;
  IF n > 0 THEN RAISE NOTICE 'M1: % EPB trackers without line_id (ambiguous branch); resolve by hand', n; END IF;
END $$;
DROP INDEX IF EXISTS public.idx_evolution_tracker_unique;                         -- baseline:2187 (season, player, base)
CREATE UNIQUE INDEX uq_evolution_tracker_season_line ON public.evolution_tracker (season_id, line_id) WHERE line_id IS NOT NULL;
CREATE UNIQUE INDEX uq_evolution_tracker_legacy_base ON public.evolution_tracker (season_id, player_id, base_pokemon) WHERE line_id IS NULL;
COMMENT ON COLUMN public.evolution_tracker.line_id IS 'Draft line id (point_buy_list_entries.line_id); one tracker per line per season. NULL for legacy evolution-tier leagues.';
COMMENT ON COLUMN public.evolution_tracker.real_kills IS 'Spec self_earned_kills: match-earned KOs of this line only. The only number shown as kills.';
COMMENT ON COLUMN public.evolution_tracker.transferred_evo_progress IS 'Spec transferred_evo_progress: real kills transferred from a redraft slot. Evolution only.';
COMMENT ON COLUMN public.evolution_tracker.draft_tokens IS 'Spec draft_token_progress (Draft Kill Tokens).';
COMMENT ON COLUMN public.evolution_tracker.kill_tokens IS 'Spec comeback_token_progress (Comeback Tokens).';
COMMENT ON COLUMN public.evolution_tracker.cosmo_points IS 'Spec cosmo_token_progress (Cosmo Tokens, Cosmog line only).';
COMMENT ON COLUMN public.evolution_tracker.total_kos IS 'Total eligible evolution progress = sum of the five source columns. Never displayed as kills.';

-- 3. picks
ALTER TABLE public.draft_picks
  ADD COLUMN IF NOT EXISTS line_id text,
  ADD COLUMN IF NOT EXISTS line_entry_id uuid REFERENCES public.point_buy_list_entries(id);
UPDATE public.draft_picks p SET line_id = t.line_id, line_entry_id = e.id
  FROM public.draft_pools dp, public.seasons s, public.evolution_tracker t, public.point_buy_list_entries e
 WHERE p.line_id IS NULL AND p.draft_pool_id = dp.id AND dp.season_id = s.id AND s.point_buy_list_id IS NOT NULL
   AND t.season_id = s.id AND t.player_id = p.player_id AND t.base_pokemon = p.pokemon_name AND t.line_id IS NOT NULL
   AND e.list_version_id = s.point_buy_list_id AND e.line_id = t.line_id;
UPDATE public.draft_picks p SET line_id = e.line_id, line_entry_id = e.id                 -- fallback: unique base in the list
  FROM public.draft_pools dp, public.seasons s, public.point_buy_list_entries e
 WHERE p.line_id IS NULL AND p.draft_pool_id = dp.id AND dp.season_id = s.id
   AND e.list_version_id = s.point_buy_list_id AND e.base_pokemon = p.pokemon_name
   AND (SELECT count(*) FROM public.point_buy_list_entries e2 WHERE e2.list_version_id = e.list_version_id AND e2.base_pokemon = p.pokemon_name) = 1;
COMMENT ON COLUMN public.draft_picks.line_id IS 'Draft line id of an EPB pick (branch-exact); NULL for non-EPB drafts.';

REVOKE ALL ON FUNCTION public.epb_fold_id(text), public.epb_line_id(text, text, text), public.pble_set_line_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.epb_fold_id(text), public.epb_line_id(text, text, text), public.pble_set_line_id() TO service_role;
COMMIT;
