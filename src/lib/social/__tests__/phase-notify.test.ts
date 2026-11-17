import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseSocialIntegrationWithSecrets } from '@/types/phase-integrations';
import type { PhaseSocialEventPayload } from '@/types/phase-events';
import { DEFAULT_SOCIAL_POST_OPTIONS } from '@/types/social';

vi.mock('@/lib/supabase/queries/phase-social-integrations', () => ({ resolvePhaseSocialIntegrations: vi.fn() }));
vi.mock('@/lib/supabase/queries/social-integrations', () => ({ resolveSocialIntegrations: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn() }));
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: vi.fn() }));
vi.mock('../crypto', () => ({ decryptJson: vi.fn() }));
vi.mock('../providers', () => ({ publishToProvider: vi.fn() }));

import { resolvePhaseSocialIntegrations } from '@/lib/supabase/queries/phase-social-integrations';
import { resolveSocialIntegrations } from '@/lib/supabase/queries/social-integrations';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { resolveContentLocale } from '@/i18n/content-locale';
import { decryptJson } from '../crypto';
import { publishToProvider } from '../providers';
import { emitPhaseSocialEvent } from '../notify';
import { formatPhaseSocialPost, formatSocialPost } from '../format';

const payload: PhaseSocialEventPayload = {
  version: 1, owner: { kind: 'phase', phase_id: 'phase-one', season_id: 'league-one' },
  event_type: 'match_confirmed', imageUrl: 'https://example.com/card.png',
  data: { kind: 'match_confirmed', phase_name: 'Opening phase', player_1_name: 'Trainer A',
    player_2_name: 'Trainer B', winner_name: 'Trainer A', game_score: '2-1', replay_url: 'https://example.com/replay' },
};

function integration(id: string, overrides: Partial<PhaseSocialIntegrationWithSecrets> = {}): PhaseSocialIntegrationWithSecrets {
  return { id, phase_id: 'phase-one', provider: 'x', label: 'Test', enabled: true,
    event_filter: [], post_options: { ...DEFAULT_SOCIAL_POST_OPTIONS },
    credential_hint: null, has_credentials: true, credentials_encrypted: `encrypted-${id}`,
    created_at: '', updated_at: '', ...overrides };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPhaseById).mockResolvedValue({ id: 'phase-one', season_id: 'league-one' } as Awaited<ReturnType<typeof getPhaseById>>);
  vi.mocked(resolveContentLocale).mockResolvedValue('de');
  vi.mocked(decryptJson).mockReturnValue({ provider: 'x', access_token: 'mock-token' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('native social notifications', () => {
  it('resolves native targets, decrypts exact stored bytes and keeps image and options', async () => {
    vi.mocked(resolvePhaseSocialIntegrations).mockResolvedValue([
      integration('one', { post_options: { include_replay_link: false, include_hashtags: true } }),
      { ...integration('filtered', { event_filter: ['round_generated'] }), scope_type: 'season', scope_id: 'league-one' },
    ]);
    expect(emitPhaseSocialEvent(payload)).toBeUndefined();
    await flush();
    expect(resolvePhaseSocialIntegrations).toHaveBeenCalledExactlyOnceWith('phase-one');
    expect(resolveSocialIntegrations).not.toHaveBeenCalled();
    expect(resolveContentLocale).toHaveBeenCalledExactlyOnceWith({ seasonId: 'league-one' });
    expect(decryptJson).toHaveBeenCalledExactlyOnceWith('encrypted-one');
    expect(publishToProvider).toHaveBeenCalledExactlyOnceWith('x', { provider: 'x', access_token: 'mock-token' },
      expect.stringContaining('#PokemonBattle'), payload.imageUrl);
    expect(vi.mocked(publishToProvider).mock.calls[0][2]).not.toContain('https://example.com/replay');
  });

  it('uses existing status filters without tournament wording', async () => {
    vi.mocked(resolvePhaseSocialIntegrations).mockResolvedValue([integration('status', { event_filter: ['tournament_completed'] })]);
    emitPhaseSocialEvent({ ...payload, event_type: 'phase_completed', data: { kind: 'phase_status', phase_name: 'Opening phase', new_status: 'completed' } });
    await flush();
    expect(vi.mocked(publishToProvider).mock.calls[0][2]).toContain('Phase beendet');
  });

  it('refuses a wrong league and returns immediately on a failed resolver', async () => {
    emitPhaseSocialEvent({ ...payload, owner: { ...payload.owner, season_id: 'wrong-league' } });
    await flush();
    expect(resolvePhaseSocialIntegrations).not.toHaveBeenCalled();
    vi.mocked(resolvePhaseSocialIntegrations).mockRejectedValue(new Error('secret-resolver-token'));
    emitPhaseSocialEvent(payload);
    await flush();
    expect(publishToProvider).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls)).not.toContain('secret-');
  });

  it('isolates invalid credentials and provider failures without logging secrets', async () => {
    vi.mocked(resolvePhaseSocialIntegrations).mockResolvedValue([integration('bad'), integration('valid'), integration('sibling')]);
    vi.mocked(decryptJson).mockImplementationOnce(() => { throw new Error('secret-ciphertext'); });
    vi.mocked(publishToProvider).mockRejectedValueOnce(new Error('secret-access-token'));
    emitPhaseSocialEvent(payload);
    await flush();
    expect(publishToProvider).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(console.error).mock.calls)).not.toContain('secret-');
  });

  it.each([['x', 280], ['threads', 500], ['bluesky', 300]] as const)('preserves %s provider truncation', (provider, limit) => {
    const long = { ...payload, data: { ...payload.data, phase_name: 'A'.repeat(600) } };
    const text = formatPhaseSocialPost(long, provider, DEFAULT_SOCIAL_POST_OPTIONS, 'en');
    expect(text).toHaveLength(limit);
    expect(text.endsWith('…')).toBe(true);
  });

  it.each(['en', 'de'] as const)('shares unchanged match formatting with legacy events in %s', (locale) => {
    const { phase_name, ...data } = payload.data;
    const legacy = { event_type: 'match_confirmed' as const, tournament_id: 'standalone', season_id: null,
      data: { ...data, tournament_name: phase_name } };
    expect(formatPhaseSocialPost(payload, 'threads', DEFAULT_SOCIAL_POST_OPTIONS, locale))
      .toBe(formatSocialPost(legacy, 'threads', DEFAULT_SOCIAL_POST_OPTIONS, locale));
  });
});
