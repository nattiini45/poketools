/** Example pack: utility categories (Gen 9 `@pkmn` ids; validated by pack-pkmn.server.test.ts). */
import type { FormatPack, PackUtilityMember } from '@/lib/format-pack/types';

function moves(ids: readonly string[]): PackUtilityMember[] {
  return ids.map((id) => ({ kind: 'move', id, inParentMatch: true, source: 'authored' }));
}

export const exampleUtility = {
  order: ['hazards', 'hazard_control', 'recovery', 'pivot', 'priority'],
  categories: [
    { key: 'hazards', members: moves(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']) },
    { key: 'hazard_control', members: moves(['rapidspin', 'defog', 'courtchange', 'mortalspin']) },
    {
      key: 'recovery',
      members: [
        ...moves(['recover', 'roost', 'slackoff', 'synthesis']),
        { kind: 'ability', id: 'regenerator', inParentMatch: true, source: 'authored' },
        // Most lines learn Rest, so it is listed but matches only when selected on its own.
        { kind: 'move', id: 'rest', inParentMatch: false, source: 'authored', flag: 'learned_by_most_lines' },
      ],
    },
    { key: 'pivot', members: moves(['uturn', 'voltswitch', 'flipturn', 'partingshot']) },
    { key: 'priority', members: moves(['suckerpunch', 'aquajet', 'iceshard', 'machpunch', 'bulletpunch']) },
  ],
  dropped: [],
} satisfies FormatPack['epb']['utility'];
