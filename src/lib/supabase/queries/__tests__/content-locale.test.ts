import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock (chainable builder; maybeSingle resolves per test) ──
const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'eq']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  getMatchSeasonLanguage,
  getSeasonLanguage,
  getTournamentSeasonLanguage,
} from '../content-locale';

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'eq']) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

describe('getSeasonLanguage', () => {
  it('reads only seasons.language for the id', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { language: 'en' }, error: null });
    await expect(getSeasonLanguage('s1')).resolves.toBe('en');
    expect(mockBuilder.from).toHaveBeenCalledWith('seasons');
    expect(mockBuilder.select).toHaveBeenCalledWith('language');
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 's1');
  });

  it('returns null for a missing row', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(getSeasonLanguage('missing')).resolves.toBeNull();
  });

  it('returns null for an unsupported stored value', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { language: 'fr' }, error: null });
    await expect(getSeasonLanguage('s1')).resolves.toBeNull();
  });

  it('throws the client error', async () => {
    const err = { message: 'boom', code: '500' };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: err });
    await expect(getSeasonLanguage('s1')).rejects.toBe(err);
  });
});

describe('getTournamentSeasonLanguage', () => {
  it('reads the season language through the tournament embed', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { seasons: { language: 'de' } }, error: null });
    await expect(getTournamentSeasonLanguage('t1')).resolves.toBe('de');
    expect(mockBuilder.from).toHaveBeenCalledWith('tournaments');
    expect(mockBuilder.select).toHaveBeenCalledWith('seasons ( language )');
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 't1');
  });

  it('returns null for a standalone tournament (no season)', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { seasons: null }, error: null });
    await expect(getTournamentSeasonLanguage('t1')).resolves.toBeNull();
  });

  it('returns null for a missing tournament', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(getTournamentSeasonLanguage('t1')).resolves.toBeNull();
  });

  it('throws the client error', async () => {
    const err = { message: 'boom' };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: err });
    await expect(getTournamentSeasonLanguage('t1')).rejects.toBe(err);
  });
});

describe('getMatchSeasonLanguage', () => {
  it('reads the season language through match -> tournament -> season', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { tournaments: { seasons: { language: 'en' } } },
      error: null,
    });
    await expect(getMatchSeasonLanguage('m1')).resolves.toBe('en');
    expect(mockBuilder.from).toHaveBeenCalledWith('matches');
    expect(mockBuilder.select).toHaveBeenCalledWith('tournaments ( seasons ( language ) )');
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
  });

  it('returns null when the tournament has no season', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { tournaments: { seasons: null } }, error: null });
    await expect(getMatchSeasonLanguage('m1')).resolves.toBeNull();
  });

  it('returns null when the match or tournament is missing', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { tournaments: null }, error: null });
    await expect(getMatchSeasonLanguage('m1')).resolves.toBeNull();
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(getMatchSeasonLanguage('m1')).resolves.toBeNull();
  });

  it('throws the client error', async () => {
    const err = { message: 'boom' };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: err });
    await expect(getMatchSeasonLanguage('m1')).rejects.toBe(err);
  });
});
