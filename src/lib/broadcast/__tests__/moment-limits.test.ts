import { describe, it, expect } from 'vitest';
import {
  MOMENT_DESCRIPTION_MAX_LENGTH,
  MOMENT_MAX_PER_GAME,
  MOMENT_MAX_TURN,
  boundMomentNote,
  boundMomentTurn,
  buildTrackerMoment,
} from '../moment-limits';
import {
  FIELD_LIMITS,
  MANUAL_RESULT_MAX_MOMENTS,
  MANUAL_RESULT_MAX_TURN,
  manualResultMomentSchema,
} from '@/lib/validation/schemas';

const NOW = new Date('2026-10-18T12:00:00.000Z');

describe('moment limits', () => {
  it('match the bounds the manual-result schema enforces', () => {
    expect(MOMENT_MAX_TURN).toBe(MANUAL_RESULT_MAX_TURN);
    expect(MOMENT_MAX_PER_GAME).toBe(MANUAL_RESULT_MAX_MOMENTS);
    expect(MOMENT_DESCRIPTION_MAX_LENGTH).toBe(FIELD_LIMITS.DESCRIPTION);
    const atCap = { moment_type: 'misplay', description: 'x'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH) };
    expect(manualResultMomentSchema.safeParse(atCap).success).toBe(true);
    const overCap = { moment_type: 'misplay', description: 'x'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH + 1) };
    expect(manualResultMomentSchema.safeParse(overCap).success).toBe(false);
  });

  describe('boundMomentTurn', () => {
    it('maps turn 0 and invalid counters to null', () => {
      expect(boundMomentTurn(0)).toBeNull();
      expect(boundMomentTurn(-3)).toBeNull();
      expect(boundMomentTurn(Number.NaN)).toBeNull();
      expect(boundMomentTurn(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('keeps in-range turns and holds larger ones at the cap', () => {
      expect(boundMomentTurn(1)).toBe(1);
      expect(boundMomentTurn(MOMENT_MAX_TURN)).toBe(MOMENT_MAX_TURN);
      expect(boundMomentTurn(MOMENT_MAX_TURN + 1)).toBe(MOMENT_MAX_TURN);
      expect(boundMomentTurn(25_000)).toBe(MOMENT_MAX_TURN);
    });
  });

  describe('boundMomentNote', () => {
    it('maps an empty note to null and keeps notes up to the cap unchanged', () => {
      expect(boundMomentNote('')).toBeNull();
      expect(boundMomentNote('nice read')).toBe('nice read');
      const atCap = 'y'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH);
      expect(boundMomentNote(atCap)).toBe(atCap);
    });

    it('cuts a 501-character note to the cap', () => {
      const cut = boundMomentNote('z'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH + 1));
      expect(cut).toHaveLength(MOMENT_DESCRIPTION_MAX_LENGTH);
    });

    it('does not split a surrogate pair at the cut', () => {
      const note = 'a'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH - 1) + '\u{1F4A5}tail';
      const cut = boundMomentNote(note);
      expect(cut).toBe('a'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH - 1));
    });
  });

  describe('buildTrackerMoment', () => {
    it('produces a moment the server schema accepts even from out-of-range tracker state', () => {
      const moment = buildTrackerMoment({
        matchId: 'm1',
        momentType: 'big_ko',
        turn: MOMENT_MAX_TURN + 500,
        note: 'n'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH + 50),
        now: NOW,
      });
      expect(moment).toEqual({
        match_id: 'm1',
        moment_type: 'big_ko',
        turn_number: MOMENT_MAX_TURN,
        description: 'n'.repeat(MOMENT_DESCRIPTION_MAX_LENGTH),
        timestamp: NOW.toISOString(),
        created_by: '',
      });
      expect(manualResultMomentSchema.safeParse(moment).success).toBe(true);
    });

    it('sends null turn and note for a fresh game with no note', () => {
      const moment = buildTrackerMoment({ matchId: 'm1', momentType: 'clutch', turn: 0, note: '', now: NOW });
      expect(moment.turn_number).toBeNull();
      expect(moment.description).toBeNull();
      expect(manualResultMomentSchema.safeParse(moment).success).toBe(true);
    });
  });
});
