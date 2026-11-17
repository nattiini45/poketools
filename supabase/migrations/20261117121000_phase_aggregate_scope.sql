BEGIN;
ALTER TYPE public.aggregate_scope ADD VALUE IF NOT EXISTS 'phase';
COMMIT;
