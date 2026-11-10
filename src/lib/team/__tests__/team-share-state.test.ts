import { describe, expect, it } from 'vitest';
import { teamLibraryMachine, teamLibraryState, teamShareMachine, teamShareState } from '../team-share-state';

describe('teamShareMachine', () => {
  it('reads a link as on only while both columns are set', () => {
    expect(teamShareState({ share_token: 't', share_enabled_at: '2026-11-01T00:00:00Z' })).toBe('on');
    expect(teamShareState({ share_token: 't', share_enabled_at: null })).toBe('off');
    expect(teamShareState({ share_token: null, share_enabled_at: '2026-11-01T00:00:00Z' })).toBe('off');
    expect(teamShareState({ share_token: null, share_enabled_at: null })).toBe('off');
  });

  it('owner and admin enable, rotate and disable from either state (the characterized routes)', () => {
    for (const actor of ['owner', 'admin'] as const) {
      expect(teamShareMachine.can('off', 'on', actor)).toBe(true);
      expect(teamShareMachine.can('on', 'on', actor)).toBe(true);
      expect(teamShareMachine.can('on', 'off', actor)).toBe(true);
      expect(teamShareMachine.can('off', 'off', actor)).toBe(true);
    }
  });
});

describe('teamLibraryMachine', () => {
  it('reads published from library_published_at', () => {
    expect(teamLibraryState({ library_published_at: '2026-11-01T00:00:00Z' })).toBe('published');
    expect(teamLibraryState({ library_published_at: null })).toBe('unpublished');
    expect(teamLibraryState({ library_published_at: undefined })).toBe('unpublished');
  });

  it('owner and admin publish, republish and unpublish from either state (the characterized routes)', () => {
    for (const actor of ['owner', 'admin'] as const) {
      expect(teamLibraryMachine.can('unpublished', 'published', actor)).toBe(true);
      expect(teamLibraryMachine.can('published', 'published', actor)).toBe(true);
      expect(teamLibraryMachine.can('published', 'unpublished', actor)).toBe(true);
      expect(teamLibraryMachine.can('unpublished', 'unpublished', actor)).toBe(true);
    }
  });
});
