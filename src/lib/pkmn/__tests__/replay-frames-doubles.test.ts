/**
 * Doubles replay frames against the real `@pkmn/client` battle tracker (issue #136): a frame lists
 * every active slot of each side, including an empty slot after a faint, while a singles frame still
 * carries exactly one slot.
 */
import { describe, expect, it } from 'vitest';
import { extractBattleFrames } from '../replay-frames';

const DOUBLES_LOG = [
  '|gametype|doubles',
  '|player|p1|Alice|1|',
  '|player|p2|Bob|1|',
  '|poke|p1|Pikachu, M|',
  '|poke|p1|Raichu, M|',
  '|poke|p2|Charizard, M|',
  '|poke|p2|Blastoise, M|',
  '|teamsize|p1|4',
  '|teamsize|p2|4',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50, M|100/100',
  '|switch|p1b: Raichu|Raichu, L50, M|100/100',
  '|switch|p2a: Charizard|Charizard, L50, M|100/100',
  '|switch|p2b: Blastoise|Blastoise, L50, M|100/100',
  '|turn|1',
  '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
  '|-damage|p2a: Charizard|40/100',
  '|move|p2b: Blastoise|Surf|p1b: Raichu',
  '|-damage|p1b: Raichu|0 fnt',
  '|faint|p1b: Raichu',
  '|turn|2',
  '|switch|p1b: Jolteon|Jolteon, L50, M|100/100',
  '|move|p1a: Pikachu|Thunderbolt|p2a: Charizard',
  '|-damage|p2a: Charizard|0 fnt',
  '|faint|p2a: Charizard',
  '|win|Alice',
].join('\n');

describe('extractBattleFrames — doubles', () => {
  it('lists every active slot of both sides in each frame', () => {
    const frames = extractBattleFrames(DOUBLES_LOG);
    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 0: initial switches are on the field before turn 1 resolves.
    const p1Active = frames[0].sides[0].active;
    expect(p1Active).toHaveLength(2);
    expect(p1Active[0]?.species).toBe('Pikachu');
    expect(p1Active[1]?.species).toBe('Raichu');

    const p2Active = frames[0].sides[1].active;
    expect(p2Active).toHaveLength(2);
    expect(p2Active[0]?.species).toBe('Charizard');
    expect(p2Active[1]?.species).toBe('Blastoise');
  });

  it('carries the same per-Pokémon fields a singles slot carries', () => {
    const frames = extractBattleFrames(DOUBLES_LOG);
    const slot = frames[0].sides[0].active[0];

    expect(slot).toMatchObject({
      species: 'Pikachu',
      hp: 100,
      fainted: false,
      terastallized: null,
      status: null,
    });
    expect(slot).toHaveProperty('boosts');
    expect(slot).toHaveProperty('volatiles');
  });

  it('keeps an emptied slot in place after a faint', () => {
    const frames = extractBattleFrames(DOUBLES_LOG);
    // Turn-1 frame: Raichu fainted on p1b during the turn.
    const afterFaint = frames[1].sides[0].active;

    expect(afterFaint).toHaveLength(2);
    expect(afterFaint[0]?.species).toBe('Pikachu');
    // The partner slot is either null (cleared) or still the fainted Raichu —
    // either way it is present as the second slot, not dropped.
    const partner = afterFaint[1];
    if (partner !== null) {
      expect(partner.species).toBe('Raichu');
      expect(partner.fainted).toBe(true);
    }
  });

  it('shows the replacement after a switch into the emptied slot', () => {
    const frames = extractBattleFrames(DOUBLES_LOG);
    const finalFrame = frames[frames.length - 1];
    const p1Active = finalFrame.sides[0].active;

    expect(p1Active).toHaveLength(2);
    expect(p1Active[1]?.species).toBe('Jolteon');
    expect(finalFrame.winner).toBe('Alice');
  });

  it('still carries exactly one slot for a singles log', () => {
    const frames = extractBattleFrames([
      '|player|p1|Alice|1|',
      '|player|p2|Bob|1|',
      '|switch|p1a: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Charizard|Charizard, L50|100/100',
      '|turn|1',
      '|win|Alice',
    ].join('\n'));

    expect(frames[0].sides[0].active).toHaveLength(1);
    expect(frames[0].sides[0].active[0]?.species).toBe('Pikachu');
  });
});
