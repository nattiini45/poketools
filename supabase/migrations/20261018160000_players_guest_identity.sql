-- Guest players (admin-created rows without Discord or Supabase Auth identity).
--
-- 20260611120000_email_password_auth.sql added players_identity_check as
--   CHECK (discord_id IS NOT NULL OR auth_user_id IS NOT NULL).
-- 20260822190000_league_phase_revamp_wave1.sql later added players.is_guest (NOT NULL DEFAULT false) for admin-created
-- guests, but never relaxed the check. Every guest insert (POST /api/players with is_guest) therefore failed with
-- SQLSTATE 23514 on players_identity_check, surfaced as the generic "Failed to create player".
--
--   1. players_identity_check now also admits guests:
--        CHECK (discord_id IS NOT NULL OR auth_user_id IS NOT NULL OR is_guest)
--      The new predicate is strictly looser than the old one, so every existing row (all of which satisfied the old
--      check; guests could never be inserted) satisfies it. ADD CONSTRAINT validates the table and rolls the whole
--      transaction back if that ever does not hold. "A guest carries no identity" is enforced by the app
--      (playerInsert in src/lib/supabase/queries/players.ts) and by claim_guest_player below.
--
--   2. public.claim_guest_player(p_guest_id, p_source_id) moves the identity of a fresh registered account onto a
--      guest row in ONE transaction. The previous app-side version ran three PostgREST calls, and its first step
--      (clearing the source's discord_id / auth_user_id while is_guest = false) violated players_identity_check under
--      both the old and the new predicate, so every claim failed. The function:
--        * locks both rows (stable id order), re-checks guest / source eligibility and raises before any write;
--          a source that is not 'active' (banned / suspended) raises 55000, so a claim never lifts a sanction
--          (the route maps that to SOURCE_NOT_ACTIVE);
--        * refuses (23503) while any ON DELETE CASCADE / SET NULL / SET DEFAULT foreign key still holds a row for the
--          source. Deleting the source would otherwise silently delete or orphan its own data (broadcast presets,
--          cast sessions, AI / avatar generations, achievements, draft seats, ...; 20260619000000 made several of
--          these CASCADE) while the claim reports success. The keys are read from pg_constraint, so a table added
--          later is covered without editing this function (fail closed). Only tables listed in
--          public.player_claim_disposable_refs are exempt: disposable per-viewer state a claim may delete with the
--          source (seeded with epb_animation_views, seen markers, and admin_export_limits, a rate-limit counter;
--          a deployment adds its own such tables there instead of editing this function);
--        * DELETEs the source first, which frees the unique discord_id / auth_user_id keys. A remaining ON DELETE
--          NO ACTION reference raises 23503 and rolls everything back (the route maps that to SOURCE_HAS_ACTIVITY);
--        * UPDATEs the guest with the source's identity and is_guest = false, and returns the claimed row.
--      Service-role only: EXECUTE revoked from PUBLIC, anon and authenticated.
BEGIN;

ALTER TABLE public.players DROP CONSTRAINT players_identity_check;
ALTER TABLE public.players
  ADD CONSTRAINT players_identity_check
  CHECK (discord_id IS NOT NULL OR auth_user_id IS NOT NULL OR is_guest);

COMMENT ON CONSTRAINT players_identity_check ON public.players IS
  'A registered player has a Discord ID or a Supabase Auth user; a guest (is_guest) may have neither.';

-- Tables whose rows referencing a player are disposable per-viewer state: claim_guest_player may delete them with
-- the source account instead of refusing the claim. Every other CASCADE / SET NULL / SET DEFAULT reference refuses.
CREATE TABLE public.player_claim_disposable_refs (
  table_ref regclass PRIMARY KEY,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200)
);

ALTER TABLE public.player_claim_disposable_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_claim_disposable_refs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.player_claim_disposable_refs TO service_role;

INSERT INTO public.player_claim_disposable_refs (table_ref, reason) VALUES
  ('public.epb_animation_views'::regclass, 'seen markers of animations'),
  ('public.admin_export_limits'::regclass, 'an admin export rate-limit counter');

