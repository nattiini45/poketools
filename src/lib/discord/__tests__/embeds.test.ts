import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEmbed } from '../embeds';
import type { DiscordEventPayload, WebhookFormatOptions, GamePokemonStats } from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';

// Freeze time for stable timestamp assertions
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
});

// ── Helpers ──────────────────────────────────────────────────────────

function makePayload(data: DiscordEventPayload['data']): DiscordEventPayload {
  return {
    event_type: 'match_result_submitted',
    tournament_id: 'tourney-1',
    season_id: null,
    data,
  };
}

const NO_SPOILERS: WebhookFormatOptions = {
  ...DEFAULT_FORMAT_OPTIONS,
  spoiler_results: false,
};

const WITH_SPOILERS: WebhookFormatOptions = {
  ...DEFAULT_FORMAT_OPTIONS,
  spoiler_results: true,
};

const sampleGameStats: GamePokemonStats[] = [
  {
    game_number: 1,
    winner_id: 'p1',
    players: [
      {
        player_id: 'p1',
        player_name: 'Alice',
        pokemon: [
          { pokemon_name: 'Garchomp', kos_dealt: 2, was_koed: false },
          { pokemon_name: 'Pikachu', kos_dealt: 0, was_koed: true },
        ],
      },
      {
        player_id: 'p2',
        player_name: 'Bob',
        pokemon: [
          { pokemon_name: 'Charizard', kos_dealt: 1, was_koed: true },
        ],
      },
    ],
  },
];

// ── match_result ────────────────────────────────────────────────────

describe('buildEmbed — match_result', () => {
  it('builds embed with round name and score', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-1',
      tournament_name: 'Spring Cup',
      round_name: 'Round 3',
    }), NO_SPOILERS, 'en');

    expect(embed.title).toBe('Game Submitted — Spring Cup');
    expect(embed.description).toContain('Round 3');
    expect(embed.description).toContain('**Alice** 2:1 **Bob**');
    expect(embed.color).toBe(0xe67e22);
    expect(embed.timestamp).toBeDefined();
  });

  it('wraps score in spoiler tags when enabled', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-0',
      tournament_name: 'Cup',
      round_name: 'Round 1',
    }), WITH_SPOILERS, 'en');

    expect(embed.description).toContain('||');
  });

  it('includes replay link when present and enabled', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-0',
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1',
      tournament_name: 'Cup',
      round_name: 'R1',
    }), { ...NO_SPOILERS, show_replay_link: true }, 'en');

    expect(embed.description).toContain('[Watch Replay]');
  });

  it('omits replay link when option is off', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-0',
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1',
      tournament_name: 'Cup',
      round_name: 'R1',
    }), { ...NO_SPOILERS, show_replay_link: false }, 'en');

    expect(embed.description).not.toContain('[Watch Replay]');
  });

  it('includes pokemon details when game_stats present and option on', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '1-0',
      tournament_name: 'Cup',
      round_name: 'R1',
      game_stats: sampleGameStats,
    }), { ...NO_SPOILERS, show_pokemon_details: true }, 'en');

    expect(embed.description).toContain('Garchomp');
    expect(embed.description).toContain('(X)');
  });

  it('omits pokemon details when option is off', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '1-0',
      tournament_name: 'Cup',
      round_name: 'R1',
      game_stats: sampleGameStats,
    }), { ...NO_SPOILERS, show_pokemon_details: false }, 'en');

    expect(embed.description).not.toContain('Garchomp');
  });
});

// ── match_confirmed ─────────────────────────────────────────────────

describe('buildEmbed — match_confirmed', () => {
  it('builds green embed with score', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_confirmed',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-1',
      tournament_name: 'Spring Cup',
    }), NO_SPOILERS, 'en');

    expect(embed.title).toBe('Match Confirmed — Spring Cup');
    expect(embed.description).toContain('2:1');
    expect(embed.color).toBe(0x57f287);
  });

  it('includes replay link and game stats when present', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_confirmed',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-0',
      tournament_name: 'Cup',
      replay_url: 'https://replay.test',
      game_stats: sampleGameStats,
    }), { ...NO_SPOILERS, show_replay_link: true, show_pokemon_details: true }, 'en');

    expect(embed.description).toContain('[Watch Replay]');
    expect(embed.description).toContain('Garchomp');
  });
});

