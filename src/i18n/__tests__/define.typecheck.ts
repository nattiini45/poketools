/**
 * Compile-time contract of the message types (i18n-core §1.3, §8.1).
 * Compiled by `tsc --noEmit`, never run (not a `*.test.ts`). Every
 * `@ts-expect-error` below must stay an error: if one starts compiling,
 * `tsc` reports the unused directive. G0-ERR appends the error-code cases.
 */
import type { ReactNode } from 'react';
import { createTranslator } from '../core';
import { defineDe, defineNamespace } from '../define';
import { bigFixtureMessages } from './fixtures/big-namespace';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { ApiError } from '@/types/api';

const en = {
  plain: 'Plain',
  greet: 'Hello {name}',
  two: '{a} vs. {b}',
  linked: 'Open the <link>rules</link>',
  count: { one: '{count} player', other: '{count} players' },
  scoped: { one: '{count} pick by {name}', other: '{count} picks by {name}' },
  group: { inner: { leaf: 'Leaf {x}' } },
} as const;

// ── Positive cases compile ──────────────────────────────────────────────────
const de = defineDe<typeof en>()({
  plain: 'Einfach',
  greet: 'Hallo {name}',
  two: '{b} gegen {a}',
  linked: 'Öffne die <link>Regeln</link>',
  count: { one: '{count} Spieler', other: '{count} Spieler' },
  scoped: { zero: 'Keine Picks', one: '{count} Pick von {name}', other: '{count} Picks von {name}' },
  group: { inner: { leaf: 'Blatt {x}' } },
});
const ns = defineNamespace('typecheck', en, de);
const t = createTranslator(ns, 'de');

export const positive: string[] = [
  t('plain'),
  t('greet', { name: 'Ash' }),
  t('two', { a: 1, b: 'x' }),
  t('linked'),
  t('count', { count: 2 }),
  t('scoped', { count: 1, name: 'Misty' }),
  t('group.inner.leaf', { x: 3 }),
  t.dynamic('anything.at.all'),
];
export const positiveRich: ReactNode = t.rich('linked', { link: (c) => c });

// The 250-key fixture namespace type-checks and resolves keys.
const big = createTranslator(bigFixtureMessages, 'en');
export const bigPositive: string[] = [
  big('group3.key1', { name: 'Ash', pokemon: 'Pikachu', points: 30 }),
  big('group9.key20', { count: 4 }),
  big('group0.key3'),
];

// ── Negative cases (each line must fail) ────────────────────────────────────
export const negativeDefinitions = [
  // missing key
  // @ts-expect-error -- `group` is missing
  defineDe<typeof en>()({
    plain: 'x', greet: 'Hallo {name}', two: '{a} {b}', linked: '<link>x</link>',
    count: { one: '{count}', other: '{count}' }, scoped: { one: '{count} {name}', other: '{count} {name}' },
  }),
  defineDe<typeof en>()({
    plain: 'x', greet: 'Hallo {name}', two: '{a} {b}', linked: '<link>x</link>',
    count: { one: '{count}', other: '{count}' }, scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
    // @ts-expect-error -- extra key
    extra: 'nope',
  }),
  defineDe<typeof en>()({
    plain: 'x',
    // @ts-expect-error -- renamed placeholder
    greet: 'Hallo {nom}',
    two: '{a} {b}', linked: '<link>x</link>',
    count: { one: '{count}', other: '{count}' }, scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
  }),
  defineDe<typeof en>()({
    plain: 'x', greet: 'Hallo {name}',
    // @ts-expect-error -- extra placeholder
    two: '{a} {b} {c}',
    linked: '<link>x</link>',
    count: { one: '{count}', other: '{count}' }, scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
  }),
  defineDe<typeof en>()({
    plain: 'x', greet: 'Hallo {name}', two: '{a} {b}',
    // @ts-expect-error -- renamed tag
    linked: '<a>x</a>',
    count: { one: '{count}', other: '{count}' }, scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
  }),
  defineDe<typeof en>()({
    plain: 'x', greet: 'Hallo {name}', two: '{a} {b}', linked: '<link>x</link>',
    // @ts-expect-error -- string where en has a plural object
    count: '{count} Spieler',
    scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
  }),
  defineDe<typeof en>()({
    // @ts-expect-error -- plural object where en has a string
    plain: { one: 'x', other: 'y' },
    greet: 'Hallo {name}', two: '{a} {b}', linked: '<link>x</link>',
    count: { one: '{count}', other: '{count}' }, scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
  }),
  defineDe<typeof en>()({
    plain: 'x', greet: 'Hallo {name}', two: '{a} {b}', linked: '<link>x</link>',
    // @ts-expect-error -- plural with an unknown placeholder
    count: { one: '{count} {who}', other: '{count}' },
    scoped: { one: '{count} {name}', other: '{count} {name}' },
    group: { inner: { leaf: '{x}' } },
  }),
];

export const negativeCalls = [
  // @ts-expect-error -- missing param
  t('greet'),
  // @ts-expect-error -- extra param
  t('plain', { name: 'x' }),
  // @ts-expect-error -- wrong param name
  t('greet', { nom: 'x' }),
  // @ts-expect-error -- plural without count
  t('count', {}),
  // @ts-expect-error -- unknown key
  t('nope'),
  // @ts-expect-error -- a group is not a leaf
  t('group.inner'),
  // @ts-expect-error -- rich tag renderer missing
  t.rich('linked', {}),
];

// ── Error-code contract (G0-ERR, i18n-core §4.1) ────────────────────────────
type DraftLikeCode = 'POOL_NOT_ACTIVE' | 'POKEMON_TAKEN';
const unionCode = 'POKEMON_TAKEN' as DraftLikeCode;

export const errorCodePositive: UserFacingError[] = [
  new UserFacingError('plain, no code'),
  new UserFacingError('literal code, no params', { code: 'SEED_CONFLICT', status: 409 }),
  new UserFacingError('literal code, its params', { code: 'SEED_CONFLICT', params: { seed: 3 } }),
  new UserFacingError('extra params are allowed', { code: 'SEED_CONFLICT', params: { seed: 3, slot_id: 'x' } }),
  new UserFacingError('plural code needs count', { code: 'REGENERATE_PLAYED', params: { count: 2 } }),
  // A union code (DraftErrorCode-style) accepts any Record<string, string | number>.
  new UserFacingError('union code', { code: unionCode, params: { anything: 1, other: 'x' } }),
];
export const errorBodyPositive: ApiError = { success: false, error: 'x', code: 'name_mismatch', params: { a: 1 } };

export const errorCodeNegative = [
  // @ts-expect-error -- unknown code
  new UserFacingError('x', { code: 'not_a_real_code' }),
  // @ts-expect-error -- literal code with a missing required param
  new UserFacingError('x', { code: 'SEED_CONFLICT', params: { slot: 3 } }),
  // @ts-expect-error -- plural code without count
  new UserFacingError('x', { code: 'REGENERATE_PLAYED', params: {} }),
  // @ts-expect-error -- a null param value is rejected
  new UserFacingError('x', { code: 'SEED_CONFLICT', params: { seed: null } }),
  // @ts-expect-error -- a null param value is rejected for a union code too
  new UserFacingError('x', { code: unionCode, params: { pokemon: null } }),
];
// @ts-expect-error -- ApiError.code must be a catalog key
export const errorBodyNegative: ApiError = { success: false, error: 'x', code: 'nope' };
