-- Winter Cup gift order and per-recipient reveal (POKE-36).
--
-- 1. format_resource_items.ordinal: the 1-based selection order of a holding within its resource. The gift action grants
--    its items in pick order, so format__insert_item now stores that order (junk gift #1, #2). The team check can select
--    one slot of a resource (`{ kind: 'resource', resource, ordinal }`).
-- 2. format__apply_ops reveal_relation: an optional `players` member reveals only the links whose `to` side is listed,
--    so a recipient's giver is revealed after that recipient's own match, never the whole field at once.
--
-- Data safety: additive only. The column is nullable; existing rows keep NULL until the backfill maps them from their
-- submission's pick order. No gift, link, result or assignment is deleted, redrawn or reshuffled. The backfill recovers
-- the order the picks were submitted in; if a league's locked picks do not preserve selection order, the organizer must
-- map those gifts explicitly (see the read-only check in the PR) before the order-dependent weeks rely on them.

ALTER TABLE public.format_resource_items ADD COLUMN IF NOT EXISTS ordinal integer;
COMMENT ON COLUMN public.format_resource_items.ordinal IS
  '1-based order of the holding within its resource (gift selection order); NULL for a legacy row not yet mapped.';

CREATE OR REPLACE FUNCTION public.format__insert_item(
  p_season_id uuid, p_resource text, p_player uuid, p_item text, p_amount integer,
  p_exclusive boolean, p_source text, p_source_ref text
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_capacity integer;
  v_held     bigint;
  v_ordinal  integer;
BEGIN
  -- Under the holding's lock the units held are read after every earlier grant of the holding has committed (the caller
  -- usually took the lock already, in sorted order; taking it again is free). A grant over the capacity is refused and the
  -- whole call rolls back, so a submission never keeps a part of its items.
  PERFORM public.format__lock_holding(p_season_id, p_resource, p_player);
  IF p_exclusive AND p_item IS NOT NULL THEN
    PERFORM public.format__lock_exclusive(p_season_id, p_resource, p_item);
  END IF;
  v_capacity := public.format__resource_capacity(p_season_id, p_resource);
  IF v_capacity IS NOT NULL THEN
    SELECT coalesce(sum(i.amount), 0) INTO v_held FROM public.format_resource_items i
     WHERE i.season_id = p_season_id AND i.resource_key = p_resource AND i.player_id = p_player;
    IF v_held + p_amount > v_capacity THEN
      RAISE EXCEPTION 'resource_capacity_reached' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('resource', p_resource, 'player_id', p_player, 'capacity', v_capacity)::text;
    END IF;
  END IF;
  -- The 1-based order of this holding within its resource: the count of the player's existing rows of the resource plus
  -- one, read under the holding's lock. For a gift action the items are inserted in pick order, so this is the selection
  -- order (junk gift #1, #2). Legacy rows keep NULL until the backfill below maps them.
  SELECT count(*) + 1 INTO v_ordinal FROM public.format_resource_items
   WHERE season_id = p_season_id AND resource_key = p_resource AND player_id = p_player;
  BEGIN
    INSERT INTO public.format_resource_items (season_id, resource_key, player_id, item_id, amount, exclusive, source, source_ref, ordinal)
    VALUES (p_season_id, p_resource, p_player, p_item, p_amount, p_exclusive, p_source, p_source_ref, v_ordinal);
  EXCEPTION WHEN unique_violation THEN
    -- Only format_resource_items_exclusive_key can fire: the id is random.
    RAISE EXCEPTION 'resource_item_taken' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('resource', p_resource, 'item_id', p_item)::text;
  END;
END $$;


CREATE OR REPLACE FUNCTION public.format__apply_ops(p_season_id uuid, p_ops jsonb, p_strict boolean DEFAULT false, p_tolerant boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_op      jsonb;
  v_kind    text;
  v_need    text[];
  v_left    integer;
  v_row     record;
  v_take    integer;
  v_skipped jsonb := '[]'::jsonb;
  v_msg     text;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', NULL::text)::text;
  END IF;

  -- The relation and action locks of the batch, in the order every writer uses (format__lock_op_keys). An event and an
  -- adjustment take them before their revision check and so have them already; re-taking a held lock is a no-op.
  PERFORM public.format__lock_op_keys(p_season_id, p_ops);

  -- Then the holdings the grant_item and revoke_item ops write to (capacity is checked per holding, and a revoke must not
  -- race a grant or another removal of the same holding), and the exclusive keys the grants take, sorted: the order every
  -- writer uses (relation -> action -> revision check -> holding -> exclusive key), so an event and a player's submit that
  -- touch the same holding or item cannot wait on each other. Malformed ops are left to the check below: a player_id that
  -- is not a canonical uuid is skipped here and fails the cast of the op itself.
  PERFORM public.format__lock_grants(p_season_id, coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'resource', o ->> 'resource', 'player_id', o ->> 'player_id', 'item_id', o ->> 'item_id',
             'exclusive', o ->> 'op' = 'grant_item' AND o ->> 'exclusive' = 'true'))
      FROM jsonb_array_elements(p_ops) AS o
     WHERE jsonb_typeof(o) = 'object' AND o ->> 'op' IN ('grant_item', 'revoke_item') AND o ->> 'resource' IS NOT NULL
       AND o ->> 'player_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), '[]'::jsonb));

  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_kind := CASE WHEN jsonb_typeof(v_op) = 'object' THEN v_op ->> 'op' END;
    v_need := CASE v_kind
      WHEN 'set_flag'        THEN ARRAY['key', 'value']
      WHEN 'set_relation'    THEN ARRAY['relation', 'links']
      WHEN 'reveal_relation' THEN ARRAY['relation']
      WHEN 'grant_item'      THEN ARRAY['resource', 'player_id', 'item_id', 'amount', 'exclusive', 'source', 'source_ref']
      WHEN 'revoke_item'     THEN ARRAY['resource', 'player_id', 'item_id', 'amount']
      WHEN 'set_attr'        THEN ARRAY['player_id', 'attr', 'value', 'source']
      WHEN 'adjust_points'   THEN ARRAY['stage', 'player_id', 'points', 'reason']
      WHEN 'open_action'     THEN ARRAY['action']
      WHEN 'lock_action'     THEN ARRAY['action']
      WHEN 'set_track'       THEN ARRAY['track', 'player_id', 'step']
    END;
    IF v_need IS NULL OR NOT (v_op ?& v_need) THEN
      RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('op', v_kind)::text;
    END IF;

    IF v_kind = 'set_flag' THEN
      INSERT INTO public.format_flags (season_id, key, value) VALUES (p_season_id, v_op ->> 'key', v_op -> 'value')
      ON CONFLICT (season_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    ELSIF v_kind = 'set_relation' THEN
      IF NOT EXISTS (SELECT 1 FROM public.format_relation_links WHERE season_id = p_season_id AND relation_key = v_op ->> 'relation') THEN
        INSERT INTO public.format_relation_links (season_id, relation_key, from_player_id, to_player_id)
        SELECT p_season_id, v_op ->> 'relation', (l ->> 'from')::uuid, (l ->> 'to')::uuid
          FROM jsonb_array_elements(v_op -> 'links') l;
      END IF;

    ELSIF v_kind = 'reveal_relation' THEN
      -- Without a `players` member the whole relation is revealed; with one, only the links whose `to` side is listed
      -- (a per-recipient reveal). An empty list reveals nothing.
      UPDATE public.format_relation_links SET revealed_at = now()
       WHERE season_id = p_season_id AND relation_key = v_op ->> 'relation' AND revealed_at IS NULL
         AND (NOT (v_op ? 'players') OR to_player_id IN (SELECT jsonb_array_elements_text(v_op -> 'players')::uuid));

    ELSIF v_kind = 'grant_item' THEN
      IF p_tolerant THEN
        BEGIN
          PERFORM public.format__insert_item(
            p_season_id, v_op ->> 'resource', (v_op ->> 'player_id')::uuid, v_op ->> 'item_id', (v_op ->> 'amount')::integer,
            (v_op ->> 'exclusive')::boolean, v_op ->> 'source', v_op ->> 'source_ref');
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
          IF v_msg NOT IN ('resource_capacity_reached', 'resource_item_taken') THEN
            RAISE;
          END IF;
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'resource', v_op ->> 'resource', 'player_id', v_op ->> 'player_id', 'item_id', v_op ->> 'item_id', 'reason', v_msg));
        END;
      ELSE
        PERFORM public.format__insert_item(
          p_season_id, v_op ->> 'resource', (v_op ->> 'player_id')::uuid, v_op ->> 'item_id', (v_op ->> 'amount')::integer,
          (v_op ->> 'exclusive')::boolean, v_op ->> 'source', v_op ->> 'source_ref');
      END IF;

    ELSIF v_kind = 'revoke_item' THEN
      -- Removes `amount` units, oldest rows first; a row holding more than is left to take keeps the rest. An inverse revoke
      -- (the undo of a logged grant) carries that grant's source and source_ref and only ever takes rows with exactly that
      -- source and source_ref, so a revert never removes the units another source holds of the same item; when the grant's
      -- rows are gone it takes nothing (a strict caller then raises insufficient_holding). A revoke without a source takes
      -- from any row of the holding. Every grant inserts its own row (format__insert_item does not merge) and a seat
      -- substitution rewrites player_id only, so the rows of a logged grant keep their source and source_ref.
      v_left := (v_op ->> 'amount')::integer;
      FOR v_row IN
        SELECT id, amount FROM public.format_resource_items
         WHERE season_id = p_season_id AND resource_key = v_op ->> 'resource' AND player_id = (v_op ->> 'player_id')::uuid
           AND item_id IS NOT DISTINCT FROM (v_op ->> 'item_id')
           AND (v_op ->> 'source' IS NULL
                OR (format_resource_items.source IS NOT DISTINCT FROM (v_op ->> 'source')
                    AND format_resource_items.source_ref IS NOT DISTINCT FROM (v_op ->> 'source_ref')))
         ORDER BY created_at, id
           FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(v_left, v_row.amount);
        IF v_take = v_row.amount THEN
          DELETE FROM public.format_resource_items WHERE id = v_row.id;
        ELSE
          UPDATE public.format_resource_items SET amount = amount - v_take WHERE id = v_row.id;
        END IF;
        v_left := v_left - v_take;
      END LOOP;
      IF p_strict AND v_left > 0 THEN
        RAISE EXCEPTION 'insufficient_holding' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('resource', v_op ->> 'resource', 'player_id', v_op ->> 'player_id', 'item_id', v_op ->> 'item_id')::text;
      END IF;

    ELSIF v_kind = 'set_attr' THEN
      INSERT INTO public.format_player_attrs (season_id, player_id, attr_key, value, source)
      VALUES (p_season_id, (v_op ->> 'player_id')::uuid, v_op ->> 'attr', v_op -> 'value', v_op ->> 'source')
      ON CONFLICT (season_id, player_id, attr_key)
        DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now();

    ELSIF v_kind = 'adjust_points' THEN
      INSERT INTO public.format_adjustments (season_id, kind, target, delta, reason, admin_id)
      VALUES (p_season_id, 'points', jsonb_build_object('stage', v_op ->> 'stage', 'player_id', v_op ->> 'player_id'),
              jsonb_build_object('points', (v_op ->> 'points')::numeric), v_op ->> 'reason', NULL);

    ELSIF v_kind = 'open_action' THEN
      INSERT INTO public.format_flags (season_id, key, value) VALUES (p_season_id, 'action:' || (v_op ->> 'action'), '"open"')
      ON CONFLICT (season_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    ELSIF v_kind = 'lock_action' THEN
      PERFORM public.format__lock_action(p_season_id, v_op ->> 'action');
      INSERT INTO public.format_flags (season_id, key, value) VALUES (p_season_id, 'action:' || (v_op ->> 'action'), '"locked"')
      ON CONFLICT (season_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      UPDATE public.format_action_submissions SET status = 'locked', locked_at = now(), updated_at = now()
       WHERE season_id = p_season_id AND action_key = v_op ->> 'action' AND status = 'submitted';

    ELSE -- set_track
      INSERT INTO public.format_track_progress (season_id, player_id, track_key, step)
      VALUES (p_season_id, (v_op ->> 'player_id')::uuid, v_op ->> 'track', (v_op ->> 'step')::integer)
      ON CONFLICT (season_id, player_id, track_key)
        DO UPDATE SET step = EXCLUDED.step, updated_at = now() WHERE public.format_track_progress.step < EXCLUDED.step;
    END IF;
  END LOOP;
  RETURN v_skipped;
END $$;


-- Backfill the order of already-granted action items from their submission's pick order. Each pick's position within its
-- step becomes the ordinal of the item it granted (a step grants one resource, so this is the order within the resource).
-- Only rows still NULL are touched; a re-run is a no-op. Items without a submission (event/adjustment grants) stay NULL.
WITH pick_order AS (
  SELECT s.id AS submission_id,
         (pick.p ->> 'item_id') AS item_id,
         row_number() OVER (PARTITION BY s.id, (pick.p ->> 'step') ORDER BY pick.pos) AS ord
    FROM public.format_action_submissions s
    CROSS JOIN LATERAL jsonb_array_elements(s.picks) WITH ORDINALITY AS pick(p, pos)
   WHERE s.picks IS NOT NULL AND jsonb_typeof(s.picks) = 'array'
)
UPDATE public.format_resource_items i
   SET ordinal = po.ord
  FROM pick_order po
 WHERE i.source = 'action'
   AND i.source_ref = po.submission_id::text
   AND i.item_id = po.item_id
   AND i.ordinal IS NULL;
