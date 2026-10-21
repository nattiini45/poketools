import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSocialPost } from '../format';
import type { SocialEventPayload, SocialPostOptions } from '@/types/social';

// Freeze time so buildEmbed's timestamps are deterministic
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
});

// ── Helpers ──────────────────────────────────────────────────────────

function makePayload(overrides?: Partial<SocialEventPayload['data']>): SocialEventPayload {
  return {
    event_type: 'match_confirmed',
    tournament_id: 'tourney-1',
    season_id: null,
    data: {
      kind: 'match_confirmed',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-1',
      tournament_name: 'Spring Cup',
      ...overrides,
    },
  } as SocialEventPayload;
}

const defaultOptions: SocialPostOptions = {
  include_replay_link: false,
  include_hashtags: false,
};

// ── Basic formatting ────────────────────────────────────────────────

describe('formatSocialPost', () => {
  it('produces plain text from a match_confirmed payload', () => {
    const post = formatSocialPost(makePayload(), 'x', defaultOptions, 'en');

    // Should contain title (without ** bold markers) and score
    expect(post).toContain('Match Confirmed');
    expect(post).toContain('Spring Cup');
    expect(post).toContain('Alice');
    expect(post).toContain('Bob');
    // Discord bold markers should be stripped
    expect(post).not.toContain('**');
  });

  it('strips Discord spoiler tags', () => {
    // buildEmbed uses spoilers by default, but EMBED_OPTIONS in format.ts disables them
    // Even if they appeared, sanitizeDiscordFormatting strips ||
    const post = formatSocialPost(makePayload(), 'x', defaultOptions, 'en');
    expect(post).not.toContain('||');
  });

  it('strips Discord @mention tags', () => {
    // Draft pick with ping content includes <@discordId>
    const payload: SocialEventPayload = {
      event_type: 'draft_pick_made',
      tournament_id: 'tourney-1',
      season_id: null,
      data: {
        kind: 'draft_pick',
        player_name: 'Alice',
        pokemon_name: 'Garchomp',
        pick_number: 1,
        round: 1,
        season_name: 'Season 5',
        next_picker_discord_id: '999888777',
        next_picker_name: 'Bob',
      },
    };
    // Use options that enable ping (format.ts sets ping_next_drafter: false, so content won't have @mention)
    // Even without ping, the body is sanitized
    const post = formatSocialPost(payload, 'x', defaultOptions, 'en');
    expect(post).not.toContain('<@');
  });
});

// ── Hashtags ────────────────────────────────────────────────────────

describe('formatSocialPost — hashtags', () => {
  it('appends hashtags when include_hashtags is true', () => {
    const post = formatSocialPost(makePayload(), 'x', {
      ...defaultOptions,
      include_hashtags: true,
    }, 'en');

    expect(post).toContain('#Poketools');
  });

  it('does not include hashtags when include_hashtags is false', () => {
    const post = formatSocialPost(makePayload(), 'x', defaultOptions, 'en');
    expect(post).not.toContain('#Poketools');
  });

  it('includes #PokemonBattle for match events', () => {
    const post = formatSocialPost(makePayload(), 'x', {
      ...defaultOptions,
      include_hashtags: true,
    }, 'en');
    expect(post).toContain('#PokemonBattle');
  });

  it('includes #PokemonDraft for draft events', () => {
    const payload: SocialEventPayload = {
      event_type: 'draft_pick_made',
      tournament_id: 'tourney-1',
      season_id: null,
      data: {
        kind: 'draft_pick',
        player_name: 'Alice',
        pokemon_name: 'Garchomp',
        pick_number: 1,
        round: 1,
        season_name: 'S1',
      },
    };
    const post = formatSocialPost(payload, 'x', {
      ...defaultOptions,
      include_hashtags: true,
    }, 'en');
    expect(post).toContain('#PokemonDraft');
  });

  it('includes #PokemonTournament for round events', () => {
    const payload: SocialEventPayload = {
      event_type: 'round_generated',
      tournament_id: 'tourney-1',
      season_id: null,
      data: {
        kind: 'round_generated',
        tournament_name: 'Cup',
        round_name: 'R1',
        pairings: [{ player_1_name: 'A', player_2_name: 'B' }],
      },
    };
    const post = formatSocialPost(payload, 'x', {
      ...defaultOptions,
      include_hashtags: true,
    }, 'en');
    expect(post).toContain('#PokemonTournament');
  });

  it('includes #PokemonLeague for achievement events', () => {
    const payload: SocialEventPayload = {
      event_type: 'achievement_unlocked',
      tournament_id: 'tourney-1',
      season_id: null,
      data: {
        kind: 'achievement_unlocked',
        player_name: 'Alice',
        achievement_name: 'First Win',
        achievement_tier: 'bronze',
        achievement_icon: null,
        achievement_description: 'Win a match.',
        tournament_name: 'Cup',
      },
    };
    const post = formatSocialPost(payload, 'x', {
      ...defaultOptions,
      include_hashtags: true,
    }, 'en');
    expect(post).toContain('#PokemonLeague');
  });
});

