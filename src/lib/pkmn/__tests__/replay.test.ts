import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @pkmn dependencies ────────────────────────────────────────

const mockBattle = {
  add: vi.fn(),
  p1: { name: 'Player1' },
  p2: { name: 'Player2' },
};

vi.mock('@pkmn/dex', () => ({ Dex: {} }));
vi.mock('@pkmn/data', () => ({ Generations: function () { return {}; } }));
vi.mock('@pkmn/client', () => ({
  Battle: function () { return mockBattle; },
}));
vi.mock('@pkmn/protocol', () => ({
  Protocol: {
    parseBattleLine: vi.fn((line: string) => {
      // Minimal parser that extracts the command and args from PS protocol lines
      const parts = line.split('|').filter(Boolean);
      if (parts.length === 0) return { args: null, kwArgs: {} };

      const cmd = parts[0];
      const args = [cmd, ...parts.slice(1)];

      // Parse kwArgs: [from] xxx [of] yyy
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

// ─── Mock global fetch for fetchReplay ──────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchReplay, normalizeReplayUrlOrId, parseReplayLog } from '../replay';

describe('normalizeReplayUrlOrId', () => {
  it('strips URL hash fragments', () => {
    expect(normalizeReplayUrlOrId('https://replay.pokemonshowdown.com/gen9ou-123#turn-5')).toBe(
      'gen9ou-123',
    );
  });

  it('strips URL query strings', () => {
    expect(normalizeReplayUrlOrId('https://replay.pokemonshowdown.com/gen9ou-123?foo=bar')).toBe(
      'gen9ou-123',
    );
  });

  it('strips both query and fragment', () => {
    expect(
      normalizeReplayUrlOrId('https://replay.pokemonshowdown.com/gen9ou-123?foo=bar#turn-3'),
    ).toBe('gen9ou-123');
  });
});

describe('fetchReplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and parses a replay by bare ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'gen9ou-12345',
        format: 'gen9ou',
        players: ['Alice', 'Bob'],
        winner: 'Alice',
        log: '|start\n|win|Alice',
      }),
    });

    const result = await fetchReplay('gen9ou-12345');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://replay.pokemonshowdown.com/gen9ou-12345.json',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: 'no-store',
      })
    );
    expect(result).toEqual({
      id: 'gen9ou-12345',
      format: 'gen9ou',
      players: ['Alice', 'Bob'],
      winner: 'Alice',
      log: '|start\n|win|Alice',
    });
  });

  it('strips full URL to bare ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'gen9ou-99999',
        format: 'gen9ou',
        players: ['X', 'Y'],
        winner: 'X',
        log: '|win|X',
      }),
    });

    await fetchReplay('https://replay.pokemonshowdown.com/gen9ou-99999');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://replay.pokemonshowdown.com/gen9ou-99999.json',
      expect.anything()
    );
  });

  it('strips trailing .json from URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        format: 'gen9ou',
        players: ['A', 'B'],
        winner: 'A',
        log: '|win|A',
      }),
    });

    const result = await fetchReplay('https://replay.pokemonshowdown.com/gen9ou-123.json');
    // .json is stripped, so the ID passed to the URL is clean
    expect(result.id).toBe('gen9ou-123');
  });

  it('strips trailing slash from URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        format: 'gen9ou',
        players: ['A', 'B'],
        winner: 'A',
        log: '|win|A',
      }),
    });

    const result = await fetchReplay('https://replay.pokemonshowdown.com/gen9ou-456/');
    expect(result.id).toBe('gen9ou-456');
  });

  it('strips URL fragment and query before fetching', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'gen9ou-777',
        format: 'gen9ou',
        players: ['A', 'B'],
        winner: 'A',
        log: '|win|A',
      }),
    });

    await fetchReplay('https://replay.pokemonshowdown.com/gen9ou-777?ref=share#turn-12');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://replay.pokemonshowdown.com/gen9ou-777.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchReplay('nonexistent')).rejects.toThrow('Failed to fetch replay: 404 Not Found');
  });

  it('throws on invalid replay format (missing log)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ players: ['A', 'B'] }),
    });

    await expect(fetchReplay('bad-format')).rejects.toThrow('Invalid replay format');
  });

  it('throws on invalid replay format (missing players)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ log: '|start' }),
    });

    await expect(fetchReplay('bad-format')).rejects.toThrow('Invalid replay format');
  });

  it('uses fallback player names (p1/p2) when players array is sparse', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        format: 'gen9ou',
        players: [null, null],
        p1: 'FallbackP1',
        p2: 'FallbackP2',
        winner: 'FallbackP1',
        log: '|win|FallbackP1',
      }),
    });

    const result = await fetchReplay('test-fallback');
    expect(result.players).toEqual(['FallbackP1', 'FallbackP2']);
  });
});

