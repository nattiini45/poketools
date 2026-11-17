import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import type { PhaseDiscordWebhook } from '@/types/phase-integrations';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';

vi.mock('@/lib/supabase/queries/phase-discord-webhooks', () => ({ resolvePhaseWebhooks: vi.fn() }));
vi.mock('@/lib/supabase/queries/discord-webhooks', () => ({ resolveWebhooks: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn() }));
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: vi.fn() }));
vi.mock('../match-card-image', () => ({ generateMatchCardImage: vi.fn() }));

import { resolvePhaseWebhooks } from '@/lib/supabase/queries/phase-discord-webhooks';
import { resolveWebhooks } from '@/lib/supabase/queries/discord-webhooks';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { resolveContentLocale } from '@/i18n/content-locale';
import { generateMatchCardImage } from '../match-card-image';
import { emitPhaseDiscordEvent } from '../notify';

const payload: PhaseDiscordEventPayload = {
  version: 1,
  owner: { kind: 'phase', phase_id: 'phase-one', season_id: 'league-one' },
  event_type: 'match_confirmed',
  data: {
    kind: 'match_confirmed', phase_name: 'Opening phase',
    player_1_name: 'Trainer A', player_2_name: 'Trainer B', winner_name: 'Trainer A',
    game_score: '2-1', replay_url: 'https://example.com/replay',
  },
};

function webhook(id: string, options: Partial<PhaseDiscordWebhook> = {}): PhaseDiscordWebhook {
  return {
    id, phase_id: 'phase-one', webhook_url: `https://discord.com/api/webhooks/123/${id}`,
    label: 'Test', enabled: true, event_filter: [], format_options: { ...DEFAULT_FORMAT_OPTIONS },
    created_at: '', updated_at: '', ...options,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPhaseById).mockResolvedValue({ id: 'phase-one', season_id: 'league-one' } as Awaited<ReturnType<typeof getPhaseById>>);
  vi.mocked(resolveContentLocale).mockResolvedValue('de');
  vi.mocked(generateMatchCardImage).mockResolvedValue(Buffer.from('mock-png'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native Discord notifications', () => {
  it('uses real ownership, target languages, options and one card per language', async () => {
    vi.mocked(resolvePhaseWebhooks).mockResolvedValue([
      webhook('league'), webhook('de', { format_options: { ...DEFAULT_FORMAT_OPTIONS, language: 'de' } }),
      { ...webhook('en', { format_options: { ...DEFAULT_FORMAT_OPTIONS, language: 'en', show_replay_link: false } }),
        scope_type: 'global', scope_id: null },
      webhook('filtered', { event_filter: ['match_disputed'] }),
    ]);
    expect(emitPhaseDiscordEvent(payload)).toBeUndefined();
    await flush();
    expect(resolvePhaseWebhooks).toHaveBeenCalledWith('phase-one');
    expect(resolveWebhooks).not.toHaveBeenCalled();
    expect(resolveContentLocale).toHaveBeenCalledExactlyOnceWith({ seasonId: 'league-one' });
    expect(generateMatchCardImage).toHaveBeenCalledTimes(2);
    expect(generateMatchCardImage).toHaveBeenCalledWith(payload.data, 'de');
    expect(generateMatchCardImage).toHaveBeenCalledWith(payload.data, 'en');
    expect(fetch).toHaveBeenCalledTimes(3);
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => init?.body as FormData);
    const en = JSON.parse(String(bodies[2].get('payload_json')));
    expect(en.embeds[0].title).toContain('Match Confirmed');
    expect(en.embeds[0].description).not.toContain('https://example.com/replay');
    expect(bodies[0].get('files[0]')).toHaveProperty('name', 'SPOILER_match-highlight.png');
    expect(payload).not.toHaveProperty('tournament_id');
    expect(payload.data).not.toHaveProperty('tournament_name');
  });

  it.each(['achievement_unlocked', 'streak_milestone', 'streak_broken', 'rating_milestone'] as const)('preserves the %s format switch', async (kind) => {
    vi.mocked(resolvePhaseWebhooks).mockResolvedValue([webhook('off', {
      format_options: { ...DEFAULT_FORMAT_OPTIONS, show_achievements: false, show_streaks: false, show_ratings: false },
    })]);
    emitPhaseDiscordEvent({ ...payload, event_type: kind, data: { kind } } as PhaseDiscordEventPayload);
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(resolveContentLocale).not.toHaveBeenCalled();
  });

  it('uses existing status filters with native phase copy', async () => {
    vi.mocked(resolvePhaseWebhooks).mockResolvedValue([webhook('status', { event_filter: ['tournament_started'] })]);
    emitPhaseDiscordEvent({ ...payload, event_type: 'phase_started', data: { kind: 'phase_status', phase_name: 'Opening phase', new_status: 'active' } });
    await flush();
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.embeds[0].title).toBe('Phase gestartet – Opening phase');
  });

  it('refuses mismatched league ownership without invoking recipients or locale', async () => {
    emitPhaseDiscordEvent({ ...payload, owner: { ...payload.owner, season_id: 'wrong-league' } });
    await flush();
    expect(resolvePhaseWebhooks).not.toHaveBeenCalled();
    expect(resolveContentLocale).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips language reads for forced languages and skips unwanted attachments', async () => {
    vi.mocked(resolvePhaseWebhooks).mockResolvedValue([webhook('forced', {
      format_options: { ...DEFAULT_FORMAT_OPTIONS, language: 'en', attach_match_card: false },
    })]);
    emitPhaseDiscordEvent(payload);
    await flush();
    expect(resolveContentLocale).not.toHaveBeenCalled();
    expect(generateMatchCardImage).not.toHaveBeenCalled();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).embeds[0].title).toContain('Match Confirmed');
  });

  it('does not resolve recipients for a missing phase', async () => {
    vi.mocked(getPhaseById).mockResolvedValue(null);
    emitPhaseDiscordEvent(payload);
    await flush();
    expect(resolvePhaseWebhooks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[Discord] Phase notification owner not found:', 'phase-one');
  });

  it('swallows resolver and card failures without logging secret error text', async () => {
    vi.mocked(resolvePhaseWebhooks).mockRejectedValueOnce(new Error('secret-webhook-token'));
    emitPhaseDiscordEvent(payload);
    await flush();
    vi.mocked(resolvePhaseWebhooks).mockResolvedValue([webhook('fallback')]);
    vi.mocked(generateMatchCardImage).mockRejectedValue(new Error('secret-avatar-token'));
    emitPhaseDiscordEvent(payload);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls)).not.toContain('secret-');
  });
});
