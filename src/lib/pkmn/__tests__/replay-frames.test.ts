import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @pkmn dependencies ────────────────────────────────────────

const mockBattleInstance = {
  add: vi.fn(),
  p1: {
    name: 'Player1',
    active: [null as unknown],
    team: [] as unknown[],
    sideConditions: {},
  },
  p2: {
    name: 'Player2',
    active: [null as unknown],
    team: [] as unknown[],
    sideConditions: {},
  },
  field: {
    weather: null as string | null,
    terrain: null as string | null,
    pseudoWeather: {},
  },
};

vi.mock('@pkmn/dex', () => ({ Dex: {} }));
vi.mock('@pkmn/data', () => ({ Generations: function () { return {}; } }));
vi.mock('@pkmn/client', () => ({
  Battle: function () { return mockBattleInstance; },
}));
vi.mock('@pkmn/protocol', () => ({
  Protocol: {
    parseBattleLine: vi.fn((line: string) => {
      const parts = line.split('|').filter(Boolean);
      if (parts.length === 0) return { args: null, kwArgs: {} };
      const cmd = parts[0];
      const args = [cmd, ...parts.slice(1)];
      const kwArgs: Record<string, string | true> = {};
      const remaining = parts.slice(1).join('|');
      const fromMatch = remaining.match(/\[from\]\s*([^[\]|]+)/);
      if (fromMatch) kwArgs.from = fromMatch[1].trim();
      const ofMatch = remaining.match(/\[of\]\s*([^[\]|]+)/);
      if (ofMatch) kwArgs.of = ofMatch[1].trim();
      if (remaining.includes('[upkeep]')) kwArgs.upkeep = true;
      return { args, kwArgs };
    }),
  },
}));

vi.mock('../replay', () => ({
  fetchReplay: vi.fn(),
}));

import { extractBattleFrames, getReplayFrames } from '../replay-frames';
import { fetchReplay } from '../replay';

