/**
 * Runtime validation of a format pack (design spec §B.2). Client-safe (zod only).
 *
 * Every section is `.strict()`; the cross-field rules run in `superRefine`, each with a path and
 * a message. `parseFormatPack` throws one error listing every issue; `formatPackIssues` returns
 * them (the contract test uses it on deliberately broken packs).
 */
import { z } from 'zod';
import type { TierKey } from '@/types/ruleset';
import { isKnownTimeZone, isValidQuietHours } from './quiet-hours';
import type { ComebackEarnWindow, FormatPack } from './types';

const PRICE_GROUP_KEYS = ['premium', 'hoch', 'mittel', 'guenstig', 'budget'] as const;
const TIEBREAKER_STEPS = ['match_points', 'evolution_points', 'kill_difference', 'head_to_head', 'decision_match'] as const;
const TEAM_ROLE_CATEGORIES = [
  'hazard_setting',
  'hazard_removal',
  'healing_cleric',
  'momentum',
  'item_removal',
  'status',
  'priority',
  'disruption',
] as const;
const POWER_TIERS = ['S', 'A', 'B', 'C'] as const;
const COMEBACK_EARN_WINDOWS = ['season', 'first_half'] as const satisfies readonly ComebackEarnWindow[];
/**
 * Upper bound of `participationPoints.comebackTokensPerProgress` and `participationPoints.draftKillTokensPerProgress`
 * (a sanity cap, not a league value).
 */
const MAX_COMEBACK_TOKENS_PER_PROGRESS = 10;
/** The singles tier hierarchy (`TierKey`, src/types/ruleset.ts). */
const TIER_KEYS = ['ZU', 'PU', 'PUBL', 'NU', 'NUBL', 'RU', 'RUBL', 'UU', 'UUBL', 'OU', 'Uber', 'AG'] as const satisfies readonly TierKey[];

const LINE_ID = /^[a-z0-9]+--[a-z0-9]+$/;
const UTILITY_KEY = /^[a-z][a-z0-9_]*$/;
const PKMN_ID = /^[a-z0-9]+$/;
const TAB_KEY = /^[\w-]+$/;
const DE_HASH = /^[0-9a-f]{8}$/;

const nonNegInt = z.number().int().min(0);
const posInt = z.number().int().min(1);
const nonEmpty = z.string().min(1);
const tera = z.enum(['any', 'stab_only', 'none']);
const priceGroup = z.enum(PRICE_GROUP_KEYS);
const teamRoleCategory = z.enum(TEAM_ROLE_CATEGORIES);
const range = z.tuple([nonNegInt, nonNegInt]);
const strRecord = z.record(z.string(), z.string());

const lineRule = z
  .object({
    base: nonEmpty,
    participationPoints: z.boolean().optional(),
    redraftLocked: z.boolean().optional(),
    instantFinalStage: z.boolean().optional(),
    noCocoon: z.boolean().optional(),
    expectedThresholds: z
      .object({ killsToStage2: nonNegInt, additionalKillsToStage3: nonNegInt.nullable() })
      .strict()
      .optional(),
  })
  .strict();

const lineOverride = z
  .object({
    line_id: z.string().regex(LINE_ID, 'must look like a line id (base--final)'),
    kills_to_stage2: nonNegInt.optional(),
    additional_kills_to_stage3: nonNegInt.optional(),
    reason: z.object({ en: nonEmpty, de: nonEmpty }).strict(),
    source: nonEmpty,
  })
  .strict();

const utilityMember = z
  .object({
    kind: z.enum(['move', 'ability']),
    id: z.string().regex(PKMN_ID, 'must be a lower-case @pkmn id'),
    inParentMatch: z.boolean(),
    source: z.enum(['sheet', 'authored']),
    flag: nonEmpty.optional(),
  })
  .strict();

const columns = z
  .object({
    lineNumber: nonNegInt,
    startName: nonNegInt,
    evolutionLine: nonNegInt,
    legacyTier: nonNegInt,
    price: nonNegInt,
    priceGroup: nonNegInt,
    killsToStage2: nonNegInt,
    additionalKillsToStage3: nonNegInt,
    rationale: nonNegInt,
    historical: nonNegInt,
    early: nonNegInt,
    mid: nonNegInt,
    late: nonNegInt,
    specialRulesText: nonNegInt,
    sources: nonNegInt,
  })
  .strict();

