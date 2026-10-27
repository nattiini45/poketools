/**
 * The storage sweep after a league left the trash for good: paths come only from validated match ids and listed
 * `<uuid>.png` names, a failure is counted and logged with its own code and never thrown, and the deadline stops it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bucket = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { storage: { from: bucket.from } },
}));

import { LEAGUE_TRASH_SWEEP_ERROR_CODES, sweepLeagueSocialImages } from '../social-image-sweep';

const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const OBJ1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBJ2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAR = Date.now() + 3_600_000;

beforeEach(() => {
  vi.clearAllMocks();
  bucket.from.mockReturnValue({ list: bucket.list, remove: bucket.remove });
  bucket.list.mockResolvedValue({ data: [], error: null });
  bucket.remove.mockImplementation(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }));
});

describe('sweepLeagueSocialImages', () => {
  it('lists each match folder in the social-images bucket and removes the cards and the legacy object', async () => {
    bucket.list.mockImplementation(async (folder: string) => ({
      data: folder === `matches/${M1}` ? [{ name: `${OBJ1}.png` }, { name: `${OBJ2}.png` }] : [],
      error: null,
    }));

    const result = await sweepLeagueSocialImages([M1, M2], FAR);

    expect(bucket.from).toHaveBeenCalledWith('social-images');
    expect(bucket.list.mock.calls.map(([folder]) => folder).sort()).toEqual([`matches/${M1}`, `matches/${M2}`]);
    const removed = bucket.remove.mock.calls.flatMap(([paths]) => paths as string[]).sort();
    expect(removed).toEqual(
      [`matches/${M1}.png`, `matches/${M1}/${OBJ1}.png`, `matches/${M1}/${OBJ2}.png`, `matches/${M2}.png`].sort(),
    );
    expect(result).toEqual({ swept: 2, unswept: 0, removed: 4, errors: [] });
  });

  it('builds paths only from lowercase uuid match ids: anything else is dropped and never reaches the bucket', async () => {
    const result = await sweepLeagueSocialImages(['../../etc', 'not-a-uuid', M1.toUpperCase(), `${M1}/../x`, ''], FAR);

    // The uppercase uuid is the same match; every other value names no match.
    expect(bucket.list.mock.calls.map(([folder]) => folder)).toEqual([`matches/${M1}`]);
    expect(result.swept).toBe(1);
  });

  it('removes only listed names that are <uuid>.png', async () => {
    bucket.list.mockResolvedValue({
      data: [{ name: `${OBJ1}.png` }, { name: '../escape.png' }, { name: 'notes.txt' }, { name: `${OBJ2}.png/x` }, { name: '.emptyFolderPlaceholder' }],
      error: null,
    });

    await sweepLeagueSocialImages([M1], FAR);

    expect(bucket.remove.mock.calls[0][0]).toEqual([`matches/${M1}.png`, `matches/${M1}/${OBJ1}.png`]);
  });

  it('counts one match once however often the id repeats', async () => {
    const result = await sweepLeagueSocialImages([M1, M1, M1], FAR);

    expect(bucket.list).toHaveBeenCalledTimes(1);
    expect(result.swept).toBe(1);
  });

  it('does nothing for an empty league', async () => {
    const result = await sweepLeagueSocialImages([], FAR);

    expect(bucket.list).not.toHaveBeenCalled();
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(result).toEqual({ swept: 0, unswept: 0, removed: 0, errors: [] });
  });

  it('logs a failed listing with its own code, still sweeps the other matches, and never throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bucket.list.mockImplementation(async (folder: string) =>
      folder === `matches/${M1}` ? { data: null, error: new Error('storage down') } : { data: [], error: null },
    );

    try {
      const result = await sweepLeagueSocialImages([M1, M2], FAR);

      expect(result).toMatchObject({ swept: 1, unswept: 0, errors: [LEAGUE_TRASH_SWEEP_ERROR_CODES.list] });
      expect(bucket.remove.mock.calls.flatMap(([paths]) => paths as string[])).toEqual([`matches/${M2}.png`]);
      expect(errorSpy.mock.calls.some(([message]) => String(message).includes(LEAGUE_TRASH_SWEEP_ERROR_CODES.list))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs a failed removal with its own code, never throws, and counts nothing removed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bucket.remove.mockResolvedValue({ data: null, error: new Error('remove refused') });

    try {
      const result = await sweepLeagueSocialImages([M1], FAR);

      expect(result).toEqual({ swept: 1, unswept: 0, removed: 0, errors: [LEAGUE_TRASH_SWEEP_ERROR_CODES.remove] });
      expect(errorSpy.mock.calls.some(([message]) => String(message).includes(LEAGUE_TRASH_SWEEP_ERROR_CODES.remove))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('treats a thrown storage call (request deadline) like a failed removal', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bucket.remove.mockRejectedValue(new Error('Supabase storage request timed out after 30000 ms: POST /object/social-images'));

    try {
      const result = await sweepLeagueSocialImages([M1], FAR);

      expect(result.errors).toEqual([LEAGUE_TRASH_SWEEP_ERROR_CODES.remove]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('stops at the deadline, counts the matches it did not reach and reports the incomplete code', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await sweepLeagueSocialImages([M1, M2], Date.now() - 1);

      expect(bucket.list).not.toHaveBeenCalled();
      expect(result).toEqual({ swept: 0, unswept: 2, removed: 0, errors: [LEAGUE_TRASH_SWEEP_ERROR_CODES.incomplete] });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('sweeps a large league in parallel chunks, one removal per chunk', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

    const result = await sweepLeagueSocialImages(ids, FAR);

    expect(result.swept).toBe(25);
    expect(bucket.remove).toHaveBeenCalledTimes(3);
  });
});
