CREATE VIEW public.phase_replay_library
WITH (security_invoker = true) AS
SELECT
  g.id::text || ':standalone' AS row_key,
  g.game_number,
  g.replay_url,
  g.created_at AS game_created_at,
  m.id AS match_id,
  m.date_played AS match_played_at,
  t.id AS tournament_id,
  NULL::uuid AS phase_id,
  NULL::uuid AS league_id,
  NULL::text AS league_name,
  t.name AS stage_name,
  r.name AS round_name,
  p1.name AS player_1_name,
  p1.ps_username AS player_1_ps_username,
  p2.name AS player_2_name,
  p2.ps_username AS player_2_ps_username
FROM public.games AS g
JOIN public.matches AS m ON m.id = g.match_id
JOIN public.tournaments AS t ON t.id = m.tournament_id
LEFT JOIN public.rounds AS r ON r.id = m.round_id
LEFT JOIN public.players AS p1 ON p1.id = m.player_1_id
LEFT JOIN public.players AS p2 ON p2.id = m.player_2_id
WHERE t.season_id IS NULL AND g.parsed AND g.source = 'ps_replay' AND g.replay_url <> ''

UNION ALL

SELECT
  g.id::text || ':phase',
  g.game_number,
  g.replay_url,
  g.created_at,
  m.id,
  m.date_played,
  NULL::uuid,
  p.id,
  s.id,
  s.name,
  p.name,
  r.name,
  p1.name,
  p1.ps_username,
  p2.name,
  p2.ps_username
FROM public.phase_games AS g
JOIN public.phase_matches AS m ON m.id = g.match_id
JOIN public.league_phases AS p ON p.id = m.phase_id
JOIN public.seasons AS s ON s.id = p.season_id
LEFT JOIN public.phase_rounds AS r ON r.id = m.round_id AND r.phase_id = m.phase_id
LEFT JOIN public.players AS p1 ON p1.id = m.player_1_id
LEFT JOIN public.players AS p2 ON p2.id = m.player_2_id
WHERE g.parsed AND g.source = 'ps_replay' AND g.replay_url <> '';

REVOKE ALL ON TABLE public.phase_replay_library FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.phase_replay_library TO service_role;
