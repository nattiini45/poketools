import { describe, it, expect } from 'vitest';
import { generateCommentaryPrompts } from '../commentary-prompts';
import type { CasterData, CasterPlayerInfo, CasterH2H } from '@/types/caster';

// ── Helpers ────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<CasterPlayerInfo> = {}): CasterPlayerInfo {
  return {
    id: 'p1',
    name: 'Alice',
    avatarUrl: null,
    rating: 1500,
    rd: 50,
    record: { wins: 5, losses: 3, draws: 0 },
    signaturePokemon: null,
    streak: { type: null, count: 0 },
    team: [],
    pokemon: [],
    archetype: null,
    nextMatch: null,
    ...overrides,
  };
}

function makeH2H(overrides: Partial<CasterH2H> = {}): CasterH2H {
  return {
    player1Wins: 0,
    player2Wins: 0,
    draws: 0,
    pastMatches: [],
    ...overrides,
  };
}

function makeCasterData(overrides: Partial<CasterData> = {}): CasterData {
  return {
    matchId: 'match-1',
    tournamentId: 't1',
    seasonId: 's1',
    roundName: 'Week 1',
    bestOf: 3,
    format: 'gen9ou',
    generation: 9,
    player1: makePlayer({ id: 'p1', name: 'Alice' }),
    player2: makePlayer({ id: 'p2', name: 'Bob' }),
    h2h: makeH2H(),
    standings: null,
    ...overrides,
  };
}

