import { describe, expect, it } from 'vitest';
import type { TournamentFormData } from '@/types/tournament';
import {
  buildTournamentPatch,
  type TournamentSettingsLocks,
  type TournamentSettingsSource,
} from '../settings-patch';

const RULESET = '11111111-1111-4111-8111-111111111111';
const OTHER_RULESET = '22222222-2222-4222-8222-222222222222';

const initial: TournamentSettingsSource = {
  name: 'Spring Cup',
  bracket_type: 'double_elim',
  ruleset_id: RULESET,
  best_of_default: 3,
  bo_overrides: { Finals: 5 },
  is_doubles: false,
  team_visibility: 'hidden_until_match',
  bracket_reset_enabled: true,
};

/** What the form submits when nothing was touched. */
function submitted(overrides: Partial<TournamentFormData> = {}): TournamentFormData {
  return {
    name: 'Spring Cup',
    bracket_type: 'double_elim',
    ruleset_id: RULESET,
    best_of_default: 3,
    bo_overrides: { Finals: 5 },
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    bracket_reset_enabled: true,
    ...overrides,
  };
}

const open: TournamentSettingsLocks = { bracketType: false, ruleset: false, doubles: false };
const locked: TournamentSettingsLocks = { bracketType: true, ruleset: true, doubles: true };

describe('buildTournamentPatch', () => {
  it('returns an empty patch when nothing changed', () => {
    expect(buildTournamentPatch(initial, submitted(), open)).toEqual({});
    expect(buildTournamentPatch(initial, submitted(), locked)).toEqual({});
  });

  it('sends only the name, trimmed', () => {
    expect(buildTournamentPatch(initial, submitted({ name: '  Autumn Cup ' }), open)).toEqual({ name: 'Autumn Cup' });
  });

  it('ignores a name that differs only by surrounding whitespace', () => {
    expect(buildTournamentPatch(initial, submitted({ name: ' Spring Cup ' }), open)).toEqual({});
  });

  it('emits a changed default best-of and visibility', () => {
    expect(
      buildTournamentPatch(initial, submitted({ best_of_default: 5, team_visibility: 'always_public' }), open),
    ).toEqual({ best_of_default: 5, team_visibility: 'always_public' });
  });

  it('sends an empty map when every override was cleared', () => {
    expect(buildTournamentPatch(initial, submitted({ bo_overrides: undefined }), open)).toEqual({ bo_overrides: {} });
  });

  it('treats an override of 0 like no override', () => {
    const none = { ...initial, bo_overrides: {} };
    expect(buildTournamentPatch(none, submitted({ bo_overrides: { Finals: 0 } }), open)).toEqual({});
    expect(buildTournamentPatch(initial, submitted({ bo_overrides: { Finals: 0 } }), open)).toEqual({
      bo_overrides: {},
    });
  });

  it('compares overrides as a key-sorted map, so key order alone is no change', () => {
    const two = { ...initial, bo_overrides: { Semifinals: 3, Finals: 5 } };
    expect(buildTournamentPatch(two, submitted({ bo_overrides: { Finals: 5, Semifinals: 3 } }), open)).toEqual({});
    expect(buildTournamentPatch(two, submitted({ bo_overrides: { Finals: 7, Semifinals: 3 } }), open)).toEqual({
      bo_overrides: { Finals: 7, Semifinals: 3 },
    });
  });

  it('emits bracket type, ruleset and doubles while they are open', () => {
    expect(
      buildTournamentPatch(
        initial,
        submitted({ bracket_type: 'swiss', ruleset_id: OTHER_RULESET, is_doubles: true }),
        open,
      ),
    ).toEqual({ bracket_type: 'swiss', ruleset_id: OTHER_RULESET, is_doubles: true });
  });

  it('never emits a locked bracket type, ruleset or doubles, even when the control changed', () => {
    const patch = buildTournamentPatch(
      initial,
      submitted({ bracket_type: 'swiss', ruleset_id: OTHER_RULESET, is_doubles: true, name: 'Renamed' }),
      locked,
    );
    expect(patch).toEqual({ name: 'Renamed' });
  });

  it('compares the grand-final reset only for double elimination', () => {
    expect(buildTournamentPatch(initial, submitted({ bracket_reset_enabled: false }), open)).toEqual({
      bracket_reset_enabled: false,
    });

    const single = { ...initial, bracket_type: 'single_elim' as const, bracket_reset_enabled: true };
    expect(
      buildTournamentPatch(single, submitted({ bracket_type: 'single_elim', bracket_reset_enabled: undefined }), open),
    ).toEqual({});
    expect(
      buildTournamentPatch(single, submitted({ bracket_type: 'single_elim', bracket_reset_enabled: false }), open),
    ).toEqual({});
  });

  it('does not emit the reset when the bracket type moves away from double elimination', () => {
    expect(
      buildTournamentPatch(initial, submitted({ bracket_type: 'swiss', bracket_reset_enabled: undefined }), open),
    ).toEqual({ bracket_type: 'swiss' });
  });

  it('reads a stored reset of undefined as the default (enabled)', () => {
    const legacy = { ...initial, bracket_reset_enabled: undefined };
    expect(buildTournamentPatch(legacy, submitted({ bracket_reset_enabled: true }), open)).toEqual({});
    expect(buildTournamentPatch(legacy, submitted({ bracket_reset_enabled: false }), open)).toEqual({
      bracket_reset_enabled: false,
    });
  });

  it('still emits the reset for a double-elimination tournament whose bracket type is locked', () => {
    expect(
      buildTournamentPatch(initial, submitted({ bracket_type: 'swiss', bracket_reset_enabled: false }), locked),
    ).toEqual({ bracket_reset_enabled: false });
  });
});
