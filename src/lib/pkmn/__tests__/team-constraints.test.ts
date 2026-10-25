import { describe, expect, it } from 'vitest';
import type { TeamConstraints } from '@/types/ruleset';
import { isEmptyTeamConstraints, normalizeTeamConstraints } from '../team-constraints';

describe('isEmptyTeamConstraints', () => {
  it('treats null, undefined, {} and an all-undefined object as empty', () => {
    expect(isEmptyTeamConstraints(null)).toBe(true);
    expect(isEmptyTeamConstraints(undefined)).toBe(true);
    expect(isEmptyTeamConstraints({})).toBe(true);
    expect(isEmptyTeamConstraints({ tera_match: undefined })).toBe(true);
  });

  it('treats any set rule as not empty, including tera_match none', () => {
    expect(isEmptyTeamConstraints({ tera_match: 'none' })).toBe(false);
    expect(isEmptyTeamConstraints({ eviolite_tier_cap: 'RU' })).toBe(false);
    expect(isEmptyTeamConstraints({ tera_match: undefined, eviolite_tier_cap: 'RU' })).toBe(false);
  });
});

describe('normalizeTeamConstraints', () => {
  it('returns null for an empty block', () => {
    expect(normalizeTeamConstraints(null)).toBeNull();
    expect(normalizeTeamConstraints(undefined)).toBeNull();
    expect(normalizeTeamConstraints({})).toBeNull();
    expect(normalizeTeamConstraints({ tera_match: undefined })).toBeNull();
  });

  it('drops undefined keys and keeps the rest', () => {
    const input: TeamConstraints = { tera_match: 'player_core', eviolite_tier_cap: undefined };
    const out = normalizeTeamConstraints(input);
    expect(out).toEqual({ tera_match: 'player_core' });
    expect(out).not.toHaveProperty('eviolite_tier_cap');
  });

  it('returns a copy, not the input object', () => {
    const input: TeamConstraints = { tera_match: 'none' };
    const out = normalizeTeamConstraints(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});