// ── match_disputed ──────────────────────────────────────────────────

describe('buildEmbed — match_disputed', () => {
  it('builds yellow embed with dispute info', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_disputed',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      disputer_name: 'Bob',
      tournament_name: 'Spring Cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Match Disputed — Spring Cup');
    expect(embed.description).toContain('**Bob** has disputed');
    expect(embed.description).toContain('admin will need to resolve');
    expect(embed.color).toBe(0xfee75c);
  });
});

// ── round_generated ─────────────────────────────────────────────────

describe('buildEmbed — round_generated', () => {
  it('builds blue embed listing pairings', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_generated',
      tournament_name: 'Spring Cup',
      round_name: 'Round 2',
      pairings: [
        { player_1_name: 'Alice', player_2_name: 'Bob' },
        { player_1_name: 'Carol', player_2_name: 'Dave' },
      ],
    }), undefined, 'en');

    expect(embed.title).toBe('Round 2 — Spring Cup');
    expect(embed.description).toContain('2 matches');
    expect(embed.description).toContain('Alice vs Bob');
    expect(embed.description).toContain('Carol vs Dave');
    expect(embed.color).toBe(0x5865f2);
  });

  it('uses singular "match" for 1 pairing', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_generated',
      tournament_name: 'Cup',
      round_name: 'Finals',
      pairings: [{ player_1_name: 'Alice', player_2_name: 'Bob' }],
    }), undefined, 'en');

    expect(embed.description).toContain('1 match:');
  });
});

// ── tournament_status ───────────────────────────────────────────────

describe('buildEmbed — tournament_status', () => {
  it('builds active tournament embed', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'tournament_status',
      tournament_name: 'Spring Cup',
      new_status: 'active',
    }), undefined, 'en');

    expect(embed.title).toBe('Tournament Started — Spring Cup');
    expect(embed.description).toContain('now underway');
    expect(embed.color).toBe(0x5865f2);
  });

  it('builds completed tournament embed', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'tournament_status',
      tournament_name: 'Spring Cup',
      new_status: 'completed',
    }), undefined, 'en');

    expect(embed.title).toBe('Tournament Completed — Spring Cup');
    expect(embed.description).toContain('concluded');
    expect(embed.color).toBe(0x57f287);
  });
});

// ── season_advanced ─────────────────────────────────────────────────

describe('buildEmbed — season_advanced', () => {
  it('builds purple embed with advancement info', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'season_advanced',
      season_name: 'Season 5',
      source_stage: 'Swiss',
      target_stage: 'Top Cut',
      advanced_count: 8,
      summary: 'Top 8 advance to elimination bracket.',
    }), undefined, 'en');

    expect(embed.title).toBe('Stage Advancement — Season 5');
    expect(embed.description).toContain('**8** players advanced');
    expect(embed.description).toContain('**Swiss**');
    expect(embed.description).toContain('**Top Cut**');
    expect(embed.color).toBe(0x9b59b6);
  });

  it('uses singular player for count of 1', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'season_advanced',
      season_name: 'S1',
      source_stage: 'A',
      target_stage: 'B',
      advanced_count: 1,
      summary: 'One player advances.',
    }), undefined, 'en');

    expect(embed.description).toContain('**1** player advanced');
    expect(embed.description).not.toContain('players');
  });
});

// ── draft_pick ──────────────────────────────────────────────────────

