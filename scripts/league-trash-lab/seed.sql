-- Synthetic league for the league-trash lab (LOCAL stack only).
-- lt_lab.seed(p_players int, p_rounds int) builds one evolution_point_buy league that touches EVERY inventory table.
CREATE SCHEMA IF NOT EXISTS lt_lab;

-- A ruleset is a definition with published versions; a league pins a VERSION. Inserts one definition with one version and
-- returns the version id. p_season makes it league-owned (private, season_id set), like a ruleset a format attach created.
CREATE OR REPLACE FUNCTION lt_lab.make_ruleset(p_definition uuid, p_version uuid, p_name text, p_season uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_name jsonb := jsonb_build_object('base', 'en', 'en', jsonb_build_object('v', p_name, 's', 'human'));
  v_spec jsonb;
  v_resolved jsonb := jsonb_build_object('v', 1, 'gen', 9, 'format_key', 'gen9', 'universe', 'standard', 'doubles', false,
    'clauses', '[]'::jsonb, 'pokemon', '{"mode":"block","ids":[]}'::jsonb, 'moves', '{"mode":"block","ids":[]}'::jsonb,
    'items', '{"mode":"block","ids":[]}'::jsonb, 'abilities', '{"mode":"block","ids":[]}'::jsonb, 'added_pokemon', '[]'::jsonb,
    'min_shared_type_pct', 0, 'team_constraints', 'null'::jsonb, 'custom_rules', '');
BEGIN
  v_spec := jsonb_build_object('schema_version', 1, 'identity', jsonb_build_object('name', v_name));
  INSERT INTO ruleset_definitions (id, slug, name, kind, visibility, season_id, current_draft)
    VALUES (p_definition, 'lt-' || substr(replace(p_definition::text, '-', ''), 1, 24), v_name, 'custom',
            CASE WHEN p_season IS NULL THEN 'gallery' ELSE 'private' END, p_season, v_spec);
  INSERT INTO ruleset_definition_versions (id, definition_id, version_no, schema_version, name_text, spec, resolved, content_hash,
                                           resolved_hash, catalog_version, gen, format_key, is_doubles)
    VALUES (p_version, p_definition, 1, 1, p_name, v_spec, v_resolved, repeat('a', 64), repeat('b', 64), 'lab', 9, 'gen9', false);
  UPDATE ruleset_definitions SET current_version_id = p_version WHERE id = p_definition;
  RETURN p_version;
END $$;

CREATE OR REPLACE FUNCTION lt_lab.seed(p_players int DEFAULT 24, p_rounds int DEFAULT 8, p_name text DEFAULT 'LT League')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_season uuid := gen_random_uuid();
  v_ruleset uuid;
  v_list uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid();
  v_g2 uuid := gen_random_uuid();
  v_half int := p_players / 2;
  v_ph uuid;
  v_phase int;
  v_round uuid;
  v_pool uuid;
  v_pools uuid[] := '{}';
  v_pool_i uuid; v_pool_r uuid;
  v_conv uuid := gen_random_uuid();
  v_players uuid[];
  v_admin uuid;
BEGIN
  -- players (named so a cleanup is easy)
  INSERT INTO players (id, name, is_guest) SELECT gen_random_uuid(), 'ltp_' || md5(random()::text) || '_' || g, true FROM generate_series(1, p_players) g;
  SELECT array_agg(id ORDER BY name) INTO v_players FROM (SELECT id, name FROM players WHERE name LIKE 'ltp_%' ORDER BY created_at DESC, name LIMIT p_players) s;
  v_admin := v_players[1];

  v_ruleset := lt_lab.make_ruleset(gen_random_uuid(), gen_random_uuid(), 'lt ruleset ' || gen_random_uuid());
  INSERT INTO point_buy_list_versions (id, name) VALUES (v_list, 'lt list ' || v_list);
  INSERT INTO point_buy_list_entries (list_version_id, line_number, base_pokemon, stage2_pokemon, price, kills_to_stage2, price_group, line_id)
    SELECT v_list, g, 'mon' || g, 'mon' || g || 'b', 5, 3, 'A', 'mon' || g || '--mon' || g || 'b' FROM generate_series(1, 40) g;

  INSERT INTO seasons (id, name, format_type, ruleset_id, status, point_buy_list_id, description)
    VALUES (v_season, p_name, 'evolution_point_buy', v_ruleset, 'active', v_list, 'synthetic');
  INSERT INTO season_participants (season_id, player_id) SELECT v_season, unnest(v_players);
  INSERT INTO season_groups (id, season_id, name, sort_order) VALUES (v_g1, v_season, 'A', 1), (v_g2, v_season, 'B', 2);
  INSERT INTO season_group_members (season_id, group_id, player_id)
    SELECT v_season, CASE WHEN i <= v_half THEN v_g1 ELSE v_g2 END, v_players[i] FROM generate_series(1, p_players) i;

  -- season-level config tables
  INSERT INTO format_rules (season_id) VALUES (v_season);
  INSERT INTO season_formats (season_id, version_no, spec, spec_hash, seed) VALUES (v_season, 1, '{}'::jsonb, repeat('a', 64), 'seedseed1');
  INSERT INTO evolution_tiers (season_id, base_pokemon, stage2_pokemon, stage2_kos) SELECT v_season, 'b' || g, 's' || g, 3 FROM generate_series(1, 20) g;
  INSERT INTO draft_tier_limits (season_id, power_tier, max_picks) SELECT v_season, t, 3 FROM unnest(ARRAY['S','A','B','C']) t;
  INSERT INTO draft_pool_entries (season_id, pokemon_name) SELECT v_season, 'pool' || g FROM generate_series(1, 150) g;
  INSERT INTO legacy_standings (season_id, player_id, rank) SELECT v_season, v_players[i], i FROM generate_series(1, p_players) i;
  INSERT INTO epb_kill_credit_epochs (season_id) VALUES (v_season);
  INSERT INTO epb_token_grants (season_id, player_id, grant_type) SELECT v_season, unnest(v_players), 'draft_token';
  INSERT INTO season_storylines (season_id, title, body, created_by) SELECT v_season, 'story ' || g, 'body', v_admin FROM generate_series(1, 5) g;

  -- draft pools: initial + redraft per group. A: initial running (drafting), redraft setup; B: initial complete, redraft submissions.
  FOR v_phase IN 1..2 LOOP
    v_pool_i := gen_random_uuid(); v_pool_r := gen_random_uuid();
    INSERT INTO draft_pools (id, season_id, draft_type, engine, kind, mode, phase, status, season_group_id, list_version_id, roster_size, pick_seconds,
                             started_at, created_by)
      VALUES (v_pool_i, v_season, 'snake', 'queue', 'initial', 'slow', CASE WHEN v_phase = 1 THEN 'drafting' ELSE 'complete' END, 'in_progress',
              CASE WHEN v_phase = 1 THEN v_g1 ELSE v_g2 END, v_list, 10, 3600, now() - interval '3 days', v_admin);
    INSERT INTO draft_pools (id, season_id, draft_type, engine, kind, mode, phase, status, season_group_id, list_version_id, roster_size, pick_seconds,
                             parent_pool_id, submission_deadline_at, token_purchase_closes_at, created_by)
      VALUES (v_pool_r, v_season, 'snake', 'queue', 'redraft', 'slow', CASE WHEN v_phase = 1 THEN 'setup' ELSE 'submissions' END, 'pending',
              CASE WHEN v_phase = 1 THEN v_g1 ELSE v_g2 END, v_list, 10, 3600, v_pool_i,
              CASE WHEN v_phase = 2 THEN now() + interval '2 days' END, now() + interval '5 days', v_admin);
    v_pools := v_pools || v_pool_i || v_pool_r;
    INSERT INTO draft_participants (draft_pool_id, player_id, seat)
      SELECT v_pool_i, v_players[i], row_number() OVER ()::smallint FROM generate_series((v_phase - 1) * v_half + 1, v_phase * v_half) i;
    INSERT INTO draft_participants (draft_pool_id, player_id, seat)
      SELECT v_pool_r, v_players[i], row_number() OVER ()::smallint FROM generate_series((v_phase - 1) * v_half + 1, v_phase * v_half) i;
    -- slots: roster 10 x half players; first 9 rounds done, round 10 first slot active, rest pending
    INSERT INTO draft_slots (id, draft_pool_id, player_id, sort_key, round, nominal_pick_number, status, timer_seconds, deadline_at, started_at)
      SELECT gen_random_uuid(), v_pool_i, v_players[(v_phase - 1) * v_half + 1 + ((n - 1) % v_half)], n, ((n - 1) / v_half) + 1, n,
             CASE WHEN v_phase = 2 OR ((n - 1) / v_half) + 1 <= 9 THEN 'done' WHEN n = 9 * v_half + 1 THEN 'active' ELSE 'pending' END,
             3600,
             CASE WHEN v_phase = 1 AND n = 9 * v_half + 1 THEN now() + interval '40 minutes' END,
             now() - interval '2 days'
      FROM generate_series(1, 10 * v_half) n;
    INSERT INTO draft_picks (draft_pool_id, player_id, pokemon_name, pick_number, round, points_spent, line_id, slot_id, made_by, made_by_role)
      SELECT s.draft_pool_id, s.player_id, 'mon' || s.nominal_pick_number, s.nominal_pick_number, s.round, 5, 'mon' || s.nominal_pick_number || '--mon' || s.nominal_pick_number || 'b', s.id, s.player_id, 'player'
        FROM draft_slots s WHERE s.draft_pool_id = v_pool_i AND s.status = 'done';
    UPDATE draft_picks p SET line_entry_id = e.id FROM point_buy_list_entries e WHERE p.draft_pool_id = v_pool_i AND e.list_version_id = v_list AND e.line_id = p.line_id;
    INSERT INTO draft_replay_events (draft_pool_id, event_type, sequence_number, pick_id)
      SELECT p.draft_pool_id, 'pick', p.pick_number, p.id FROM draft_picks p WHERE p.draft_pool_id = v_pool_i;
    INSERT INTO draft_line_restrictions (draft_pool_id, player_id, line_id, reason, created_by) VALUES (v_pool_i, v_players[1], 'line1', 'admin', v_admin);
    -- redraft slots with a filled pick (the circular FK) and submissions
    INSERT INTO redraft_slots (id, draft_pool_id, season_id, player_id, label, dropped_line_id, dropped_price, transferred_real_kills, dropped_stage, dropped_tracker_snapshot)
      SELECT gen_random_uuid(), v_pool_r, v_season, v_players[i], 'A', 'line1', 5, 0, 1, '{}'::jsonb FROM generate_series((v_phase - 1) * v_half + 1, v_phase * v_half) i;
  END LOOP;

  -- trackers (one per done pick), then submissions, redraft history, token tables, events
  INSERT INTO evolution_tracker (season_id, player_id, base_pokemon, current_form, line_id, season_group_id, real_kills)
    SELECT v_season, p.player_id, 'mon' || p.pick_number, 'mon' || p.pick_number, p.line_id || '_' || p.pick_number, m.group_id, 1
      FROM draft_picks p JOIN draft_pools dp ON dp.id = p.draft_pool_id
      JOIN season_group_members m ON m.season_id = v_season AND m.player_id = p.player_id
     WHERE dp.season_id = v_season;
  -- fill some redraft slots with a draft_pick that points back (cycle): pick.redraft_slot_id <-> slot.filled_by_pick_id
  WITH tgt AS (SELECT rs.id slot_id, p.id pick_id FROM redraft_slots rs JOIN LATERAL (SELECT dp.id FROM draft_picks dp WHERE dp.player_id = rs.player_id AND dp.voided_at IS NULL ORDER BY dp.pick_number LIMIT 1) p ON true WHERE rs.season_id = v_season AND rs.draft_pool_id = (v_pools)[2])
  UPDATE draft_picks dp SET redraft_slot_id = tgt.slot_id FROM tgt WHERE dp.id = tgt.pick_id;
  UPDATE redraft_slots rs SET filled_by_pick_id = dp.id FROM draft_picks dp WHERE dp.redraft_slot_id = rs.id;
  UPDATE evolution_tracker t SET redraft_slot_id = rs.id FROM redraft_slots rs WHERE rs.season_id = v_season AND rs.player_id = t.player_id AND t.id = (SELECT id FROM evolution_tracker x WHERE x.player_id = rs.player_id AND x.season_id = v_season LIMIT 1);
  INSERT INTO redraft_submissions (draft_pool_id, player_id, tracker_id, line_id)
    SELECT v_pools[4], t.player_id, t.id, t.line_id FROM evolution_tracker t JOIN season_group_members m ON m.season_id = v_season AND m.player_id = t.player_id AND m.group_id = v_g2
     WHERE t.season_id = v_season AND t.line_id IS NOT NULL LIMIT 20;
  INSERT INTO redraft_history (season_id, player_id, to_base_pokemon, transfer_type, draft_pool_id, from_tracker_id)
    SELECT v_season, t.player_id, 'x', 'free_swap', v_pools[2], t.id FROM evolution_tracker t WHERE t.season_id = v_season LIMIT 10;
  INSERT INTO redraft_trade_requests (season_id, initiated_by, player_a_id, line_a, player_b_id, line_b, from_tracker_a_id, from_tracker_b_id)
    SELECT v_season, v_players[1], v_players[1], 'line1', v_players[2], 'line2', (SELECT id FROM evolution_tracker WHERE player_id = v_players[1] AND season_id = v_season LIMIT 1), (SELECT id FROM evolution_tracker WHERE player_id = v_players[2] AND season_id = v_season LIMIT 1);
  INSERT INTO evolution_events (season_id, player_id, base_pokemon, previous_form, new_form, new_stage, tracker_id)
    SELECT v_season, t.player_id, t.base_pokemon, t.current_form, t.current_form || 'b', 2, t.id FROM evolution_tracker t WHERE t.season_id = v_season LIMIT 50;
  INSERT INTO evo_progress_log (season_id, tracker_id, source, amount, created_by) SELECT v_season, t.id, 'real_kill', 1, v_admin FROM evolution_tracker t WHERE t.season_id = v_season;
  INSERT INTO epb_draft_token_purchases (season_id, player_id, line_id, points_spent, client_request_id, tracker_id, created_by)
    SELECT v_season, t.player_id, t.line_id, 1, gen_random_uuid(), t.id, v_admin FROM evolution_tracker t WHERE t.season_id = v_season LIMIT 30;
  INSERT INTO epb_comeback_token_spends (season_id, player_id, line_id, amount, client_request_id, tracker_id, created_by)
    SELECT v_season, t.player_id, t.line_id, 1, gen_random_uuid(), t.id, v_admin FROM evolution_tracker t WHERE t.season_id = v_season LIMIT 30;

  -- phases
  FOR v_phase IN 1..3 LOOP
    v_ph := gen_random_uuid();
    INSERT INTO tournaments (id, name, season_id, bracket_type, ruleset_id, status, stage_order, format_stage_key) VALUES (v_ph, 'Phase ' || v_phase, v_season, 'round_robin', v_ruleset, 'active', v_phase, 'p' || v_phase);
    INSERT INTO tournament_participants (tournament_id, player_id) SELECT v_ph, unnest(v_players);
    INSERT INTO tournament_groups (id, tournament_id, name, group_number, season_group_id) VALUES (gen_random_uuid(), v_ph, 'A', 1, v_g1), (gen_random_uuid(), v_ph, 'B', 2, v_g2);
    INSERT INTO tournament_group_members (group_id, player_id)
      SELECT g.id, m.player_id FROM tournament_groups g JOIN season_group_members m ON m.group_id = g.season_group_id AND m.season_id = v_season WHERE g.tournament_id = v_ph;
  END LOOP;
  FOR v_ph IN SELECT id FROM tournaments WHERE season_id = v_season LOOP
    FOR v_phase IN 1..p_rounds LOOP
      INSERT INTO rounds (id, name, tournament_id, round_number, best_of, status, deadline, pairings_generated) VALUES (gen_random_uuid(), 'R' || v_phase, v_ph, v_phase, 3, 'active', now() + (v_phase || ' days')::interval, true) RETURNING id INTO v_round;
      -- pairings: i vs i + half rotated, per half
      INSERT INTO matches (round_id, tournament_id, player_1_id, player_2_id, status, winner_id, date_played, auto_confirm_at, confirmed_at, finalized_at, scheduled_at)
        SELECT v_round, v_ph, v_players[a], v_players[b],
               (ARRAY['completed','completed','pending_confirmation','scheduled'])[1 + (a + v_phase) % 4]::match_status,
               CASE WHEN (a + v_phase) % 4 IN (0, 1) THEN v_players[a] END,
               now() - interval '1 day',
               CASE WHEN (a + v_phase) % 4 = 2 THEN now() + interval '20 hours' END,
               CASE WHEN (a + v_phase) % 4 IN (0, 1) THEN now() - interval '1 day' END,
               CASE WHEN (a + v_phase) % 4 IN (0, 1) THEN now() - interval '1 day' END,
               now() + interval '1 day'
          FROM (SELECT x AS a, ((x - 1 + v_phase) % v_half) + 1 + CASE WHEN x <= v_half THEN 0 ELSE v_half END AS b FROM generate_series(1, p_players) x) pr
         WHERE pr.a < pr.b;
    END LOOP;
  END LOOP;
  -- games, stats, per-match children
  INSERT INTO games (match_id, game_number, winner_id, source, parsed, aggregate_applied_at, exclude_all_time, replay_hash, replay_url)
    SELECT m.id, g, m.winner_id, 'ps_replay', true, CASE WHEN g = 1 THEN now() - interval '1 day' END, false, encode(sha256((m.id::text || g)::bytea), 'hex'), 'https://replay.example/' || m.id || '-' || g
      FROM matches m JOIN tournaments t ON t.id = m.tournament_id, generate_series(1, 2) g WHERE t.season_id = v_season AND m.status IN ('completed', 'pending_confirmation');
  INSERT INTO battle_stats (game_id, player_id, pokemon_name, was_brought, was_lead, kos_dealt)
    SELECT g.id, pl, 'mon' || k, true, k = 1, (k % 3)
      FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id,
           LATERAL (VALUES (m.player_1_id), (m.player_2_id)) AS p(pl), generate_series(1, 6) k WHERE t.season_id = v_season;
  INSERT INTO aggregate_jobs (game_id, tournament_id, season_id, status) SELECT g.id, m.tournament_id, v_season, CASE WHEN g.aggregate_applied_at IS NULL THEN 'pending' ELSE 'completed' END FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season;
  INSERT INTO rating_history (player_id, match_id, rating_before, rating_after, rd_before, rd_after, opponent_id, opponent_rating, result)
    SELECT m.player_1_id, m.id, 1500, 1510, 100, 95, m.player_2_id, 1500, 'win' FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'completed';
  INSERT INTO match_evolution_snapshots (match_id, player_id, base_pokemon, species_at_match, stage_at_match, tracker_id)
    SELECT m.id, m.player_1_id, tr.base_pokemon, tr.current_form, 1, tr.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id
      JOIN LATERAL (SELECT * FROM evolution_tracker e WHERE e.player_id = m.player_1_id AND e.season_id = v_season LIMIT 3) tr ON true WHERE t.season_id = v_season AND m.status = 'completed';
  INSERT INTO match_analyses (match_id, model_id) SELECT m.id, 'mdl' FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'completed' AND random() < 0.3;
  INSERT INTO match_prep_analyses (match_id, player_id, model_id) SELECT m.id, m.player_1_id, 'mdl' FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'scheduled' AND random() < 0.3;
  INSERT INTO match_prep_teams (match_id, player_id) SELECT m.id, m.player_1_id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'scheduled' AND random() < 0.3;
  INSERT INTO match_proposals (match_id, proposer_id, responder_id, proposed_at, expires_at, status) SELECT m.id, m.player_1_id, m.player_2_id, now(), now() + interval '2 days', 'pending' FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'scheduled' AND random() < 0.3;
  INSERT INTO epb_animation_views (player_id, match_id) SELECT m.player_1_id, m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'completed' AND random() < 0.2;
  INSERT INTO broadcast_moments (match_id, moment_type, created_by, game_id) SELECT g.match_id, 'highlight', v_admin, g.id FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND random() < 0.05;
  INSERT INTO tournament_reports (tournament_id, round_id, report_type, model_id, status) SELECT r.tournament_id, r.id, 'round_recap', 'mdl', 'completed' FROM rounds r JOIN tournaments t ON t.id = r.tournament_id WHERE t.season_id = v_season;

  -- teams: one per completed/pending match side (linked to the match, some completed), plus draft teams (pool), plus a fork from outside the league
  INSERT INTO teams (player_id, tournament_id, season_id, match_id, pokemon, name)
    SELECT m.player_1_id, m.tournament_id, v_season, m.id, '[{"species":"x"}]'::jsonb, 'team ' || m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status IN ('completed', 'pending_confirmation');
  INSERT INTO teams (player_id, season_id, draft_pool_id, is_draft_team, pokemon, name) SELECT v_players[i], v_season, v_pools[1], true, '[]'::jsonb, 'draft ' || i FROM generate_series(1, v_half) i;
  -- outside team forked from a league team + outside team pointing at a league match
  INSERT INTO teams (id, player_id, pokemon, name, forked_from_team_id) SELECT gen_random_uuid(), v_players[1], '[]'::jsonb, 'fork', (SELECT id FROM teams WHERE season_id = v_season AND match_id IS NOT NULL LIMIT 1);
  INSERT INTO teams (player_id, pokemon, name, match_id) SELECT v_players[2], '[]'::jsonb, 'ptr', (SELECT m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season AND m.status = 'completed' AND NOT EXISTS (SELECT 1 FROM teams x WHERE x.player_id = v_players[2] AND x.match_id = m.id) LIMIT 1);

  -- polymorphic, no FK
  INSERT INTO resource_admins (player_id, resource_type, resource_id) VALUES (v_players[1], 'season', v_season), (v_players[2], 'season', v_season);
  INSERT INTO resource_admins (player_id, resource_type, resource_id) SELECT v_players[3], 'tournament', id FROM tournaments WHERE season_id = v_season;
  INSERT INTO discord_webhooks (scope_type, scope_id, webhook_url) VALUES ('season', v_season, 'https://hook.example/season');
  INSERT INTO discord_webhooks (scope_type, scope_id, webhook_url) SELECT 'tournament', id, 'https://hook.example/t' FROM tournaments WHERE season_id = v_season LIMIT 1;
  INSERT INTO social_integrations (provider, scope_type, scope_id, label) VALUES ('x', 'season', v_season, 'lt social');
  INSERT INTO wiki_notes (entity_type, entity_name, author_id, content, scope_type, scope_id) VALUES ('pokemon', 'pikachu', v_players[1], 'note', 'league', v_season);
  INSERT INTO wiki_notes (entity_type, entity_name, author_id, content, scope_type, scope_id) SELECT 'move', 'tackle', v_players[1], 'note', 'tournament', id FROM tournaments WHERE season_id = v_season LIMIT 1;
  INSERT INTO wiki_note_reports (note_id, reporter_id, reason) SELECT id, v_players[2], 'spam' FROM wiki_notes WHERE scope_id = v_season;

  -- derived: aggregates (league + tournament scopes), player_aggregates
  INSERT INTO aggregates (scope_type, scope_id, pokemon_name, total_appearances) SELECT 'league', v_season, 'mon' || g, 10 FROM generate_series(1, 20) g;
  INSERT INTO aggregates (scope_type, scope_id, pokemon_name, total_appearances) SELECT 'tournament', t.id, 'mon' || g, 5 FROM tournaments t, generate_series(1, 20) g WHERE t.season_id = v_season;
  INSERT INTO player_aggregates (scope_type, scope_id, player_id, pokemon_name, total_appearances) SELECT 'league', v_season, v_players[i], 'mon1', 2 FROM generate_series(1, p_players) i;
  INSERT INTO player_aggregates (scope_type, scope_id, player_id, pokemon_name, total_appearances) SELECT 'tournament', t.id, v_players[1], 'mon1', 2 FROM tournaments t WHERE t.season_id = v_season;
  -- streak pointers to league matches (the NO ACTION FK)
  INSERT INTO player_streaks (player_id, last_match_id) SELECT pl, (SELECT m.id FROM matches m WHERE (m.player_1_id = pl OR m.player_2_id = pl) AND m.status = 'completed' LIMIT 1) FROM unnest(v_players) pl ON CONFLICT (player_id) DO UPDATE SET last_match_id = excluded.last_match_id;
  -- unlinked pointers
  INSERT INTO cast_sessions (owner_id, season_id, tournament_id, match_id, name) SELECT v_admin, v_season, t.id, (SELECT id FROM matches WHERE tournament_id = t.id LIMIT 1), 'cast' FROM tournaments t WHERE t.season_id = v_season LIMIT 1;
  INSERT INTO agent_conversations (id, player_id, persona, messages) VALUES (v_conv, v_admin, 'p', '[]'::jsonb);
  INSERT INTO agent_suggestions (player_id, conversation_id, match_id, context_format) SELECT v_admin, v_conv, (SELECT m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = v_season LIMIT 1), 'gen9';
  RETURN v_season;
END $$;