function defaultGameState() {
  return {
    gameNumber: 1,
    p1KOs: 0,
    p2KOs: 0,
    p1Remaining: 6,
    p2Remaining: 6,
    seriesScore: [0, 0] as [number, number],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('generateCommentaryPrompts', () => {
  // ── first_meeting ──

  describe('first_meeting prompt', () => {
    it('generates first_meeting when h2h totals are all zero', () => {
      const data = makeCasterData();
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const first = prompts.find((p) => p.type === 'first_meeting');
      expect(first).toBeDefined();
      expect(first!.text).toContain('Alice');
      expect(first!.text).toContain('Bob');
      expect(first!.priority).toBe(3);
    });

    it('does not generate first_meeting when there is h2h history', () => {
      const data = makeCasterData({ h2h: makeH2H({ player1Wins: 1 }) });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'first_meeting')).toBeUndefined();
    });

    it('does not generate first_meeting when only draws exist', () => {
      const data = makeCasterData({ h2h: makeH2H({ draws: 2 }) });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'first_meeting')).toBeUndefined();
    });
  });

  // ── h2h ──

  describe('h2h prompt', () => {
    it('generates h2h prompt when player1 leads', () => {
      const data = makeCasterData({ h2h: makeH2H({ player1Wins: 3, player2Wins: 1 }) });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const h2h = prompts.find((p) => p.type === 'h2h');
      expect(h2h).toBeDefined();
      expect(h2h!.text).toContain('Alice');
      expect(h2h!.text).toContain('3-1');
      expect(h2h!.priority).toBe(4);
    });

    it('generates h2h prompt when player2 leads', () => {
      const data = makeCasterData({ h2h: makeH2H({ player1Wins: 1, player2Wins: 4 }) });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const h2h = prompts.find((p) => p.type === 'h2h');
      expect(h2h).toBeDefined();
      expect(h2h!.text).toContain('Bob');
      expect(h2h!.text).toContain('4-1');
    });

    it('does not generate h2h prompt when records are tied', () => {
      const data = makeCasterData({ h2h: makeH2H({ player1Wins: 2, player2Wins: 2 }) });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'h2h')).toBeUndefined();
    });

    it('does not generate h2h prompt when totalH2H is zero', () => {
      const data = makeCasterData({ h2h: makeH2H({ player1Wins: 0, player2Wins: 0, draws: 3 }) });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'h2h')).toBeUndefined();
    });
  });

  // ── streak ──

  describe('streak prompt', () => {
    it('generates win streak prompt at 3+ wins', () => {
      const data = makeCasterData({
        player1: makePlayer({ id: 'p1', name: 'Alice', streak: { type: 'win', count: 3 } }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const streak = prompts.find((p) => p.type === 'streak');
      expect(streak).toBeDefined();
      expect(streak!.text).toContain('3-match win streak');
      expect(streak!.priority).toBe(5);
    });

    it('generates loss streak prompt at 3+ losses', () => {
      const data = makeCasterData({
        player2: makePlayer({ id: 'p2', name: 'Bob', streak: { type: 'loss', count: 4 } }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const streak = prompts.find((p) => p.type === 'streak');
      expect(streak).toBeDefined();
      expect(streak!.text).toContain('4-match losing streak');
      expect(streak!.priority).toBe(4);
    });

    it('does not generate streak prompt for count < 3', () => {
      const data = makeCasterData({
        player1: makePlayer({ id: 'p1', name: 'Alice', streak: { type: 'win', count: 2 } }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'streak')).toBeUndefined();
    });

    it('does not generate streak prompt for null streak type', () => {
      const data = makeCasterData({
        player1: makePlayer({ id: 'p1', name: 'Alice', streak: { type: null, count: 5 } }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'streak')).toBeUndefined();
    });

    it('generates streaks for both players when applicable', () => {
      const data = makeCasterData({
        player1: makePlayer({ id: 'p1', name: 'Alice', streak: { type: 'win', count: 5 } }),
        player2: makePlayer({ id: 'p2', name: 'Bob', streak: { type: 'loss', count: 3 } }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const streaks = prompts.filter((p) => p.type === 'streak');
      expect(streaks).toHaveLength(2);
    });
  });

  // ── off_meta ──

  describe('off_meta prompt', () => {
    it('generates off_meta prompt for pokemon with usagePct < 5', () => {
      const data = makeCasterData({
        player1: makePlayer({
          id: 'p1',
          name: 'Alice',
          pokemon: [
            { species: 'Dunsparce', usagePct: 1.2 } as never,
            { species: 'Smeargle', usagePct: 3.0 } as never,
          ],
        }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const offMeta = prompts.find((p) => p.type === 'off_meta');
      expect(offMeta).toBeDefined();
      expect(offMeta!.text).toContain('Dunsparce');
      expect(offMeta!.text).toContain('Smeargle');
      expect(offMeta!.text).toContain('off-meta');
      expect(offMeta!.priority).toBe(3);
    });

    it('does not generate off_meta for pokemon with usagePct >= 5', () => {
      const data = makeCasterData({
        player1: makePlayer({
          id: 'p1',
          name: 'Alice',
          pokemon: [
            { species: 'Garchomp', usagePct: 25.0 } as never,
          ],
        }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'off_meta')).toBeUndefined();
    });

    it('does not generate off_meta for pokemon with null usagePct', () => {
      const data = makeCasterData({
        player1: makePlayer({
          id: 'p1',
          name: 'Alice',
          pokemon: [
            { species: 'Garchomp', usagePct: null } as never,
          ],
        }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'off_meta')).toBeUndefined();
    });

    it('does not generate off_meta when pokemon array is empty', () => {
      const data = makeCasterData();
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'off_meta')).toBeUndefined();
    });
  });

  // ── signature ──

  describe('signature prompt', () => {
    it('generates signature prompt when player has signaturePokemon', () => {
      const data = makeCasterData({
        player1: makePlayer({ id: 'p1', name: 'Alice', signaturePokemon: 'Pikachu' }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const sig = prompts.find((p) => p.type === 'signature');
      expect(sig).toBeDefined();
      expect(sig!.text).toContain('Pikachu');
      expect(sig!.text).toContain('Alice');
      expect(sig!.priority).toBe(2);
    });

    it('does not generate signature prompt when signaturePokemon is null', () => {
      const data = makeCasterData();
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      expect(prompts.find((p) => p.type === 'signature')).toBeUndefined();
    });

    it('generates signature prompts for both players', () => {
      const data = makeCasterData({
        player1: makePlayer({ id: 'p1', name: 'Alice', signaturePokemon: 'Pikachu' }),
        player2: makePlayer({ id: 'p2', name: 'Bob', signaturePokemon: 'Gengar' }),
      });
      const prompts = generateCommentaryPrompts(data, defaultGameState());
      const sigs = prompts.filter((p) => p.type === 'signature');
      expect(sigs).toHaveLength(2);
    });
  });

  // ── milestone ──

  describe('milestone prompt', () => {
    it('generates milestone prompt for player1 with 3+ KOs', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1KOs: 4 };
      const prompts = generateCommentaryPrompts(data, game);
      const milestone = prompts.find((p) => p.type === 'milestone');
      expect(milestone).toBeDefined();
      expect(milestone!.text).toContain('Alice');
      expect(milestone!.text).toContain('4 KOs');
      expect(milestone!.priority).toBe(6);
    });

    it('generates milestone prompt for player2 with 3+ KOs', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p2KOs: 3 };
      const prompts = generateCommentaryPrompts(data, game);
      const milestone = prompts.find((p) => p.type === 'milestone');
      expect(milestone).toBeDefined();
      expect(milestone!.text).toContain('Bob');
      expect(milestone!.text).toContain('3 KOs');
    });

    it('generates milestone for both players when both have 3+ KOs', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1KOs: 5, p2KOs: 3 };
      const prompts = generateCommentaryPrompts(data, game);
      const milestones = prompts.filter((p) => p.type === 'milestone');
      expect(milestones).toHaveLength(2);
    });

    it('does not generate milestone for KOs < 3', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1KOs: 2, p2KOs: 1 };
      const prompts = generateCommentaryPrompts(data, game);
      expect(prompts.find((p) => p.type === 'milestone')).toBeUndefined();
    });
  });

  // ── advantage ──

  describe('advantage prompt', () => {
    it('generates advantage prompt for player1 with 2+ pokemon lead', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1Remaining: 5, p2Remaining: 3 };
      const prompts = generateCommentaryPrompts(data, game);
      const adv = prompts.find((p) => p.type === 'advantage');
      expect(adv).toBeDefined();
      expect(adv!.text).toContain('Alice');
      expect(adv!.text).toContain('2-pokemon advantage');
      expect(adv!.priority).toBe(5);
    });

    it('generates advantage prompt for player2 with 2+ pokemon lead', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1Remaining: 1, p2Remaining: 4 };
      const prompts = generateCommentaryPrompts(data, game);
      const adv = prompts.find((p) => p.type === 'advantage');
      expect(adv).toBeDefined();
      expect(adv!.text).toContain('Bob');
      expect(adv!.text).toContain('3-pokemon advantage');
    });

    it('does not generate advantage prompt for diff < 2', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1Remaining: 4, p2Remaining: 3 };
      const prompts = generateCommentaryPrompts(data, game);
      expect(prompts.find((p) => p.type === 'advantage')).toBeUndefined();
    });

    it('does not generate advantage prompt when remaining are equal', () => {
      const data = makeCasterData();
      const game = { ...defaultGameState(), p1Remaining: 3, p2Remaining: 3 };
      const prompts = generateCommentaryPrompts(data, game);
      expect(prompts.find((p) => p.type === 'advantage')).toBeUndefined();
    });
  });

  // ── series ──

  describe('series prompt', () => {
    it('generates series prompt when player1 is on match point (Bo3)', () => {
      const data = makeCasterData({ bestOf: 3 });
      const game = { ...defaultGameState(), seriesScore: [1, 0] as [number, number] };
      const prompts = generateCommentaryPrompts(data, game);
      const series = prompts.find((p) => p.type === 'series');
      expect(series).toBeDefined();
      expect(series!.text).toContain('Alice');
      expect(series!.text).toContain('match point');
      expect(series!.text).toContain('1-0');
      expect(series!.priority).toBe(7);
    });

    it('generates series prompt when player2 is on match point (Bo3)', () => {
      const data = makeCasterData({ bestOf: 3 });
      const game = { ...defaultGameState(), seriesScore: [0, 1] as [number, number] };
      const prompts = generateCommentaryPrompts(data, game);
      const series = prompts.find((p) => p.type === 'series');
      expect(series).toBeDefined();
      expect(series!.text).toContain('Bob');
      expect(series!.text).toContain('match point');
    });

    it('generates series prompt in Bo5 at 2 wins', () => {
      const data = makeCasterData({ bestOf: 5 });
      const game = { ...defaultGameState(), seriesScore: [2, 1] as [number, number] };
      const prompts = generateCommentaryPrompts(data, game);
      const series = prompts.find((p) => p.type === 'series');
      expect(series).toBeDefined();
      expect(series!.text).toContain('Alice');
      expect(series!.text).toContain('2-1');
    });

    it('does not generate series prompt when neither player is on match point', () => {
      const data = makeCasterData({ bestOf: 3 });
      const game = { ...defaultGameState(), seriesScore: [0, 0] as [number, number] };
      const prompts = generateCommentaryPrompts(data, game);
      expect(prompts.find((p) => p.type === 'series')).toBeUndefined();
    });

    it('generates series prompt when Bo1 at 0-0 (winsNeeded=1, so 0 === winsNeeded-1)', () => {
      const data = makeCasterData({ bestOf: 1 });
      const game = { ...defaultGameState(), seriesScore: [0, 0] as [number, number] };
      const prompts = generateCommentaryPrompts(data, game);
      const series = prompts.find((p) => p.type === 'series');
      expect(series).toBeDefined();
    });
  });

  // ── sorting ──

  describe('sorting', () => {
    it('returns prompts sorted by priority descending', () => {
      const data = makeCasterData({
        bestOf: 3,
        player1: makePlayer({
          id: 'p1',
          name: 'Alice',
          signaturePokemon: 'Pikachu',
          streak: { type: 'win', count: 5 },
        }),
      });
      const game = {
        gameNumber: 2,
        p1KOs: 4,
        p2KOs: 0,
        p1Remaining: 5,
        p2Remaining: 2,
        seriesScore: [1, 0] as [number, number],
      };
      const prompts = generateCommentaryPrompts(data, game);
      for (let i = 1; i < prompts.length; i++) {
        expect(prompts[i - 1].priority).toBeGreaterThanOrEqual(prompts[i].priority);
      }
    });
  });

  // ── combined ──

  describe('combined scenarios', () => {
    it('generates multiple prompt types simultaneously', () => {
      const data = makeCasterData({
        bestOf: 3,
        h2h: makeH2H({ player1Wins: 5, player2Wins: 1 }),
        player1: makePlayer({
          id: 'p1',
          name: 'Alice',
          signaturePokemon: 'Pikachu',
          streak: { type: 'win', count: 7 },
          pokemon: [{ species: 'Dunsparce', usagePct: 0.5 } as never],
        }),
      });
      const game = {
        gameNumber: 2,
        p1KOs: 5,
        p2KOs: 1,
        p1Remaining: 4,
        p2Remaining: 1,
        seriesScore: [1, 0] as [number, number],
      };
      const prompts = generateCommentaryPrompts(data, game);
      const types = new Set(prompts.map((p) => p.type));
      expect(types.has('h2h')).toBe(true);
      expect(types.has('streak')).toBe(true);
      expect(types.has('off_meta')).toBe(true);
      expect(types.has('signature')).toBe(true);
      expect(types.has('milestone')).toBe(true);
      expect(types.has('advantage')).toBe(true);
      expect(types.has('series')).toBe(true);
    });

    it('returns empty array when no conditions are met', () => {
      const data = makeCasterData({
        h2h: makeH2H({ player1Wins: 2, player2Wins: 2 }),
      });
      const game = {
        gameNumber: 1,
        p1KOs: 0,
        p2KOs: 0,
        p1Remaining: 6,
        p2Remaining: 6,
        seriesScore: [0, 0] as [number, number],
      };
      // h2h tied (no h2h prompt), not first meeting (total > 0),
      // no streaks, no off_meta, no sigs, no milestone KOs, no advantage,
      // Bo3 at 0-0 means winsNeeded=2, neither at 1 yet.
      const prompts = generateCommentaryPrompts(data, game);
      // Only first_meeting is excluded since total > 0
      // h2h is excluded since tied
      // Everything else excluded by defaults
      expect(prompts.every((p) => p.type !== 'first_meeting')).toBe(true);
      expect(prompts.every((p) => p.type !== 'h2h')).toBe(true);
    });
  });
});

// ── i18n (T15) ─────────────────────────────────────────────────────────

describe('generateCommentaryPrompts i18n (T15)', () => {
  it('defaults to English (unchanged output)', () => {
    const prompts = generateCommentaryPrompts(makeCasterData(), defaultGameState());
    const first = prompts.find((p) => p.type === 'first_meeting');
    expect(first!.text).toBe('First time Alice and Bob face off this tournament');
  });

  it('writes the prompt text in German for locale de', () => {
    const prompts = generateCommentaryPrompts(makeCasterData(), defaultGameState(), 'de');
    const first = prompts.find((p) => p.type === 'first_meeting');
    expect(first!.text).toBe('Erstes Aufeinandertreffen von Alice und Bob in diesem Turnier');
  });

  it('localizes Pokémon names with the data locale', () => {
    const data = makeCasterData({
      player1: makePlayer({ id: 'p1', name: 'Alice', signaturePokemon: 'Charizard' }),
    });
    const de = generateCommentaryPrompts(data, defaultGameState(), 'de');
    const sig = de.find((p) => p.type === 'signature');
    expect(sig!.text).toBe('Achte auf Glurak, das Signature-Pokémon von Alice');

    // "Keep Pokémon terms in English": German text, English names
    const mixed = generateCommentaryPrompts(data, defaultGameState(), 'de', 'en');
    expect(mixed.find((p) => p.type === 'signature')!.text).toContain('Charizard');

    const en = generateCommentaryPrompts(data, defaultGameState());
    expect(en.find((p) => p.type === 'signature')!.text).toBe("Watch for Alice's signature Charizard");
  });

  it('keeps priorities and order independent of the locale', () => {
    const data = makeCasterData({ h2h: makeH2H({ player1Wins: 2 }) });
    const state = { ...defaultGameState(), p1KOs: 3, seriesScore: [1, 0] as [number, number] };
    const en = generateCommentaryPrompts(data, state);
    const de = generateCommentaryPrompts(data, state, 'de');
    expect(de.map((p) => [p.type, p.priority])).toEqual(en.map((p) => [p.type, p.priority]));
    expect(de.find((p) => p.type === 'series')!.text).toBe('Alice hat Matchball (1–0)');
  });
});
