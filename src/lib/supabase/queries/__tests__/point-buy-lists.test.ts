import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import { epbPack } from '@/lib/format-pack';
import exampleList from '@/lib/draft/__tests__/fixtures/example-list.json';

vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

import { supabase } from '@/lib/supabase/client';
import {
  bulkCreateListEntries,
  getListEntries,
  getListEntryByBase,
  getListEntryByBaseAndStage3,
  getListEntryById,
  getListEntryByLineId,
  isVersionBoundToAnySeason,
} from '../point-buy-lists';

type MockSupabase = ReturnType<typeof createMockSupabase> & {
  range: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
};
const mock = supabase as unknown as MockSupabase;

/** The active format pack's first line override and its example-fixture entry (format-pack spec §F.2). */
const OVERRIDE = epbPack.lineOverrides[0];
const OVERRIDE_ENTRY = exampleList.entries.find((e) => e.line_id === OVERRIDE.line_id)!;

/** A point_buy_list_entries row as PostgREST returns it after migration M1: the override line, with sheet thresholds the override changes. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    ...OVERRIDE_ENTRY,
    id: 'entry-override',
    list_version_id: 'v1',
    kills_to_stage2: (OVERRIDE.kills_to_stage2 ?? 0) + 1,
    additional_kills_to_stage3: (OVERRIDE.additional_kills_to_stage3 ?? 0) + 1,
    created_at: '2026-07-27T00:00:00Z',
    ...overrides,
  };
}

const gastly = row({
  id: 'entry-gastly',
  line_number: 5,
  line_id: 'gastly--gengar',
  base_pokemon: 'Gastly',
  stage2_pokemon: 'Haunter',
  stage3_pokemon: 'Gengar',
  kills_to_stage2: 5,
  additional_kills_to_stage3: 9,
  special_rules: null,
  special_rules_text: null,
});

function expectOverridden(entry: { kills_to_stage2: number; additional_kills_to_stage3: number | null; overrides?: unknown[] } | null) {
  expect(entry?.kills_to_stage2).toBe(OVERRIDE.kills_to_stage2);
  expect(entry?.additional_kills_to_stage3).toBe(OVERRIDE.additional_kills_to_stage3);
  expect(entry?.overrides).toHaveLength(2);
}

describe('point-buy list reads apply the league overrides on every path', () => {
  beforeEach(() => mock.__reset());

  it('getListEntries', async () => {
    mock.__setResult([row(), gastly]);
    const entries = await getListEntries('v1');
    expectOverridden(entries[0]);
    expect(entries[0].special_rules).toEqual(OVERRIDE_ENTRY.special_rules);
    expect(entries[1]).toMatchObject({ line_id: 'gastly--gengar', kills_to_stage2: 5, overrides: [] });
  });

  it('getListEntryById', async () => {
    mock.__setResult([row()]);
    expectOverridden(await getListEntryById('entry-override'));
    expect(mock.eq).toHaveBeenCalledWith('id', 'entry-override');
  });

  it('getListEntryByLineId filters by version and line id', async () => {
    mock.__setResult([row()]);
    expectOverridden(await getListEntryByLineId('v1', OVERRIDE.line_id));
    expect(mock.eq).toHaveBeenCalledWith('list_version_id', 'v1');
    expect(mock.eq).toHaveBeenCalledWith('line_id', OVERRIDE.line_id);
  });

  it('getListEntryByBase', async () => {
    mock.__setResult([row()]);
    expectOverridden(await getListEntryByBase('v1', OVERRIDE_ENTRY.base_pokemon));
  });

  it('getListEntryByBaseAndStage3 (both the branch lookup and the unique-base lookup)', async () => {
    mock.__setResult([row()]);
    expectOverridden(await getListEntryByBaseAndStage3('v1', OVERRIDE_ENTRY.base_pokemon, OVERRIDE_ENTRY.stage3_pokemon!));
    mock.__setResult([row()]);
    expectOverridden(await getListEntryByBaseAndStage3('v1', OVERRIDE_ENTRY.base_pokemon));
  });

  it('computes the line id for a row read before M1 (no line_id column yet)', async () => {
    const legacy: Record<string, unknown> = row({ base_pokemon: 'Flabébé', stage2_pokemon: 'Floette', stage3_pokemon: 'Florges' });
    delete legacy.line_id;
    mock.__setResult([legacy]);
    const [entry] = await getListEntries('v1');
    expect(entry.line_id).toBe('flabebe--florges');
    expect(entry.overrides).toEqual([]);
  });
});

describe('getListEntries paging', () => {
  beforeEach(() => mock.__reset());

  /** Rows `[from, to]` of a 2,345-line list, as the server would cut the page. */
  function pageOf(from: number, to: number) {
    return Array.from({ length: Math.min(to, 2344) - from + 1 }, (_, i) =>
      row({ id: `entry-${from + i}`, line_number: from + i + 1, line_id: `line-${from + i}`, base_pokemon: `Mon ${from + i}` }),
    );
  }

  it('reads a list past the 1,000-row ceiling page by page, in line_number order', async () => {
    mock.range
      .mockReturnValueOnce(Promise.resolve({ data: pageOf(0, 999), error: null }))
      .mockReturnValueOnce(Promise.resolve({ data: pageOf(1000, 1999), error: null }))
      .mockReturnValueOnce(Promise.resolve({ data: pageOf(2000, 2999), error: null }));

    const entries = await getListEntries('v1');

    expect(mock.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(entries).toHaveLength(2345);
    expect(entries.map((e) => e.line_number)).toEqual(Array.from({ length: 2345 }, (_, i) => i + 1));
    expect(mock.eq).toHaveBeenCalledWith('list_version_id', 'v1');
    expect(mock.order.mock.calls).toEqual([['line_number'], ['id'], ['line_number'], ['id'], ['line_number'], ['id']]);
  });

  it('reads a short list with ONE range call and the same output', async () => {
    mock.__setResult([row(), gastly]);

    const entries = await getListEntries('v1');

    expect(mock.range.mock.calls).toEqual([[0, 999]]);
    expectOverridden(entries[0]);
    expect(entries[1]).toMatchObject({ line_id: 'gastly--gengar', kills_to_stage2: 5, overrides: [] });
  });

  it('rethrows an error from a later page', async () => {
    const boom = new Error('page 2 failed');
    mock.range
      .mockReturnValueOnce(Promise.resolve({ data: pageOf(0, 999), error: null }))
      .mockReturnValueOnce(Promise.resolve({ data: null, error: boom }));

    await expect(getListEntries('v1')).rejects.toBe(boom);
  });
});

