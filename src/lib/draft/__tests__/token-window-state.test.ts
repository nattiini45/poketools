/**
 * The Draft Kill Token window is derived (`draftKillTokenWindow`, SQL twin inside `epb_purchase_draft_token`);
 * `draftKillTokenWindowMachine` documents how it moves. This holds the TS function, the SQL and the machine
 * together. No database.
 */
import { describe, expect, it } from 'vitest';
import { draftKillTokenWindow, type DraftKillWindow } from '../tokens';
import { draftKillTokenWindowMachine } from '../token-window-state';
import { latestFunctionBody } from './sql-function-body';

const NOW = new Date('2026-11-09T12:00:00Z');
const window = (i: Partial<Parameters<typeof draftKillTokenWindow>[0]>) =>
  draftKillTokenWindow({ initialPhase: 'complete', closesAt: null, anyLeagueMatchConfirmed: false, now: NOW, ...i });

describe('draft.kill_token_window', () => {
  it('has exactly the states draftKillTokenWindow returns', () => {
    const outputs = new Set<DraftKillWindow>([
      window({ initialPhase: 'drafting' }),
      window({}),
      window({ anyLeagueMatchConfirmed: true }),
    ]);
    expect([...outputs].sort()).toEqual([...draftKillTokenWindowMachine.spec.states].sort());
  });

  it('is before for every phase but complete (a reopened or cancelled initial draft included)', () => {
    for (const phase of ['setup', 'drafting', 'cancelled'] as const) expect(window({ initialPhase: phase })).toBe('before');
    expect(window({ initialPhase: null })).toBe('before');
  });

  it('closes at the close date itself, as the SQL twin does (now() >= token_purchase_closes_at)', () => {
    expect(window({ closesAt: '2026-11-09T12:00:00.001Z' })).toBe('open');
    expect(window({ closesAt: NOW.toISOString() })).toBe('closed');
    // A close date ahead keeps the window open after matches were played (the move_close_date transition).
    expect(window({ closesAt: '2026-12-01T00:00:00Z', anyLeagueMatchConfirmed: true })).toBe('open');

    const sql = latestFunctionBody('epb_purchase_draft_token');
    expect(sql).toMatch(/IF NOT FOUND OR v_initial\.phase <> 'complete' THEN\s+RAISE EXCEPTION 'TOKEN_WINDOW_CLOSED'[^;]*'window', 'before'/);
    expect(sql).toMatch(/IF v_initial\.token_purchase_closes_at IS NOT NULL THEN\s+v_closed := now\(\) >= v_initial\.token_purchase_closes_at;/);
    expect(sql).toMatch(/ELSE\s+v_closed := EXISTS \(SELECT 1 FROM public\.matches m[^;]*m\.status = 'completed'\);/);
    expect(sql).toMatch(/IF v_closed THEN\s+RAISE EXCEPTION 'TOKEN_WINDOW_CLOSED'[^;]*'window', 'closed'/);
  });

  it('every move the machine declares is one the function can make', () => {
    const inputsOf: Record<DraftKillWindow, Partial<Parameters<typeof draftKillTokenWindow>[0]>> = {
      before: { initialPhase: 'drafting' },
      open: { closesAt: '2026-12-01T00:00:00Z' },
      closed: { closesAt: '2026-11-01T00:00:00Z' },
    };
    for (const t of draftKillTokenWindowMachine.spec.transitions) {
      expect(window(inputsOf[t.to as DraftKillWindow]), t.event).toBe(t.to);
    }
  });
});
