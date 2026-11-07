-- Format engine: every league attached before the kit engine existed keeps running on the legacy engine.
--
-- season_formats.engine   legacy | shadow | kit (20261024100200). The column defaulted to 'kit' while nothing read it;
--                         the attached leagues were scheduled, scored and advanced by the legacy code. From this
--                         release the kit engine runs a 'kit' league, so the rows that exist now move to 'legacy'
--                         and an admin switches each league (Format tab, through 'shadow' first) once the diff is
--                         clean. A league attached after this migration starts on the column default, 'kit'.
--
-- League recycle bin: a league that was deleted before this release sits in league_trash_tables with its season_formats row as
--                         it was (engine 'kit', the old column default). Restoring it would put a pre-release league on the
--                         kit engine, so the captured rows move to 'legacy' as well.
--
-- Data only: no grants, no function. Deploy order: before the code (the code reads engine to pick the engine).
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.season_formats SET engine = 'legacy' WHERE engine <> 'legacy';

-- The captured rows are a jsonb array of to_jsonb(row); only a snapshot that carries the engine column is touched, and the
-- element order is kept.
UPDATE public.league_trash_tables lt
   SET rows = (SELECT jsonb_agg(CASE WHEN r.value ->> 'engine' IS DISTINCT FROM 'legacy' THEN jsonb_set(r.value, '{engine}', '"legacy"'::jsonb) ELSE r.value END
                                ORDER BY r.ord)
                 FROM jsonb_array_elements(lt.rows) WITH ORDINALITY AS r(value, ord))
 WHERE lt.rel = 'season_formats' AND lt.n > 0 AND lt.cols ? 'engine'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(lt.rows) r WHERE r ->> 'engine' IS DISTINCT FROM 'legacy');

COMMIT;