describe('buildEmbed — draft_pick', () => {
  it('builds blue embed with pick info and fields', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'draft_pick',
      player_name: 'Alice',
      pokemon_name: 'Garchomp',
      pick_number: 3,
      round: 1,
      season_name: 'Season 5',
    }), undefined, 'en');

    expect(embed.title).toBe('Draft Pick — Season 5');
    expect(embed.description).toContain('**Alice** selected **Garchomp**');
    expect(embed.fields).toHaveLength(2);
    expect(embed.fields![0]).toEqual({ name: 'Round', value: '1', inline: true });
    expect(embed.fields![1]).toEqual({ name: 'Pick #', value: '3', inline: true });
  });

  it('pings next drafter when option enabled and discord ID present', () => {
    const { embed, content } = buildEmbed(makePayload({
      kind: 'draft_pick',
      player_name: 'Alice',
      pokemon_name: 'Garchomp',
      pick_number: 3,
      round: 1,
      season_name: 'S5',
      next_picker_discord_id: '123456789',
      next_picker_name: 'Bob',
    }), { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: true }, 'en');

    expect(content).toBe("<@123456789> — you're up next!");
    expect(embed.footer).toEqual({ text: 'Next pick: Bob' });
  });

  it('shows footer without ping when ping_next_drafter is off but next_picker_name exists', () => {
    const { embed, content } = buildEmbed(makePayload({
      kind: 'draft_pick',
      player_name: 'Alice',
      pokemon_name: 'Garchomp',
      pick_number: 3,
      round: 1,
      season_name: 'S5',
      next_picker_name: 'Bob',
      next_picker_discord_id: '123456789',
    }), { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: false }, 'en');

    expect(content).toBeUndefined();
    expect(embed.footer).toEqual({ text: 'Next pick: Bob' });
  });

  it('shows no footer or content when no next picker info', () => {
    const { embed, content } = buildEmbed(makePayload({
      kind: 'draft_pick',
      player_name: 'Alice',
      pokemon_name: 'Garchomp',
      pick_number: 1,
      round: 1,
      season_name: 'S5',
    }), undefined, 'en');

    expect(content).toBeUndefined();
    expect(embed.footer).toBeUndefined();
  });

  it('adds footer when ping enabled, next_picker_name exists but discord_id is missing', () => {
    const { embed, content } = buildEmbed(makePayload({
      kind: 'draft_pick',
      player_name: 'Alice',
      pokemon_name: 'Garchomp',
      pick_number: 1,
      round: 1,
      season_name: 'S5',
      next_picker_name: 'Carol',
    }), { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: true }, 'en');

    // No discord ID means the ping branch isn't taken, but footer is still set
    expect(content).toBeUndefined();
    expect(embed.footer).toEqual({ text: 'Next pick: Carol' });
  });
});

// ── draft_completed ─────────────────────────────────────────────────

describe('buildEmbed — draft_completed', () => {
  it('builds green embed', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'draft_completed',
      season_name: 'Season 5',
      pool_name: 'Pool A',
    }), undefined, 'en');

    expect(embed.title).toBe('Draft Complete — Season 5');
    expect(embed.description).toBe('The draft is complete (Pool A)! All picks have been assigned.');
    expect(embed.color).toBe(0x57f287);
  });

  it('names the pool by its order and pricing in the webhook language when pool_format is set', () => {
    const payload = makePayload({
      kind: 'draft_completed',
      season_name: 'Season 5',
      pool_name: 'Snake order · fixed prices',
      pool_format: { order: 'snake', pricing: 'fixed' },
    });
    expect(buildEmbed(payload, undefined, 'en').embed.description).toBe(
      'The draft is complete (Snake order · fixed prices)! All picks have been assigned.',
    );
    expect(buildEmbed(payload, undefined, 'de').embed.description).toBe(
      'Der Draft ist abgeschlossen (Snake-Reihenfolge · feste Preise)! Alle Picks sind vergeben.',
    );
  });
});

// ── achievement_unlocked ────────────────────────────────────────────

