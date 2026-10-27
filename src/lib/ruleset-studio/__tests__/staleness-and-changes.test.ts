/**
 * The catalog staleness test of a published version, and the per-version change summaries of the version list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import { isCatalogStale } from '../staleness';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({ listVersionRules: vi.fn() }));

import { listVersionRules } from '@/lib/supabase/queries/ruleset-definitions';
import { VERSION_CHANGE_LIMIT, getVersionChanges } from '../version-changes.server';

const CURRENT = '2026-10-26.1';

describe('isCatalogStale', () => {
  it('a version based on a preset is stale when it was computed from another catalog version', () => {
    expect(isCatalogStale({ catalog_version: '2026-09-01.1', base_preset: 'gen9ou' }, CURRENT)).toBe(true);
    expect(isCatalogStale({ catalog_version: CURRENT, base_preset: 'gen9ou' }, CURRENT)).toBe(false);
  });

  it('a blank base and a converted legacy ruleset never depend on the catalog', () => {
    expect(isCatalogStale({ catalog_version: '2026-09-01.1', base_preset: null }, CURRENT)).toBe(false);
    expect(isCatalogStale({ catalog_version: 'legacy', base_preset: null }, CURRENT)).toBe(false);
  });
});

describe('getVersionChanges', () => {
  const DEF = '33333333-3333-4333-8333-333333333333';
  const rulesOf = (...banned: string[]) => rulesFromBans({ gen: 9, bans: { pokemon: banned } });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('compares each version with the one before it from the frozen rules, and the first version has nothing before it', async () => {
    vi.mocked(listVersionRules).mockResolvedValue(
      new Map([
        [1, rulesOf('koraidon')],
        [2, rulesOf('koraidon', 'garchomp')],
        [3, rulesOf('garchomp')],
      ]),
    );

    const changes = await getVersionChanges(DEF, [{ version_no: 3 }, { version_no: 2 }, { version_no: 1 }]);

    expect(changes.get(1)).toBeNull();
    expect(changes.get(2)).toMatchObject({ banned: 1, unbanned: 0 });
    expect(changes.get(3)).toMatchObject({ banned: 0, unbanned: 1 });
    // One read of the rules for all three.
    expect(listVersionRules).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listVersionRules).mock.calls[0][1].slice().sort()).toEqual([1, 2, 3]);
  });

  it('a republish that only changed the frozen rules shows a difference although the document did not change', async () => {
    vi.mocked(listVersionRules).mockResolvedValue(new Map([[1, rulesOf()], [2, rulesOf('garchomp')]]));
    expect((await getVersionChanges(DEF, [{ version_no: 2 }, { version_no: 1 }])).get(2)).toMatchObject({ banned: 1 });
  });

  it('looks at the newest versions only, plus the one before the oldest of them', async () => {
    const total = VERSION_CHANGE_LIMIT + 5;
    const versions = Array.from({ length: total }, (_, i) => ({ version_no: total - i }));
    vi.mocked(listVersionRules).mockImplementation(async (_id, wanted) => new Map(wanted.map((n) => [n, rulesOf(`mon${n}`)])));

    const changes = await getVersionChanges(DEF, versions);

    expect([...changes.keys()].sort((x, y) => x - y)).toEqual(Array.from({ length: VERSION_CHANGE_LIMIT }, (_, i) => total - VERSION_CHANGE_LIMIT + 1 + i));
    const read = vi.mocked(listVersionRules).mock.calls[0][1];
    expect(read).toHaveLength(VERSION_CHANGE_LIMIT + 1);
    expect(Math.min(...read)).toBe(total - VERSION_CHANGE_LIMIT);
  });

  it('leaves out a version whose rules or predecessor could not be read, instead of inventing a comparison', async () => {
    vi.mocked(listVersionRules).mockResolvedValue(new Map([[2, rulesOf('garchomp')]]));
    expect((await getVersionChanges(DEF, [{ version_no: 2 }, { version_no: 1 }])).has(2)).toBe(false);
  });

  it('answers an empty map for a ruleset without versions', async () => {
    vi.mocked(listVersionRules).mockResolvedValue(new Map());
    expect((await getVersionChanges(DEF, [])).size).toBe(0);
  });
});
