import { describe, expect, it } from 'vitest';
import {
  canAttachDefinition,
  canDeleteDefinition,
  canEditDraft,
  canPublishVersion,
  canSetVisibility,
  canViewDefinition,
  type FormatActor,
} from '../access';
import { FORMAT_VISIBILITIES, type FormatKind, type FormatVisibility } from '../library-types';

const OWNER = 'owner-1';
const OTHER = 'other-2';

const actors = {
  siteAdmin: { playerId: 'admin-9', isAdmin: true },
  owner: { playerId: OWNER, isAdmin: false },
  other: { playerId: OTHER, isAdmin: false },
} satisfies Record<string, FormatActor>;

const def = (kind: FormatKind, visibility: FormatVisibility, owner_id: string | null = OWNER) => ({ kind, visibility, owner_id });

describe('canViewDefinition', () => {
  it.each(FORMAT_VISIBILITIES)('a site admin sees a %s definition of anyone', (visibility) => {
    expect(canViewDefinition(actors.siteAdmin, def('custom', visibility))).toBe(true);
    expect(canViewDefinition(actors.siteAdmin, def('preset', visibility, null))).toBe(true);
  });

  it.each(FORMAT_VISIBILITIES)('the owner sees their own %s definition', (visibility) => {
    expect(canViewDefinition(actors.owner, def('custom', visibility))).toBe(true);
  });

  it('another admin sees league and gallery definitions, not private ones', () => {
    expect(canViewDefinition(actors.other, def('custom', 'private'))).toBe(false);
    expect(canViewDefinition(actors.other, def('custom', 'league'))).toBe(true);
    expect(canViewDefinition(actors.other, def('custom', 'gallery'))).toBe(true);
  });

  it('an ownerless definition is visible by visibility only', () => {
    expect(canViewDefinition(actors.other, def('custom', 'private', null))).toBe(false);
    expect(canViewDefinition(actors.other, def('custom', 'league', null))).toBe(true);
    expect(canViewDefinition(actors.siteAdmin, def('custom', 'private', null))).toBe(true);
  });

  it('a null owner never matches an actor', () => {
    expect(canViewDefinition({ playerId: '', isAdmin: false }, def('custom', 'private', null))).toBe(false);
  });
});

describe('canEditDraft and canDeleteDefinition', () => {
  it.each(FORMAT_VISIBILITIES)('the owner edits and deletes their own custom %s definition', (visibility) => {
    expect(canEditDraft(actors.owner, def('custom', visibility))).toBe(true);
    expect(canDeleteDefinition(actors.owner, def('custom', visibility))).toBe(true);
  });

  it.each(FORMAT_VISIBILITIES)('another admin never edits a %s definition, even one shared with all admins', (visibility) => {
    expect(canEditDraft(actors.other, def('custom', visibility))).toBe(false);
    expect(canDeleteDefinition(actors.other, def('custom', visibility))).toBe(false);
  });

  it('a preset row is edited by site admins only, even when its owner is set', () => {
    expect(canEditDraft(actors.owner, def('preset', 'league'))).toBe(false);
    expect(canDeleteDefinition(actors.owner, def('preset', 'league'))).toBe(false);
    expect(canEditDraft(actors.siteAdmin, def('preset', 'gallery', null))).toBe(true);
  });

  it('an ownerless custom row is managed by site admins only', () => {
    expect(canEditDraft(actors.owner, def('custom', 'league', null))).toBe(false);
    expect(canEditDraft(actors.siteAdmin, def('custom', 'league', null))).toBe(true);
  });
});

describe('canPublishVersion', () => {
  it('the owner publishes a private or league definition', () => {
    expect(canPublishVersion(actors.owner, def('custom', 'private'))).toBe(true);
    expect(canPublishVersion(actors.owner, def('custom', 'league'))).toBe(true);
  });

  it('the owner cannot publish a version of a gallery definition; a site admin can', () => {
    expect(canPublishVersion(actors.owner, def('custom', 'gallery'))).toBe(false);
    expect(canPublishVersion(actors.siteAdmin, def('custom', 'gallery'))).toBe(true);
  });

  it('another admin and an owner of a preset row cannot publish', () => {
    expect(canPublishVersion(actors.other, def('custom', 'league'))).toBe(false);
    expect(canPublishVersion(actors.owner, def('preset', 'private'))).toBe(false);
    expect(canPublishVersion(actors.siteAdmin, def('preset', 'private', null))).toBe(true);
  });

  it('an ownerless custom row is published by site admins only', () => {
    expect(canPublishVersion(actors.other, def('custom', 'private', null))).toBe(false);
    expect(canPublishVersion(actors.siteAdmin, def('custom', 'private', null))).toBe(true);
  });
});

describe('canSetVisibility', () => {
  it('a site admin may make any change', () => {
    for (const from of FORMAT_VISIBILITIES) {
      for (const to of FORMAT_VISIBILITIES) {
        expect(canSetVisibility(actors.siteAdmin, def('custom', from), to)).toBe(true);
        expect(canSetVisibility(actors.siteAdmin, def('preset', from, null), to)).toBe(true);
      }
    }
  });

  it('the owner moves a custom definition between private and league', () => {
    expect(canSetVisibility(actors.owner, def('custom', 'private'), 'league')).toBe(true);
    expect(canSetVisibility(actors.owner, def('custom', 'league'), 'private')).toBe(true);
    expect(canSetVisibility(actors.owner, def('custom', 'private'), 'private')).toBe(true);
  });

  it('the owner never moves a definition to or from the gallery', () => {
    expect(canSetVisibility(actors.owner, def('custom', 'private'), 'gallery')).toBe(false);
    expect(canSetVisibility(actors.owner, def('custom', 'league'), 'gallery')).toBe(false);
    expect(canSetVisibility(actors.owner, def('custom', 'gallery'), 'private')).toBe(false);
    expect(canSetVisibility(actors.owner, def('custom', 'gallery'), 'league')).toBe(false);
    expect(canSetVisibility(actors.owner, def('custom', 'gallery'), 'gallery')).toBe(false);
  });

  it('another admin changes nothing, and an owner of a preset row changes nothing', () => {
    for (const from of FORMAT_VISIBILITIES) {
      for (const to of FORMAT_VISIBILITIES) {
        expect(canSetVisibility(actors.other, def('custom', from), to)).toBe(false);
        expect(canSetVisibility(actors.owner, def('preset', from), to)).toBe(false);
        expect(canSetVisibility(actors.owner, def('custom', from, null), to)).toBe(false);
      }
    }
  });
});

describe('canAttachDefinition', () => {
  it('attaches what the actor owns, what is shared with all admins and anything as a site admin', () => {
    expect(canAttachDefinition(actors.owner, def('custom', 'private'))).toBe(true);
    expect(canAttachDefinition(actors.other, def('custom', 'league'))).toBe(true);
    expect(canAttachDefinition(actors.other, def('custom', 'gallery'))).toBe(true);
    expect(canAttachDefinition(actors.siteAdmin, def('custom', 'private'))).toBe(true);
  });

  it("refuses another admin's private definition", () => {
    expect(canAttachDefinition(actors.other, def('custom', 'private'))).toBe(false);
    expect(canAttachDefinition(actors.other, def('custom', 'private', null))).toBe(false);
  });

  it('an ownerless definition is attachable when visible', () => {
    expect(canAttachDefinition(actors.other, def('custom', 'gallery', null))).toBe(true);
  });
});