describe('buildEmbed — achievement_unlocked', () => {
  it('builds embed with icon and description', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'Alice',
      achievement_name: 'First Blood',
      achievement_tier: 'bronze',
      achievement_icon: null,
      achievement_description: 'Win your first match.',
      tournament_name: 'Cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Achievement Unlocked — Cup');
    expect(embed.description).toContain('**Alice** earned **First Blood**');
    expect(embed.description).toContain('Win your first match.');
    // null icon => default emoji
    expect(embed.description).toContain('\uD83C\uDFC5');
  });

  it('uses custom icon when provided', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'Alice',
      achievement_name: 'Sweep',
      achievement_tier: 'gold',
      achievement_icon: '\uD83E\uDD47',
      achievement_description: 'Sweep an opponent.',
      tournament_name: 'Cup',
    }), undefined, 'en');

    expect(embed.description).toContain('\uD83E\uDD47');
  });

  it('uses bronze color for bronze tier', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'A',
      achievement_name: 'B',
      achievement_tier: 'bronze',
      achievement_icon: null,
      achievement_description: 'D',
      tournament_name: 'T',
    }), undefined, 'en');
    expect(embed.color).toBe(0xcd7f32);
  });

  it('uses silver color for silver tier', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'A',
      achievement_name: 'B',
      achievement_tier: 'silver',
      achievement_icon: null,
      achievement_description: 'D',
      tournament_name: 'T',
    }), undefined, 'en');
    expect(embed.color).toBe(0xc0c0c0);
  });

  it('uses gold color for gold tier', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'A',
      achievement_name: 'B',
      achievement_tier: 'gold',
      achievement_icon: null,
      achievement_description: 'D',
      tournament_name: 'T',
    }), undefined, 'en');
    expect(embed.color).toBe(0xffd700);
  });

  it('uses gold color for platinum tier', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'A',
      achievement_name: 'B',
      achievement_tier: 'platinum',
      achievement_icon: null,
      achievement_description: 'D',
      tournament_name: 'T',
    }), undefined, 'en');
    // achievementColor returns COLORS.gold for anything not bronze/silver
    expect(embed.color).toBe(0xffd700);
  });
});

// ── streak_milestone ────────────────────────────────────────────────

describe('buildEmbed — streak_milestone', () => {
  it('builds orange embed with streak info', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'streak_milestone',
      player_name: 'Alice',
      streak_type: 'win',
      streak_count: 5,
      tournament_name: 'Cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Streak Milestone — Cup');
    expect(embed.description).toContain('**5**-match win streak');
    expect(embed.color).toBe(0xe67e22);
  });
});

// ── streak_broken ───────────────────────────────────────────────────

describe('buildEmbed — streak_broken', () => {
  it('builds red embed', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'streak_broken',
      breaker_name: 'Bob',
      broken_player_name: 'Alice',
      streak_count: 5,
      tournament_name: 'Cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Streak Broken — Cup');
    expect(embed.description).toContain("**Bob** ended **Alice**'s 5-match streak");
    expect(embed.color).toBe(0xff0000);
  });
});

// ── rating_milestone ────────────────────────────────────────────────

describe('buildEmbed — rating_milestone', () => {
  it('builds purple embed with rounded rating', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'rating_milestone',
      player_name: 'Alice',
      new_rating: 1523.456,
      threshold_name: 'Expert',
      tournament_name: 'Cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Rating Milestone — Cup');
    expect(embed.description).toContain('**1523**');
    expect(embed.description).toContain('Expert');
    expect(embed.color).toBe(0x9b59b6);
  });
});

// ── round_completed ─────────────────────────────────────────────────

