import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/discord-webhooks', () => ({ resolveWebhooks: vi.fn() }));
vi.mock('@/lib/supabase/queries/social-integrations', () => ({ resolveSocialIntegrations: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-discord-webhooks', () => ({ resolvePhaseWebhooks: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-social-integrations', () => ({ resolvePhaseSocialIntegrations: vi.fn() }));

import { matchesFilter, matchesFormatOptions } from '@/lib/discord/matchers';
import { matchesEventFilter } from '@/lib/social/matchers';
import { resolveWebhooks } from '@/lib/supabase/queries/discord-webhooks';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { resolvePhaseWebhooks } from '@/lib/supabase/queries/phase-discord-webhooks';
import { resolvePhaseSocialIntegrations } from '@/lib/supabase/queries/phase-social-integrations';
import { resolveSocialIntegrations } from '@/lib/supabase/queries/social-integrations';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import { previewPhaseBracketRecipients, previewRecipients } from '../outward-recipients';

const TID = '00000000-0000-4000-8000-000000007710';
const SEASON = '00000000-0000-4000-8000-000000008001';
const SECRET_URL = 'https://discord.com/api/webhooks/123456789/SECRET-TOKEN-abcdef';

const webhook = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, scope_type: 'global', scope_id: null, webhook_url: SECRET_URL, label: '#league-announcements', enabled: true, event_filter: [], format_options: { ...DEFAULT_FORMAT_OPTIONS }, ...over }) as never;
const integration = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, provider: 'bluesky', scope_type: 'global', scope_id: null, label: '@league', enabled: true, event_filter: [], credentials_encrypted: 'ENCRYPTED-CREDENTIALS', credential_hint: 'x', ...over }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveWebhooks).mockResolvedValue([]);
  vi.mocked(resolveSocialIntegrations).mockResolvedValue([]);
});

