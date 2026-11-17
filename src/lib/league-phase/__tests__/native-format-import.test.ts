import { expect, it, vi } from 'vitest';

const forbidden = vi.hoisted(() => vi.fn(() => { throw new Error('Importing native format persistence must not read a session or database'); }));
vi.mock('@/auth', () => ({ auth: forbidden, loadSessionPlayer: forbidden }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: forbidden, rpc: forbidden } }));
vi.mock('next/cache', () => ({ revalidatePath: forbidden, revalidateTag: forbidden }));

import { createLeagueFromFormat } from '@/lib/format-studio/create-league';
import { nativeFormatStorage } from '../format-storage';

it('loads the real wizard and native format adapter with an explicit session boundary', () => {
  expect(createLeagueFromFormat).toBeTypeOf('function');
  expect(nativeFormatStorage.create).toBeTypeOf('function');
  expect(forbidden).not.toHaveBeenCalled();
});
