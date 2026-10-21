import { describe, expect, it } from 'vitest';
import {
  ROLL_CALL_GATE_IDLE,
  ROLL_CALL_LEAD_MS,
  ROLL_CALL_PULSE_MS,
  ROLL_CALL_STEP_MS,
  nextRollCallTick,
  rollCallCallAt,
  rollCallDoneAt,
  rollCallLights,
  rollCallTicks,
  stepRollCallGate,
  type RollCallGate,
  type RollCallGateInput,
} from '../roll-call';

const base: RollCallGateInput = {
  station: 0,
  settled: false,
  teamsIndex: 2,
  skipActive: false,
  skipTo: 0,
  reducedMotion: false,
};

describe('roll-call stagger', () => {
  it('calls one column every 140 ms, left to right, after the lead', () => {
    expect(ROLL_CALL_STEP_MS).toBe(140);
    expect([0, 1, 2, 7].map(rollCallCallAt)).toEqual([ROLL_CALL_LEAD_MS, ROLL_CALL_LEAD_MS + 140, ROLL_CALL_LEAD_MS + 280, ROLL_CALL_LEAD_MS + 980]);
  });

  it('lights rest → calling → called per column, never dimmer than rest', () => {
    expect(rollCallLights(4, null)).toEqual(['rest', 'rest', 'rest', 'rest']);
    expect(rollCallLights(4, ROLL_CALL_LEAD_MS - 1)).toEqual(['rest', 'rest', 'rest', 'rest']);
    expect(rollCallLights(4, rollCallCallAt(1) + 1)).toEqual(['calling', 'calling', 'rest', 'rest']);
    expect(rollCallLights(4, rollCallCallAt(0) + ROLL_CALL_PULSE_MS + 1)[0]).toBe('called');
    expect(rollCallLights(4, rollCallDoneAt(4) + 1)).toEqual(['called', 'called', 'called', 'called']);
  });

  it('repaints only on its ticks (≤ 2 N), in order', () => {
    const ticks = rollCallTicks(8);
    expect(ticks.length).toBeLessThanOrEqual(16);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(nextRollCallTick(8, 0)).toBe(ticks[0]);
    expect(nextRollCallTick(8, rollCallDoneAt(8))).toBeNull();
    // The lights change only at a tick.
    for (let t = 0; t < rollCallDoneAt(8); t += 10) {
      const next = nextRollCallTick(8, t);
      if (next === null) break;
      expect(rollCallLights(8, t)).toEqual(rollCallLights(8, Math.max(t, next - 0.5)));
    }
  });
});

describe('roll-call arrival gate', () => {
  function run(steps: Partial<RollCallGateInput>[]): { starts: number; leaves: number } {
    let gate: RollCallGate = ROLL_CALL_GATE_IDLE;
    let starts = 0;
    let leaves = 0;
    for (const step of steps) {
      const out = stepRollCallGate(gate, { ...base, ...step });
      gate = out.gate;
      if (out.start) starts += 1;
      if (out.leave) leaves += 1;
    }
    return { starts, leaves };
  }

  it('fires once per arrival (the rising edge of settled at teams)', () => {
    expect(run([{ station: 1 }, { station: 2 }, { station: 2, settled: true }, { station: 2, settled: true }, { station: 2, settled: true }])).toEqual({ starts: 1, leaves: 0 });
  });

  it('does not replay while settled (micro-scroll keeps the latch) and re-arms after leaving', () => {
    expect(
      run([
        { station: 2, settled: true },
        { station: 2, settled: true },
        { station: 2, settled: false },
        { station: 3, settled: true },
        { station: 2, settled: true },
      ]),
    ).toEqual({ starts: 2, leaves: 1 });
  });

  it('never fires for a skip-through passing the teams station', () => {
    expect(run([{ station: 2, settled: true, skipActive: true, skipTo: 4 }, { station: 3 }, { station: 4, settled: true }])).toEqual({ starts: 0, leaves: 0 });
  });

  it('fires when a skip-through lands ON teams', () => {
    expect(run([{ station: 2, settled: true, skipActive: true, skipTo: 2 }])).toEqual({ starts: 1, leaves: 0 });
  });

  it('never animates under reduced motion (and cannot fire late after it)', () => {
    expect(run([{ station: 2, settled: true, reducedMotion: true }, { station: 2, settled: true }])).toEqual({ starts: 0, leaves: 0 });
  });
});
