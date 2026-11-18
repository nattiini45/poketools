import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPhaseRouteMode } from '../route-mode';

const db = vi.hoisted(() => {
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, single };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: db.from } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('phase route mode', () => {
  it.each([undefined, '', 'false'])('keeps the default legacy path free of schema reads (%s)', async (value) => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', value);
    expect(await getPhaseRouteMode()).toBe('legacy');
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'frozen_legacy', 'frozen_phase', 'phase'])('preserves authoritative mode %s', async (mode) => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    db.single.mockResolvedValue({ data: { mode }, error: null });
    expect(await getPhaseRouteMode()).toBe(mode);
    expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_storage_state');
    expect(db.select).toHaveBeenCalledExactlyOnceWith('mode');
    expect(db.eq).toHaveBeenCalledExactlyOnceWith('id', true);
  });

  it('does not cache across calls or fall back to the legacy store after a read failure', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    const error = { code: 'PGRST205', message: 'Schema unavailable' };
    db.single.mockResolvedValueOnce({ data: { mode: 'legacy' }, error: null })
      .mockResolvedValueOnce({ data: { mode: 'phase' }, error: null })
      .mockResolvedValueOnce({ data: null, error });
    expect(await getPhaseRouteMode()).toBe('legacy');
    expect(await getPhaseRouteMode()).toBe('phase');
    await expect(getPhaseRouteMode()).rejects.toBe(error);
  });

  it.each([null, { mode: 'unknown' }])('refuses an invalid singleton result', async (data) => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    db.single.mockResolvedValue({ data, error: null });
    await expect(getPhaseRouteMode()).rejects.toThrow();
  });

  it('refuses invalid rollout configuration before reaching the database', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'yes');
    await expect(getPhaseRouteMode()).rejects.toThrow(/READ_PHASE_STORAGE_STATE/);
    expect(db.from).not.toHaveBeenCalled();
  });
});
