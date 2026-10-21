import { describe, it, expect } from 'vitest';
import { buildEmbed } from '../embeds';
import { formatSocialPost } from '@/lib/social/format';
import type { DiscordEventPayload, RatingMilestoneData } from '@/types/discord';

function ratingPayload(data: Omit<RatingMilestoneData, 'kind'>): DiscordEventPayload {
  return {
    event_type: 'rating_milestone',
    tournament_id: 'tourney-1',
    season_id: null,
    data: { kind: 'rating_milestone', ...data },
  };
}

describe('rating_milestone threshold keys', () => {
  it('renders the English threshold name from the key', () => {
    const { embed } = buildEmbed(
      ratingPayload({ player_name: 'Alice', new_rating: 1702, threshold: 'ace_trainer', tournament_name: 'Cup' }),
      undefined,
      'en',
    );
    expect(embed.description).toBe('**Alice** reached **1702** (Ace Trainer).');
  });

  it('renders the German threshold name from the key', () => {
    const { embed } = buildEmbed(
      ratingPayload({ player_name: 'Alice', new_rating: 1805, threshold: 'elite_four', tournament_name: 'Cup' }),
      undefined,
      'de',
    );
    expect(embed.description).toBe('**Alice** hat **1805** erreicht (Top Vier).');
  });

  it('falls back to the stored English name on old payloads', () => {
    const { embed } = buildEmbed(
      ratingPayload({ player_name: 'Alice', new_rating: 1612, threshold_name: 'Rising Star', tournament_name: 'Cup' }),
      undefined,
      'de',
    );
    expect(embed.description).toContain('(Rising Star)');
  });

  it('social posts reuse the translated threshold', () => {
    const post = formatSocialPost(
      ratingPayload({ player_name: 'Alice', new_rating: 1901, threshold: 'champion_tier', tournament_name: 'Cup' }),
      'x',
      { include_replay_link: false, include_hashtags: false },
      'de',
    );
    expect(post).toContain('Champ-Klasse');
  });
});