describe('parseReplayLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBattle.p1.name = 'Player1';
    mockBattle.p2.name = 'Player2';
  });

  it('parses a minimal log with a win', () => {
    const log = [
      '|player|p1|Player1',
      '|player|p2|Player2',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
    expect(result.players.length).toBe(2);
  });

  it('tracks team preview (poke) and switch events', () => {
    const log = [
      '|poke|p1|Pikachu, L50, M|',
      '|poke|p2|Charizard, L50, M|',
      '|switch|p1a: Pikachu|Pikachu, L50, M|100/100',
      '|switch|p2a: Charizard|Charizard, L50, M|100/100',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const p1Pika = result.players[0].pokemon.find((p) => p.pokemon_name === 'Pikachu');
    expect(p1Pika).toBeDefined();
    expect(p1Pika!.was_brought).toBe(true);
    expect(p1Pika!.was_lead).toBe(true);
  });

  it('tracks move usage', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const pika = result.players[0].pokemon.find((p) => p.pokemon_name === 'Pikachu');
    expect(pika!.moves_used).toContain('Thunderbolt');
  });

  it('tracks turns_active for active pokemon', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|turn|2',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|turn|3',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const pika = result.players[0].pokemon.find((p) => p.pokemon_name === 'Pikachu');
    // Active for turns 1, 2, and 3 (incremented at each |turn|)
    expect(pika!.turns_active).toBeGreaterThanOrEqual(2);
  });

  it('tracks KOs and faint attribution', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|-damage|p2a: Charizard|0 fnt',
      '|faint|p2a: Charizard',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const pika = result.players[0].pokemon.find((p) => p.pokemon_name === 'Pikachu');
    const zard = result.players[1].pokemon.find((p) => p.pokemon_name === 'Charizard');
    expect(pika!.kos_dealt).toBe(1);
    expect(zard!.was_koed).toBe(true);
  });

  it('tracks hazard setup via -sidestart', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Stealth Rock|',
      '|-sidestart|p2: Player2|move: Stealth Rock',
      '|win|Player1',
    ].join('\n');

    // Should not crash and should still parse correctly
    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks weather setup and damage attribution', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Sandstorm|',
      '|-weather|Sandstorm',
      '|turn|2',
      '|-weather|Sandstorm|[upkeep]',
      '|-damage|p2a: Charizard|90/100|[from] Sandstorm',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks weather cleared to none', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|-weather|Sandstorm',
      '|turn|2',
      '|-weather|none',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks status infliction and cure', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunder Wave|p2a: Charizard',
      '|-status|p2a: Charizard|par',
      '|turn|2',
      '|-curestatus|p2a: Charizard|par',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks volatile starts and ends (Leech Seed)', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Leech Seed|p2a: Charizard',
      '|-start|p2a: Charizard|move: Leech Seed',
      '|turn|2',
      '|-end|p2a: Charizard|move: Leech Seed',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks Curse volatile', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Curse|p2a: Charizard',
      '|-start|p2a: Charizard|Curse',
      '|turn|2',
      '|-end|p2a: Charizard|Curse',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks partial trap moves', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Fire Spin|p2a: Charizard',
      '|-start|p2a: Charizard|move: Fire Spin',
      '|turn|2',
      '|-damage|p2a: Charizard|80/100|[from] move: Fire Spin',
      '|-end|p2a: Charizard|move: Fire Spin',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks Perish Song via -start perish3', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Perish Song|',
      '|-start|p1a: Pikachu|perish3',
      '|-start|p2a: Charizard|perish3',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('tracks Destiny Bond activation', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|-activate|p2a: Charizard|move: Destiny Bond',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles hazard removal via -sideend', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Stealth Rock|',
      '|-sidestart|p2: Player2|move: Stealth Rock',
      '|turn|2',
      '|move|p2a: Charizard|Rapid Spin|p1a: Pikachu',
      '|-sideend|p2: Player2|move: Stealth Rock',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles drag (forced switch) events', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|poke|p2|Bulbasaur, L50, M|',
      '|turn|1',
      '|move|p1a: Pikachu|Whirlwind|p2a: Charizard',
      '|drag|p2a: Bulbasaur|Bulbasaur, L50, M|100/100',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const bulba = result.players[1].pokemon.find((p) => p.pokemon_name === 'Bulbasaur');
    expect(bulba).toBeDefined();
    expect(bulba!.was_brought).toBe(true);
  });

  it('handles damage from items (Life Orb, Rocky Helmet)', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
      '|-damage|p2a: Charizard|50/100',
      '|-damage|p1a: Pikachu|90/100|[from] item: Life Orb',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles damage from abilities', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Tackle|p2a: Charizard',
      '|-damage|p2a: Charizard|80/100',
      '|-damage|p1a: Pikachu|85/100|[from] ability: Iron Barbs|[of] p2a: Charizard',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles recoil damage', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Wild Charge|p2a: Charizard',
      '|-damage|p2a: Charizard|50/100',
      '|-damage|p1a: Pikachu|80/100|[from] recoil',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles status from Toxic Spikes hazard', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Toxic Spikes|',
      '|-sidestart|p2: Player2|move: Toxic Spikes',
      '|turn|2',
      '|-status|p2a: Charizard|psn|[from] Toxic Spikes',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles status from contact ability (Flame Body)', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|move|p1a: Pikachu|Tackle|p2a: Charizard',
      '|-status|p1a: Pikachu|brn|[from] ability: Flame Body',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('handles non-parseable lines without crashing', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|some-unknown-protocol-line|blah',
      '|win|Player1',
    ].join('\n');

    // Should not throw — battle.add errors are caught
    mockBattle.add.mockImplementation((line: string) => {
      if (line.includes('unknown-protocol')) throw new Error('parse fail');
    });

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('uses side.name for player names', () => {
    mockBattle.p1.name = 'CustomName1';
    mockBattle.p2.name = 'CustomName2';

    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|win|CustomName1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.players[0].ps_username).toBe('CustomName1');
    expect(result.players[1].ps_username).toBe('CustomName2');
  });

  it('returns empty winner when no |win| line', () => {
    const log = [
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('');
  });

  it('skips non-| lines', () => {
    const log = [
      'Some preamble text',
      '',
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    expect(result.winner_ps_username).toBe('Player1');
  });

  it('merges team preview hidden species with real switch-in (Greninja-*)', () => {
    const log = [
      '|poke|p2|Greninja-*, F|',
      '|poke|p2|Kingambit, M|',
      '|poke|p2|Gallade, M|',
      '|poke|p2|Poliwrath, M|',
      '|poke|p2|Annihilape, M|',
      '|poke|p2|Sneasler, M|',
      '|switch|p2a: Greninja|Greninja, F|100/100',
      '|turn|1',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const greninja = result.players[1].pokemon.filter((p) =>
      p.pokemon_name.toLowerCase().includes('greninja'),
    );
    expect(greninja).toHaveLength(1);
    expect(greninja[0].pokemon_name).toBe('Greninja');
    expect(greninja[0].was_brought).toBe(true);
    expect(result.players[1].pokemon).toHaveLength(6);
  });

  it('keeps one Mimikyu tracker across detailschange and Volt Switch re-entry as Busted', () => {
    const log = [
      '|switch|p2a: Mimikyu|Mimikyu, M|100/100',
      '|turn|1',
      '|move|p2a: Mimikyu|Trailblaze|',
      '|turn|2',
      '|detailschange|p2a: Mimikyu|Mimikyu-Busted, M|50/100',
      '|switch|p2b: Other|Other, M|100/100',
      '|switch|p2a: Mimikyu|Mimikyu-Busted, M|40/100|[from] Volt Switch',
      '|turn|3',
      '|move|p2a: Mimikyu|Drain Punch|',
      '|faint|p2a: Mimikyu',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const mimikyu = result.players[1].pokemon.filter((p) =>
      p.pokemon_name.toLowerCase().includes('mimikyu'),
    );
    expect(mimikyu).toHaveLength(1);
    expect(mimikyu[0].pokemon_name).toBe('Mimikyu');
    expect(mimikyu[0].moves_used).toContain('Trailblaze');
    expect(mimikyu[0].moves_used).toContain('Drain Punch');
    expect(mimikyu[0].was_koed).toBe(true);
  });

  it('keeps one Mimikyu tracker when only detailschange occurs (no re-switch as Busted)', () => {
    const log = [
      '|switch|p1a: Mimikyu|Mimikyu, M|100/100',
      '|turn|1',
      '|move|p1a: Mimikyu|Trailblaze|',
      '|turn|2',
      '|detailschange|p1a: Mimikyu|Mimikyu-Busted, M|50/100',
      '|move|p1a: Mimikyu|Drain Punch|',
      '|faint|p1a: Mimikyu',
      '|win|Player1',
    ].join('\n');

    const result = parseReplayLog(log);
    const mimikyu = result.players[0].pokemon.filter((p) =>
      p.pokemon_name.toLowerCase().includes('mimikyu'),
    );
    expect(mimikyu).toHaveLength(1);
    expect(mimikyu[0].moves_used).toContain('Trailblaze');
    expect(mimikyu[0].moves_used).toContain('Drain Punch');
  });

  it('splits a disguise window off the copied species when an Illusion breaks (|replace|)', () => {
    // A disguised Zoroark copies the real Lycanroc's nickname and species; |replace|
    // reveals it, and the real Lycanroc enters on the same slot afterwards.
    const log = [
      '|poke|p2|Zoroark-Hisui, M|',
      '|poke|p2|Lycanroc-Midnight, M|',
      '|switch|p1a: Alpha|Alpha|100/100',
      '|switch|p2a: Howler|Lycanroc-Midnight, M|100/100',
      '|turn|1',
      '|move|p2a: Howler|Bitter Malice|p1a: Alpha',
      '|-damage|p1a: Alpha|0 fnt',
      '|faint|p1a: Alpha',
      '|switch|p1a: Beta|Beta|100/100',
      '|turn|2',
      '|move|p1a: Beta|Stored Power|p2a: Howler',
      '|-damage|p2a: Howler|0 fnt',
      '|replace|p2a: Masque|Zoroark-Hisui, M',
      '|-end|p2a: Masque|Illusion',
      '|faint|p2a: Masque',
      '|switch|p2a: Howler|Lycanroc-Midnight, M|100/100',
      '|turn|3',
      '|move|p2a: Howler|Stone Edge|p1a: Beta',
      '|-damage|p1a: Beta|0 fnt',
      '|faint|p1a: Beta',
      '|win|Player2',
    ].join('\n');

    const result = parseReplayLog(log);
    const zoroark = result.players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark-Hisui');
    const lycanroc = result.players[1].pokemon.find(
      (p) => p.pokemon_name === 'Lycanroc-Midnight',
    );

    expect(zoroark).toBeDefined();
    expect(zoroark!.was_brought).toBe(true);
    expect(zoroark!.was_koed).toBe(true);
    expect(zoroark!.kos_dealt).toBe(1);
    expect(zoroark!.moves_used).toEqual(['Bitter Malice']);
    expect(zoroark!.turns_active).toBe(2);

    expect(lycanroc).toBeDefined();
    expect(lycanroc!.was_brought).toBe(true);
    expect(lycanroc!.was_koed).toBe(false);
    expect(lycanroc!.kos_dealt).toBe(1);
    expect(lycanroc!.moves_used).toEqual(['Stone Edge']);
    expect(lycanroc!.turns_active).toBe(1);

    // The reveal does not steal the kill credit: the mon that broke the Illusion is credited.
    const beta = result.players[0].pokemon.find((p) => p.pokemon_name === 'Beta');
    expect(beta!.kos_dealt).toBe(1);
  });

  it('keeps post-reveal activity on the revealed species when the Illusion user survives', () => {
    const log = [
      '|poke|p2|Zoroark, M|',
      '|poke|p2|Lycanroc, M|',
      '|switch|p1a: Alpha|Alpha|100/100',
      '|switch|p2a: Lupin|Lycanroc, M|100/100',
      '|turn|1',
      '|move|p2a: Lupin|Bitter Malice|p1a: Alpha',
      '|-damage|p1a: Alpha|60/100',
      '|move|p1a: Alpha|Stored Power|p2a: Lupin',
      '|-damage|p2a: Lupin|30/100',
      '|replace|p2a: Masque|Zoroark, M',
      '|-end|p2a: Masque|Illusion',
      '|turn|2',
      '|move|p2a: Masque|Focus Blast|p1a: Alpha',
      '|-damage|p1a: Alpha|0 fnt',
      '|faint|p1a: Alpha',
      '|win|Player2',
    ].join('\n');

    const result = parseReplayLog(log);
    const zoroark = result.players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark');
    const lycanroc = result.players[1].pokemon.find((p) => p.pokemon_name === 'Lycanroc');

    expect(zoroark).toBeDefined();
    expect(zoroark!.was_brought).toBe(true);
    expect(zoroark!.was_koed).toBe(false);
    expect(zoroark!.kos_dealt).toBe(1);
    expect(zoroark!.moves_used).toEqual(['Bitter Malice', 'Focus Blast']);
    expect(zoroark!.turns_active).toBe(2);

    // The copied species never actually entered the field.
    expect(lycanroc).toBeDefined();
    expect(lycanroc!.was_brought).toBe(false);
    expect(lycanroc!.was_koed).toBe(false);
    expect(lycanroc!.kos_dealt).toBe(0);
    expect(lycanroc!.turns_active).toBe(0);
  });

  it('hands the Zoroark a move it used in disguise even when the copied species had used it before', () => {
    const log = [
      '|poke|p2|Zoroark, M|',
      '|poke|p2|Lycanroc, M|',
      '|switch|p1a: Alpha|Alpha|100/100',
      '|switch|p2a: Howler|Lycanroc, M|100/100',
      '|turn|1',
      '|move|p2a: Howler|Stone Edge|p1a: Alpha',
      '|-damage|p1a: Alpha|60/100',
      '|switch|p2a: Howler|Lycanroc, M|100/100',
      '|turn|2',
      '|move|p2a: Howler|Stone Edge|p1a: Alpha',
      '|-damage|p1a: Alpha|30/100',
      '|replace|p2a: Masque|Zoroark, M',
      '|-end|p2a: Masque|Illusion',
      '|win|Player2',
    ].join('\n');

    const result = parseReplayLog(log);
    const zoroark = result.players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark');
    const lycanroc = result.players[1].pokemon.find((p) => p.pokemon_name === 'Lycanroc');
    expect(zoroark!.moves_used).toEqual(['Stone Edge']);
    expect(lycanroc!.moves_used).toEqual(['Stone Edge']);
  });

  it('splits a disguise window on a legacy Illusion reveal via |detailschange|', () => {
    const log = [
      '|poke|p2|Zoroark, M|',
      '|poke|p2|Lycanroc, M|',
      '|switch|p1a: Alpha|Alpha|100/100',
      '|switch|p2a: Lupin|Lycanroc, M|100/100',
      '|turn|1',
      '|move|p2a: Lupin|Bitter Malice|p1a: Alpha',
      '|-damage|p1a: Alpha|0 fnt',
      '|faint|p1a: Alpha',
      '|switch|p1a: Beta|Beta|100/100',
      '|turn|2',
      '|move|p1a: Beta|Stored Power|p2a: Lupin',
      '|-damage|p2a: Lupin|0 fnt',
      '|detailschange|p2a: Masque|Zoroark, M',
      '|-end|p2a: Masque|Illusion',
      '|faint|p2a: Masque',
      '|win|Player2',
    ].join('\n');

    const result = parseReplayLog(log);
    const zoroark = result.players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark');
    const lycanroc = result.players[1].pokemon.find((p) => p.pokemon_name === 'Lycanroc');

    expect(zoroark).toBeDefined();
    expect(zoroark!.was_brought).toBe(true);
    expect(zoroark!.was_koed).toBe(true);
    expect(zoroark!.kos_dealt).toBe(1);
    expect(zoroark!.moves_used).toEqual(['Bitter Malice']);
    expect(zoroark!.turns_active).toBe(2);

    expect(lycanroc).toBeDefined();
    expect(lycanroc!.was_brought).toBe(false);
    expect(lycanroc!.was_koed).toBe(false);
  });
});
