/**
 * getPlayerWorldExperience: a stored preference is returned as is; a missing
 * row or an unknown stored value coerces to DEFAULT_WORLD_EXPERIENCE ('off',
 * the 3D world is opt-in) instead of throwing. Served by the in-memory
 * PostgREST (no network).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

import { getPlayerWorldExperience } from '../players';

beforeEach(() => {
  fake.current = createFakeSupabase({
    players: [
      { id: 'p-on', world_experience: 'on' },
      { id: 'p-auto', world_experience: 'auto' },
      { id: 'p-bogus', world_experience: 'sometimes' },
      { id: 'p-null', world_experience: null },
    ],
  });
});

describe('getPlayerWorldExperience', () => {
  it.each([
    ['p-on', 'on'],
    ['p-auto', 'auto'],
  ])('returns the stored choice of %s', async (id, expected) => {
    await expect(getPlayerWorldExperience(id)).resolves.toBe(expected);
  });

  it.each(['p-bogus', 'p-null', 'p-missing'])('coerces %s to the default off', async (id) => {
    await expect(getPlayerWorldExperience(id)).resolves.toBe('off');
  });
});
