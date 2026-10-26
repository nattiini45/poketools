import { describe, expect, it } from 'vitest';
import { leagueCreatedHref } from '../tabs';

const ID = '5e150000-0000-4000-8000-000000000001';

describe('leagueCreatedHref (where a new league opens)', () => {
  it('a custom league opens on the Format tab, where its format is attached', () => {
    expect(leagueCreatedHref(ID, 'custom')).toBe(`/admin/leagues/${ID}?tab=format`);
  });

  it.each(['singles', 'doubles', 'draft', 'evolution_point_buy'] as const)(
    '%s keeps the plain league URL (the overview)',
    (formatType) => {
      expect(leagueCreatedHref(ID, formatType)).toBe(`/admin/leagues/${ID}`);
    },
  );
});
