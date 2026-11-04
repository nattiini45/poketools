-- Format engine: every league attached before the kit engine existed keeps running on the legacy engine.
--
-- season_formats.engine   legacy | shadow | kit (20261024100200). The column defaulted to 'kit' while nothing read it;
--                         the attached leagues were scheduled, scored and advanced by the legacy code. From this
--                         release the kit engine runs a 'kit' league, so the rows that exist now move to 'legacy'
--                         and an admin switches each league (Format tab, through 'shadow' first) once the diff is
--                         clean. A league attached after this migration starts on the column default, 'kit'.
--
-- Data only: no grants, no function. Deploy order: before the code (the code reads engine to pick the engine).
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.season_formats SET engine = 'legacy' WHERE engine <> 'legacy';

COMMIT;
