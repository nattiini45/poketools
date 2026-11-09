import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EMPTY_POINTS,
  EMPTY_RELATION,
  EMPTY_RESOURCE,
  apiOnlyKindsOf,
  formKindsOf,
  isPointsDirty,
  isRelationDirty,
  isResourceDirty,
  parsePoints,
  parseRelation,
  parseResource,
} from '../adjust-form';
import { adjustmentFacts } from '../adjustment-facts';
import { codePointLength, nameOf } from '../admin-shared';
import { describeCheck, matchIdOf, TEAM_AUDIT_CAUSES, TEAM_AUDIT_REASONS } from '../check-subject';
import type { TeamAuditCause, TeamAuditReason } from '@/lib/format-engine/runtime/team-audit';
import { FORMAT_CHECK_SOURCES } from '@/lib/format-engine/runtime/types';
import en from '@/i18n/messages/format-runtime/admin/en';
import de from '@/i18n/messages/format-runtime/admin/de';
import { MARA, MATCH, MISTY } from './helpers';

describe('team audit code lists', () => {
  it('match the server unions in both directions', () => {
    expectTypeOf<(typeof TEAM_AUDIT_REASONS)[number]>().toEqualTypeOf<TeamAuditReason>();
    expectTypeOf<(typeof TEAM_AUDIT_CAUSES)[number]>().toEqualTypeOf<TeamAuditCause>();
    expect(new Set(TEAM_AUDIT_REASONS).size).toBe(TEAM_AUDIT_REASONS.length);
    expect(new Set(TEAM_AUDIT_CAUSES).size).toBe(TEAM_AUDIT_CAUSES.length);
  });
});

describe('describeCheck', () => {
  it('reads each source of the engine', () => {
    expect(describeCheck({ source: 'unresolved_outcome', subject: { match_id: MATCH, players: [MARA, MISTY] } })).toEqual({
      kind: 'unresolved_outcome',
      matchId: MATCH,
      players: [MARA, MISTY],
    });
    expect(describeCheck({ source: 'standings_tie', subject: { stage: 'cup', players: [MARA, MISTY], tie_group: 1 } })).toEqual({
      kind: 'standings_tie',
      stage: 'cup',
      players: [MARA, MISTY],
    });
    expect(describeCheck({ source: 'pairing_rematch', subject: { stage: 'cup', round: 2, rematches: 1 } })).toEqual({
      kind: 'pairing_rematch',
      stage: 'cup',
      round: 2,
      count: 1,
    });
    expect(describeCheck({ source: 'pairing_forbidden', subject: { stage: 'cup', round: 2, forbidden: 3 } })).toEqual({
      kind: 'pairing_forbidden',
      stage: 'cup',
      round: 2,
      count: 3,
    });
  });

  it('reads a missed match deadline and a missed action', () => {
    expect(
      describeCheck({
        source: 'deadline_missed',
        subject: { stage: 'cup', applies: 'match', on_miss: 'admin_review', round: 1, match_id: MATCH, players: [MARA, MISTY], reason: 'admin_review' },
      }),
    ).toEqual({ kind: 'deadline_missed', stage: 'cup', round: 1, matchId: MATCH, players: [MARA, MISTY], action: null, reason: 'admin_review' });
    expect(
      describeCheck({ source: 'deadline_missed', subject: { stage: 'cup', applies: 'action', action: 'gift', player_id: MARA, reason: 'no_valid_pick' } }),
    ).toEqual({ kind: 'deadline_missed', stage: 'cup', round: null, matchId: null, players: [MARA], action: 'gift', reason: 'no_valid_pick' });
    expect(
      describeCheck({ source: 'deadline_missed', subject: { stage: 'cup', applies: 'action', action: 'gift', giver_masked: true, reason: 'admin_review' } }),
    ).toEqual({ kind: 'deadline_missed', stage: 'cup', round: null, matchId: null, players: [], action: 'gift', reason: 'admin_review', giverHidden: true });
  });

  it('reads a team audit, keeping only the reasons and causes it knows', () => {
    const d = describeCheck({
      source: 'team_audit',
      subject: {
        match_id: MATCH,
        round: 2,
        player_id: MARA,
        reasons: ['rules', 'something_new', 'audit_unavailable'],
        cause: 'read_failed',
        issues: [{ code: 'kit_count_max', params: { max: 1, source: 'x', nested: { a: 1 } }, pokemon_indexes: [0] }, { nope: true }],
        off_team: ['Pikachu', 7],
        edited_after_play: true,
      },
    });
    expect(d).toEqual({
      kind: 'team_audit',
      matchId: MATCH,
      round: 2,
      player: MARA,
      reasons: ['rules', 'audit_unavailable'],
      cause: 'read_failed',
      issues: [{ code: 'kit_count_max', params: { max: 1, source: 'x' } }],
      offTeam: ['Pikachu'],
      editedAfterPlay: true,
    });
  });

  it('marks a team audit whose planned team the server hid, and nothing else changes', () => {
    const base = {
      match_id: MATCH,
      round: 2,
      player_id: MARA,
      reasons: ['rules', 'observed_mismatch'],
      issues: [{ code: 'kit_count_max', params: {}, pokemon_indexes: [0] }],
      off_team: [],
      off_team_count: 2,
      team_id: null,
    };
    expect(describeCheck({ source: 'team_audit', subject: { ...base, team_hidden: true } })).toMatchObject({ kind: 'team_audit', teamHidden: true, offTeam: [] });
    expect(describeCheck({ source: 'team_audit', subject: base })).not.toHaveProperty('teamHidden');
    expect(describeCheck({ source: 'team_audit', subject: { ...base, team_hidden: 'yes' } })).not.toHaveProperty('teamHidden');
  });

  it('falls back to generic for an unknown source, an unreadable subject and a team audit without a known reason', () => {
    expect(describeCheck({ source: 'expr', subject: { of: 'player', id: MARA } })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'from_the_future', subject: { match_id: MATCH } })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'unresolved_outcome', subject: null })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'unresolved_outcome', subject: [MATCH] })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'unresolved_outcome', subject: { players: [MARA] } })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'standings_tie', subject: { stage: 'cup', players: [] } })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'team_audit', subject: { reasons: ['unheard_of'] } })).toEqual({ kind: 'generic' });
    expect(describeCheck({ source: 'deadline_missed', subject: { stage: 'cup' } })).toEqual({ kind: 'generic' });
  });

  it('every source the engine can write is handled by a sentence or the generic one without throwing', () => {
    for (const source of FORMAT_CHECK_SOURCES) expect(() => describeCheck({ source, subject: {} })).not.toThrow();
  });

  it('names the match a check is about', () => {
    expect(matchIdOf(describeCheck({ source: 'unresolved_outcome', subject: { match_id: MATCH } }))).toBe(MATCH);
    expect(matchIdOf(describeCheck({ source: 'standings_tie', subject: { players: [MARA] } }))).toBeNull();
  });
});