describe('buildEmbed — round_completed', () => {
  it('builds green embed with results and standings', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'Round 3',
      round_number: 3,
      match_results: [
        { player_1_name: 'Alice', player_2_name: 'Bob', score: '2:1', winner_name: 'Alice' },
      ],
      standings: [
        { position: 1, player_name: 'Alice', wins: 3, losses: 0, draws: 0, points: 9, position_change: 0 },
        { position: 2, player_name: 'Bob', wins: 2, losses: 1, draws: 0, points: 6, position_change: -1 },
      ],
    }), NO_SPOILERS, 'en');

    // The stored round name already says "Round 3"; the title no longer prefixes a second "Round".
    expect(embed.title).toBe('Round 3 Completed! — Cup');
    expect(embed.color).toBe(0x57f287);
    expect(embed.description).toContain('**Results**');
    expect(embed.description).toContain('**Standings**');
    expect(embed.description).toContain('Alice');
  });

  it('bolds winner in match results', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'R1',
      round_number: 1,
      match_results: [
        { player_1_name: 'Alice', player_2_name: 'Bob', score: '2:0', winner_name: 'Alice' },
      ],
      standings: [
        { position: 1, player_name: 'Alice', wins: 1, losses: 0, draws: 0, points: 3, position_change: null },
      ],
    }), NO_SPOILERS, 'en');

    expect(embed.description).toContain('**Alice**');
  });

  it('shows position change indicators in standings', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'R2',
      round_number: 2,
      match_results: [],
      standings: [
        { position: 1, player_name: 'Alice', wins: 2, losses: 0, draws: 0, points: 6, position_change: 2 },
        { position: 2, player_name: 'Bob', wins: 1, losses: 1, draws: 0, points: 3, position_change: -1 },
        { position: 3, player_name: 'Carol', wins: 1, losses: 1, draws: 0, points: 3, position_change: 0 },
        { position: 4, player_name: 'Dave', wins: 0, losses: 2, draws: 0, points: 0, position_change: null },
      ],
    }), NO_SPOILERS, 'en');

    // Up arrow for +2
    expect(embed.description).toMatch(/▲2/);
    // Down arrow for -1
    expect(embed.description).toMatch(/▼1/);
  });

  it('shows draws in record when draws > 0', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'R2',
      round_number: 2,
      match_results: [],
      standings: [
        { position: 1, player_name: 'Alice', wins: 1, losses: 0, draws: 1, points: 4, position_change: null },
      ],
    }), NO_SPOILERS, 'en');

    expect(embed.description).toContain('1-0-1');
  });

  it('omits draws from record when draws is 0', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'R2',
      round_number: 2,
      match_results: [],
      standings: [
        { position: 1, player_name: 'Alice', wins: 2, losses: 0, draws: 0, points: 6, position_change: null },
      ],
    }), NO_SPOILERS, 'en');

    expect(embed.description).toContain('2-0)');
    expect(embed.description).not.toContain('2-0-0');
  });

  it('truncates standings when they would exceed limit', () => {
    // Create enough standings to blow past the 3900 char limit
    const standings = Array.from({ length: 200 }, (_, i) => ({
      position: i + 1,
      player_name: `Player_${String(i + 1).padStart(3, '0')}_${'x'.repeat(20)}`,
      wins: 10 - (i % 10),
      losses: i % 10,
      draws: 0,
      points: (10 - (i % 10)) * 3,
      position_change: i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0,
    }));

    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'R10',
      round_number: 10,
      match_results: [],
      standings,
    }), NO_SPOILERS, 'en');

    expect(embed.description).toContain('... and');
    expect(embed.description).toContain('more');
    expect(embed.description!.length).toBeLessThan(4096);
  });
});

// ── round_recap_published ───────────────────────────────────────────

describe('buildEmbed — round_recap_published', () => {
  it('builds purple embed with recap content', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_recap_published',
      tournament_name: 'Cup',
      round_name: 'Round 3',
      headline: 'An explosive round of upsets!',
      match_summaries: [
        { players: 'Alice vs Bob', score: '2-1', one_liner: 'Alice clutched it out.' },
      ],
      meta_trends: 'Garchomp usage surged to 80%.',
      player_spotlight: { player_name: 'Alice', reason: 'Dominant 6-0 sweep in Game 2.' },
      tournament_url: 'https://poketools.example/t/cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Round Recap: Round 3 — Cup');
    expect(embed.description).toContain('An explosive round of upsets!');
    expect(embed.description).toContain('Alice vs Bob');
    expect(embed.description).toContain('Player Spotlight: Alice');
    expect(embed.description).toContain('Meta Trends');
    expect(embed.description).toContain('Garchomp usage surged');
    expect(embed.color).toBe(0x9b59b6);
    expect(embed.url).toBe('https://poketools.example/t/cup');
  });

  it('omits spotlight section when player_name is empty', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_recap_published',
      tournament_name: 'Cup',
      round_name: 'R1',
      headline: 'Week 1 recap',
      match_summaries: [],
      meta_trends: 'Nothing notable.',
      player_spotlight: { player_name: '', reason: '' },
      tournament_url: 'https://poketools.example/t/cup',
    }), undefined, 'en');

    expect(embed.description).not.toContain('Player Spotlight');
  });

  it('truncates description to 4000 chars', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_recap_published',
      tournament_name: 'Cup',
      round_name: 'R1',
      headline: 'A'.repeat(5000),
      match_summaries: [],
      meta_trends: 'X',
      player_spotlight: { player_name: '', reason: '' },
      tournament_url: 'https://test.com',
    }), undefined, 'en');

    expect(embed.description!.length).toBeLessThanOrEqual(4000);
  });
});

