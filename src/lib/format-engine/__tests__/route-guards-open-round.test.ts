/**
 * The guard of the round routes for a stage that ends on an expression: no round is written while an earlier round still
 * has unfinished matches, so the condition is evaluated (when that round's last match completes) before a later round
 * exists and a phase it ends never strands scheduled matches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({ openForbiddenPairingCheck: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/calendar-server', () => ({ fillRoundDeadline: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ assertStageNotEnded: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByTournament: vi.fn() }));

import { UserFacingError } from '@/lib/api/user-facing-error';
import type { KitPhase } from '@/lib/format-engine/load';
import type { EndWhen } from '@/lib/format-kit/types';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { assertNoOpenRoundBeforeNext, assertNoRoundOpenAhead, openRoundsOf } from '../route-guards';

const phaseWith = (endWhen?: EndWhen, engine: KitPhase['engine'] = 'kit') =>
  ({ engine, stage: { key: 'league', ...(endWhen === undefined ? {} : { end_when: endWhen }) } }) as KitPhase;
const rounds: EndWhen = { kind: 'rounds', rounds: 4 };
const expr = { kind: 'expr', when: { k: 'bool', v: false } } as EndWhen;

const round = (n: number, status: string) => ({ id: `r-${n}`, name: `Round ${n}`, round_number: n, status }) as never;
const match = (n: number, status: string) => ({ round_id: `r-${n}`, status });

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('openRoundsOf', () => {
  it('lists the rounds that are not completed and hold an unfinished match, lowest first', () => {
    const open = openRoundsOf(
      [round(3, 'active'), round(1, 'active'), round(2, 'completed'), round(4, 'pending')],
      [match(3, 'scheduled'), match(1, 'in_progress'), match(2, 'scheduled'), match(4, 'completed')],
    );
    expect(open.map((r) => r.round_number)).toEqual([1, 3]);
  });

  it('does not list a round without matches (an interrupted call left it empty to be filled)', () => {
    expect(openRoundsOf([round(1, 'pending')], [])).toEqual([]);
  });
});

describe('assertNoRoundOpenAhead', () => {
  it('refuses another round while a round still has unfinished matches (409, naming the round)', () => {
    const thrown = thrownBy(() =>
      assertNoRoundOpenAhead(phaseWith(expr), [round(1, 'active')], [match(1, 'completed'), match(1, 'scheduled')]),
    );
    expect(thrown).toBeInstanceOf(UserFacingError);
    expect(thrown).toMatchObject({ code: 'rounds_end_when_round_open', statusCode: 409, params: { round: 'Round 1' } });
    expect((thrown as Error).message).toContain('complete Round 1 anyway with a reason');
  });

  it('names the earliest open round when several are open', () => {
    const thrown = thrownBy(() =>
      assertNoRoundOpenAhead(phaseWith(expr), [round(2, 'active'), round(1, 'active')], [match(2, 'scheduled'), match(1, 'scheduled')]),
    );
    expect(thrown).toMatchObject({ params: { round: 'Round 1' } });
  });

  it('passes once every match of every round is completed, or the open round was completed by force', () => {
    expect(() => assertNoRoundOpenAhead(phaseWith(expr), [round(1, 'active')], [match(1, 'completed')])).not.toThrow();
    expect(() => assertNoRoundOpenAhead(phaseWith(expr), [round(1, 'completed')], [match(1, 'scheduled')])).not.toThrow();
    expect(() => assertNoRoundOpenAhead(phaseWith(expr), [], [])).not.toThrow();
  });

  it('passes a rounds bound, no bound, and a phase off the kit engine, whatever is open', () => {
    const open = [match(1, 'scheduled')];
    expect(() => assertNoRoundOpenAhead(phaseWith(rounds), [round(1, 'active')], open)).not.toThrow();
    expect(() => assertNoRoundOpenAhead(phaseWith(), [round(1, 'active')], open)).not.toThrow();
    expect(() => assertNoRoundOpenAhead(phaseWith(expr, 'shadow'), [round(1, 'active')], open)).not.toThrow();
    expect(() => assertNoRoundOpenAhead(null, [round(1, 'active')], open)).not.toThrow();
  });

  it('words the refusal in English and German with the round to finish', async () => {
    const en = (await import('@/i18n/messages/errors/tournaments/en')).default.rounds_end_when_round_open;
    const de = (await import('@/i18n/messages/errors/tournaments/de')).default.rounds_end_when_round_open;
    expect(en).toContain('{round}');
    expect(en).toContain('Finish the open matches');
    expect(en).toContain('complete {round} anyway with a reason');
    expect(de).toContain('{round}');
    expect(de).toContain('Beende die offenen Matches');
    expect(de).toContain('beende {round} trotzdem mit einer Begründung');
  });
});

describe('assertNoOpenRoundBeforeNext', () => {
  beforeEach(() => {
    vi.mocked(getMatchesByTournament).mockReset();
  });

  it('reads the phase matches and refuses while a round is open', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match(1, 'scheduled')] as never);
    await expect(assertNoOpenRoundBeforeNext('t-1', phaseWith(expr), [round(1, 'active')])).rejects.toMatchObject({
      code: 'rounds_end_when_round_open',
    });
    expect(getMatchesByTournament).toHaveBeenCalledWith('t-1');
  });

  it('passes when the matches are all completed', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match(1, 'completed')] as never);
    await expect(assertNoOpenRoundBeforeNext('t-1', phaseWith(expr), [round(1, 'active')])).resolves.toBeUndefined();
  });

  it('reads nothing for any other phase, or when every round is completed', async () => {
    await assertNoOpenRoundBeforeNext('t-1', phaseWith(rounds), [round(1, 'active')]);
    await assertNoOpenRoundBeforeNext('t-1', phaseWith(expr, 'shadow'), [round(1, 'active')]);
    await assertNoOpenRoundBeforeNext('t-1', null, [round(1, 'active')]);
    await assertNoOpenRoundBeforeNext('t-1', phaseWith(expr), [round(1, 'completed')]);
    await assertNoOpenRoundBeforeNext('t-1', phaseWith(expr), []);
    expect(getMatchesByTournament).not.toHaveBeenCalled();
  });
});
