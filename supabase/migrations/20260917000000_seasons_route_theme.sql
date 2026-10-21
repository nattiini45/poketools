-- seasons.route_theme (C-092): per-league 3D world theme pick.
-- 'auto' resolves through the format map (EPB → plaza, others → default);
-- explicit ids resolve only when registered in the client theme registry
-- (src/components/world/themes). Written only — applied through the repo's
-- migration process, never by hand.
ALTER TABLE seasons ADD COLUMN route_theme text NOT NULL DEFAULT 'auto'
  CHECK (route_theme IN ('auto','plaza','sakura','mountain','clouds'));
