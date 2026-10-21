/**
 * Format-pack contract (design spec §F.3). Public: validates the example pack, the active pack
 * (always the example pack in the public `app` project, see vitest.config.ts), and the private
 * pack too when the companion overlay is attached (existence-gated, like GAUNTLET_STATEFUL).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { proseHash } from '@/lib/draft/special-rules-text';
import ExampleEn from '../../../format-packs/example/messages/en';
import examplePack from '../../../format-packs/example';
import exampleFixture from '../../draft/__tests__/fixtures/example-list.json';
import {
  comebackEarnWindow,
  comebackTokensFromTable,
  comebackTokensPerProgress,
  definePackEn,
  draftQuietHours,
  epbLineRuleForBase,
  formatPack,
  lineOverrideFor,
  participationLineBase,
  priceGroupForPrice,
  priceTabOf,
  ruleConflictText,
  STORED_FLAG,
  storedSpecialRulesForBase,
  teraEligibilityForStage,
  utilityLabel,
  type FormatPack,
} from '..';
import { formatPackIssues, parseFormatPack } from '../schema';

const PRIVATE_ENTRY = path.resolve(__dirname, '../../../format-packs/private/index.ts');
const HAS_PRIVATE = existsSync(PRIVATE_ENTRY);

/** The private pack, loaded by a computed specifier so no bundler resolves it statically. */
async function loadPrivatePack(): Promise<unknown> {
  const specifier = pathToFileURL(PRIVATE_ENTRY).href;
  const mod: unknown = await import(/* @vite-ignore */ specifier);
  return (mod as { default: unknown }).default;
}

const DELETE = Symbol('delete');

