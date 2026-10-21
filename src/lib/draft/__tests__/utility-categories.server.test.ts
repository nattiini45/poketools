import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import { epbPack, utilityLabel } from '@/lib/format-pack';
import fixture from './fixtures/example-list.json';
import {
  bannedMoveIdSet,
  DROPPED_UTILITY_MOVES,
  parentMatchIds,
  UTILITY_CATEGORIES,
  UTILITY_ORDER,
  utilityCategory,
  type UtilityCategoryDef,
} from '../utility-categories';
import { computeLineUtility } from '../utility-matches.server';

// The public suite runs on the example pack (5 categories; Rest is its one restricted member, none is banned).
const banned = bannedMoveIdSet(epbPack.defaults.bannedMoves);

function entry(lineId: string) {
  const found = fixture.entries.find((e) => e.line_id === lineId);
  if (!found) throw new Error(`fixture has no ${lineId}`);
  return found;
}

describe('utility categories (format pack ids)', () => {
  it('lists the pack categories in UTILITY_ORDER, each with an en and de label', () => {
    expect(UTILITY_ORDER).toEqual(epbPack.utility.order);
    expect(UTILITY_CATEGORIES.map((c) => c.key)).toEqual([...UTILITY_ORDER]);
    expect(UTILITY_ORDER).toEqual(['hazards', 'hazard_control', 'recovery', 'pivot', 'priority']);
    for (const key of UTILITY_ORDER) {
      expect(utilityLabel(key, 'en'), key).not.toBe(key);
      expect(utilityLabel(key, 'de'), key).not.toBe(key);
    }
    expect(DROPPED_UTILITY_MOVES).toEqual(epbPack.utility.dropped);
  });

  it('every member is a Gen 9 @pkmn id that exists and is not nonstandard', () => {
    for (const def of UTILITY_CATEGORIES) {
      for (const m of def.members) {
        const data = m.kind === 'move' ? Dex.moves.get(m.id) : Dex.abilities.get(m.id);
        expect(data.exists, `${def.key}:${m.id}`).toBe(true);
        expect(data.id, `${def.key}:${m.id}`).toBe(m.id);
        expect(data.isNonstandard ?? null, `${def.key}:${m.id}`).toBeNull();
      }
    }
  });

  it('no member appears twice, and the finder views are derived from members', () => {
    const seen = new Set<string>();
    for (const def of UTILITY_CATEGORIES) {
      for (const m of def.members) {
        expect(seen.has(m.id), m.id).toBe(false);
        seen.add(m.id);
      }
      expect(def.moves).toEqual(def.members.filter((m) => m.kind === 'move').map((m) => m.id));
      expect(def.abilities).toEqual(def.members.filter((m) => m.kind === 'ability').map((m) => m.id));
      expect(def.excludeFromParent).toEqual(def.members.filter((m) => !m.inParentMatch).map((m) => m.id));
    }
  });

  it('the parent match keeps abilities and drops restricted and banned moves', () => {
    const recovery = utilityCategory('recovery');
    // The example pack's Rest matches only on its own, so the whole-category match leaves it out.
    expect(recovery.excludeFromParent).toEqual(['rest']);
    expect(parentMatchIds(recovery, banned)).toEqual({
      moves: recovery.moves.filter((id) => id !== 'rest'),
      abilities: ['regenerator'],
    });
    // A category with a member that only matches on its own and a banned member (pack data may set both).
    const def: UtilityCategoryDef = {
      key: 'demo',
      members: [
        { kind: 'move', id: 'recover', inParentMatch: true, source: 'authored' },
        { kind: 'move', id: 'rest', inParentMatch: false, source: 'authored', flag: 'learned_by_every_line' },
        { kind: 'move', id: 'batonpass', inParentMatch: true, source: 'sheet', flag: 'banned_by_default' },
      ],
      moves: ['recover', 'rest', 'batonpass'],
      abilities: [],
      excludeFromParent: ['rest'],
    };
    expect(parentMatchIds(def, bannedMoveIdSet(['Baton Pass'])).moves).toEqual(['recover']);
    expect(parentMatchIds(def, new Set()).moves).toEqual(['recover', 'batonpass']);
  });

  it('throws for a key the pack does not define', () => {
    expect(() => utilityCategory('nope')).toThrow('Unknown utility category: nope');
  });
});

describe('computeLineUtility (stage-specific, Gen 9 Paldea learnsets)', () => {
  it('reports the earliest stage: Stealth Rock on the Beldum line from Metang (stage 2)', async () => {
    const matches = await computeLineUtility(entry('beldum--metagross'), banned);
    expect(matches).toContainEqual({ key: 'hazards', stage: 2, via: { kind: 'move', id: 'stealthrock' } });
    expect(matches).toContainEqual({ key: 'priority', stage: 2, via: { kind: 'move', id: 'bulletpunch' } });
  });

  it('never matches a banned move (U-turn on the Fletchling line, when the season bans it)', async () => {
    const open = await computeLineUtility(entry('fletchling--talonflame'), new Set());
    expect(open.some((m) => m.via.id === 'uturn')).toBe(true);
    const withBans = await computeLineUtility(entry('fletchling--talonflame'), bannedMoveIdSet(['U-turn']));
    expect(withBans.some((m) => m.via.id === 'uturn')).toBe(false);
  });

  it('a line whose only learnable member is Rest lists it, through Rest alone', async () => {
    expect(await computeLineUtility(entry('capsakid--scovillain'), banned)).toEqual([
      { key: 'recovery', stage: 1, via: { kind: 'move', id: 'rest' } },
    ]);
  });
});
