import { describe, expect, it } from 'vitest';
import { buildSnapshotRows } from '../epb-matchday';
import type { EvolutionTracker, EvoProgressEntry, EvolutionEventRecord } from '@/types/evolution';
import type { LineThresholds } from '@/lib/match/epb-stage-resolution';

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 'season-1',
    player_id: 'player-1',
    base_pokemon: 'Gastly',
    current_form: 'Gastly',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<EvoProgressEntry> = {}): EvoProgressEntry {
  return {
    id: 'log-1',
    tracker_id: 'tracker-1',
    season_id: 'season-1',
    matchday: 3,
    source: 'real_kill',
    amount: 1,
    note: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const gastlyLine: LineThresholds = {
  base_pokemon: 'Gastly',
  stage2_pokemon: 'Haunter',
  stage3_pokemon: 'Gengar',
  stage2_kos: 5,
  stage3_kos: 15,
};

describe('buildSnapshotRows', () => {
  it('credits KOs logged under an evolved form name and marks the line brought', () => {
    const tracker = makeTracker({
      current_form: 'Gengar',
      current_stage: 3,
      total_kos: 16,
      real_kills: 16,
    });
    const logEntries = [makeLogEntry({ source: 'real_kill', amount: 2, id: 'log-a' })];
    const battleStats = [{ player_id: 'player-1', pokemon_name: 'Haunter' }];

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1'], [tracker], [gastlyLine], logEntries, [], battleStats,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].real_kos).toBe(2);
    expect(rows[0].brought).toBe(true);
    expect(rows[0].progress_before).toBe(14);
    expect(rows[0].progress_after).toBe(16);
  });

  it('isolates same-matchday cosmo deltas from real KOs in progress_before', () => {
    const tracker = makeTracker({ total_kos: 6, real_kills: 5, cosmo_points: 1 });
    const logEntries = [
      makeLogEntry({ source: 'real_kill', amount: 1, id: 'log-a' }),
      makeLogEntry({ source: 'cosmo_point', amount: 1, id: 'log-b' }),
    ];

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1'], [tracker], [gastlyLine], logEntries, [], [],
    );

    expect(rows[0].progress_before).toBe(4);
    expect(rows[0].real_kos).toBe(1);
    expect(rows[0].cosmo_points_delta).toBe(1);
  });

  it('uses the pre-evolution form when the line evolved this matchday', () => {
    const tracker = makeTracker({ current_form: 'Haunter', current_stage: 2, total_kos: 5 });
    const event = {
      id: 'event-1',
      season_id: 'season-1',
      matchday: 3,
      tracker_id: 'tracker-1',
      player_id: 'player-1',
      base_pokemon: 'Gastly',
      previous_form: 'Gastly',
      new_form: 'Haunter',
      previous_stage: 1,
      new_stage: 2,
      total_kos: 5,
      is_devolution: false,
      is_manual: false,
      created_at: '2026-01-01T00:00:00Z',
    } satisfies EvolutionEventRecord;

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1'], [tracker], [gastlyLine], [], [event], [],
    );

    expect(rows[0].species_at_match).toBe('Gastly');
    expect(rows[0].stage_at_match).toBe(1);
    expect(rows[0].evolution_triggered).toBe(true);
  });

  it('sets suspension_triggered only for suspensions created this matchday', () => {
    const suspended = makeTracker({ id: 'tracker-1', suspended_until_matchday: 4 });
    const servedEarlier = makeTracker({
      id: 'tracker-2',
      base_pokemon: 'Abra',
      suspended_until_matchday: 3,
    });

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1'], [suspended, servedEarlier], [gastlyLine], [], [], [],
    );

    expect(rows.find((r) => r.tracker_id === 'tracker-1')?.suspension_triggered).toBe(true);
    expect(rows.find((r) => r.tracker_id === 'tracker-2')?.suspension_triggered).toBe(false);
  });

  it('excludes admin corrections from match-attributed deltas', () => {
    const tracker = makeTracker({ total_kos: 8 });
    const logEntries = [
      makeLogEntry({ source: 'real_kill', amount: 2, id: 'log-a' }),
      makeLogEntry({ source: 'admin_correction', amount: 3, id: 'log-b' }),
    ];

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1'], [tracker], [gastlyLine], logEntries, [], [],
    );

    expect(rows[0].progress_before).toBe(6);
    expect(rows[0].real_kos).toBe(2);
  });

  it('sums per-source matchday deltas into the delta columns', () => {
    const tracker = makeTracker({ total_kos: 10 });
    const logEntries = [
      makeLogEntry({ source: 'real_kill', amount: 2, id: 'log-a' }),
      makeLogEntry({ source: 'draft_token', amount: 1, id: 'log-b' }),
      makeLogEntry({ source: 'kill_token', amount: 1, id: 'log-c' }),
      makeLogEntry({ source: 'cosmo_point', amount: 1, id: 'log-d' }),
    ];

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1'], [tracker], [gastlyLine], logEntries, [], [],
    );

    expect(rows[0].real_kos).toBe(2);
    expect(rows[0].draft_tokens_delta).toBe(1);
    expect(rows[0].kill_tokens_delta).toBe(1);
    expect(rows[0].cosmo_points_delta).toBe(1);
    expect(rows[0].progress_before).toBe(5);
  });

  it('writes one row per line of a branched base, each with its line_id', () => {
    const samurott = makeTracker({
      id: 't-samurott', base_pokemon: 'Oshawott', current_form: 'Dewott', current_stage: 2, line_id: 'oshawott--samurott',
    });
    const hisui = makeTracker({
      id: 't-hisui', base_pokemon: 'Oshawott', current_form: 'Oshawott', line_id: 'oshawott--samurotthisui',
    });
    const lines: LineThresholds[] = [
      { line_id: 'oshawott--samurott', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott', stage2_kos: 3, stage3_kos: 10 },
      { line_id: 'oshawott--samurotthisui', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott-Hisui', stage2_kos: 6, stage3_kos: 12 },
    ];

    const rows = buildSnapshotRows('match-1', 3, ['player-1'], [samurott, hisui], lines, [], [], []);

    expect(rows.map((r) => [r.tracker_id, r.base_pokemon, r.line_id, r.stage_at_match])).toEqual([
      ['t-samurott', 'Oshawott', 'oshawott--samurott', 2],
      ['t-hisui', 'Oshawott', 'oshawott--samurotthisui', 1],
    ]);
  });

  it('writes line_id null for a legacy tracker without a line', () => {
    const rows = buildSnapshotRows('match-1', 3, ['player-1'], [makeTracker()], [gastlyLine], [], [], []);
    expect(rows[0].line_id).toBeNull();
  });

  it('only snapshots trackers belonging to the match players', () => {
    const p1Tracker = makeTracker({ id: 't-1', player_id: 'player-1' });
    const otherTracker = makeTracker({ id: 't-3', player_id: 'player-3', base_pokemon: 'Abra' });

    const rows = buildSnapshotRows(
      'match-1', 3, ['player-1', 'player-2'], [p1Tracker, otherTracker], [gastlyLine], [], [], [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].player_id).toBe('player-1');
  });
});
