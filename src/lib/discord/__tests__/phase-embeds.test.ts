import { describe, expect, it, vi } from 'vitest';
import type { PhaseNotificationData } from '@/types/phase-events';
import type { DiscordEventData } from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import { buildEmbed, buildNotificationEmbed } from '../embeds';

const phase_name = 'Opening phase';
const players = { player_1_name: 'Trainer A', player_2_name: 'Trainer B' };
const data: PhaseNotificationData[] = [
  { kind: 'match_result', phase_name, ...players, winner_name: 'Trainer A', game_score: '2-1', round_name: 'Round 1' },
  { kind: 'match_confirmed', phase_name, ...players, winner_name: 'Trainer A', game_score: '2-1' },
  { kind: 'match_disputed', phase_name, ...players, disputer_name: 'Trainer B' },
  { kind: 'round_generated', phase_name, round_name: 'Round 1', pairings: [players] },
  { kind: 'achievement_unlocked', phase_name, player_name: 'Trainer A', achievement_name: 'Example achievement',
    achievement_description: 'Example description', achievement_tier: 'gold', achievement_icon: null },
  { kind: 'streak_milestone', phase_name, player_name: 'Trainer A', streak_type: 'win', streak_count: 5 },
  { kind: 'streak_broken', phase_name, breaker_name: 'Trainer B', broken_player_name: 'Trainer A', streak_count: 5 },
  { kind: 'rating_milestone', phase_name, player_name: 'Trainer A', new_rating: 1600, threshold: 'rising_star' },
  { kind: 'round_completed', phase_name, round_name: 'Round 1', round_number: 1, match_results: [], standings: [] },
  { kind: 'round_recap_published', phase_name, round_name: 'Round 1', headline: 'Example recap', match_summaries: [],
    meta_trends: 'Example trends', player_spotlight: { player_name: 'Trainer A', reason: 'Example reason' },
    phase_url: 'https://example.com/leagues/league-one/phases/phase-one' },
  { kind: 'round_forecast_published', phase_name, round_name: 'Round 2', headline: 'Example forecast', matchup_previews: [],
    bold_prediction: 'Example prediction', phase_url: 'https://example.com/leagues/league-one/phases/phase-one' },
];

describe('phase-owned notification rendering', () => {
  it.each(['en', 'de'] as const)('preserves all legacy event layouts in %s using display names only', (locale) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      for (const item of data) {
        const { phase_name: name, ...rest } = item;
        const { phase_url, ...legacyData } = 'phase_url' in rest ? rest : { ...rest, phase_url: undefined };
        const legacy = { ...legacyData, tournament_name: name,
          ...(phase_url ? { tournament_url: phase_url } : {}) } as DiscordEventData;
        const nativeEmbed = buildNotificationEmbed({ data: item }, DEFAULT_FORMAT_OPTIONS, locale);
        expect(nativeEmbed).toEqual(buildEmbed({ event_type: 'match_confirmed', tournament_id: 'standalone',
          season_id: null, data: legacy }, DEFAULT_FORMAT_OPTIONS, locale));
        if ('phase_url' in item) expect(nativeEmbed.embed.url).toBe(item.phase_url);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['en', 'de'] as const)('uses typed phase status terminology in %s', (locale) => {
    for (const new_status of ['active', 'completed'] as const) {
      const result = buildNotificationEmbed({ data: { kind: 'phase_status', phase_name, new_status } }, undefined, locale);
      expect(result.embed.title).toContain('Phase');
      expect(result.embed.title).not.toMatch(/Tournament|Turnier/);
      expect(result.embed.description).toContain(phase_name);
    }
  });
});
