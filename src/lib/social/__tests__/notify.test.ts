import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  SocialEventPayload,
  SocialIntegrationWithSecrets,
} from '@/types/social';
import { DEFAULT_SOCIAL_POST_OPTIONS } from '@/types/social';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/social-integrations', () => ({
  resolveSocialIntegrations: vi.fn(),
}));

vi.mock('../crypto', () => ({
  decryptJson: vi.fn(),
}));

vi.mock('../format', () => ({
  formatSocialPost: vi.fn(),
}));

vi.mock('../providers', () => ({
  publishToProvider: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({
  resolveContentLocale: vi.fn(),
}));

import { resolveSocialIntegrations } from '@/lib/supabase/queries/social-integrations';
import { resolveContentLocale } from '@/i18n/content-locale';
import { decryptJson } from '../crypto';
import { formatSocialPost } from '../format';
import { publishToProvider } from '../providers';
import { emitSocialEvent, sendSocialTestMessage } from '../notify';

// ── Helpers ────────────────────────────────────────────────────────

function makeIntegration(overrides?: Partial<SocialIntegrationWithSecrets>): SocialIntegrationWithSecrets {
  return {
    id: 'int-1',
    provider: 'x',
    scope_type: 'tournament',
    scope_id: 'tournament-1',
    label: 'Test X Account',
    enabled: true,
    event_filter: [],
    post_options: { ...DEFAULT_SOCIAL_POST_OPTIONS },
    credential_hint: '@testaccount',
    has_credentials: true,
    credentials_encrypted: 'encrypted-blob',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePayload(overrides?: Partial<SocialEventPayload>): SocialEventPayload {
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
  vi.mocked(decryptJson).mockReturnValue({
    provider: 'x',
    access_token: 'test-token',
  });
  vi.mocked(formatSocialPost).mockReturnValue('Alice defeats Bob 2-1');
  vi.mocked(publishToProvider).mockResolvedValue(undefined);
  vi.mocked(resolveContentLocale).mockResolvedValue('de');
});

describe('emitSocialEvent — content language (i18n-core §6.3)', () => {
  it('formats posts in the league language resolved from the payload', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([makeIntegration()]);
    vi.mocked(resolveContentLocale).mockResolvedValue('en');

    emitSocialEvent(makePayload({ season_id: 'season-1' }));
    await flushPromises();

    expect(resolveContentLocale).toHaveBeenCalledTimes(1);
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'season-1', tournamentId: 'tournament-1' });
    expect(formatSocialPost).toHaveBeenCalledWith(expect.any(Object), 'x', expect.any(Object), 'en');
  });

  it('reads the language once for several integrations', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([
      makeIntegration({ id: 'int-1' }),
      makeIntegration({ id: 'int-2' }),
    ]);

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(resolveContentLocale).toHaveBeenCalledTimes(1);
    expect(vi.mocked(formatSocialPost).mock.calls.map((call) => call[3])).toEqual(['de', 'de']);
  });

  it('does not read the language when no integration matches', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([]);

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(resolveContentLocale).not.toHaveBeenCalled();
  });
});

