-- stage_order orders a season's phases. A tournament without a season (a standalone one) has no phases to
-- order, so its stage_order is meaningless noise — anything else but 0 there is a write-path bug (the
-- league-phase create paths always set it from the phase list). Pin it at the database, not only in the
-- application: the CHECK refuses a season-less row with any other value, on both INSERT and UPDATE.
--
-- The precheck fails the migration when a violating row already exists; fix that row first (production held
-- none on 2026-11-23).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.tournaments WHERE season_id IS NULL AND stage_order <> 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'tournaments holds % season-less rows with stage_order <> 0; reset them to 0 first', n;
  END IF;
END $$;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_stage_order_seasonless_check
  CHECK (season_id IS NOT NULL OR stage_order = 0);

COMMIT;