COMMENT ON TABLE public.player_claim_disposable_refs IS
  'Tables holding disposable per-viewer state about a player: claim_guest_player deletes their rows with the source account instead of refusing the claim. Service-role only.';

CREATE OR REPLACE FUNCTION public.claim_guest_player(
  p_guest_id uuid,
  p_source_id uuid
) RETURNS public.players
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_guest public.players;
  v_source public.players;
  v_claimed public.players;
  v_ref record;
  v_referenced boolean;
BEGIN
  IF p_guest_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'p_guest_id and p_source_id are required' USING ERRCODE = '22004';
  END IF;
  IF p_guest_id = p_source_id THEN
    RAISE EXCEPTION 'Guest and source account must be different players' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in id order so two concurrent claims touching the same rows serialize.
  PERFORM 1 FROM public.players WHERE id IN (p_guest_id, p_source_id) ORDER BY id FOR UPDATE;

  SELECT * INTO v_guest FROM public.players WHERE id = p_guest_id;
  IF NOT FOUND OR NOT v_guest.is_guest THEN
    RAISE EXCEPTION 'Target player % is not a guest account', p_guest_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM public.players WHERE id = p_source_id;
  IF NOT FOUND OR v_source.is_guest THEN
    RAISE EXCEPTION 'Source player % is not a registered account', p_source_id USING ERRCODE = '22023';
  END IF;
  IF v_source.discord_id IS NULL AND v_source.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Source player % has no linked identity', p_source_id USING ERRCODE = '22023';
  END IF;
  -- A banned or suspended source would hand its identity to an 'active' guest row and drop its
  -- ban_reason / suspended_until with the DELETE below, silently lifting the sanction.
  IF v_source.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Source player % is not in good standing (status %)', p_source_id, v_source.status
      USING ERRCODE = '55000';
  END IF;

  -- The DELETE below must not cascade into (or null out) the source's own rows: refuse while any
  -- CASCADE / SET NULL / SET DEFAULT reference still holds one. The source row is locked FOR UPDATE,
  -- so no new referencing row can commit until this transaction ends.
  FOR v_ref IN
    SELECT n.nspname AS ref_schema, cl.relname AS ref_table, a.attname AS ref_column
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.players'::regclass
       AND c.confdeltype IN ('c', 'n', 'd')
       AND NOT EXISTS (SELECT 1 FROM public.player_claim_disposable_refs d WHERE d.table_ref = c.conrelid)
     ORDER BY n.nspname, cl.relname, a.attname
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
                   v_ref.ref_schema, v_ref.ref_table, v_ref.ref_column)
      INTO v_referenced
      USING p_source_id;
    IF v_referenced THEN
      RAISE EXCEPTION 'Source player % still owns rows in %.% (%)', p_source_id,
        v_ref.ref_schema, v_ref.ref_table, v_ref.ref_column
        USING ERRCODE = '23503';
    END IF;
  END LOOP;

  -- Delete first: frees the unique identity keys. 23503 here (a NO ACTION reference) aborts the whole claim.
  DELETE FROM public.players WHERE id = p_source_id;

  UPDATE public.players
     SET discord_id = v_source.discord_id,
         auth_user_id = v_source.auth_user_id,
         is_guest = false
   WHERE id = p_guest_id
     AND is_guest
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest player % changed during the claim', p_guest_id USING ERRCODE = '40001';
  END IF;

  RETURN v_claimed;
END;
$$;

COMMENT ON FUNCTION public.claim_guest_player(uuid, uuid) IS
  'Atomically move the Discord / Auth identity of a fresh registered player onto a guest row (is_guest -> false) and delete the source row. Raises 23503 when the source is still referenced (including rows its delete would cascade into) and 55000 when the source is banned or suspended. Service-role only.';

REVOKE ALL ON FUNCTION public.claim_guest_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_player(uuid, uuid) TO service_role;

COMMIT;
