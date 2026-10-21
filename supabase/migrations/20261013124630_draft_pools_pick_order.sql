-- Legacy draft pools: pick order as its own axis, separate from pricing.
--
-- Before, draft_type mixed both: snake = strict alternating order with no points, budget/auction = no turn order at
-- all. Snake order with point costs (the most common league setup) could not be configured.
-- After:
--   pick_order  turn order of a legacy pool: snake (reverses every round) | linear (same seat order every round) |
--               free (no turns enforced; players pick any time, admins enter picks for them)
--   draft_type  stays and becomes the pricing axis: snake = no points (tier limits only) | budget = fixed costs |
--               auction = bids. Enum values are not renamed.
-- An auction records the pick for the winning bidder, so turn order cannot apply: draft_type auction needs pick_order
-- free. Existing auction/budget pools are backfilled to free and behave exactly as before; snake pools keep 'snake'.
-- The queue engine (engine = 'queue', EvoLiga) ignores the column; its pools keep the 'snake' default (draft_create_pool
-- inserts draft_type 'snake', so the CHECK holds). No RPC changes.
-- Text + CHECK like the queue-engine columns of 20261012024202_draft_queue_engine.sql. No grants: draft_pools keeps
-- its service_role-only privileges (20261008081443_close_public_api_roles.sql).
BEGIN;

ALTER TABLE public.draft_pools
  ADD COLUMN pick_order text NOT NULL DEFAULT 'snake' CHECK (pick_order IN ('snake', 'linear', 'free'));

UPDATE public.draft_pools SET pick_order = 'free' WHERE draft_type IN ('auction', 'budget');

ALTER TABLE public.draft_pools
  ADD CONSTRAINT draft_pools_auction_free_order CHECK (draft_type <> 'auction' OR pick_order = 'free');

COMMENT ON COLUMN public.draft_pools.pick_order IS
  'Legacy engine turn order: snake | linear (same order every round) | free (turns not enforced). Ignored by the queue engine.';
COMMENT ON COLUMN public.draft_pools.draft_type IS
  'Legacy engine pricing: snake = no points (tier limits only) | budget = fixed costs | auction = bids. Turn order is pick_order.';

COMMIT;