// ── round_forecast_published ────────────────────────────────────────

describe('buildEmbed — round_forecast_published', () => {
  it('builds blue embed with previews and prediction', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_forecast_published',
      tournament_name: 'Cup',
      round_name: 'Round 4',
      headline: 'A critical round ahead!',
      matchup_previews: [
        { players: 'Alice vs Carol', storyline: 'Battle of the undefeated.' },
      ],
      bold_prediction: 'Carol upsets Alice.',
      tournament_url: 'https://poketools.example/t/cup',
    }), undefined, 'en');

    expect(embed.title).toBe('Round Preview: Round 4 — Cup');
    expect(embed.description).toContain('A critical round ahead!');
    expect(embed.description).toContain('Alice vs Carol');
    expect(embed.description).toContain('Battle of the undefeated');
    expect(embed.description).toContain('Bold Prediction');
    expect(embed.description).toContain('Carol upsets Alice');
    expect(embed.color).toBe(0x5865f2);
    expect(embed.url).toBe('https://poketools.example/t/cup');
  });

  it('truncates description to 4000 chars', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_forecast_published',
      tournament_name: 'Cup',
      round_name: 'R1',
      headline: 'B'.repeat(5000),
      matchup_previews: [],
      bold_prediction: 'X',
      tournament_url: 'https://test.com',
    }), undefined, 'en');

    expect(embed.description!.length).toBeLessThanOrEqual(4000);
  });
});

// ── Default options ─────────────────────────────────────────────────

describe('buildEmbed — default options', () => {
  it('uses DEFAULT_FORMAT_OPTIONS when no options passed', () => {
    // Default has spoiler_results: true
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-0',
      tournament_name: 'Cup',
      round_name: 'R1',
    }), undefined, 'en');

    // With default options, spoiler_results is true so score should be wrapped
    expect(embed.description).toContain('||');
  });
});

// ── Multi-game stats rendering ──────────────────────────────────────

describe('buildEmbed — multi-game stats', () => {
  it('renders Game N headers for multiple games', () => {
    const multiGameStats: GamePokemonStats[] = [
      {
        game_number: 1,
        winner_id: 'p1',
        players: [
          { player_id: 'p1', player_name: 'Alice', pokemon: [{ pokemon_name: 'Garchomp', kos_dealt: 3, was_koed: false }] },
          { player_id: 'p2', player_name: 'Bob', pokemon: [] },
        ],
      },
      {
        game_number: 2,
        winner_id: 'p2',
        players: [
          { player_id: 'p1', player_name: 'Alice', pokemon: [{ pokemon_name: 'Pikachu', kos_dealt: 0, was_koed: true }] },
          { player_id: 'p2', player_name: 'Bob', pokemon: [{ pokemon_name: 'Charizard', kos_dealt: 1, was_koed: false }] },
        ],
      },
    ];

    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-1',
      tournament_name: 'Cup',
      round_name: 'R1',
      game_stats: multiGameStats,
    }), { ...NO_SPOILERS, show_pokemon_details: true }, 'en');

    expect(embed.description).toContain('**Game 1:**');
    expect(embed.description).toContain('**Game 2:**');
  });

  it('omits Game N header for single game', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '1-0',
      tournament_name: 'Cup',
      round_name: 'R1',
      game_stats: sampleGameStats,
    }), { ...NO_SPOILERS, show_pokemon_details: true }, 'en');

    expect(embed.description).not.toContain('**Game 1:**');
  });
});

