/**
 * The format library cache tag: its name, the helper that expires it (one `revalidateTag` call with an immediate
 * expiry) and the fact that attach and detach still reach the league tag through `seasonWriteTags`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  tags: [] as Array<{ tag: string; profile: unknown }>,
  paths: [] as string[],
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    calls.paths.push(path);
  }),
  revalidateTag: vi.fn((tag: string, profile: unknown) => {
    calls.tags.push({ tag, profile });
  }),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

import { EXPIRE_NOW, expireFormatLibraryReads, expireSeasonReads, publicTags, seasonWriteTags } from '../revalidation';

beforeEach(() => {
  calls.tags.length = 0;
  calls.paths.length = 0;
});

describe('format library tag', () => {
  it('is named format-library', () => {
    expect(publicTags.formatLibrary).toBe('format-library');
  });

  it('expireFormatLibraryReads expires exactly that tag, once, immediately', () => {
    expireFormatLibraryReads();
    expect(calls.tags).toEqual([{ tag: 'format-library', profile: { expire: 0 } }]);
    expect(calls.tags[0].profile).toBe(EXPIRE_NOW);
    expect(calls.paths).toEqual([]);
  });

  it('is not part of any league or tournament write', () => {
    expect(seasonWriteTags('s1', ['t1'])).not.toContain('format-library');
    expireSeasonReads('s1', ['t1']);
    expect(calls.tags.map((entry) => entry.tag)).not.toContain('format-library');
  });
});

describe('attach and detach rely on the league tags', () => {
  it('seasonWriteTags still contains the league tag and the tags of the stage ids', () => {
    const tags = seasonWriteTags('season-1', ['stage-a', 'stage-b']);
    expect(tags).toContain('season:season-1');
    expect(tags).toContain('tournament:stage-a');
    expect(tags).toContain('tournament:stage-b');
    expect(tags).toContain(publicTags.seasons);
    expect(tags).toContain(publicTags.tournaments);
  });

  it('expireSeasonReads expires the league tag and each stage tag', () => {
    expireSeasonReads('season-1', ['stage-a']);
    const expired = calls.tags.map((entry) => entry.tag);
    expect(expired).toContain('season:season-1');
    expect(expired).toContain('tournament:stage-a');
    expect(calls.tags.every((entry) => entry.profile === EXPIRE_NOW)).toBe(true);
  });
});