describe('extractBattleFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBattleInstance.p1.active = [null];
    mockBattleInstance.p2.active = [null];
    mockBattleInstance.p1.team = [];
    mockBattleInstance.p2.team = [];
    mockBattleInstance.p1.sideConditions = {};
    mockBattleInstance.p2.sideConditions = {};
    mockBattleInstance.field.weather = null;
    mockBattleInstance.field.terrain = null;
    mockBattleInstance.field.pseudoWeather = {};
  });

  it('produces at least one frame even with minimal log', () => {
    const frames = extractBattleFrames('|start');
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].turn).toBe(0);
  });

  it('produces frame 0 before turn 1 and frame for each subsequent turn', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|turn|2',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    // Frame 0 (initial), frame for turn 1, final frame with winner
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0].turn).toBe(0);
  });

  it('captures switch events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const switchEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'switch');
    expect(switchEvent).toBeDefined();
    if (switchEvent?.type === 'switch') {
      expect(switchEvent.pokemonIn).toBe('Pikachu');
      expect(switchEvent.side).toBe(0);
    }
  });

  it('captures p2 switch events with correct side index', () => {
    const log = [
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|win|Player2',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const switchEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'switch');
    expect(switchEvent).toBeDefined();
    if (switchEvent?.type === 'switch') {
      expect(switchEvent.side).toBe(1);
    }
  });

  it('captures move events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const moveEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'move');
    expect(moveEvent).toBeDefined();
    if (moveEvent?.type === 'move') {
      expect(moveEvent.move).toBe('Thunderbolt');
      expect(moveEvent.pokemon).toBe('Pikachu');
      expect(moveEvent.target).toBe('Charizard');
    }
  });

  it('captures damage events with HP parsing', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|-damage|p2a: Charizard|50/200',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const dmgEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'damage');
    expect(dmgEvent).toBeDefined();
    if (dmgEvent?.type === 'damage') {
      expect(dmgEvent.hp).toBe(25); // 50/200 = 25%
    }
  });

  it('captures faint damage (0 fnt) as 0 HP', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|-damage|p2a: Charizard|0 fnt',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const dmgEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'damage');
    expect(dmgEvent).toBeDefined();
    if (dmgEvent?.type === 'damage') {
      expect(dmgEvent.hp).toBe(0);
    }
  });

  it('captures heal events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-heal|p1a: Pikachu|90/100',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const healEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'heal');
    expect(healEvent).toBeDefined();
    if (healEvent?.type === 'heal') {
      expect(healEvent.hp).toBe(90);
    }
  });

  it('captures faint events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|faint|p2a: Charizard',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const faintEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'faint');
    expect(faintEvent).toBeDefined();
    if (faintEvent?.type === 'faint') {
      expect(faintEvent.pokemon).toBe('Charizard');
      expect(faintEvent.side).toBe(1);
    }
  });

  it('captures status events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-status|p1a: Pikachu|par',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const statusEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'status');
    expect(statusEvent).toBeDefined();
    if (statusEvent?.type === 'status') {
      expect(statusEvent.status).toBe('par');
    }
  });

  it('captures cure-status events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-curestatus|p1a: Pikachu|par',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const cureEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'cure-status');
    expect(cureEvent).toBeDefined();
  });

  it('captures boost and unboost events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-boost|p1a: Pikachu|atk|2',
      '|-unboost|p1a: Pikachu|def|1',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const boosts = frames.flatMap((f) => f.events).filter((e) => e.type === 'boost');
    expect(boosts.length).toBe(2);
    if (boosts[0].type === 'boost') {
      expect(boosts[0].stat).toBe('atk');
      expect(boosts[0].amount).toBe(2);
    }
    if (boosts[1].type === 'boost') {
      expect(boosts[1].stat).toBe('def');
      expect(boosts[1].amount).toBe(-1);
    }
  });

  it('captures weather events (non-upkeep only)', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-weather|Sandstorm',
      '|turn|2',
      '|-weather|Sandstorm|[upkeep]',
      '|-weather|none',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const weatherEvents = frames.flatMap((f) => f.events).filter((e) => e.type === 'weather');
    // Only non-upkeep weather events should be captured
    expect(weatherEvents.length).toBeGreaterThanOrEqual(1);
    // The "none" weather should set weather to null
    const noneEvent = weatherEvents.find((e) => e.type === 'weather' && e.weather === null);
    expect(noneEvent).toBeDefined();
  });

  it('captures the weather setter (ability + Pokémon) for ability-set weather', () => {
    const log = [
      '|switch|p1a: Vulpix|Vulpix, L50|100/100',
      '|-weather|SunnyDay|[from] ability: Drought|[of] p1a: Vulpix',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const weatherEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'weather');
    expect(weatherEvent).toBeDefined();
    if (weatherEvent?.type === 'weather') {
      expect(weatherEvent.weather).toBe('SunnyDay');
      expect(weatherEvent.from).toBe('ability: Drought');
      expect(weatherEvent.of).toBe('Vulpix');
    }
  });

  it('leaves weather setter undefined for move-set weather', () => {
    const log = [
      '|switch|p1a: Torkoal|Torkoal, L50|100/100',
      '|turn|1',
      '|move|p1a: Torkoal|Sunny Day',
      '|-weather|SunnyDay',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const weatherEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'weather');
    expect(weatherEvent).toBeDefined();
    if (weatherEvent?.type === 'weather') {
      expect(weatherEvent.from).toBeUndefined();
      expect(weatherEvent.of).toBeUndefined();
    }
  });

  it('captures the terrain setter for surge-ability terrain', () => {
    const log = [
      '|switch|p1a: Rillaboom|Rillaboom, L50|100/100',
      '|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p1a: Rillaboom',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const terrainEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'terrain');
    expect(terrainEvent).toBeDefined();
    if (terrainEvent?.type === 'terrain') {
      expect(terrainEvent.terrain).toBe('Grassy');
      expect(terrainEvent.from).toBe('ability: Grassy Surge');
      expect(terrainEvent.of).toBe('Rillaboom');
    }
  });

  it('captures terrain start and end events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-fieldstart|move: Electric Terrain',
      '|turn|2',
      '|-fieldend|move: Electric Terrain',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const terrainEvents = frames.flatMap((f) => f.events).filter((e) => e.type === 'terrain');
    expect(terrainEvents.length).toBe(2);
    if (terrainEvents[0].type === 'terrain') {
      expect(terrainEvents[0].terrain).toBe('Electric');
    }
    if (terrainEvents[1].type === 'terrain') {
      expect(terrainEvents[1].terrain).toBeNull();
    }
  });

  it('captures side-condition start and end events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-sidestart|p2: Player2|move: Stealth Rock',
      '|turn|2',
      '|-sideend|p2: Player2|move: Stealth Rock',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const sideEvents = frames.flatMap((f) => f.events).filter((e) => e.type === 'side-condition');
    expect(sideEvents.length).toBe(2);
    if (sideEvents[0].type === 'side-condition') {
      expect(sideEvents[0].condition).toBe('Stealth Rock');
      expect(sideEvents[0].action).toBe('start');
    }
    if (sideEvents[1].type === 'side-condition') {
      expect(sideEvents[1].action).toBe('end');
    }
  });

  it('captures mega evolution events', () => {
    const log = [
      '|switch|p1a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|-mega|p1a: Charizard|Charizard|Charizardite X',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const megaEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'mega');
    expect(megaEvent).toBeDefined();
    if (megaEvent?.type === 'mega') {
      expect(megaEvent.pokemon).toBe('Charizard');
    }
  });

  it('captures terastallize events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-terastallize|p1a: Pikachu|Electric',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const teraEvent = frames.flatMap((f) => f.events).find((e) => e.type === 'terastallize');
    expect(teraEvent).toBeDefined();
    if (teraEvent?.type === 'terastallize') {
      expect(teraEvent.teraType).toBe('Electric');
    }
  });

  it('captures drag events as switch events', () => {
    const log = [
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|drag|p2a: Pikachu|Pikachu, L50|100/100',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const switchEvents = frames.flatMap((f) => f.events).filter((e) => e.type === 'switch');
    expect(switchEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('sets winner on final frame when |win| is present', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    const lastFrame = frames[frames.length - 1];
    expect(lastFrame.winner).toBe('Player1');
  });

  it('handles log with no turns (edge case)', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
    ].join('\n');

    const frames = extractBattleFrames(log);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].turn).toBe(0);
  });

  it('ignores non-| lines', () => {
    const log = [
      'preamble',
      '',
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const frames = extractBattleFrames(log);
    expect(frames.length).toBeGreaterThanOrEqual(1);
  });

  it('handles non-terrain fieldstart/fieldend gracefully', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|turn|1',
      '|-fieldstart|move: Trick Room',
      '|-fieldend|move: Trick Room',
      '|win|Player1',
    ].join('\n');

    // Trick Room doesn't have "Terrain" in the name, so no terrain events
    const frames = extractBattleFrames(log);
    const terrainEvents = frames.flatMap((f) => f.events).filter((e) => e.type === 'terrain');
    expect(terrainEvents.length).toBe(0);
  });
});

describe('getReplayFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBattleInstance.p1.active = [null];
    mockBattleInstance.p2.active = [null];
    mockBattleInstance.p1.team = [];
    mockBattleInstance.p2.team = [];
    mockBattleInstance.p1.sideConditions = {};
    mockBattleInstance.p2.sideConditions = {};
    mockBattleInstance.field.weather = null;
    mockBattleInstance.field.terrain = null;
    mockBattleInstance.field.pseudoWeather = {};
  });

  it('fetches replay and returns frames + meta', async () => {
    const mockFetchReplay = vi.mocked(fetchReplay);
    mockFetchReplay.mockResolvedValueOnce({
      id: 'gen9ou-123',
      format: 'gen9ou',
      players: ['Alice', 'Bob'],
      winner: 'Alice',
      log: '|switch|p1a: Pikachu|Pikachu, L50|100/100\n|turn|1\n|win|Alice',
    });

    const result = await getReplayFrames('gen9ou-123');
    expect(result.meta).toEqual({
      id: 'gen9ou-123',
      format: 'gen9ou',
      players: ['Alice', 'Bob'],
      winner: 'Alice',
    });
    expect(result.frames.length).toBeGreaterThanOrEqual(1);
  });
});
