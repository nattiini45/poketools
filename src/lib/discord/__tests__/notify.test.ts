import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DiscordEventPayload,
  DiscordWebhook,
} from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/discord-webhooks', () => ({
  resolveWebhooks: vi.fn(),
}));

vi.mock('../embeds', () => ({
  buildEmbed: vi.fn(),
}));

vi.mock('../match-card-image', () => ({
  generateMatchCardImage: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({
  resolveContentLocale: vi.fn(),
}));

import { resolveWebhooks } from '@/lib/supabase/queries/discord-webhooks';
import { resolveContentLocale } from '@/i18n/content-locale';
import { buildEmbed } from '../embeds';
import { generateMatchCardImage } from '../match-card-image';
import { emitDiscordEvent, webhookLanguage } from '../notify';

// ── Helpers ────────────────────────────────────────────────────────

function makeWebhook(overrides?: Partial<DiscordWebhook>): DiscordWebhook {
  return {
    id: 'wh-1',
    scope_type: 'tournament',
    scope_id: 'tournament-1',
    webhook_url: 'https://discord.com/api/webhooks/123/abc',
    label: 'Test Webhook',
    enabled: true,
    event_filter: [],
    format_options: { ...DEFAULT_FORMAT_OPTIONS },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePayload(overrides?: Partial<DiscordEventPayload>): DiscordEventPayload {
  return {
    event_type: 'match_confirmed',
    tournament_id: 'tournament-1',
    season_id: null,
    data: {
      kind: 'match_confirmed',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-1',
      tournament_name: 'Season 1',
    },
    ...overrides,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(''),
  }));
  vi.mocked(buildEmbed).mockReturnValue({
    embed: {
      title: 'Match Result',
      description: 'Alice defeats Bob',
      color: 0x57f287,
    },
    content: undefined,
  });
  vi.mocked(resolveContentLocale).mockResolvedValue('de');
});

describe('webhookLanguage', () => {
  it('follows the league for "league" and for rows without the option', () => {
    expect(webhookLanguage('league', 'en')).toBe('en');
    expect(webhookLanguage(undefined, 'en')).toBe('en');
    expect(webhookLanguage('league', 'de')).toBe('de');
  });

  it('a forced language beats the league language', () => {
    expect(webhookLanguage('en', 'de')).toBe('en');
    expect(webhookLanguage('de', 'en')).toBe('de');
  });

  it('falls back to German when no league language was read', () => {
    expect(webhookLanguage('league', null)).toBe('de');
  });
});

describe('emitDiscordEvent — language (i18n-core §6.2)', () => {
  it('resolves the league language once from the payload and builds each embed in it', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([
      makeWebhook({ id: 'wh-1', webhook_url: 'https://discord.com/api/webhooks/1/a' }),
      makeWebhook({ id: 'wh-2', webhook_url: 'https://discord.com/api/webhooks/2/b' }),
    ]);
    vi.mocked(resolveContentLocale).mockResolvedValue('en');

    emitDiscordEvent(makePayload({ season_id: 'season-1' }));
    await flushPromises();

    expect(resolveContentLocale).toHaveBeenCalledTimes(1);
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'season-1', tournamentId: 'tournament-1' });
    expect(vi.mocked(buildEmbed).mock.calls.map((call) => call[2])).toEqual(['en', 'en']);
  });

  it('a webhook language override beats the league language', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([
      makeWebhook({ id: 'wh-league', format_options: { ...DEFAULT_FORMAT_OPTIONS, attach_match_card: false } }),
      makeWebhook({
        id: 'wh-en',
        webhook_url: 'https://discord.com/api/webhooks/2/b',
        format_options: { ...DEFAULT_FORMAT_OPTIONS, attach_match_card: false, language: 'en' },
      }),
    ]);

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(vi.mocked(buildEmbed).mock.calls.map((call) => call[2])).toEqual(['de', 'en']);
  });

  it('skips the language read when every webhook forces a language', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([
      makeWebhook({ format_options: { ...DEFAULT_FORMAT_OPTIONS, attach_match_card: false, language: 'de' } }),
    ]);

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(resolveContentLocale).not.toHaveBeenCalled();
    expect(vi.mocked(buildEmbed).mock.calls[0][2]).toBe('de');
  });

  it('renders the match card once per language that wants it', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([
      makeWebhook({ id: 'wh-1', webhook_url: 'https://discord.com/api/webhooks/1/a' }),
      makeWebhook({ id: 'wh-2', webhook_url: 'https://discord.com/api/webhooks/2/b' }),
      makeWebhook({
        id: 'wh-3',
        webhook_url: 'https://discord.com/api/webhooks/3/c',
        format_options: { ...DEFAULT_FORMAT_OPTIONS, language: 'en' },
      }),
    ]);
    vi.mocked(generateMatchCardImage).mockResolvedValue(Buffer.from('fake-image'));

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(vi.mocked(generateMatchCardImage).mock.calls.map((call) => call[1]).sort()).toEqual(['de', 'en']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stays fire-and-forget if the language read rejects', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([makeWebhook()]);
    vi.mocked(resolveContentLocale).mockRejectedValue(new Error('DB down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => emitDiscordEvent(makePayload())).not.toThrow();
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('emitDiscordEvent', () => {
  it('does not throw (fire-and-forget)', () => {
    vi.mocked(resolveWebhooks).mockRejectedValue(new Error('DB down'));
    expect(() => emitDiscordEvent(makePayload())).not.toThrow();
  });

  it('resolves webhooks for the tournament and sends embeds', async () => {
    const webhook = makeWebhook();
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(resolveWebhooks).toHaveBeenCalledWith('tournament-1', null);
    expect(fetch).toHaveBeenCalledWith(
      webhook.webhook_url,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does not call fetch when no webhooks match', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([]);

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('filters webhooks by event_filter', async () => {
    const webhook = makeWebhook({
      event_filter: ['round_generated'],
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload({ event_type: 'match_confirmed' }));
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends to webhooks with matching event_filter', async () => {
    const webhook = makeWebhook({
      event_filter: ['match_confirmed'],
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload({ event_type: 'match_confirmed' }));
    await flushPromises();

    expect(fetch).toHaveBeenCalled();
  });

  it('sends to webhooks with empty event_filter (matches all)', async () => {
    const webhook = makeWebhook({ event_filter: [] });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload({ event_type: 'tournament_completed' }));
    await flushPromises();

    expect(fetch).toHaveBeenCalled();
  });

  it('filters out achievement events when show_achievements is false', async () => {
    const webhook = makeWebhook({
      format_options: { ...DEFAULT_FORMAT_OPTIONS, show_achievements: false },
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload({
      event_type: 'achievement_unlocked',
      data: {
        kind: 'achievement_unlocked',
        player_name: 'Alice',
        achievement_name: 'First Win',
        achievement_tier: 'bronze',
        achievement_icon: null,
        achievement_description: 'Win your first match',
        tournament_name: 'Season 1',
      },
    }));
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('filters out streak events when show_streaks is false', async () => {
    const webhook = makeWebhook({
      format_options: { ...DEFAULT_FORMAT_OPTIONS, show_streaks: false },
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload({
      event_type: 'streak_milestone',
      data: {
        kind: 'streak_milestone',
        player_name: 'Alice',
        streak_type: 'win',
        streak_count: 5,
        tournament_name: 'Season 1',
      },
    }));
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('filters out rating events when show_ratings is false', async () => {
    const webhook = makeWebhook({
      format_options: { ...DEFAULT_FORMAT_OPTIONS, show_ratings: false },
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload({
      event_type: 'rating_milestone',
      data: {
        kind: 'rating_milestone',
        player_name: 'Alice',
        new_rating: 1800,
        threshold_name: 'Elite',
        tournament_name: 'Season 1',
      },
    }));
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends JSON body for non-attachment embeds', async () => {
    const webhook = makeWebhook({
      format_options: { ...DEFAULT_FORMAT_OPTIONS, attach_match_card: false },
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);

    emitDiscordEvent(makePayload());
    await flushPromises();

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('generates match card image for match_confirmed when attach_match_card is true', async () => {
    const webhook = makeWebhook({
      format_options: { ...DEFAULT_FORMAT_OPTIONS, attach_match_card: true },
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);
    vi.mocked(generateMatchCardImage).mockResolvedValue(Buffer.from('fake-image'));

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(generateMatchCardImage).toHaveBeenCalled();
    // Should use FormData for multipart upload
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.body).toBeInstanceOf(FormData);
  });

  it('still sends text embed when image generation fails', async () => {
    const webhook = makeWebhook({
      format_options: { ...DEFAULT_FORMAT_OPTIONS, attach_match_card: true },
    });
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);
    vi.mocked(generateMatchCardImage).mockRejectedValue(new Error('Canvas error'));

    emitDiscordEvent(makePayload());
    await flushPromises();

    // Should fall back to JSON POST (no attachment)
    expect(fetch).toHaveBeenCalled();
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('logs and swallows fetch failures', async () => {
    const webhook = makeWebhook();
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook]);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve('rate limited'),
    } as Response);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('sends to multiple matching webhooks', async () => {
    const webhooks = [
      makeWebhook({ id: 'wh-1', webhook_url: 'https://discord.com/api/webhooks/1/a' }),
      makeWebhook({ id: 'wh-2', webhook_url: 'https://discord.com/api/webhooks/2/b' }),
    ];
    vi.mocked(resolveWebhooks).mockResolvedValue(webhooks);

    emitDiscordEvent(makePayload());
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
