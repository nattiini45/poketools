import { describe, expect, it } from 'vitest';
import {
  STUDIO_KINDS,
  STUDIO_VISIBILITIES,
  canDeleteDefinition,
  canEditDraft,
  canPublishVersion,
  canSetVisibility,
  canViewDefinition,
  type DefAccess,
  type StudioActor,
  type StudioVisibility,
} from '../access';

const OWNER = 'owner-1';
const LEAGUE = 'league-7';

const siteAdmin: StudioActor = { playerId: 'admin-9', isAdmin: true };
const owner: StudioActor = { playerId: OWNER, isAdmin: false };
const stranger: StudioActor = { playerId: 'other-2', isAdmin: false };
const leagueAdmin: StudioActor = { playerId: 'la-3', isAdmin: false, leagueIds: new Set([LEAGUE]) };

const def = (over: Partial<DefAccess> = {}): DefAccess => ({ kind: 'custom', owner_id: OWNER, visibility: 'private', ...over });

describe('the studio access rules', () => {
  it('the kinds and visibilities are the ones the tables allow', () => {
    expect([...STUDIO_KINDS]).toEqual(['preset', 'custom']);
    expect([...STUDIO_VISIBILITIES]).toEqual(['private', 'league', 'gallery']);
  });

  it('a definition without season_id (a format) never matches a league admin', () => {
    expect(canViewDefinition(leagueAdmin, def())).toBe(false);
    expect(canEditDraft(leagueAdmin, def())).toBe(false);
    expect(canEditDraft(leagueAdmin, def({ season_id: null }))).toBe(false);
  });

  describe('a league-owned definition (season_id set)', () => {
    const owned = def({ owner_id: 'someone-else', season_id: LEAGUE });

    it('is seen, edited, published and deleted by the admins of that league', () => {
      expect(canViewDefinition(leagueAdmin, owned)).toBe(true);
      expect(canEditDraft(leagueAdmin, owned)).toBe(true);
      expect(canPublishVersion(leagueAdmin, owned)).toBe(true);
      expect(canDeleteDefinition(leagueAdmin, owned)).toBe(true);
    });

    it('is not managed by the admin of another league or by a stranger', () => {
      const elsewhere: StudioActor = { playerId: 'la-4', isAdmin: false, leagueIds: new Set(['league-8']) };
      for (const actor of [elsewhere, stranger]) {
        expect(canViewDefinition(actor, owned)).toBe(false);
        expect(canEditDraft(actor, owned)).toBe(false);
      }
    });

    it('does not let the league admin change who can see it', () => {
      for (const next of STUDIO_VISIBILITIES) expect(canSetVisibility(leagueAdmin, owned, next)).toBe(false);
    });

    it('is not published by a league admin once it belongs to the gallery', () => {
      expect(canPublishVersion(leagueAdmin, { ...owned, visibility: 'gallery' })).toBe(false);
      expect(canPublishVersion(siteAdmin, { ...owned, visibility: 'gallery' })).toBe(true);
    });
  });

  it('a site admin may do everything, a preset row is theirs alone', () => {
    const preset = def({ kind: 'preset', owner_id: null, visibility: 'gallery' });
    for (const next of STUDIO_VISIBILITIES) expect(canSetVisibility(siteAdmin, preset, next)).toBe(true);
    expect(canEditDraft(siteAdmin, preset)).toBe(true);
    expect(canEditDraft(owner, { ...preset, owner_id: OWNER })).toBe(false);
    expect(canPublishVersion(owner, { ...preset, owner_id: OWNER })).toBe(false);
  });

  it.each(STUDIO_VISIBILITIES)('the owner of a custom %s definition edits and deletes it', (visibility) => {
    expect(canEditDraft(owner, def({ visibility }))).toBe(true);
    expect(canDeleteDefinition(owner, def({ visibility }))).toBe(true);
  });

  it('visibility moves between private and league for the owner, never to or from the gallery', () => {
    const moves = (from: StudioVisibility, to: StudioVisibility) => canSetVisibility(owner, def({ visibility: from }), to);
    expect(moves('private', 'league')).toBe(true);
    expect(moves('league', 'private')).toBe(true);
    expect(moves('private', 'gallery')).toBe(false);
    expect(moves('gallery', 'private')).toBe(false);
  });
});
