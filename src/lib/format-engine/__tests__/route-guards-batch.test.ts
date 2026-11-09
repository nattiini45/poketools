/**
 * The guards of generate-all-rounds that keep a batch inside the stage: the round a `rounds` end condition caps it at, the
 * refusal of a batch for an expression end condition, and the refusal of legs on groups that mirror league groups.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({ openForbiddenPairingCheck: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/calendar-server', () => ({ fillRoundDeadline: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ assertStageNotEnded: vi.fn() }));

import { UserFacingError } from '@/lib/api/user-facing-error';
import type { KitPhase } from '@/lib/format-engine/load';
import type { EndWhen } from '@/lib/format-kit/types';
import { assertBatchMayRunAhead, assertMirroredGroupsPlayLegs, batchRoundCap } from '../route-guards';

const phaseWith = (endWhen?: EndWhen, engine: KitPhase['engine'] = 'kit') =>
  ({ engine, stage: { key: 'league', ...(endWhen === undefined ? {} : { end_when: endWhen }) } }) as KitPhase;
const rounds: EndWhen = { kind: 'rounds', rounds: 4 };
const expr = { kind: 'expr', when: { k: 'bool', v: false } } as EndWhen;

describe('batchRoundCap', () => {
  it('caps a batch at the rounds bound of a kit stage', () => {
    expect(batchRoundCap(phaseWith(rounds))).toBe(4);
  });

  it('does not cap a stage without an end condition, with an expression, or off the kit engine', () => {
    expect(batchRoundCap(phaseWith())).toBeNull();
    expect(batchRoundCap(phaseWith(expr))).toBeNull();
    expect(batchRoundCap(phaseWith(rounds, 'shadow'))).toBeNull();
    expect(batchRoundCap(null)).toBeNull();
  });
});

describe('assertBatchMayRunAhead', () => {
  it('refuses two or more rounds for an expression bound (409)', () => {
    let thrown: unknown;
    try {
      assertBatchMayRunAhead(phaseWith(expr), 2);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UserFacingError);
    expect(thrown).toMatchObject({ code: 'rounds_batch_end_when_expression', statusCode: 409 });
  });

  it('lets a single round through, as generate-round would write it', () => {
    expect(() => assertBatchMayRunAhead(phaseWith(expr), 1)).not.toThrow();
    expect(() => assertBatchMayRunAhead(phaseWith(expr), 0)).not.toThrow();
  });

  it('passes a rounds bound (the batch is capped instead), no bound, and a phase off the kit engine', () => {
    expect(() => assertBatchMayRunAhead(phaseWith(rounds), 5)).not.toThrow();
    expect(() => assertBatchMayRunAhead(phaseWith(), 5)).not.toThrow();
    expect(() => assertBatchMayRunAhead(phaseWith(expr, 'shadow'), 5)).not.toThrow();
    expect(() => assertBatchMayRunAhead(null, 5)).not.toThrow();
  });
});

describe('assertMirroredGroupsPlayLegs', () => {
  it('refuses more than one leg on mirrored groups (409, with the legs)', () => {
    let thrown: unknown;
    try {
      assertMirroredGroupsPlayLegs({ legs: 3 }, true);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'rounds_mirrored_groups_legs', statusCode: 409, params: { legs: 3 } });
  });

  it('names a remedy the admin can apply (a single leg, or remove the league groups), in English and German', async () => {
    let thrown: Error | undefined;
    try {
      assertMirroredGroupsPlayLegs({ legs: 2 }, true);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toContain('Use a single leg, or remove the league groups.');
    // The stage cannot form its own groups while the league has any: never offer that.
    expect(thrown?.message).not.toMatch(/own groups/);
    const en = (await import('@/i18n/messages/errors/tournaments/en')).default.rounds_mirrored_groups_legs;
    const de = (await import('@/i18n/messages/errors/tournaments/de')).default.rounds_mirrored_groups_legs;
    expect(en).toContain('Use a single leg, or remove the league groups.');
    expect(en).not.toMatch(/own groups/);
    expect(de).toContain('entferne die Ligagruppen');
    expect(de).not.toMatch(/eigene Gruppen/);
  });

  it('passes one leg, the phase own groups, and a phase that is no kit round robin', () => {
    expect(() => assertMirroredGroupsPlayLegs({ legs: 1 }, true)).not.toThrow();
    expect(() => assertMirroredGroupsPlayLegs({ legs: 4 }, false)).not.toThrow();
    expect(() => assertMirroredGroupsPlayLegs(null, true)).not.toThrow();
  });
});