/** A deep copy of the example pack with one value replaced (or deleted) at `at`. */
function broken(at: readonly (string | number)[], value: unknown): unknown {
  const copy: unknown = structuredClone(examplePack);
  let node = copy as Record<string | number, unknown>;
  for (const key of at.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = at[at.length - 1];
  if (value === DELETE) delete node[last];
  else node[last] = value;
  return copy;
}

function leafPaths(tree: unknown, prefix = ''): string[] {
  if (typeof tree === 'string') return [prefix];
  const node = tree as Record<string, unknown>;
  const keys = Object.keys(node);
  if (keys.length > 0 && keys.every((k) => k === 'zero' || k === 'one' || k === 'other')) return [prefix];
  return keys.flatMap((k) => leafPaths(node[k], prefix ? `${prefix}.${k}` : k));
}

function messageChecks(pack: FormatPack) {
  const enLeaves = leafPaths(pack.messages.en).sort();
  const deLeaves = leafPaths(pack.messages.de).sort();
  expect(deLeaves).toEqual(enLeaves);
  for (const key of pack.epb.utility.order) {
    expect(pack.messages.en.utility[key], `en utility.${key}`).toBeTruthy();
    expect(pack.messages.de.utility[key], `de utility.${key}`).toBeTruthy();
  }
  const values = (tree: unknown): string[] =>
    typeof tree === 'string' ? [tree] : Object.values(tree as Record<string, unknown>).flatMap(values);
  for (const text of [...values(pack.messages.en), ...values(pack.messages.de)]) expect(text.trim()).not.toBe('');
}

describe('format pack contract: example pack', () => {
  it('validates', () => {
    expect(formatPackIssues(examplePack)).toEqual([]);
    expect(parseFormatPack(examplePack)).toBe(examplePack);
  });

  it('has equal en/de message keys, utility labels and no empty leaf', () => {
    messageChecks(examplePack);
  });

  it('its message tree is the contract (example en shape)', () => {
    expect(leafPaths(examplePack.messages.en).filter((p) => !p.startsWith('utility.'))).toEqual(
      leafPaths(ExampleEn).filter((p) => !p.startsWith('utility.')),
    );
  });

  it('every override line and special-rule prose line exists in the example fixture, with matching hashes', () => {
    const byId = new Map(exampleFixture.entries.map((e) => [e.line_id, e]));
    for (const o of examplePack.epb.lineOverrides) expect(byId.has(o.line_id), o.line_id).toBe(true);
    for (const [lineId, entry] of Object.entries(examplePack.epb.specialRulesEn)) {
      const row = byId.get(lineId);
      expect(row?.special_rules_text, lineId).toBeTruthy();
      expect(proseHash(row?.special_rules_text ?? ''), lineId).toBe(entry.de_hash);
    }
    const bases = new Set(exampleFixture.entries.map((e) => e.base_pokemon));
    for (const rule of examplePack.epb.lineRules) expect(bases.has(rule.base), rule.base).toBe(true);
  });

  it('the example fixture stores the pack flags and keeps every price inside a tab', () => {
    for (const e of exampleFixture.entries) {
      const rule = examplePack.epb.lineRules.find((r) => r.base === e.base_pokemon);
      expect(e.special_rules !== null, e.line_id).toBe(!!rule);
      expect(examplePack.epb.priceTabs.some((t) => e.price >= t.min && e.price <= t.max), e.line_id).toBe(true);
    }
  });
});

describe('format pack contract: the active pack', () => {
  it('is the example pack in the public app project, valid and deep-frozen', () => {
    expect(formatPack.id).toBe('example');
    expect(formatPackIssues(formatPack)).toEqual([]);
    expect(Object.isFrozen(formatPack)).toBe(true);
    expect(Object.isFrozen(formatPack.epb.priceTabs[0])).toBe(true);
    expect(Object.isFrozen(formatPack.messages.en.glossary.token)).toBe(true);
  });
});

describe('format pack contract: the private pack (companion overlay)', () => {
  it.skipIf(!HAS_PRIVATE)('validates, and its message tree matches the contract', async () => {
    const pack = await loadPrivatePack();
    expect(formatPackIssues(pack)).toEqual([]);
    const p = pack as FormatPack;
    expect(p.id).not.toBe('example');
    messageChecks(p);
    // `utility` and `ruleConflicts` hold pack-own keys (definePackEn excludes them from the contract).
    const contractPath = (x: string) => !x.startsWith('utility.') && !x.startsWith('ruleConflicts.');
    expect(leafPaths(p.messages.en).filter(contractPath)).toEqual(leafPaths(ExampleEn).filter(contractPath));
  });
});

describe('schema rules reject broken packs', () => {
  const E = examplePack.epb;
  const cases: [string, (string | number)[], unknown, string][] = [
    ['price group order', ['epb', 'priceGroupOrder'], ['premium'], 'epb.priceGroupOrder'],
    ['overlapping price groups', ['epb', 'priceGroups', 'hoch'], [15, 22], 'epb.priceGroups.hoch'],
    ['tab key all', ['epb', 'priceTabs', 0, 'key'], 'all', 'epb.priceTabs.0.key'],
    ['ascending tabs', ['epb', 'priceTabs'], [...E.priceTabs].reverse(), 'epb.priceTabs.1'],
    ['decision match not last', ['epb', 'tiebreakerChain'], [...E.tiebreakerChain].reverse(), 'epb.tiebreakerChain'],
    [
      'comeback not ascending',
      ['epb', 'comeback', 'table'],
      [{ minWinnerSurvivors: 4, tokens: 2 }, { minWinnerSurvivors: 3, tokens: 1 }],
      'epb.comeback.table.1',
    ],
    ['participation line not locked', ['epb', 'lineRules', 0, 'redraftLocked'], DELETE, 'epb.lineRules.0.redraftLocked'],
    ['bad override id', ['epb', 'lineOverrides', 0, 'line_id'], 'Dratini', 'epb.lineOverrides.0.line_id'],
    ['bad de hash', ['epb', 'specialRulesEn', 'dratini--dragonite', 'de_hash'], 'xyz', 'epb.specialRulesEn.dratini--dragonite.de_hash'],
    ['duplicate columns', ['epb', 'workbook', 'pointBuy', 'columns', 'mid'], 0, 'epb.workbook.pointBuy.columns'],
    ['utility order mismatch', ['epb', 'utility', 'order'], E.utility.order.slice(1), 'epb.utility.order'],
    ['missing de message', ['messages', 'de', 'draftRedraft', 'tokenNote'], DELETE, 'messages.de'],
    ['missing utility label', ['messages', 'de', 'utility', 'pivot'], DELETE, 'messages.de.utility.pivot'],
    ['empty message', ['messages', 'en', 'draftRedraft', 'tokenNote'], ' ', 'messages.en.draftRedraft.tokenNote'],
    ['tier limits', ['draftFormat', 'tierLimitDefaults', 'C'], DELETE, 'draftFormat.tierLimitDefaults.C'],
    ['unknown key', ['epb', 'extra'], 1, 'epb'],
    ['unknown comeback earn window', ['epb', 'comeback', 'earnWindow'], 'weekly', 'epb.comeback.earnWindow'],
    ['missing comeback earn window', ['epb', 'comeback', 'earnWindow'], DELETE, 'epb.comeback.earnWindow'],
    ['zero tokens per progress', ['epb', 'participationPoints', 'comebackTokensPerProgress'], 0, 'epb.participationPoints.comebackTokensPerProgress'],
    ['fractional tokens per progress', ['epb', 'participationPoints', 'comebackTokensPerProgress'], 1.5, 'epb.participationPoints.comebackTokensPerProgress'],
    ['tokens per progress above the cap', ['epb', 'participationPoints', 'comebackTokensPerProgress'], 11, 'epb.participationPoints.comebackTokensPerProgress'],
    ['missing tokens per progress', ['epb', 'participationPoints', 'comebackTokensPerProgress'], DELETE, 'epb.participationPoints.comebackTokensPerProgress'],
    ['missing draft clock', ['epb', 'draftClock'], DELETE, 'epb.draftClock'],
    ['missing quiet hours (null is required for "off")', ['epb', 'draftClock', 'quietHours'], DELETE, 'epb.draftClock.quietHours'],
    ['empty quiet window', ['epb', 'draftClock', 'quietHours'], { startHour: 6, endHour: 6, timeZone: 'Europe/Berlin' }, 'epb.draftClock.quietHours.endHour'],
    ['quiet window across midnight', ['epb', 'draftClock', 'quietHours'], { startHour: 22, endHour: 6, timeZone: 'Europe/Berlin' }, 'epb.draftClock.quietHours.endHour'],
    ['quiet start hour 24', ['epb', 'draftClock', 'quietHours'], { startHour: 24, endHour: 24, timeZone: 'UTC' }, 'epb.draftClock.quietHours.startHour'],
    ['quiet end hour 0', ['epb', 'draftClock', 'quietHours'], { startHour: 0, endHour: 0, timeZone: 'UTC' }, 'epb.draftClock.quietHours.endHour'],
    ['24 h quiet window (clock never runs)', ['epb', 'draftClock', 'quietHours'], { startHour: 0, endHour: 24, timeZone: 'Europe/Berlin' }, 'epb.draftClock.quietHours.endHour'],
    ['quiet time zone name over 64 characters', ['epb', 'draftClock', 'quietHours'], { startHour: 0, endHour: 6, timeZone: `Europe/${'X'.repeat(60)}` }, 'epb.draftClock.quietHours.timeZone'],
    ['unknown quiet time zone', ['epb', 'draftClock', 'quietHours'], { startHour: 0, endHour: 6, timeZone: 'Mars/Olympus_Mons' }, 'epb.draftClock.quietHours.timeZone'],
    ['extra quiet hours key', ['epb', 'draftClock', 'quietHours'], { startHour: 0, endHour: 6, timeZone: 'UTC', days: [1] }, 'epb.draftClock.quietHours'],
  ];
  it.each(cases)('%s', (_name, at, value, path) => {
    const pack = broken(at, value);
    const issues = formatPackIssues(pack);
    expect(issues.some((i) => i.startsWith(`${path}:`)), issues.join('\n')).toBe(true);
    expect(() => parseFormatPack(pack as FormatPack)).toThrow(/^\[format-pack\] invalid pack "example": /);
  });
});

describe('rule-conflict texts (pack-own keys)', () => {
  const withTexts = (en: unknown, de: unknown) => {
    const pack = broken(['messages', 'en', 'ruleConflicts'], en === undefined ? DELETE : en) as {
      messages: { de: Record<string, unknown> };
    };
    pack.messages.de.ruleConflicts = de;
    return pack;
  };

  it('accepts matching keys and placeholders', () => {
    expect(formatPackIssues(withTexts({ A: 'Row {row}: {text}' }, { A: '{text} in Zeile {row}' }))).toEqual([]);
  });

  it('rejects a German text whose placeholders differ', () => {
    const issues = formatPackIssues(withTexts({ A: 'Row {row}: {text}' }, { A: 'Zeile {row}' }));
    expect(issues.some((i) => i.startsWith('messages.de.ruleConflicts.A:'))).toBe(true);
  });

  it('rejects a key missing in one language', () => {
    const issues = formatPackIssues(withTexts({ A: 'a', B: 'b' }, { A: 'a' }));
    expect(issues.some((i) => i.startsWith('messages.de:') && i.includes('ruleConflicts.B'))).toBe(true);
  });

  it('rejects a missing map', () => {
    const issues = formatPackIssues(withTexts(undefined, {}));
    expect(issues.some((i) => i.startsWith('messages.en.ruleConflicts:'))).toBe(true);
  });

  it('ruleConflictText returns null for a key the active pack has no text for (the example pack has none)', () => {
    expect(formatPack.messages.en.ruleConflicts).toEqual({});
    expect(ruleConflictText('NO_SUCH_KEY', {}, 'de')).toBeNull();
  });
});

describe('schema accepts the new pack fields', () => {
  it.each([
    ['first-half comeback window', ['epb', 'comeback', 'earnWindow'], 'first_half'],
    ['2 tokens per progress', ['epb', 'participationPoints', 'comebackTokensPerProgress'], 2],
    ['a quiet window', ['epb', 'draftClock', 'quietHours'], { startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' }],
    ['a quiet window up to midnight', ['epb', 'draftClock', 'quietHours'], { startHour: 23, endHour: 24, timeZone: 'UTC' }],
    ['the longest quiet window (23 h)', ['epb', 'draftClock', 'quietHours'], { startHour: 1, endHour: 24, timeZone: 'UTC' }],
  ] as [string, (string | number)[], unknown][])('%s', (_name, at, value) => {
    expect(formatPackIssues(broken(at, value))).toEqual([]);
  });
});

describe('accessors (example pack values)', () => {
  it('line rules and stored flags', () => {
    expect(epbLineRuleForBase('Dratini')?.participationPoints).toBe(true);
    expect(epbLineRuleForBase('Bulbasaur')).toBeNull();
    expect(storedSpecialRulesForBase('Dratini')).toEqual({ [STORED_FLAG.participationPoints]: true, [STORED_FLAG.redraftLocked]: true });
    expect(storedSpecialRulesForBase('Grubbin')).toEqual({ scatterbug: true });
    expect(storedSpecialRulesForBase('Axew')).toEqual({ no_cocoon_rule: true });
    expect(storedSpecialRulesForBase('Bulbasaur')).toBeNull();
    expect(participationLineBase()).toBe('Dratini');
    expect(lineOverrideFor('dratini--dragonite')?.kills_to_stage2).toBe(5);
    expect(lineOverrideFor('bulbasaur--venusaur')).toBeNull();
  });

  it('comeback table, Tera, price groups and tabs', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((w) => comebackTokensFromTable(0, w))).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect(comebackTokensFromTable(1, 6)).toBe(0);
    expect([0, 1, 2, 3, 4].map(teraEligibilityForStage)).toEqual(['any', 'any', 'any', 'stab_only', 'stab_only']);
    expect([25, 20, 19, 10, 6, 5, 1, 0].map(priceGroupForPrice)).toEqual([
      'premium', 'premium', 'hoch', 'mittel', 'guenstig', 'budget', 'budget', 'budget',
    ]);
    expect([26, 25, 20, 15, 9, 1, 0].map(priceTabOf)).toEqual([null, '25-20', '25-20', '19-15', '9-1', '9-1', null]);
  });

  it('comeback earn window, tokens per progress and quiet hours', () => {
    expect(comebackEarnWindow()).toBe('season');
    expect(comebackTokensPerProgress(true)).toBe(1);
    expect(comebackTokensPerProgress(false)).toBe(1);
    expect(draftQuietHours()).toBeNull();
  });

  it('utility labels fall back to English, then to the key', () => {
    expect(utilityLabel('pivot', 'de')).toBe('Pivot');
    expect(utilityLabel('pivot', 'en')).toBe('Pivoting');
    expect(utilityLabel('unknown_key', 'de')).toBe('unknown_key');
  });
});

describe('definePackEn (type-level contract; tsc enforces the @ts-expect-error lines)', () => {
  it('accepts a tree with the contract keys and placeholders, and returns it unchanged', () => {
    const ok = definePackEn<typeof ExampleEn>()({ ...ExampleEn, utility: { anything: 'Anything' } } as const);
    expect(ok.utility.anything).toBe('Anything');
  });

  it('rejects a renamed placeholder, a missing key and an extra key', () => {
    const define = definePackEn<typeof ExampleEn>();
    // @ts-expect-error a renamed placeholder ({n} -> {m}) breaks the contract
    define({ ...ExampleEn, draftShared: { ...ExampleEn.draftShared, progress: { cosmoChip: '+{m} x' } } } as const);
    // @ts-expect-error a missing key breaks the contract
    define({ ...ExampleEn, draftRedraft: {} } as const);
    // @ts-expect-error an extra key breaks the contract
    define({ ...ExampleEn, draftRedraft: { ...ExampleEn.draftRedraft, extra: 'x' } } as const);
    expect(typeof define).toBe('function');
  });
});
