import { describe, expect, it } from 'vitest';
import { DRIFT_IGNORED_FIELDS, changedFields, classifyDrift, driftReport, fingerprintFields, type DriftInput } from '../drift';

const after = { name: 'Gen 9 OU League', end_date: '2026-12-01', status: 'upcoming' };
const input = (live: DriftInput['live'], stored: DriftInput['after'] = { fields: after }): DriftInput => ({ refKey: 'league', after: stored, live });

describe('classifyDrift (plan 4.8)', () => {
  it('is unchanged when the tracked fields match, whatever their order', () => {
    expect(classifyDrift(input({ accessible: true, exists: true, fields: { status: 'upcoming', end_date: '2026-12-01', name: 'Gen 9 OU League' } }))).toEqual({
      refKey: 'league',
      state: 'unchanged',
    });
  });

  it('names the fields someone changed outside the chat', () => {
    const result = classifyDrift(input({ accessible: true, exists: true, fields: { ...after, end_date: '2026-12-15', description: 'new' } }));
    expect(result).toEqual({ refKey: 'league', state: 'changed_outside', fields: ['description', 'end_date'] });
  });

  it('ignores phase enrollment and timestamps: the admin UI rewrites them on every page load (X13)', () => {
    const live = { ...after, enrollment: ['x'], participants_enrollment: 12, enrollment_source: { frozen: false }, updated_at: '2026-10-27T10:00:00Z' };
    expect(classifyDrift(input({ accessible: true, exists: true, fields: live })).state).toBe('unchanged');
    expect(DRIFT_IGNORED_FIELDS).toEqual(expect.arrayContaining(['enrollment', 'updated_at']));
    expect(fingerprintFields({ ...after, enrollment: [1] })).toBe(fingerprintFields({ ...after, enrollment: [2] }));
  });

  it('reports gone, and in_trash with the purge date instead of gone for a recycled league', () => {
    expect(classifyDrift(input({ accessible: true, exists: false }))).toEqual({ refKey: 'league', state: 'gone' });
    expect(classifyDrift(input({ accessible: true, exists: false, trash: { purgeAfter: '2027-01-25T00:00:00Z' } }))).toEqual({
      refKey: 'league',
      state: 'in_trash',
      purgeAfter: '2027-01-25T00:00:00Z',
    });
  });

  it('answers no_access before anything else, so a revoked grant reveals nothing', () => {
    expect(classifyDrift(input({ accessible: false, exists: true, fields: { ...after, name: 'secret' } }))).toEqual({ refKey: 'league', state: 'no_access' });
    expect(classifyDrift(input({ accessible: false, exists: false, trash: { purgeAfter: 'x' } })).state).toBe('no_access');
  });

  it('compares fingerprints when no fields were stored, and fails closed when a side is missing', () => {
    const fp = fingerprintFields(after);
    expect(classifyDrift(input({ accessible: true, exists: true, fingerprint: fp }, { fingerprint: fp })).state).toBe('unchanged');
    expect(classifyDrift(input({ accessible: true, exists: true, fingerprint: 'other' }, { fingerprint: fp })).state).toBe('changed_outside');
    expect(classifyDrift(input({ accessible: true, exists: true, fields: after }, { fingerprint: fp })).state).toBe('unchanged');
    expect(classifyDrift(input({ accessible: true, exists: true }, { fingerprint: fp })).state).toBe('changed_outside');
    expect(classifyDrift(input({ accessible: true, exists: true, fingerprint: fp }, {})).state).toBe('changed_outside');
  });

  it('counts a field missing on one side as changed', () => {
    expect(changedFields({ a: 1 }, { a: 1, b: null })).toEqual(['b']);
    expect(changedFields({ a: 1, b: [1, { c: 2 }] }, { a: 1, b: [1, { c: 2 }] })).toEqual([]);
    expect(changedFields({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toEqual(['b']);
  });
});

describe('driftReport', () => {
  it('lists drifted entities and drops the ones the caller may no longer read', () => {
    const report = driftReport([
      { refKey: 'league', after: { fields: after }, live: { accessible: true, exists: true, fields: after } },
      { refKey: 'phase.playoffs', after: { fields: after }, live: { accessible: true, exists: true, fields: { ...after, status: 'active' } } },
      { refKey: 'tournament', after: { fields: after }, live: { accessible: false, exists: true } },
      { refKey: 'phase.regular_season', after: { fields: after }, live: { accessible: true, exists: false } },
    ]);
    expect(report.drifted).toEqual([
      { refKey: 'phase.playoffs', state: 'changed_outside', fields: ['status'] },
      { refKey: 'phase.regular_season', state: 'gone' },
    ]);
    expect(report.noAccess).toEqual(['tournament']);
  });
});
