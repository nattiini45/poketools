import { describe, expect, it } from 'vitest';
import { createTranslator, isPluralForms, lookupPath } from '@/i18n/core';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { REASON_CODES, isReasonCode, reasonMessageKey, reasonParams, reasonText } from '@/lib/draft-ui/reasons';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { ReasonCode } from '@/lib/draft-ui/snapshot-types';
import { MISTY, snapshot } from './fixtures';

const isLeaf = (v: unknown): boolean => typeof v === 'string' || isPluralForms(v);

const en = createTranslator(draftSharedMessages, 'en');
const de = createTranslator(draftSharedMessages, 'de');
const vm = toDraftViewModel(snapshot());

/** Compile-time: `REASON_CODES` holds every member of the union. */
type Missing = Exclude<ReasonCode, (typeof REASON_CODES)[number]>;
const exhaustive: [Missing] extends [never] ? true : false = true;

describe('REASON_CODES', () => {
  it('lists every ReasonCode once', () => {
    expect(exhaustive).toBe(true);
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
    expect(REASON_CODES).toContain('NOT_ENOUGH_LINES');
    expect(REASON_CODES).toContain('POOL_NOT_COMPLETABLE');
    expect(REASON_CODES).toContain('POOL_CHECK_LIMIT');
    expect(REASON_CODES).toHaveLength(19);
  });

  it('every ReasonCode has a draft/shared.reasons key in both languages', () => {
    for (const code of REASON_CODES) {
      expect(isLeaf(lookupPath(draftSharedMessages.en, `reasons.${code}`)), code).toBe(true);
      expect(isLeaf(lookupPath(draftSharedMessages.de, `reasons.${code}`)), code).toBe(true);
    }
  });

  it('en and de reasons hold the same keys: every ReasonCode, plus only *_PLAIN variants of them', () => {
    const enKeys = Object.keys(draftSharedMessages.en.reasons).sort();
    const deKeys = Object.keys(draftSharedMessages.de.reasons).sort();
    expect(deKeys).toEqual(enKeys);
    for (const code of REASON_CODES) expect(enKeys, code).toContain(code);
    const codes = new Set<string>(REASON_CODES);
    for (const key of enKeys) expect(codes.has(key.replace(/_PLAIN$/, '')), key).toBe(true);
  });

  it('every *_PLAIN fallback the helpers can select exists', () => {
    for (const code of REASON_CODES) {
      const key = reasonMessageKey({ code });
      expect(isLeaf(lookupPath(draftSharedMessages.en, key)), key).toBe(true);
      expect(isLeaf(lookupPath(draftSharedMessages.de, key)), key).toBe(true);
    }
  });

  it('recognises reason codes at runtime', () => {
    expect(isReasonCode('LINE_TAKEN')).toBe(true);
    expect(isReasonCode('line_taken')).toBe(false);
    expect(isReasonCode('toString')).toBe(false);
  });
});

describe('reasonParams', () => {
  it('maps LINE_TAKEN player_id to the participant name', () => {
    expect(reasonParams({ code: 'LINE_TAKEN', params: { player_id: MISTY } }, vm)).toEqual({ player: 'Misty' });
  });

  it('passes other params through', () => {
    expect(reasonParams({ code: 'INSUFFICIENT_BUDGET', params: { price: 30, remaining: 20 } }, vm)).toEqual({
      price: 30,
      remaining: 20,
    });
  });
});

describe('reasonText', () => {
  it('renders LINE_TAKEN with the owner name in both languages', () => {
    const reason = { code: 'LINE_TAKEN', params: { player_id: MISTY } } as const;
    expect(reasonText(en, reason, vm)).toBe('Already drafted by Misty.');
    expect(reasonText(de, reason, vm)).toBe('Bereits von Misty gedraftet.');
  });

  it('falls back to "another player" for an unknown owner', () => {
    const reason = { code: 'LINE_TAKEN', params: { player_id: 'nobody' } } as const;
    expect(reasonText(en, reason, vm)).toBe('Already drafted by another player.');
    expect(reasonText(de, reason, vm)).toBe('Bereits von einem anderen Spieler gedraftet.');
  });

  it('renders templated reasons', () => {
    expect(reasonText(en, { code: 'INSUFFICIENT_BUDGET', params: { price: 30, remaining: 20 } }, vm)).toBe(
      'Not enough points: costs 30 P, you have 20 P.',
    );
  });

  it('pluralises NOT_ENOUGH_LINES on the available lines', () => {
    const r = (available: number) => ({ code: 'NOT_ENOUGH_LINES', params: { slots: 3, available } }) as const;
    expect(reasonText(en, r(2), vm)).toBe('Not draftable – only 2 lines are left for your last 3 roster slots.');
    expect(reasonText(en, r(1), vm)).toBe('Not draftable – only 1 line is left for your last 3 roster slots.');
    expect(reasonText(en, r(0), vm)).toBe('Not draftable – no lines are left to fill your roster.');
    expect(reasonText(de, r(2), vm)).toBe('Nicht draftbar – für deine letzten 3 Kaderplätze sind nur noch 2 Linien übrig.');
    expect(reasonText(de, r(1), vm)).toBe('Nicht draftbar – für deine letzten 3 Kaderplätze ist nur noch 1 Linie übrig.');
    expect(reasonText(de, r(0), vm)).toBe('Nicht draftbar – es ist keine Linie mehr übrig, um deinen Kader zu füllen.');
  });

  it('pluralises ROSTER_FULL on the roster size', () => {
    const r = (size: number) => ({ code: 'ROSTER_FULL', params: { size } }) as const;
    expect(reasonParams(r(1), vm)).toEqual({ size: 1, count: 1 });
    expect(reasonText(en, r(1), vm)).toBe('Your roster is full (1 line).');
    expect(reasonText(en, r(9), vm)).toBe('Your roster is full (9 lines).');
    expect(reasonText(de, r(1), vm)).toBe('Dein Kader ist voll (1 Linie).');
    expect(reasonText(de, r(9), vm)).toBe('Dein Kader ist voll (9 Linien).');
  });

  it('pluralises BUDGET_INFEASIBLE on the slots', () => {
    expect(reasonText(de, { code: 'BUDGET_INFEASIBLE', params: { shortfall: 4, slots: 1 } }, vm)).toBe(
      'Nicht draftbar – nach diesem Pick fehlen dir mindestens 4 Punkte, um deinen letzten Kaderplatz zu füllen.',
    );
  });

  it('uses BUDGET_INFEASIBLE_PLAIN without shortfall/slots', () => {
    expect(reasonMessageKey({ code: 'BUDGET_INFEASIBLE' })).toBe('reasons.BUDGET_INFEASIBLE_PLAIN');
    expect(reasonText(en, { code: 'BUDGET_INFEASIBLE' }, vm)).toBe(
      'This pick would make your remaining roster slots unaffordable.',
    );
    expect(reasonText(en, { code: 'BUDGET_INFEASIBLE', params: { shortfall: 7, slots: 3 } }, vm)).toBe(
      'Not draftable – after this pick you would be at least 7 points short of filling your last 3 roster slots.',
    );
  });

  it('renders viewer-level reasons', () => {
    expect(reasonText(de, { code: 'NOT_YOUR_TURN' }, vm)).toBe('Du bist nicht am Zug.');
    expect(reasonText(en, { code: 'DRAFT_PAUSED', params: { reason: 'admin' } }, vm)).toBe('The draft is paused.');
    expect(reasonText(en, { code: 'ROSTER_FULL', params: { size: 9 } }, vm)).toBe('Your roster is full (9 lines).');
  });
});
