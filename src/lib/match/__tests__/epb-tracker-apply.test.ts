import { describe, expect, it } from 'vitest';
import {
  applyKillDelta,
  applyStageTransitions,
  buildFormToTrackerIndex,
} from '../epb-tracker-apply';
import type { LineThresholds } from '@/lib/match/epb-stage-resolution';
import type { EvolutionTracker } from '@/types/evolution';

const gastlyLine: LineThresholds = {
  base_pokemon: 'Gastly',
  stage2_pokemon: 'Haunter',
  stage3_pokemon: 'Gengar',
  stage2_kos: 5,
  stage3_kos: 15,
};

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

describe('buildFormToTrackerIndex', () => {
  it('indexes all line forms including locked stage-3', () => {
    const tracker = makeTracker({ locked_stage3_pokemon: 'Gengar-Mega' });
    const index = buildFormToTrackerIndex([tracker], [gastlyLine]);

    expect(index.get('player-1::Gastly')).toBe(tracker);
    expect(index.get('player-1::Haunter')).toBe(tracker);
    expect(index.get('player-1::Gengar')).toBe(tracker);
    expect(index.get('player-1::Gengar-Mega')).toBe(tracker);
  });

  it('includes locked stage-3 when no line thresholds exist', () => {
    const tracker = makeTracker({
      base_pokemon: 'Ralts',
      current_form: 'Kirlia',
      locked_stage3_pokemon: 'Gallade',
    });
    const index = buildFormToTrackerIndex([tracker], []);

    expect(index.get('player-1::Ralts')).toBe(tracker);
    expect(index.get('player-1::Kirlia')).toBe(tracker);
    expect(index.get('player-1::Gallade')).toBe(tracker);
  });
});

describe('applyStageTransitions', () => {
  it('mutates tracker and emits events when thresholds are crossed', () => {
    const tracker = makeTracker({ total_kos: 5, current_stage: 1, current_form: 'Gastly' });
    const events = applyStageTransitions(tracker, gastlyLine);

    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Haunter');
    expect(events[0].new_stage).toBe(2);
    expect(tracker.current_form).toBe('Haunter');
    expect(tracker.current_stage).toBe(2);
  });

  it('returns empty when form already matches thresholds', () => {
    const tracker = makeTracker({
      total_kos: 5,
      current_stage: 2,
      current_form: 'Haunter',
    });
    expect(applyStageTransitions(tracker, gastlyLine)).toEqual([]);
  });
});

describe('applyKillDelta', () => {
  it('signs positive KO rows for apply and rollback', () => {
    const stats = [
      { player_id: 'p1', pokemon_name: 'Gastly', kos_dealt: 2 },
      { player_id: 'p1', pokemon_name: 'Haunter', kos_dealt: 0 },
    ];

    expect(applyKillDelta(stats, 1)).toEqual([
      { player_id: 'p1', pokemon_name: 'Gastly', kos_dealt: 2 },
    ]);
    expect(applyKillDelta(stats, -1)).toEqual([
      { player_id: 'p1', pokemon_name: 'Gastly', kos_dealt: -2 },
    ]);
  });
});