describe('emitSocialEvent', () => {
  it('does not throw (fire-and-forget)', () => {
    vi.mocked(resolveSocialIntegrations).mockRejectedValue(new Error('DB down'));
    expect(() => emitSocialEvent(makePayload())).not.toThrow();
  });

  it('resolves integrations and publishes to matching providers', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([makeIntegration()]);

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(resolveSocialIntegrations).toHaveBeenCalledWith('tournament-1', null);
    expect(publishToProvider).toHaveBeenCalledWith(
      'x',
      { provider: 'x', access_token: 'test-token' },
      'Alice defeats Bob 2-1',
      undefined
    );
  });

  it('does not publish when no integrations match', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([]);

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(publishToProvider).not.toHaveBeenCalled();
  });

  it('filters integrations by event_filter', async () => {
    const integration = makeIntegration({
      event_filter: ['round_generated'],
    });
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([integration]);

    emitSocialEvent(makePayload({ event_type: 'match_confirmed' }));
    await flushPromises();

    expect(publishToProvider).not.toHaveBeenCalled();
  });

  it('publishes to integrations with matching event_filter', async () => {
    const integration = makeIntegration({
      event_filter: ['match_confirmed'],
    });
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([integration]);

    emitSocialEvent(makePayload({ event_type: 'match_confirmed' }));
    await flushPromises();

    expect(publishToProvider).toHaveBeenCalled();
  });

  it('publishes to integrations with empty event_filter (matches all)', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([makeIntegration({ event_filter: [] })]);

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(publishToProvider).toHaveBeenCalled();
  });

  it('skips publish when credentials are missing', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([
      makeIntegration({ credentials_encrypted: null }),
    ]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(publishToProvider).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('skips publish when credential provider mismatches', async () => {
    vi.mocked(decryptJson).mockReturnValue({
      provider: 'bluesky',
      handle: 'test.bsky.social',
      app_password: 'password',
    });
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([
      makeIntegration({ provider: 'x' }),
    ]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(publishToProvider).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('skips publish when formatSocialPost returns empty text', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([makeIntegration()]);
    vi.mocked(formatSocialPost).mockReturnValue('');

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(publishToProvider).not.toHaveBeenCalled();
  });

  it('passes imageUrl through to publishToProvider', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([makeIntegration()]);

    emitSocialEvent(makePayload({ imageUrl: 'https://example.com/image.png' }));
    await flushPromises();

    expect(publishToProvider).toHaveBeenCalledWith(
      'x',
      expect.any(Object),
      expect.any(String),
      'https://example.com/image.png'
    );
  });

  it('publishes to multiple integrations', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([
      makeIntegration({ id: 'int-1', provider: 'x' }),
      makeIntegration({ id: 'int-2', provider: 'x' }),
    ]);

    emitSocialEvent(makePayload());
    await flushPromises();

    expect(publishToProvider).toHaveBeenCalledTimes(2);
  });

  it('swallows publishToProvider errors silently', async () => {
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([makeIntegration()]);
    vi.mocked(publishToProvider).mockRejectedValue(new Error('API error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitSocialEvent(makePayload());
    await flushPromises();

    // Should not throw
    consoleSpy.mockRestore();
  });
});

describe('sendSocialTestMessage', () => {
  it('sends a test message with correct details', async () => {
    const integration = makeIntegration({ label: 'My X Account' });

    await sendSocialTestMessage(integration);

    expect(publishToProvider).toHaveBeenCalledWith(
      'x',
      { provider: 'x', access_token: 'test-token' },
      expect.stringContaining('PokeTools social integration test')
    );
    // Verify the message includes provider and label
    const callArgs = vi.mocked(publishToProvider).mock.calls[0];
    expect(callArgs[2]).toContain('Provider: x');
    expect(callArgs[2]).toContain('Label: My X Account');
  });

  it('writes the test post in the given locale', async () => {
    await sendSocialTestMessage(makeIntegration({ label: 'Mein X-Konto' }), 'de');

    const text = vi.mocked(publishToProvider).mock.calls[0][2];
    expect(text).toContain('PokéTools: Test der Social-Integration');
    expect(text).toContain('Anbieter: x');
    expect(text).toContain('Bezeichnung: Mein X-Konto');
  });

  it('throws when credentials are missing', async () => {
    const integration = makeIntegration({ credentials_encrypted: null });

    await expect(sendSocialTestMessage(integration)).rejects.toThrow(
      'Integration credentials are missing or invalid'
    );
  });

  it('throws when credentials decrypt to mismatched provider', async () => {
    vi.mocked(decryptJson).mockReturnValue({
      provider: 'threads',
      access_token: 'token',
      user_id: '123',
    });

    const integration = makeIntegration({ provider: 'x' });

    await expect(sendSocialTestMessage(integration)).rejects.toThrow(
      'Integration credentials are missing or invalid'
    );
  });
});
