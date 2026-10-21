/**
 * Roll-call light stagger (fidelity wave 2, seat 2G; WAVE-PLAN §1 "Teams",
 * §2 "2G TEAMS", decision D16).
 *
 * When the visitor ARRIVES at the teams station (the single latched
 * `settled` signal — never raw x.5 progress, anti-pattern §5.4), the ledger
 * calls its columns left to right: every `ROLL_CALL_STEP_MS` one more column
 * lights, and the column just called pulses its gym-band chip for
 * `ROLL_CALL_PULSE_MS`. The ledger is repainted only on those ticks (a
 * board-local canvas repaint — no per-frame work, no shader, no draw call).
 *
 * The ledger is READABLE in every state: `rest` is the full-contrast face
 * (≥ 4.5:1 — the painter's law); `called` and `calling` only add light. So a
 * visitor who arrives mid-sweep, or never triggers one (reduced motion,
 * a skip-through pass), still reads every name.
 *
 * Once per arrival: the gate below fires on the rising edge of
 * "settled at teams" only. The settle latch's own hysteresis (release at
 * 0.3 of a crossing) keeps a micro-scroll from re-arming it (§5.15), and a
 * skip-through that PASSES the teams station never settles there — the gate
 * additionally refuses an edge while a skip-through aimed elsewhere is in
 * flight. Leaving the station (settle released or nearest changed) re-arms
 * it and returns the ledger to rest.
 *
 * Wave 3's fidget hook keys on the same schedule: column k is called at
 * `startedAt + k · ROLL_CALL_STEP_MS` (`rollCallCallAt`).
 *
 * Pure — no client-only imports.
 */

/** One column called every 140 ms (D16). */
export const ROLL_CALL_STEP_MS = 140;
/** How long the just-called column's band chip pulses. */
export const ROLL_CALL_PULSE_MS = 420;
/** A short lead before the first column, so the call starts after the card fades in. */
export const ROLL_CALL_LEAD_MS = 180;

export type ColumnLight = 'rest' | 'calling' | 'called';

/** When column `k` (0-based, left to right) is called, relative to the start. */
export function rollCallCallAt(k: number): number {
  return ROLL_CALL_LEAD_MS + k * ROLL_CALL_STEP_MS;
}

/** When the whole call has finished (last pulse faded), relative to the start. */
export function rollCallDoneAt(n: number): number {
  return n <= 0 ? 0 : rollCallCallAt(n - 1) + ROLL_CALL_PULSE_MS;
}

/** Every column's light `elapsedMs` after the start (`null` = not running: all rest). */
export function rollCallLights(n: number, elapsedMs: number | null): ColumnLight[] {
  return Array.from({ length: n }, (_, k) => {
    if (elapsedMs === null) return 'rest';
    const since = elapsedMs - rollCallCallAt(k);
    if (since < 0) return 'rest';
    return since < ROLL_CALL_PULSE_MS ? 'calling' : 'called';
  });
}

/** The repaint instants (ms after the start): each call, each pulse end. Sorted, unique. */
export function rollCallTicks(n: number): number[] {
  const ticks = new Set<number>();
  for (let k = 0; k < n; k += 1) {
    ticks.add(rollCallCallAt(k));
    ticks.add(rollCallCallAt(k) + ROLL_CALL_PULSE_MS);
  }
  return [...ticks].sort((a, b) => a - b);
}

/** The next repaint instant after `elapsedMs`, or null when the call is over. */
export function nextRollCallTick(n: number, elapsedMs: number): number | null {
  for (const t of rollCallTicks(n)) if (t > elapsedMs + 1e-6) return t;
  return null;
}

// ── Arrival gate ─────────────────────────────────────────────────────────────

export interface RollCallGateInput {
  /** The hysteretic nearest station and the latched settle (useStationSettle). */
  station: number;
  settled: boolean;
  /** The teams station's index in this world. */
  teamsIndex: number;
  /** The conductor's skip-through record (skipThroughOf). */
  skipActive: boolean;
  skipTo: number;
  /** Reduced motion: never animate — the ledger stays at its readable rest. */
  reducedMotion: boolean;
}

export interface RollCallGate {
  /** True while the visitor is arrived at teams (the edge detector's memory). */
  arrived: boolean;
}

export const ROLL_CALL_GATE_IDLE: RollCallGate = { arrived: false };

/**
 * Step the arrival gate. `start` is true exactly once per arrival: on the
 * rising edge of "settled at the teams station", unless a skip-through aimed
 * at another station is still in flight, or reduced motion is on (then the
 * arrival is recorded — so it cannot fire late — but nothing plays). `leave`
 * is true on the falling edge (the ledger returns to rest).
 */
export function stepRollCallGate(
  prev: RollCallGate,
  input: RollCallGateInput,
): { gate: RollCallGate; start: boolean; leave: boolean } {
  const atTeams = input.settled && input.station === input.teamsIndex;
  if (atTeams && !prev.arrived) {
    const passing = input.skipActive && input.skipTo !== input.teamsIndex;
    if (passing) return { gate: prev, start: false, leave: false };
    return { gate: { arrived: true }, start: !input.reducedMotion, leave: false };
  }
  if (!atTeams && prev.arrived) return { gate: { arrived: false }, start: false, leave: true };
  return { gate: prev, start: false, leave: false };
}