describe('isVersionBoundToAnySeason', () => {
  beforeEach(() => mock.__reset());

  it('is true when any season (any status) is bound to the version', async () => {
    mock.__setResult([{ id: 'season-1' }]);
    expect(await isVersionBoundToAnySeason('v1')).toBe(true);
    expect(mock.from).toHaveBeenCalledWith('seasons');
    expect(mock.eq).toHaveBeenCalledWith('point_buy_list_id', 'v1');
    expect(mock.neq).not.toHaveBeenCalled();
  });

  it('is false for an unbound version', async () => {
    mock.__setResult([]);
    expect(await isVersionBoundToAnySeason('v1')).toBe(false);
  });
});

describe('bulkCreateListEntries', () => {
  beforeEach(() => mock.__reset());

  it('sends the line id with every row (the M1 trigger checks it)', async () => {
    const SHEET_K2 = (OVERRIDE.kills_to_stage2 ?? 0) + 1;
    mock.__setResult([]); // not bound to an active season; the upsert succeeds
    await bulkCreateListEntries('v1', [
      {
        line_number: 1,
        base_pokemon: 'Flabébé',
        stage2_pokemon: 'Floette',
        stage3_pokemon: 'Florges',
        price: 19,
        kills_to_stage2: 3,
        additional_kills_to_stage3: 11,
        price_group: 'mittel',
      },
      {
        line_number: 2,
        line_id: OVERRIDE.line_id,
        base_pokemon: OVERRIDE_ENTRY.base_pokemon,
        stage2_pokemon: OVERRIDE_ENTRY.stage2_pokemon,
        stage3_pokemon: OVERRIDE_ENTRY.stage3_pokemon,
        price: OVERRIDE_ENTRY.price,
        kills_to_stage2: SHEET_K2,
        additional_kills_to_stage3: 10,
        price_group: OVERRIDE_ENTRY.price_group as 'premium',
      },
    ]);
    const [rows] = mock.upsert.mock.calls[0] as [{ line_id: string; kills_to_stage2: number }[]];
    expect(rows.map((r) => r.line_id)).toEqual(['flabebe--florges', OVERRIDE.line_id]);
    // Writes store the sheet values; the override applies on read only.
    expect(rows[1].kills_to_stage2).toBe(SHEET_K2);
  });
});

describe('public read cache of the entries', () => {
  it('is named point-buy-entries-v2, so pre-line-id cache entries are never served', () => {
    const source = readFileSync(resolve(__dirname, '../../../cache/public-reads.ts'), 'utf-8');
    const block = source.slice(source.indexOf('const pointBuyEntries'), source.indexOf('const pointBuyEntries') + 400);
    expect(block).toContain("name: 'point-buy-entries-v2'");
    expect(source).not.toContain("name: 'point-buy-entries',");
  });
});