// ── Character limit truncation ──────────────────────────────────────

describe('formatSocialPost — truncation', () => {
  it('truncates to 280 chars for X provider', () => {
    // Create a payload with a very long tournament name to exceed 280
    const payload = makePayload({ tournament_name: 'T'.repeat(400) } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'x', defaultOptions, 'en');
    expect(post.length).toBeLessThanOrEqual(280);
  });

  it('truncates to 500 chars for Threads provider', () => {
    const payload = makePayload({ tournament_name: 'T'.repeat(600) } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'threads', defaultOptions, 'en');
    expect(post.length).toBeLessThanOrEqual(500);
  });

  it('truncates to 300 chars for Bluesky provider', () => {
    const payload = makePayload({ tournament_name: 'T'.repeat(400) } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'bluesky', defaultOptions, 'en');
    expect(post.length).toBeLessThanOrEqual(300);
  });

  it('appends ellipsis when truncated', () => {
    const payload = makePayload({ tournament_name: 'T'.repeat(400) } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'x', defaultOptions, 'en');
    expect(post.endsWith('\u2026')).toBe(true);
  });

  it('does not truncate short posts', () => {
    const post = formatSocialPost(makePayload(), 'threads', defaultOptions, 'en');
    // A simple match confirmed post should be well under 500 chars
    expect(post).not.toContain('\u2026');
  });
});

// ── Fields rendering ────────────────────────────────────────────────

describe('formatSocialPost — fields', () => {
  it('includes embed fields as "Name: Value" lines for draft_pick', () => {
    const payload: SocialEventPayload = {
      event_type: 'draft_pick_made',
      tournament_id: 'tourney-1',
      season_id: null,
      data: {
        kind: 'draft_pick',
        player_name: 'Alice',
        pokemon_name: 'Garchomp',
        pick_number: 5,
        round: 2,
        season_name: 'Season 5',
      },
    };
    const post = formatSocialPost(payload, 'threads', defaultOptions, 'en');

    expect(post).toContain('Round: 2');
    expect(post).toContain('Pick #: 5');
  });
});

// ── Replay link ─────────────────────────────────────────────────────

describe('formatSocialPost — replay link', () => {
  it('includes replay link when option is true and URL present', () => {
    const payload = makePayload({
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1',
    } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'threads', {
      ...defaultOptions,
      include_replay_link: true,
    }, 'en');

    expect(post).toContain('Watch Replay');
  });

  it('omits replay link when option is false', () => {
    const payload = makePayload({
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1',
    } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'threads', {
      ...defaultOptions,
      include_replay_link: false,
    }, 'en');

    expect(post).not.toContain('Watch Replay');
  });
});

// ── Content language (i18n-core §6.3) ───────────────────────────────

describe('formatSocialPost — German', () => {
  it('writes the post in German with German Pokémon names', () => {
    const payload: SocialEventPayload = {
      event_type: 'draft_pick_made',
      tournament_id: 'tourney-1',
      season_id: null,
      data: {
        kind: 'draft_pick',
        player_name: 'Alice',
        pokemon_name: 'Garchomp',
        pick_number: 5,
        round: 2,
        season_name: 'Saison 5',
      },
    };
    const post = formatSocialPost(payload, 'threads', defaultOptions, 'de');

    expect(post).toContain('Draft-Pick – Saison 5');
    expect(post).toContain('Alice hat Knakrack gepickt');
    expect(post).toContain('Runde: 2');
    expect(post).toContain('Pick-Nr.: 5');
    expect(post).not.toContain('Garchomp');
  });

  it('translates the replay link label', () => {
    const payload = makePayload({
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1',
    } as Record<string, unknown>);
    const post = formatSocialPost(payload, 'threads', { ...defaultOptions, include_replay_link: true }, 'de');

    expect(post).toContain('Spiel bestätigt – Spring Cup');
    expect(post).toContain('Replay ansehen');
  });
});
