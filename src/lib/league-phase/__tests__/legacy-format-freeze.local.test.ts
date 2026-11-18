import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import type { SessionPlayer } from '@/types/auth';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class AuthError extends Error {},
  requireAnyAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 }),
}));

it.skipIf(!localStackOptIn('LOCAL_LEGACY_FORMAT_FREEZE'))('returns 503 without writes from a legacy app after the database freezes', async () => {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
  const { supabase } = await import('@/lib/supabase/client');
  const auth = await import('@/lib/auth/helpers');
  const [seasons, format, cache] = await Promise.all([
    import('@/app/api/seasons/route'), import('@/app/api/seasons/[id]/format/route'), import('next/cache'),
  ]);
  const mode = await supabase.from('phase_storage_state').select('mode').single();
  expect(mode.error).toBeNull();
  expect(mode.data?.mode).toBe('frozen_legacy');
  const actor: SessionPlayer = {
    playerId: randomUUID(), name: 'Legacy freeze fixture', isAdmin: true, isResourceAdmin: true, isCreator: false,
    psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
  };
  vi.mocked(auth.requireAnyAdmin).mockResolvedValue(actor);
  vi.mocked(auth.requireResourceAdmin).mockResolvedValue(actor);
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
  try {
    const name = `Synthetic frozen format ${randomUUID()}`;
    const seasonId = randomUUID();
    const result = [
      await seasons.POST(new NextRequest('http://localhost/api/seasons', {
        method: 'POST', body: JSON.stringify({ name, format_type: 'custom', from_format: { preset_id: 'wichtelcup' } }),
      })),
      await format.DELETE(new NextRequest(`http://localhost/api/seasons/${seasonId}/format`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: seasonId }) }),
    ];
    for (const response of result) {
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toMatchObject({ code: 'phase_storage_unavailable' });
    }
    const [league, rulesets, definitions] = await Promise.all([
      supabase.from('seasons').select('id').eq('name', name),
      supabase.from('ruleset_definitions').select('id').eq('owner_id', actor.playerId),
      supabase.from('format_definitions').select('id').eq('owner_id', actor.playerId),
    ]);
    for (const receipt of [league, rulesets, definitions]) {
      expect(receipt.error).toBeNull();
      expect(receipt.data).toEqual([]);
    }
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
