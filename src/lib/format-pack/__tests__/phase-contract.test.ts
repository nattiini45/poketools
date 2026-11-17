import { describe, expectTypeOf, it } from 'vitest';
import type { CompetitionOwner, Phase, PhaseMatch, PhaseParticipant, PhaseRound } from '../types';
import type { HistoricalCompetitionOption, HistoricalStatisticsRequest } from '@/lib/pack-extensions/types';

describe('public native phase contracts', () => {
  it('exposes native ownership without a disguised tournament field', () => {
    expectTypeOf<Phase>().toHaveProperty('season_id').toEqualTypeOf<string>();
    expectTypeOf<PhaseRound>().toHaveProperty('phase_id').toEqualTypeOf<string>();
    expectTypeOf<PhaseParticipant>().toHaveProperty('seed').toEqualTypeOf<number | null>();
    expectTypeOf<PhaseParticipant>().not.toHaveProperty('tournament_id');
    expectTypeOf<PhaseMatch>().toHaveProperty('phase_id').toEqualTypeOf<string>();
    expectTypeOf<PhaseMatch>().not.toHaveProperty('tournament_id');
    expectTypeOf<Extract<CompetitionOwner, { kind: 'phase' }>>()
      .toEqualTypeOf<{ kind: 'phase'; phase_id: string; season_id: string }>();
  });

  it('distinguishes phase historical requests from standalone tournament requests', () => {
    expectTypeOf<'phase'>().toExtend<HistoricalStatisticsRequest['scopeType']>();
    expectTypeOf<'phase'>().toExtend<HistoricalCompetitionOption['kind']>();
    expectTypeOf<'tournament'>().toExtend<HistoricalStatisticsRequest['scopeType']>();
  });
});