// ── German (webhook language 'de', i18n-core §6.2) ──────────────────

describe('buildEmbed — German', () => {
  it('translates match_result copy, the round name and Pokémon names', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'match_result',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-1',
      tournament_name: 'Frühlingscup',
      round_name: 'Round 3',
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1',
      game_stats: sampleGameStats,
    }), { ...NO_SPOILERS, show_replay_link: true, show_pokemon_details: true }, 'de');

    expect(embed.title).toBe('Ergebnis eingereicht – Frühlingscup');
    expect(embed.description).toContain('Runde 3');
    expect(embed.description).toContain('**Alice** 2:1 **Bob**');
    expect(embed.description).toContain('[Replay ansehen](https://replay.pokemonshowdown.com/gen9ou-1)');
    expect(embed.description).toContain('Knakrack 2');
    expect(embed.description).toContain('Glurak 1 (X)');
    expect(embed.description).not.toContain('Garchomp');
  });

  it('uses "Partie N" headers for multi-game stats', () => {
    const twoGames: GamePokemonStats[] = [sampleGameStats[0], { ...sampleGameStats[0], game_number: 2 }];
    const { embed } = buildEmbed(makePayload({
      kind: 'match_confirmed',
      player_1_name: 'Alice',
      player_2_name: 'Bob',
      winner_name: 'Alice',
      game_score: '2-0',
      tournament_name: 'Cup',
      game_stats: twoGames,
    }), { ...NO_SPOILERS, show_pokemon_details: true }, 'de');

    expect(embed.title).toBe('Spiel bestätigt – Cup');
    expect(embed.description).toContain('**Partie 1:**');
    expect(embed.description).toContain('**Partie 2:**');
  });

  it('pluralizes round_generated in German', () => {
    const one = buildEmbed(makePayload({
      kind: 'round_generated',
      tournament_name: 'Cup',
      round_name: 'Finals',
      pairings: [{ player_1_name: 'Alice', player_2_name: 'Bob' }],
    }), undefined, 'de').embed;
    const two = buildEmbed(makePayload({
      kind: 'round_generated',
      tournament_name: 'Cup',
      round_name: 'Round 2',
      pairings: [
        { player_1_name: 'Alice', player_2_name: 'Bob' },
        { player_1_name: 'Carol', player_2_name: 'Dave' },
      ],
    }), undefined, 'de').embed;

    expect(one.title).toBe('Finale – Cup');
    expect(one.description).toContain('Neue Runde mit 1 Spiel ausgelost:');
    expect(one.description).toContain('• Alice vs. Bob');
    expect(two.title).toBe('Runde 2 – Cup');
    expect(two.description).toContain('Neue Runde mit 2 Spielen ausgelost:');
  });

  it('translates draft_pick fields, the ping and the footer', () => {
    const { embed, content } = buildEmbed(makePayload({
      kind: 'draft_pick',
      player_name: 'Alice',
      pokemon_name: 'Garchomp',
      pick_number: 3,
      round: 1,
      season_name: 'Saison 5',
      next_picker_discord_id: '123456789',
      next_picker_name: 'Bob',
    }), { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: true }, 'de');

    expect(embed.title).toBe('Draft-Pick – Saison 5');
    expect(embed.description).toBe('**Alice** hat **Knakrack** gepickt');
    expect(embed.fields).toEqual([
      { name: 'Runde', value: '1', inline: true },
      { name: 'Pick-Nr.', value: '3', inline: true },
    ]);
    expect(content).toBe('<@123456789> – du bist als Nächstes dran!');
    expect(embed.footer).toEqual({ text: 'Nächster Pick: Bob' });
  });

  it('shows catalog achievement text by key, and DB text for keyless achievements', () => {
    const keyed = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      achievement_key: 'first_win',
      player_name: 'Alice',
      achievement_name: 'First Win',
      achievement_tier: 'gold',
      achievement_icon: null,
      achievement_description: 'Win your first match.',
      tournament_name: 'Cup',
    }), undefined, 'de').embed;
    const custom = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      player_name: 'Alice',
      achievement_name: 'Hausregel',
      achievement_tier: 'gold',
      achievement_icon: null,
      achievement_description: 'Vom Admin angelegt.',
      tournament_name: 'Cup',
    }), undefined, 'de').embed;

    expect(keyed.title).toBe('Erfolg freigeschaltet – Cup');
    expect(keyed.description).toContain('**Alice** hat **Erster Sieg** freigeschaltet');
    expect(keyed.description).toContain('Gewinne dein erstes Spiel.');
    expect(custom.description).toContain('**Hausregel**');
    expect(custom.description).toContain('Vom Admin angelegt.');
  });

  it('keeps the English catalog text for a keyed achievement in English', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'achievement_unlocked',
      achievement_key: 'first_win',
      player_name: 'Alice',
      achievement_name: 'First Win (DB)',
      achievement_tier: 'gold',
      achievement_icon: null,
      achievement_description: 'DB text',
      tournament_name: 'Cup',
    }), undefined, 'en');

    expect(embed.description).not.toContain('DB text');
    expect(embed.description).toContain('**Alice** earned **');
  });

  it('translates streaks, ratings and season advancement', () => {
    const streak = buildEmbed(makePayload({
      kind: 'streak_milestone',
      player_name: 'Alice',
      streak_type: 'win',
      streak_count: 5,
      tournament_name: 'Cup',
    }), undefined, 'de').embed;
    const broken = buildEmbed(makePayload({
      kind: 'streak_broken',
      breaker_name: 'Bob',
      broken_player_name: 'Alice',
      streak_count: 5,
      tournament_name: 'Cup',
    }), undefined, 'de').embed;
    const rating = buildEmbed(makePayload({
      kind: 'rating_milestone',
      player_name: 'Alice',
      new_rating: 1523.456,
      threshold_name: 'Expert',
      tournament_name: 'Cup',
    }), undefined, 'de').embed;
    const advanced = buildEmbed(makePayload({
      kind: 'season_advanced',
      season_name: 'S1',
      source_stage: 'Gruppenphase',
      target_stage: 'Playoffs',
      advanced_count: 1,
      summary: '',
    }), undefined, 'de').embed;

    expect(streak.description).toBe('**Alice** hat eine Siegesserie von **5** Spielen!');
    expect(broken.description).toBe('**Bob** hat die Serie von **Alice** nach 5 Spielen beendet.');
    // A rating is never digit-grouped ("1.523" would read as 1.5 in German).
    expect(rating.description).toBe('**Alice** hat **1523** erreicht (Expert).');
    expect(advanced.description).toContain('**1** Spieler ist von **Gruppenphase** in **Playoffs** weitergekommen.');
  });

  it('translates round_completed headers and points', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_completed',
      tournament_name: 'Cup',
      round_name: 'Round 3',
      round_number: 3,
      match_results: [{ player_1_name: 'Alice', player_2_name: 'Bob', score: '2:1', winner_name: 'Alice' }],
      standings: [{ position: 1, player_name: 'Alice', wins: 3, losses: 0, draws: 0, points: 9, position_change: 0 }],
    }), NO_SPOILERS, 'de');

    expect(embed.title).toBe('Runde 3 abgeschlossen! – Cup');
    expect(embed.description).toContain('**Ergebnisse**');
    expect(embed.description).toContain('**Tabelle**');
    expect(embed.description).toContain('1. Alice (3-0) 9 Pkt.');
  });

  it('leaves an admin-typed round name unchanged', () => {
    const { embed } = buildEmbed(makePayload({
      kind: 'round_generated',
      tournament_name: 'Cup',
      round_name: 'Spieltag 4',
      pairings: [],
    }), undefined, 'de');

    expect(embed.title).toBe('Spieltag 4 – Cup');
  });
});
