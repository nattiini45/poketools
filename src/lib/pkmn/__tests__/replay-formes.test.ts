/**
 * Forme changes against the real Pokédex (the main replay suite mocks the dex empty, so it cannot tell a forme change from
 * a different species): a `|detailschange|` between two non-base formes of one species is a forme change, never an
 * Illusion reveal, and the stats stay on one row.
 */
import { expect, it } from 'vitest';
import { parseReplayLog } from '../replay';

it.each([
  ['Ogerpon-Wellspring', 'Ogerpon-Wellspring-Tera'],
  ['Zygarde-10%', 'Zygarde-Complete'],
  ['Necrozma-Dusk-Mane', 'Necrozma-Ultra'],
])('keeps a forme change between two non-base formes (%s to %s) on one tracker, not an Illusion split', (from, to) => {
  const log = [
    '|switch|p1a: Alpha|Alpha|100/100',
    `|switch|p2a: Mon|${from}|100/100`,
    '|turn|1',
    '|move|p2a: Mon|Tackle|p1a: Alpha',
    '|-damage|p1a: Alpha|0 fnt',
    '|faint|p1a: Alpha',
    '|switch|p1a: Beta|Beta|100/100',
    `|detailschange|p2a: Mon|${to}`,
    '|turn|2',
    '|move|p2a: Mon|Tackle|p1a: Beta',
    '|-damage|p1a: Beta|0 fnt',
    '|faint|p1a: Beta',
    '|win|Player2',
  ].join('\n');

  const result = parseReplayLog(log);
  const rows = result.players[1].pokemon;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ pokemon_name: from, was_brought: true, was_lead: true, kos_dealt: 2, turns_active: 2 });
});