describe('adjustment forms', () => {
  it('offers the form kinds the format allows and names the rest as API only', () => {
    expect(formKindsOf(['resource', 'rank', 'points', 'action'])).toEqual(['points', 'resource']);
    expect(apiOnlyKindsOf(['points', 'relation', 'rank', 'domain', 'action'])).toEqual(['rank', 'domain', 'relation_links']);
    expect(apiOnlyKindsOf(['points', 'action'])).toEqual([]);
  });

  it('points the API-only kinds at the API alone, as the assistant has no adjustment tool', () => {
    expect(en.adjust.apiOnly).toMatch(/API/);
    expect(de.adjust.apiOnly).toMatch(/API/);
    expect(en.adjust.apiOnly).not.toMatch(/assistant/i);
    expect(de.adjust.apiOnly).not.toMatch(/assistent/i);
  });

  it('parses points: signs, a comma, two decimals, the bound, never zero', () => {
    const draft = { stage: 'cup', player: MARA, points: '' };
    const ok = (points: string) => parsePoints({ ...draft, points });
    expect(ok('2')).toEqual({ ok: true, body: { kind: 'points', stage: 'cup', player_id: MARA, points: 2 } });
    expect(ok(' -1,25 ')).toMatchObject({ ok: true, body: { points: -1.25 } });
    expect(ok('+0.5')).toMatchObject({ ok: true, body: { points: 0.5 } });
    expect(ok('1000')).toMatchObject({ ok: true });
    expect(ok('-1000')).toMatchObject({ ok: true });
    expect(ok('1000.01')).toEqual({ ok: false, error: 'points_range' });
    expect(ok('0.001')).toEqual({ ok: false, error: 'points_format' });
    expect(ok('1e3')).toEqual({ ok: false, error: 'points_format' });
    expect(ok('0')).toEqual({ ok: false, error: 'points_zero' });
    expect(ok('-0.00')).toEqual({ ok: false, error: 'points_zero' });
    expect(ok('')).toEqual({ ok: false, error: 'points_required' });
    expect(parsePoints({ ...EMPTY_POINTS, points: '1' })).toEqual({ ok: false, error: 'stage_required' });
    expect(parsePoints({ stage: 'cup', player: '', points: '1' })).toEqual({ ok: false, error: 'player_required' });
  });

  it('parses a resource change: an entry only for a list, the sign from the direction, 1 to 64', () => {
    const draft = { resource: 'gifts', player: MARA, item: 'eevee', direction: 'grant' as const, amount: '2' };
    expect(parseResource(draft, true)).toEqual({ ok: true, body: { kind: 'resource', resource: 'gifts', player_id: MARA, item_id: 'eevee', amount: 2 } });
    expect(parseResource({ ...draft, direction: 'revoke' }, true)).toMatchObject({ ok: true, body: { amount: -2 } });
    expect(parseResource({ ...draft, item: '' }, false)).toEqual({ ok: true, body: { kind: 'resource', resource: 'gifts', player_id: MARA, amount: 2 } });
    expect(parseResource({ ...draft, item: '' }, true)).toEqual({ ok: false, error: 'item_required' });
    expect(parseResource({ ...draft, amount: '64' }, true)).toMatchObject({ ok: true });
    expect(parseResource({ ...draft, amount: '65' }, true)).toEqual({ ok: false, error: 'amount_range' });
    expect(parseResource({ ...draft, amount: '0' }, true)).toEqual({ ok: false, error: 'amount_range' });
    expect(parseResource({ ...draft, amount: '-1' }, true)).toEqual({ ok: false, error: 'amount_format' });
    expect(parseResource({ ...draft, amount: ' ' }, true)).toEqual({ ok: false, error: 'amount_required' });
    expect(parseResource(EMPTY_RESOURCE, false)).toEqual({ ok: false, error: 'resource_required' });
    expect(parseResource({ ...draft, player: '' }, true)).toEqual({ ok: false, error: 'player_required' });
  });

  it('parses a relation reveal and nothing else', () => {
    expect(parseRelation({ relation: 'santa', reveal: true })).toEqual({ ok: true, body: { kind: 'relation', relation: 'santa', reveal: true } });
    expect(parseRelation({ relation: 'santa', reveal: false })).toEqual({ ok: false, error: 'nothing_to_do' });
    expect(parseRelation(EMPTY_RELATION)).toEqual({ ok: false, error: 'relation_required' });
  });

  it('a fresh draft is clean and any input makes it dirty', () => {
    expect(isPointsDirty(EMPTY_POINTS)).toBe(false);
    expect(isPointsDirty({ ...EMPTY_POINTS, points: '1' })).toBe(true);
    expect(isResourceDirty(EMPTY_RESOURCE)).toBe(false);
    expect(isResourceDirty({ ...EMPTY_RESOURCE, direction: 'revoke' })).toBe(true);
    expect(isRelationDirty(EMPTY_RELATION)).toBe(false);
    expect(isRelationDirty({ relation: '', reveal: true })).toBe(true);
  });
});

