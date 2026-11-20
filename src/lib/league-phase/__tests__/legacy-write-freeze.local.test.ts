import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';

// LIVE-LOCAL test for supabase/migrations/20261120110000_phase_legacy_write_freeze.sql, run by the frozen_legacy pass of
// `npm run test:db` (vitest.config.ts, FROZEN_FORMAT_SUITES). While the storage generation is frozen, every statement
// the service role sends to a table the P6 transfer reads or rewrites on the legacy side is refused, whether or not it
// would touch a row. The legacy and phase passes run the whole suite with the same triggers in place.
const FENCED: ReadonlyArray<readonly [table: string, key: string]> = [
  ['tournaments', 'id'], ['tournament_participants', 'tournament_id'], ['tournament_groups', 'id'],
  ['tournament_group_members', 'group_id'], ['rounds', 'id'], ['matches', 'id'], ['games', 'id'], ['battle_stats', 'id'],
  ['match_outcomes', 'match_id'], ['match_analyses', 'id'], ['match_prep_analyses', 'id'], ['match_prep_teams', 'id'],
  ['match_proposals', 'id'], ['match_evolution_snapshots', 'id'], ['epb_animation_views', 'id'], ['broadcast_moments', 'id'],
  ['rating_history', 'id'], ['tournament_reports', 'id'], ['aggregate_jobs', 'id'], ['aggregates', 'id'],
  ['player_aggregates', 'id'], ['teams', 'id'], ['cast_sessions', 'id'], ['resource_admins', 'id'], ['discord_webhooks', 'id'],
  ['social_integrations', 'id'], ['wiki_notes', 'id'], ['wiki_note_reports', 'id'], ['agent_suggestions', 'id'],
  ['player_streaks', 'id'], ['format_challenges', 'id'],
];

it.skipIf(!localStackOptIn('LOCAL_LEGACY_WRITE_FREEZE'))('refuses every legacy write the transfer depends on while frozen', async () => {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
  const { supabase } = await import('@/lib/supabase/client');
  const mode = await supabase.from('phase_storage_state').select('mode').single();
  expect(mode.error).toBeNull();
  expect(mode.data?.mode).toBe('frozen_legacy');

  for (const [table, key] of FENCED) {
    const { error } = await supabase.from(table as 'teams').delete().eq(key as 'id', randomUUID());
    expect(error?.message, table).toBe('phase_storage_not_ready');
    expect(error?.details, table).toContain(`"table": "${table}"`);
  }

  // Deleting a player is itself frozen: its foreign keys cascade into fenced tables, and PostgreSQL runs those cascades
  // as the table owner, so the guard must not trust current_user there. The fixture keeps a fixed id, so a rerun reuses
  // it instead of leaving one player per run behind; a database reset removes it.
  const player = '41928000-0000-4000-8000-0000000000f1';
  const created = await supabase.from('players').upsert({ id: player, name: 'Freeze fixture', is_guest: true }, { onConflict: 'id' });
  expect(created.error).toBeNull();

  const insert = await supabase.from('resource_admins').insert({ player_id: player, resource_type: 'tournament', resource_id: randomUUID() });
  expect(insert.error?.message).toBe('phase_storage_not_ready');
  const rows = await supabase.from('resource_admins').select('id').eq('player_id', player);
  expect(rows.error).toBeNull();
  expect(rows.data).toEqual([]);

  const cascade = await supabase.from('players').delete().eq('id', player);
  expect(cascade.error?.message).toBe('phase_storage_not_ready');
  expect(cascade.error?.details).toContain('"op": "DELETE"');
  const kept = await supabase.from('players').select('id').eq('id', player);
  expect(kept.error).toBeNull();
  expect(kept.data).toEqual([{ id: player }]);
});
