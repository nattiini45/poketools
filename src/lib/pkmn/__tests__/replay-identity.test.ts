import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  REPLAY_HASH_PATTERN,
  REPLAY_HASH_VERSION,
  canonicalReplayLog,
  computeReplayHash,
  findReplayHashCollisions,
} from '../replay-identity';

/** A short spectator-view battle log, as replay.pokemonshowdown.com serves it. */
const BATTLE = [
  '|j|☆alice_ps',
  '|j|☆bob_ps',
  '|t:|1760950000',
  '|gametype|singles',
  '|player|p1|alice_ps|102|1500',
  '|player|p2|bob_ps|265|1500',
  '|teamsize|p1|1',
  '|teamsize|p2|1',
  '|gen|9',
  '|tier|[Gen 9] OU',
  '|rule|Species Clause: Limit one of each Pokémon',
  '|',
  '|t:|1760950003',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50, M|100/100',
  '|switch|p2a: Garchomp|Garchomp, L50, F|100/100',
  '|turn|1',
  '|c|☆alice_ps|glhf',
  '|',
  '|t:|1760950010',
  '|move|p2a: Garchomp|Earthquake|p1a: Pikachu',
  '|-damage|p1a: Pikachu|0 fnt',
  '|faint|p1a: Pikachu',
  '|',
  '|win|bob_ps',
];

const join = (lines: string[]) => lines.join('\n');

describe('canonicalReplayLog', () => {
  it('keeps the battle lines in order and drops chat, joins and spacers', () => {
    const lines = canonicalReplayLog(join(BATTLE));
    expect(lines[0]).toBe('|t:|1760950000');
    expect(lines).toContain('|player|p1|alice_ps|102|1500');
    expect(lines).not.toContain('|c|☆alice_ps|glhf');
    expect(lines).not.toContain('|j|☆alice_ps');
    expect(lines).not.toContain('|');
    expect(lines[lines.length - 1]).toBe('|win|bob_ps');
  });

  it('keeps only the public line of a |split| block', () => {
    const playerView = canonicalReplayLog(join([
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|split|p1',
      '|-damage|p1a: Pikachu|61/150',
      '|-damage|p1a: Pikachu|41/100',
      '|win|bob_ps',
    ]));
    const spectatorView = canonicalReplayLog(join([
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|-damage|p1a: Pikachu|41/100',
      '|win|bob_ps',
    ]));
    expect(playerView).toEqual(spectatorView);
  });

  it('stops at the first |win| or |tie| line', () => {
    expect(canonicalReplayLog(join(['|turn|1', '|tie', '|raw|rating change', '|turn|2']))).toEqual(['|turn|1', '|tie']);
  });
});

describe('computeReplayHash', () => {
  const hash = computeReplayHash(join(BATTLE));

  it('is 64 lowercase hex characters: sha256 of the version tag and the canonical lines', () => {
    expect(hash).toMatch(REPLAY_HASH_PATTERN);
    const expected = createHash('sha256')
      .update(`${REPLAY_HASH_VERSION}\n${canonicalReplayLog(join(BATTLE)).join('\n')}`, 'utf8')
      .digest('hex');
    expect(hash).toBe(expected);
  });

  it('is the same for the same battle with CRLF line endings, trailing spaces, other chat or a later upload', () => {
    expect(computeReplayHash(BATTLE.join('\r\n'))).toBe(hash);
    expect(computeReplayHash(join(BATTLE.map((l) => `${l}  `)))).toBe(hash);
    const otherRoom = BATTLE.filter((l) => !l.startsWith('|c|')).concat([]);
    otherRoom.splice(1, 0, '|j|spectator', '|c|spectator|hi', '|inactive|Battle timer is ON');
    expect(computeReplayHash(join(otherRoom))).toBe(hash);
    const laterUpload = [...BATTLE, '|raw|bob_ps\'s rating: 1500 &rarr; 1520', '|l|☆alice_ps', '|c|☆bob_ps|gg'];
    expect(computeReplayHash(join(laterUpload))).toBe(hash);
  });

  it('differs for a different battle (another move, another timestamp, another winner)', () => {
    const otherMove = BATTLE.map((l) => l.replace('|Earthquake|', '|Dragon Claw|'));
    const otherTime = BATTLE.map((l) => l.replace('1760950010', '1760950011'));
    const otherWinner = BATTLE.map((l) => (l === '|win|bob_ps' ? '|win|alice_ps' : l));
    for (const variant of [otherMove, otherTime, otherWinner]) {
      expect(computeReplayHash(join(variant))).not.toBe(hash);
    }
  });

  it('refuses a log without any battle line', () => {
    expect(() => computeReplayHash('')).toThrow(/no battle lines/);
    expect(() => computeReplayHash(join(['|j|alice', '|c|alice|hi', '|']))).toThrow(/no battle lines/);
  });
});

describe('findReplayHashCollisions', () => {
  it('lists every hash bound to more than one game, and nothing else', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const c = 'c'.repeat(64);
    expect(findReplayHashCollisions([
      { game_id: 'g3', replay_hash: b },
      { game_id: 'g1', replay_hash: a },
      { game_id: 'g2', replay_hash: b },
      { game_id: 'g4', replay_hash: c },
      { game_id: 'g4', replay_hash: c }, // the same game twice is not a collision
    ])).toEqual([{ replay_hash: b, game_ids: ['g2', 'g3'] }]);
    expect(findReplayHashCollisions([])).toEqual([]);
  });
});
