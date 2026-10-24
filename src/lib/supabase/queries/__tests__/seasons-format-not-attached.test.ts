/**
 * `updateSeason` and the custom-league start rule: the trigger on `seasons` raises FORMAT_NOT_ATTACHED when a custom
 * league without an attached format becomes active, and the query turns that into a typed 409. Every other error
 * (what a legacy league can produce) is rethrown as the very same object, so legacy behaviour is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reply: { data: null as unknown, error: null as unknown },
  updates: [] as unknown[],
}));

vi.mock('@/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.update = (value: unknown) => {
    state.updates.push(value);
    return chain;
  };
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.single = () => Promise.resolve({ ...state.reply });
  return { supabase: chain };
});

import { updateSeason } from '../seasons';
import { FormatStudioError } from '@/lib/format-studio/errors';

const ID = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';

beforeEach(() => {
  state.reply = { data: null, error: null };
  state.updates.length = 0;
});

describe('updateSeason, FORMAT_NOT_ATTACHED', () => {
  it('maps the trigger error to format_not_attached with status 409', async () => {
    state.reply = {
      data: null,
      error: { code: 'P0001', message: 'FORMAT_NOT_ATTACHED', details: `{"season_id":"${ID}"}`, hint: null },
    };
    const error = await updateSeason(ID, { status: 'active' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FormatStudioError);
    expect(error).toMatchObject({ code: 'format_not_attached', statusCode: 409 });
    expect(state.updates).toEqual([{ status: 'active' }]);
  });

  it('rethrows any other database error as the same object', async () => {
    const boom = { code: '23505', message: 'duplicate key value violates unique constraint "seasons_name_key"', details: '', hint: '' };
    state.reply = { data: null, error: boom };
    await expect(updateSeason(ID, { name: 'x' })).rejects.toBe(boom);
  });

  it('rethrows another P0001 message unchanged', async () => {
    const other = { code: 'P0001', message: 'SOMETHING_ELSE', details: '', hint: '' };
    state.reply = { data: null, error: other };
    await expect(updateSeason(ID, { status: 'active' })).rejects.toBe(other);
  });

  it('rethrows a thrown Error unchanged', async () => {
    const failure = new Error('network');
    state.reply = { data: null, error: failure };
    await expect(updateSeason(ID, { status: 'active' })).rejects.toBe(failure);
  });

  it('returns the mapped season on success', async () => {
    state.reply = {
      data: {
        id: ID,
        name: 'League',
        description: '',
        format_type: 'singles',
        ruleset_id: null,
        start_date: null,
        end_date: null,
        status: 'active',
        archived: false,
        legacy: false,
        is_test_season: false,
        core_pool: null,
        point_buy_list_id: null,
        route_theme: 'auto',
        language: 'en',
        created_at: 't',
        updated_at: 't',
      },
      error: null,
    };
    const season = await updateSeason(ID, { status: 'active' });
    expect(season.id).toBe(ID);
    expect(season.status).toBe('active');
  });
});