describe('adjustmentFacts', () => {
  it('reads the stored shapes of every kind', () => {
    expect(adjustmentFacts({ kind: 'points', target: { stage: 'cup', player_id: MARA }, delta: { points: -2 } })).toEqual({ kind: 'points', stage: 'cup', player: MARA, points: -2 });
    expect(adjustmentFacts({ kind: 'resource', target: { resource: 'coins', player_id: MARA, item_id: null }, delta: { amount: 2 } })).toEqual({
      kind: 'resource',
      resource: 'coins',
      player: MARA,
      item: null,
      amount: 2,
    });
    expect(adjustmentFacts({ kind: 'relation', target: { relation: 'santa' }, delta: { reveal: true } })).toEqual({
      kind: 'relation',
      relation: 'santa',
      reveal: true,
      draw: false,
      linkCount: null,
    });
    expect(adjustmentFacts({ kind: 'domain', target: { domain: 'pool' }, delta: { add: [{}, {}], remove: ['a'] } })).toEqual({ kind: 'domain', domain: 'pool', added: 2, removed: 1 });
  });

  it('anything else is unknown', () => {
    expect(adjustmentFacts({ kind: 'points', target: null, delta: {} })).toEqual({ kind: 'unknown' });
    expect(adjustmentFacts({ kind: 'action', target: { action: 'gift' }, delta: { state: 'paused' } })).toEqual({ kind: 'unknown' });
    expect(adjustmentFacts({ kind: 'points', target: { stage: 'cup', player_id: MARA }, delta: { points: 'x' } })).toEqual({ kind: 'unknown' });
  });
});

describe('admin helpers', () => {
  it('counts characters as the server does', () => {
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('😀😀')).toBe(2);
  });

  it('looks a name up by id and never returns an id or an inherited key for an unknown player', () => {
    const names = { [MARA]: 'Mara', [MISTY]: 'Misty' };
    expect(nameOf(names, MARA)).toBe('Mara');
    expect(nameOf(names, 'x')).toBeNull();
    expect(nameOf(names, 'constructor')).toBeNull();
  });
});
