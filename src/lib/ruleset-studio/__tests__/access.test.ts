import { describe, expect, it } from 'vitest';
import { canDeleteDefinition, canEditDraft, canPublishVersion, canSetVisibility, canUseRuleset, canViewDefinition, type RulesetActor } from '../access';
import type { RulesetDefinitionMeta } from '../library-types';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const LEAGUE = '33333333-3333-4333-8333-333333333333';

type Def = Pick<RulesetDefinitionMeta, 'kind' | 'owner_id' | 'visibility' | 'season_id'>;
const def = (overrides: Partial<Def> = {}): Def => ({ kind: 'custom', owner_id: OWNER, visibility: 'private', season_id: null, ...overrides });
const owner: RulesetActor = { playerId: OWNER, isAdmin: false };
const other: RulesetActor = { playerId: OTHER, isAdmin: false };
const admin: RulesetActor = { playerId: OTHER, isAdmin: true };
const leagueAdmin: RulesetActor = { playerId: OTHER, isAdmin: false, leagueIds: new Set([LEAGUE]) };

describe('ruleset access rules', () => {
  it('a private ruleset is visible and editable to its owner and to site admins only', () => {
    for (const rule of [canViewDefinition, canEditDraft, canPublishVersion, canDeleteDefinition]) {
      expect(rule(owner, def())).toBe(true);
      expect(rule(admin, def())).toBe(true);
      expect(rule(other, def())).toBe(false);
    }
  });

  it('a shared ruleset is visible to every admin, editable only by owner and site admins', () => {
    for (const visibility of ['league', 'gallery'] as const) {
      expect(canViewDefinition(other, def({ visibility }))).toBe(true);
      expect(canEditDraft(other, def({ visibility }))).toBe(false);
    }
  });

  it('a site catalog ruleset (kind preset) is edited by site admins only, even by its owner', () => {
    expect(canEditDraft(owner, def({ kind: 'preset' }))).toBe(false);
    expect(canPublishVersion(owner, def({ kind: 'preset' }))).toBe(false);
    expect(canEditDraft(admin, def({ kind: 'preset' }))).toBe(true);
  });

  it('the owner of a gallery ruleset cannot publish a new version of it', () => {
    expect(canPublishVersion(owner, def({ visibility: 'gallery' }))).toBe(false);
    expect(canPublishVersion(admin, def({ visibility: 'gallery' }))).toBe(true);
  });

  it('visibility: an owner moves private and league only; site admins move anything', () => {
    expect(canSetVisibility(owner, def(), 'league')).toBe(true);
    expect(canSetVisibility(owner, def(), 'gallery')).toBe(false);
    expect(canSetVisibility(owner, def({ visibility: 'gallery' }), 'private')).toBe(false);
    expect(canSetVisibility(other, def({ visibility: 'league' }), 'private')).toBe(false);
    expect(canSetVisibility(admin, def(), 'gallery')).toBe(true);
  });

  it('the admins of the league that owns a league-made ruleset may view, edit and publish it, but not share it', () => {
    const made = def({ season_id: LEAGUE, owner_id: OWNER });
    expect(canViewDefinition(leagueAdmin, made)).toBe(true);
    expect(canEditDraft(leagueAdmin, made)).toBe(true);
    expect(canPublishVersion(leagueAdmin, made)).toBe(true);
    expect(canDeleteDefinition(leagueAdmin, made)).toBe(true);
    expect(canSetVisibility(leagueAdmin, made, 'league')).toBe(false);
    // Another league's ruleset, and a ruleset no league owns, stay closed to them.
    expect(canViewDefinition(leagueAdmin, def({ season_id: '44444444-4444-4444-8444-444444444444' }))).toBe(false);
    expect(canViewDefinition(leagueAdmin, def())).toBe(false);
  });

  it('using a ruleset needs the right to see it AND a published version', () => {
    expect(canUseRuleset(owner, def(), true)).toBe(true);
    expect(canUseRuleset(owner, def(), false)).toBe(false);
    expect(canUseRuleset(other, def(), true)).toBe(false);
    expect(canUseRuleset(other, def({ visibility: 'gallery' }), true)).toBe(true);
  });
});