const workbook = z
  .object({
    pointBuy: z
      .object({
        sheet: nonEmpty,
        defaultListName: nonEmpty,
        overviewSheet: nonEmpty.nullable(),
        rulesSheet: nonEmpty.nullable(),
        columns,
        skipStartNames: z.array(nonEmpty),
        priceGroupSpellings: z.record(z.string(), priceGroup),
        overviewGroupLabels: z.object({
          premium: nonEmpty,
          hoch: nonEmpty,
          mittel: nonEmpty,
          guenstig: nonEmpty,
          budget: nonEmpty,
        }).strict(),
        overviewLabels: z.object({ lineCount: nonEmpty, averagePrice: nonEmpty }).strict(),
      })
      .strict(),
    utilitySheet: z
      .object({
        sheet: nonEmpty,
        categories: z.array(nonEmpty).min(1),
        branchMarkers: z.record(
          z.string(),
          z.object({ species: nonEmpty, line: z.tuple([nonEmpty, nonEmpty]) }).strict(),
        ),
        typos: strRecord,
        exact: strRecord,
        moveRenames: strRecord,
      })
      .strict(),
    teamRoles: z
      .object({
        sheets: z.tuple([nonEmpty, nonEmpty]),
        categoryLabels: z.record(z.string(), teamRoleCategory),
        blocks: z.array(
          z
            .object({ label: nonEmpty, category: teamRoleCategory, speciesCol: nonNegInt, moveCol: nonNegInt })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

const quietHours = z
  .object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    timeZone: z.string().min(1).max(64).refine(isKnownTimeZone, 'must be a known IANA time zone'),
  })
  .strict()
  .refine((q) => q.startHour < q.endHour, { message: 'startHour must be less than endHour', path: ['endHour'] })
  .refine((q) => q.endHour - q.startHour <= 23, {
    message: 'the window must leave the pick clock running at least one hour a day',
    path: ['endHour'],
  })
  // Backstop: the whole rule the draft clock, the pool-creation route and draft__cfg_quiet apply. A pack they would
  // refuse (every pool creation would fail) is refused at load instead; the checks above only name the field.
  .refine(isValidQuietHours, { message: 'is not a valid draft quiet-hours window (isValidQuietHours)' });

const ruleChecksHook = z.custom<NonNullable<FormatPack['epb']['reconciliation']['ruleChecks']>>(
  (v) => typeof v === 'function',
  'must be a function',
);

const messageTree = z.record(z.string(), z.unknown());

const formatPackSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a lower-case slug'),
    epb: z
      .object({
        defaults: z
          .object({
            draftBudget: posInt,
            draftPicks: posInt,
            tokenRatio: posInt,
            tokenMax: nonNegInt,
            tokenMaxPerLine: nonNegInt,
            redraftMaxLines: nonNegInt,
            bannedMoves: z.array(nonEmpty),
            bannedItems: z.array(nonEmpty),
          })
          .strict(),
        matchPoints: z.object({ win: nonNegInt, draw: nonNegInt }).strict(),
        teraByStage: z.object({ stage1: tera, stage2: tera, stage3: tera }).strict(),
        tiebreakerChain: z.array(z.enum(TIEBREAKER_STEPS)),
        comeback: z
          .object({
            table: z.array(z.object({ minWinnerSurvivors: posInt, tokens: posInt }).strict()),
            earnWindow: z.enum(COMEBACK_EARN_WINDOWS),
          })
          .strict(),
        stageLock: z
          .object({ enabled: z.boolean(), stage: posInt, byMatchday: posInt, suspendMatchdays: posInt })
          .strict(),
        participationPoints: z
          .object({
            perMatchday: posInt,
            untilStage: posInt,
            locksRedraft: z.boolean(),
            awardNote: nonEmpty,
            comebackTokensPerProgress: z.number().int().min(1).max(MAX_COMEBACK_TOKENS_PER_PROGRESS),
            draftKillTokensPerProgress: z.number().int().min(1).max(MAX_COMEBACK_TOKENS_PER_PROGRESS).optional(),
          })
          .strict(),
        draftClock: z.object({ quietHours: quietHours.nullable() }).strict(),
        priceGroups: z
          .object({ premium: range, hoch: range, mittel: range, guenstig: range, budget: range })
          .strict(),
        priceGroupOrder: z.array(priceGroup),
        priceTabs: z.array(z.object({ key: z.string(), min: nonNegInt, max: nonNegInt }).strict()),
        lineRules: z.array(lineRule),
        lineOverrides: z.array(lineOverride),
        specialRulesEn: z.record(z.string(), z.object({ de_hash: z.string(), en: nonEmpty }).strict()),
        utility: z
          .object({
            order: z.array(z.string()),
            categories: z.array(z.object({ key: z.string(), members: z.array(utilityMember) }).strict()),
            dropped: z.array(z.object({ id: z.string().regex(PKMN_ID), reason: nonEmpty }).strict()),
          })
          .strict(),
        workbook,
        reconciliation: z
          .object({
            knownRepoOnlyBanIds: z.array(z.string().regex(PKMN_ID)),
            pastStatusHealingIds: z.array(z.string().regex(PKMN_ID)),
            ruleChecks: ruleChecksHook.optional(),
            overrideRowPattern: nonEmpty.optional(),
          })
          .strict(),
      })
      .strict(),
    draftFormat: z
      .object({
        tierLimitDefaults: z.object({ S: nonNegInt, A: nonNegInt, B: nonNegInt, C: nonNegInt }).strict(),
        newTier: z.object({ stage2Kos: nonNegInt, stage3Kos: nonNegInt, tier: z.enum(POWER_TIERS) }).strict(),
        newWildcard: z.object({ stage2Kos: nonNegInt, stage3Kos: nonNegInt }).strict(),
        hintSpecies: z.tuple([nonEmpty, nonEmpty]),
      })
      .strict(),
    coreLiga: z
      .object({
        newTripleDefault: z.tuple([nonEmpty, nonEmpty, nonEmpty]),
        typeQuotaDefault: z
          .object({ source: z.literal('player_core'), min: posInt, multiCount: z.boolean() })
          .strict(),
        evioliteCapTierDefault: z.enum(TIER_KEYS),
      })
      .strict(),
    messages: z.object({ en: messageTree, de: messageTree }).strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const { epb } = pack;

    // 1. Price groups: each key once in the order; ranges min <= max, disjoint, descending by the order.
    const order = epb.priceGroupOrder;
    if (order.length !== PRICE_GROUP_KEYS.length || new Set(order).size !== order.length) {
      issue(['epb', 'priceGroupOrder'], `must hold each of ${PRICE_GROUP_KEYS.join(', ')} exactly once`);
    } else {
      order.forEach((g, i) => {
        const [min, max] = epb.priceGroups[g];
        if (min > max) issue(['epb', 'priceGroups', g], `min ${min} > max ${max}`);
        if (i > 0) {
          const [prevMin] = epb.priceGroups[order[i - 1]];
          if (max >= prevMin) issue(['epb', 'priceGroups', g], `must lie below ${order[i - 1]} (max ${max} >= ${prevMin})`);
        }
      });
    }

    // 2. Price tabs: 1..6, key shape, not 'all', unique, disjoint, descending.
    const tabs = epb.priceTabs;
    if (tabs.length < 1 || tabs.length > 6) issue(['epb', 'priceTabs'], 'must hold 1 to 6 tabs');
    const tabKeys = new Set<string>();
    tabs.forEach((tab, i) => {
      if (!TAB_KEY.test(tab.key) || tab.key === 'all') issue(['epb', 'priceTabs', i, 'key'], `invalid tab key "${tab.key}"`);
      if (tabKeys.has(tab.key)) issue(['epb', 'priceTabs', i, 'key'], `duplicate tab key "${tab.key}"`);
      tabKeys.add(tab.key);
      if (tab.min > tab.max) issue(['epb', 'priceTabs', i], `min ${tab.min} > max ${tab.max}`);
      if (i > 0 && tab.max >= tabs[i - 1].min) issue(['epb', 'priceTabs', i], 'tabs must be disjoint and descending');
    });

    // 3. Utility: order = the category keys, unique, key shape.
    const catKeys = epb.utility.categories.map((c) => c.key);
    const orderKeys = epb.utility.order;
    if (new Set(orderKeys).size !== orderKeys.length) issue(['epb', 'utility', 'order'], 'keys must be unique');
    if (new Set(catKeys).size !== catKeys.length) issue(['epb', 'utility', 'categories'], 'keys must be unique');
    orderKeys.forEach((k, i) => {
      if (!UTILITY_KEY.test(k)) issue(['epb', 'utility', 'order', i], `invalid utility key "${k}"`);
    });
    const sameSet = catKeys.length === orderKeys.length && orderKeys.every((k) => catKeys.includes(k));
    if (!sameSet) issue(['epb', 'utility', 'order'], 'must list exactly the category keys');

    // 4. Tiebreaker chain: non-empty, unique, decision_match last.
    const chain = epb.tiebreakerChain;
    if (chain.length === 0) issue(['epb', 'tiebreakerChain'], 'must not be empty');
    if (new Set(chain).size !== chain.length) issue(['epb', 'tiebreakerChain'], 'steps must be unique');
    const decision = chain.indexOf('decision_match');
    if (decision !== -1 && decision !== chain.length - 1) issue(['epb', 'tiebreakerChain'], 'decision_match must be last');

    // 5. Comeback table: winner survivors strictly ascending in 1..6, tokens strictly ascending.
    epb.comeback.table.forEach((row, i) => {
      if (row.minWinnerSurvivors > 6) issue(['epb', 'comeback', 'table', i], 'minWinnerSurvivors must be 1..6');
      if (i > 0) {
        const prev = epb.comeback.table[i - 1];
        if (row.minWinnerSurvivors <= prev.minWinnerSurvivors) issue(['epb', 'comeback', 'table', i], 'minWinnerSurvivors must ascend strictly');
        if (row.tokens <= prev.tokens) issue(['epb', 'comeback', 'table', i], 'tokens must ascend strictly');
      }
    });

    // 6. Stage lock.
    if (epb.stageLock.stage !== 2 && epb.stageLock.stage !== 3) issue(['epb', 'stageLock', 'stage'], 'must be 2 or 3');

    // 7. Participation points; SQL agreement: a participation line is redraft-locked when locksRedraft.
    const until = epb.participationPoints.untilStage;
    if (until !== 2 && until !== 3) issue(['epb', 'participationPoints', 'untilStage'], 'must be 2 or 3');
    epb.lineRules.forEach((rule, i) => {
      if (epb.participationPoints.locksRedraft && rule.participationPoints && !rule.redraftLocked) {
        issue(['epb', 'lineRules', i, 'redraftLocked'], 'a participation line must be redraftLocked while locksRedraft is true (SQL reads no_redraft)');
      }
    });

    // 8. Line rules unique by base; overrides unique by line id and set a threshold.
    const bases = new Set<string>();
    epb.lineRules.forEach((rule, i) => {
      if (bases.has(rule.base)) issue(['epb', 'lineRules', i, 'base'], `duplicate base "${rule.base}"`);
      bases.add(rule.base);
    });
    const overrideIds = new Set<string>();
    epb.lineOverrides.forEach((o, i) => {
      if (overrideIds.has(o.line_id)) issue(['epb', 'lineOverrides', i, 'line_id'], `duplicate line id "${o.line_id}"`);
      overrideIds.add(o.line_id);
      if (o.kills_to_stage2 === undefined && o.additional_kills_to_stage3 === undefined) {
        issue(['epb', 'lineOverrides', i], 'must set kills_to_stage2 or additional_kills_to_stage3');
      }
    });

    // 9. Special-rule prose keys and hashes.
    for (const [lineId, entry] of Object.entries(epb.specialRulesEn)) {
      if (!LINE_ID.test(lineId)) issue(['epb', 'specialRulesEn', lineId], 'key must look like a line id');
      if (!DE_HASH.test(entry.de_hash)) issue(['epb', 'specialRulesEn', lineId, 'de_hash'], 'must be 8 lower-case hex digits');
    }

    // 10. Workbook columns are distinct.
    const cols = Object.values(epb.workbook.pointBuy.columns);
    if (new Set(cols).size !== cols.length) issue(['epb', 'workbook', 'pointBuy', 'columns'], 'column indices must be distinct');

    // 11. Messages: same deep key set in en and de, no empty leaf, a label per utility key.
    const enKeys = leafPaths(pack.messages.en, (path, message) => issue(['messages', 'en', ...path], message));
    const deKeys = leafPaths(pack.messages.de, (path, message) => issue(['messages', 'de', ...path], message));
    for (const k of enKeys) if (!deKeys.has(k)) issue(['messages', 'de'], `missing key ${k}`);
    for (const k of deKeys) if (!enKeys.has(k)) issue(['messages', 'en'], `missing key ${k}`);
    for (const key of orderKeys) {
      for (const locale of ['en', 'de'] as const) {
        const labels = pack.messages[locale].utility;
        const label = isRecord(labels) ? labels[key] : undefined;
        if (typeof label !== 'string' || label.length === 0) issue(['messages', locale, 'utility', key], 'missing utility label');
      }
    }
    // Rule-conflict texts (pack-own keys, not type-checked against the contract): a map in both languages, and each
    // text has the same placeholders in en and de (the key sets are compared above).
    const conflictTexts = { en: pack.messages.en.ruleConflicts, de: pack.messages.de.ruleConflicts };
    for (const locale of ['en', 'de'] as const) {
      if (!isRecord(conflictTexts[locale])) issue(['messages', locale, 'ruleConflicts'], 'must be an object (may be empty)');
    }
    if (isRecord(conflictTexts.en) && isRecord(conflictTexts.de)) {
      for (const [key, en] of Object.entries(conflictTexts.en)) {
        const de = conflictTexts.de[key];
        if (typeof en !== 'string' || typeof de !== 'string') continue;
        if (placeholdersOf(en) !== placeholdersOf(de)) {
          issue(['messages', 'de', 'ruleConflicts', key], `placeholders differ from en (${placeholdersOf(en) || 'none'})`);
        }
      }
    }
  });

/** The sorted, de-duplicated `{name}` placeholders of a message, joined (for an equality check). */
function placeholdersOf(text: string): string {
  return [...new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))].sort().join(',');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const PLURAL_FORMS = new Set(['zero', 'one', 'other']);