describe('previewPhaseBracketRecipients', () => {
  it('uses the native sender sets and event filters, preserving inherited channels and masking secrets', async () => {
    vi.mocked(getPhaseById).mockResolvedValue({ id: TID, season_id: SEASON } as never);
    vi.mocked(resolvePhaseWebhooks).mockResolvedValue([
      webhook('inherited', { label: '#league' }),
      webhook('phase', { phase_id: TID, event_filter: ['round_generated'], label: SECRET_URL }),
      webhook('no-rounds', { event_filter: ['match_confirmed'] }),
    ]);
    vi.mocked(resolvePhaseSocialIntegrations).mockResolvedValue([
      integration('inherited', { label: 'https://example.test/hook?token=abc' }),
      integration('phase', { phase_id: TID, event_filter: ['round_generated'] }),
      integration('no-rounds', { event_filter: ['tournament_started'] }),
    ]);

    const result = await previewPhaseBracketRecipients({ phaseId: TID, seasonId: SEASON });
    expect(result).toEqual({
      discord: { ids: ['inherited', 'phase'], names: ['Discord #league', 'Discord …cdef'].sort((a, b) => a.localeCompare(b)) },
      social: { ids: ['inherited', 'phase'], names: ['bluesky @league', 'bluesky …'].sort((a, b) => a.localeCompare(b)) },
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET-TOKEN|ENCRYPTED-CREDENTIALS|token=abc/);
    expect(resolvePhaseWebhooks).toHaveBeenCalledExactlyOnceWith(TID);
    expect(resolvePhaseSocialIntegrations).toHaveBeenCalledExactlyOnceWith(TID);
    expect(resolveWebhooks).not.toHaveBeenCalled();
    expect(resolveSocialIntegrations).not.toHaveBeenCalled();
  });

  it('does not preview another league’s phase or fall back to tournament storage', async () => {
    vi.mocked(getPhaseById).mockResolvedValue({ id: TID, season_id: TID } as never);
    expect(await previewPhaseBracketRecipients({ phaseId: TID, seasonId: SEASON })).toBeNull();
    expect(resolvePhaseWebhooks).not.toHaveBeenCalled();
    expect(resolvePhaseSocialIntegrations).not.toHaveBeenCalled();
    expect(resolveWebhooks).not.toHaveBeenCalled();
    expect(resolveSocialIntegrations).not.toHaveBeenCalled();
  });
});

describe('previewRecipients', () => {
  it('asks for the channels of the tournament and its league and returns nothing when there are none', async () => {
    expect(await previewRecipients({ eventType: 'round_generated', tournamentId: TID, seasonId: SEASON })).toEqual({ discord: { ids: [], names: [] }, social: { ids: [], names: [] } });
    expect(resolveWebhooks).toHaveBeenCalledWith(TID, SEASON);
    expect(resolveSocialIntegrations).toHaveBeenCalledWith(TID, SEASON);
  });

  it('keeps the channels whose event filter lets the event through (an empty filter means every event)', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([
      webhook('w-all'),
      webhook('w-rounds', { label: '#rounds', event_filter: ['round_generated'] }),
      webhook('w-results', { label: '#results', event_filter: ['match_confirmed'] }),
    ]);
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([integration('s-all'), integration('s-started', { provider: 'x', label: '@started', event_filter: ['tournament_started'] })]);

    const bracket = await previewRecipients({ eventType: 'round_generated', tournamentId: TID, seasonId: null });
    expect(bracket.discord.ids).toEqual(['w-all', 'w-rounds']);
    expect(bracket.social.ids).toEqual(['s-all']);
    const started = await previewRecipients({ eventType: 'tournament_started', tournamentId: TID, seasonId: null });
    expect(started.discord.ids).toEqual(['w-all']);
    expect(started.social.ids).toEqual(['s-all', 's-started']);
  });

  it('decides with the same matchers the senders use', async () => {
    const hooks = [webhook('a', { event_filter: ['round_generated'] }), webhook('b', { event_filter: ['match_confirmed'] }), webhook('c')];
    vi.mocked(resolveWebhooks).mockResolvedValue(hooks);
    const preview = await previewRecipients({ eventType: 'round_generated', tournamentId: TID, seasonId: null });
    const direct = (hooks as unknown as Array<{ id: string }>).filter((hook) => matchesFilter(hook as never, 'round_generated') && matchesFormatOptions(hook as never, { data: { kind: 'round_generated' } })).map((hook) => hook.id);
    expect(preview.discord.ids).toEqual(direct);
    expect(matchesEventFilter({ event_filter: ['tournament_started'] }, 'round_generated')).toBe(false);
    expect(matchesEventFilter({ event_filter: [] }, 'round_generated')).toBe(true);
  });

  it('applies the per-webhook switches of achievements, streaks and rating milestones', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([
      webhook('quiet', { format_options: { ...DEFAULT_FORMAT_OPTIONS, show_achievements: false, show_streaks: false, show_ratings: false } }),
      webhook('loud', { format_options: { ...DEFAULT_FORMAT_OPTIONS, show_achievements: true, show_streaks: true, show_ratings: true } }),
    ]);
    for (const eventType of ['achievement_unlocked', 'streak_milestone', 'streak_broken', 'rating_milestone'] as const) {
      expect((await previewRecipients({ eventType, tournamentId: TID, seasonId: null })).discord.ids, eventType).toEqual(['loud']);
    }
    // Round events are not affected by the switches.
    expect((await previewRecipients({ eventType: 'round_generated', tournamentId: TID, seasonId: null })).discord.ids).toEqual(['loud', 'quiet']);
  });

  it('returns masked names only: labels and providers, sorted, never a URL, a token or a credential', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook('w2', { label: '#zeta' }), webhook('w1', { label: '#alpha' }), webhook('w3', { label: SECRET_URL })]);
    vi.mocked(resolveSocialIntegrations).mockResolvedValue([integration('s1'), integration('s2', { label: 'https://example.test/hook?token=abc' })]);
    const preview = await previewRecipients({ eventType: 'round_generated', tournamentId: TID, seasonId: null });
    expect(preview.discord.names).toEqual(['Discord #alpha', 'Discord #zeta', 'Discord …cdef'].sort((a, b) => a.localeCompare(b)));
    expect(preview.social.names).toEqual(['bluesky @league', 'bluesky …'].sort((a, b) => a.localeCompare(b)));
    const everything = JSON.stringify(preview);
    for (const secret of [SECRET_URL, 'SECRET-TOKEN', 'ENCRYPTED-CREDENTIALS', 'token=abc', 'credential']) expect(everything).not.toContain(secret);
  });

  it('shortens a very long label', async () => {
    vi.mocked(resolveWebhooks).mockResolvedValue([webhook('w1', { label: 'x'.repeat(200) })]);
    const [name] = (await previewRecipients({ eventType: 'round_generated', tournamentId: TID, seasonId: null })).discord.names;
    expect(name.length).toBe(60);
  });
});
