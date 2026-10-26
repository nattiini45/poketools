-- Legacy ruleset fixtures for the Ruleset Studio conversion rehearsal (scripts/ruleset-lab/rehearse.sh). LOCAL stack only.
-- Loaded into a database replayed up to 20261026091500 (before the Ruleset Studio migrations). Fixed uuids, so the
-- vitest rehearsal test and the SQL agree on identities. Every shape the conversion and the replay of the old
-- resolver have to get right is here once; the comments name it.
BEGIN;

INSERT INTO public.players (id, name, discord_id) VALUES ('00000000-0000-4000-8000-0000000000a1', 'Fixture Admin', 'fixture-admin-discord');

INSERT INTO public.rulesets
  (id, name, base_format, is_doubles, clauses, banned_pokemon, banned_moves, banned_items, banned_abilities, added_pokemon,
   custom_rules_string, min_shared_type_pct, team_constraints, created_by, created_at)
VALUES
  -- r01: a seeded tier row (created_by NULL, "Gen N ..."): kind preset; ids need the id fold (♀, accents, apostrophes, colons)
  ('10000000-0000-4000-8000-000000000001', 'Gen 9 OU', 'gen9ou', false,
   ARRAY['Species Clause', 'Sleep Clause Mod', 'Baton Pass Clause', 'Batonpass Clause', 'OHKO Clause'],
   ARRAY['Annihilape', 'Flabébé', 'Nidoran♀', 'Nidoran♂', 'Farfetch''d', 'Type: Null', 'Tapu Koko', 'Rotom-Wash', 'Great Tusk'],
   ARRAY['Baton Pass', 'Last Respects', 'Shed Tail'],
   ARRAY['King''s Rock', 'Poké Ball', 'Focus Sash'],
   ARRAY['Moody', 'Arena Trap'], '{}', '', 0, NULL, NULL, '2026-01-01 10:00:00+00'),
  -- r02: a custom league ruleset (team constraints, custom rules, an added Pokémon that is ALSO banned: the ban wins)
  ('10000000-0000-4000-8000-000000000002', 'Core Liga', 'gen9ru', false,
   ARRAY['Species Clause', 'Item Clause'], ARRAY['Garchomp', 'Kingambit'], ARRAY[]::text[], ARRAY['Eviolite'], ARRAY[]::text[],
   ARRAY['Pikachu', 'Garchomp', 'Mr. Mime'], 'Types must match the core.', 0,
   '{"type_quotas": {"source": "player_core", "min_per_type": 1, "allow_multi_count": true}, "tera_match": "player_core"}'::jsonb,
   '00000000-0000-4000-8000-0000000000a1', '2026-01-02 10:00:00+00'),
  -- r03: an EMPTY constraints object. It is truthy in JavaScript, so the old code counted it as custom.
  ('10000000-0000-4000-8000-000000000003', 'Empty constraints', 'gen9uu', false, ARRAY['Species Clause'], ARRAY['Ubers'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', '', 0, '{}'::jsonb, NULL, '2026-01-03 10:00:00+00'),
  -- r04, r05: custom rules that are only whitespace for JavaScript's trim(): NOT custom
  ('10000000-0000-4000-8000-000000000004', 'Newline rules', 'gen9ou', false, ARRAY['Species Clause'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', E'\n', 0, NULL, NULL, '2026-01-04 10:00:00+00'),
  ('10000000-0000-4000-8000-000000000005', 'Nbsp rules', 'gen9ou', false, ARRAY['Species Clause'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', E'  　', 0, NULL, NULL, '2026-01-05 10:00:00+00'),
  -- r06: typos and spellings that never matched the exact-name compare of the old validator
  ('10000000-0000-4000-8000-000000000006', 'Typos', 'gen9ou', false, ARRAY['Species Clause', 'Made Up Clause'],
   ARRAY['Tapu-Koko', 'Mr Mime', 'Ho Oh', 'Farfetchd', 'Garchmop', 'Mr. Mime'], ARRAY['Tbolt'], ARRAY['Leftovers'], ARRAY['Intimdate'],
   '{}', '', 0, NULL, NULL, '2026-01-06 10:00:00+00'),
  -- r07, r08: two custom rulesets with the SAME name (the oldest wins the name match), and the season they match
  ('10000000-0000-4000-8000-000000000007', 'Spring League', 'gen9ou', false, ARRAY['Species Clause'], ARRAY['Koraidon'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', 'Spring rules (old)', 0, NULL, NULL, '2026-01-07 10:00:00+00'),
  ('10000000-0000-4000-8000-000000000008', 'Spring League', 'gen9ou', false, ARRAY['Species Clause'], ARRAY['Miraidon'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', 'Spring rules (new)', 0, NULL, NULL, '2026-01-08 10:00:00+00'),
  -- r09: a ruleset a format attach created (named in season_formats.preset_rulesets below)
  ('10000000-0000-4000-8000-000000000009', 'Summer League · Gen 9 OU', 'gen9ou', false, ARRAY['Species Clause'], ARRAY['Miraidon'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', '', 0, NULL, '00000000-0000-4000-8000-0000000000a1', '2026-01-09 10:00:00+00'),
  -- r10: the shared point-buy ruleset (gen9 names a generation and no tier; no bans)
  ('10000000-0000-4000-8000-000000000010', 'Point Buy Battle', 'gen9', false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   '{}', '', 0, NULL, NULL, '2026-01-10 10:00:00+00'),
  -- r11, r12: duplicate names that are not custom
  ('10000000-0000-4000-8000-000000000011', 'Dup', 'gen8ou', false, ARRAY['Species Clause'], ARRAY['Zacian'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], '{}', '', 0, NULL, NULL, '2026-01-11 10:00:00+00'),
  ('10000000-0000-4000-8000-000000000012', 'Dup', 'gen8ou', false, ARRAY['Species Clause'], ARRAY['Zacian'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], '{}', '', 0, NULL, NULL, '2026-01-12 10:00:00+00'),
  -- r13: doubles and a shared-type percentage; r14: National Dex (converted to the STANDARD universe); r15: 1v1 (key starts with a digit); r16: blank
  ('10000000-0000-4000-8000-000000000013', 'Gen 9 Doubles OU', 'gen9doublesou', true, ARRAY['Species Clause'], ARRAY['Flutter Mane'], ARRAY['Fake Out'], ARRAY[]::text[], ARRAY[]::text[], '{}', '', 60, NULL, NULL, '2026-01-13 10:00:00+00'),
  ('10000000-0000-4000-8000-000000000014', 'Gen 9 National Dex', 'gen9nationaldex', false, ARRAY['Species Clause'], ARRAY['Mewtwo-Mega-X'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], '{}', '', 0, NULL, NULL, '2026-01-14 10:00:00+00'),
  ('10000000-0000-4000-8000-000000000015', 'Gen 9 1v1', 'gen91v1', false, ARRAY[]::text[], ARRAY['Arceus'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], '{}', '', 0, NULL, NULL, '2026-01-15 10:00:00+00'),
  ('10000000-0000-4000-8000-000000000016', 'Plain blank', 'blank', false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], '{}', '', 0, NULL, NULL, '2026-01-16 10:00:00+00'),
  -- r17: a custom ruleset with an accented, emoji-only style name (slug fallback)
  ('10000000-0000-4000-8000-000000000017', 'Ünïcode ✨', 'gen7ou', false, ARRAY['Species Clause'], ARRAY['Landorus-Therian'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], '{}', 'x', 0, NULL, NULL, '2026-01-17 10:00:00+00');

INSERT INTO public.seasons (id, name, format_type, ruleset_id, status) VALUES
  -- s1: name matches the custom 'Spring League' rulesets, its own ruleset is a plain tier: the name match applies
  ('20000000-0000-4000-8000-000000000001', 'Spring League', 'singles', '10000000-0000-4000-8000-000000000001', 'active'),
  -- s2: its own ruleset is custom
  ('20000000-0000-4000-8000-000000000002', 'Core Liga Season', 'singles', '10000000-0000-4000-8000-000000000002', 'active'),
  -- s3: a format-attach league (custom format type) with a recorded preset ruleset
  ('20000000-0000-4000-8000-000000000003', 'Summer League', 'custom', '10000000-0000-4000-8000-000000000001', 'upcoming'),
  -- s4: point buy
  ('20000000-0000-4000-8000-000000000004', 'Point Buy Season', 'evolution_point_buy', '10000000-0000-4000-8000-000000000010', 'active'),
  -- s5: no ruleset at all
  ('20000000-0000-4000-8000-000000000005', 'No ruleset', 'singles', NULL, 'upcoming');

INSERT INTO public.tournaments (id, name, season_id, bracket_type, ruleset_id, status) VALUES
  -- Spring League phases: group phase (name match -> r07), playoffs (single_elim keeps its own), swiss keeps its own,
  -- a phase with its own custom ruleset (step 1)
  ('30000000-0000-4000-8000-000000000001', 'Spring groups',   '20000000-0000-4000-8000-000000000001', 'round_robin', '10000000-0000-4000-8000-000000000001', 'active'),
  ('30000000-0000-4000-8000-000000000002', 'Spring playoffs', '20000000-0000-4000-8000-000000000001', 'single_elim', '10000000-0000-4000-8000-000000000001', 'upcoming'),
  ('30000000-0000-4000-8000-000000000003', 'Spring swiss',    '20000000-0000-4000-8000-000000000001', 'swiss',        '10000000-0000-4000-8000-000000000004', 'upcoming'),
  ('30000000-0000-4000-8000-000000000004', 'Spring own',      '20000000-0000-4000-8000-000000000001', 'double_elim',  '10000000-0000-4000-8000-000000000017', 'upcoming'),
  -- Core Liga Season: a plain-tier phase inherits the league's custom ruleset (step 2), even in a bracket type
  ('30000000-0000-4000-8000-000000000005', 'Core groups',     '20000000-0000-4000-8000-000000000002', 'round_robin', '10000000-0000-4000-8000-000000000001', 'active'),
  ('30000000-0000-4000-8000-000000000006', 'Core playoffs',   '20000000-0000-4000-8000-000000000002', 'single_elim', '10000000-0000-4000-8000-000000000001', 'upcoming'),
  -- Summer League: the attach-created ruleset (not custom) stays
  ('30000000-0000-4000-8000-000000000007', 'Summer stage',    '20000000-0000-4000-8000-000000000003', 'round_robin', '10000000-0000-4000-8000-000000000009', 'upcoming'),
  -- Point buy: a plain phase
  ('30000000-0000-4000-8000-000000000008', 'Draft stage',     '20000000-0000-4000-8000-000000000004', 'round_robin', '10000000-0000-4000-8000-000000000010', 'active'),
  -- a phase of the league without a ruleset of its own custom-ness and a season without ruleset: fallback
  ('30000000-0000-4000-8000-000000000009', 'No league rules', '20000000-0000-4000-8000-000000000005', 'round_robin', '10000000-0000-4000-8000-000000000011', 'upcoming'),
  -- standalone tournaments (no season): steps 2 and 3 do not exist
  ('30000000-0000-4000-8000-000000000010', 'Standalone custom', NULL, 'single_elim', '10000000-0000-4000-8000-000000000002', 'upcoming'),
  ('30000000-0000-4000-8000-000000000011', 'Standalone plain',  NULL, 'single_elim', '10000000-0000-4000-8000-000000000012', 'upcoming');

-- The recorded map of a format attach: rule preset id -> ruleset id (WP-J shape; the conversion rewrites it to a definition id)
INSERT INTO public.season_formats (season_id, definition_id, version_no, spec, spec_hash, seed, preset_rulesets) VALUES
  ('20000000-0000-4000-8000-000000000003', NULL, 1, '{}'::jsonb, repeat('a', 64), 'fixtureseed1',
   jsonb_build_object('gen9ou', '10000000-0000-4000-8000-000000000009'));

COMMIT;
