-- Backfill: EPB seasons created before the auto-bind feature (C-025) get the
-- currently active point-buy list version — same semantics as the new
-- creation-time auto-bind in POST /api/seasons. First-bind-when-null only:
-- seasons with an existing snapshot are untouched, and seasons with no active
-- version available stay unbound (manual bind remains available).
UPDATE seasons
SET point_buy_list_id = (
  SELECT v.id
  FROM point_buy_list_versions v
  WHERE v.is_active = true
  ORDER BY v.version DESC
  LIMIT 1
)
WHERE format_type = 'evolution_point_buy'
  AND point_buy_list_id IS NULL
  AND EXISTS (
    SELECT 1 FROM point_buy_list_versions v WHERE v.is_active = true
  );