/** Dotted leaf paths of a message tree (a plural object is one leaf); reports non-string / empty leaves. */
function leafPaths(
  tree: Record<string, unknown>,
  report: (path: string[], message: string) => void,
): Set<string> {
  const out = new Set<string>();
  const walk = (node: Record<string, unknown>, prefix: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (typeof value === 'string') {
        if (value.trim().length === 0) report(path, 'empty message');
        out.add(path.join('.'));
      } else if (isRecord(value)) {
        const keys = Object.keys(value);
        const plural = keys.length > 0 && keys.every((k) => PLURAL_FORMS.has(k)) && 'other' in value;
        if (plural) {
          for (const k of keys) {
            const form = value[k];
            if (typeof form !== 'string' || form.trim().length === 0) report([...path, k], 'empty plural form');
          }
          out.add(path.join('.'));
        } else {
          walk(value, path);
        }
      } else {
        report(path, 'a message leaf must be a string or a plural object');
      }
    }
  };
  walk(tree, []);
  return out;
}

/** Every validation issue of `raw` as `path: message` (empty when the pack is valid). */
export function formatPackIssues(raw: unknown): string[] {
  const result = formatPackSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
}

/**
 * Validates a pack and returns it unchanged (the zod output is discarded, so the pack's own
 * object and its hook survive). Throws `[format-pack] invalid pack "<id>": …` listing every issue.
 */
export function parseFormatPack<P extends FormatPack>(raw: P): P {
  const issues = formatPackIssues(raw);
  if (issues.length > 0) {
    const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : '?';
    throw new Error(`[format-pack] invalid pack "${id}": ${issues.join('; ')}`);
  }
  return raw;
}
