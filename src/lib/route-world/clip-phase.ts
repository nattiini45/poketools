/**
 * Clip phase allocation and the seeded idle-fidget schedule (W2 living
 * figures, spec 2026-09-24 §5.1; fidelity decisions D7/D11).
 *
 * Two jobs, both pure functions of their inputs so a scene-level director can
 * recompute them on every registry commit and a capture pin can reproduce
 * them exactly:
 *
 *  1. `allocateClipPhases` — no two visible figures may loop the same clip in
 *     the same phase (the W2 veto). Members that play the SAME clip of the
 *     SAME file (`clipKey`) are spread evenly around the loop: the k-th of N
 *     sits at `(k + 0.5 + jitter) / N` (plus one seeded rotation per group),
 *     with `|jitter| ≤ 0.25`, so every pair in a group is at least `0.5 / N`
 *     of a loop apart on the circle. Phases are normalised [0, 1) — the
 *     consumer multiplies by the clip's own duration, which is what the old
 *     second-based `clipOffset` (`i * 0.37`, `seed % 7`) could not do: a
 *     whole-second offset modulo a whole-second clip collapses to phase 0.
 *
 *  2. `idleFidgetSchedule` — the signature idle / fidget alternation. A
 *     figure dwells in `idle` for a seeded 8–20 s, plays ONE pass of a fidget
 *     clip (`idle2`, or any other non-locomotion clip the file carries), and
 *     returns to `idle`. It is an O(1) function of ACCUMULATED seconds (the
 *     clamped R3F delta sum), never of wall-clock time or frame count, so a
 *     parked `frameloop="demand"` canvas cannot burst fidgets on resume.
 *
 * Locomotion clips (`walk`, `run`) are never fidgets: a locomotion clip
 * played in place is the treadmill the W2 bar vetoes.
 *
 * Pure data — no client-only imports.
 */

/** Clip names that animate travel; never played by a stopped figure. */
export const LOCOMOTION_CLIPS: readonly string[] = ['walk', 'run'];

export function isLocomotionClip(clip: string): boolean {
  return LOCOMOTION_CLIPS.includes(clip);
}

/** Canonical group key: one file playing one clip. */
export function clipKeyFor(file: string, clip: string): string {
  return `${file}|${clip}`;
}

/**
 * 32-bit integer mix of two words (the murmur3 finaliser over a combined
 * word). Deterministic across platforms; the only randomness source here.
 */
export function mix32(a: number, b: number): number {
  let h = (Math.imul(a >>> 0, 0x9e3779b1) ^ (b >>> 0)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seeded uniform in [0, 1) from two words. */
export function hash01(a: number, b: number): number {
  return mix32(a, b) / 4294967296;
}

/** FNV-1a over a string (same family as `ambient.ts` hashString). */
export function hashText(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface ClipPhaseMember {
  /** Unique figure id (slot key). Duplicates after the first are ignored. */
  id: string;
  /** `clipKeyFor(file, clip)` — members sharing it loop the same animation. */
  clipKey: string;
}

/** Largest seeded nudge off the even spacing, in units of one slot (1/N). */
export const PHASE_JITTER = 0.25;

/**
 * Seeded, evenly spread phase in [0, 1) per member. Order-independent: the
 * group is sorted by id first, so the same set of figures gets the same
 * phases however the registry happened to commit them.
 */
export function allocateClipPhases(
  members: readonly ClipPhaseMember[],
  seed: number,
): Map<string, number> {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    const group = groups.get(member.clipKey);
    if (group) group.push(member.id);
    else groups.set(member.clipKey, [member.id]);
  }

  const phases = new Map<string, number>();
  for (const [clipKey, ids] of groups) {
    ids.sort();
    const n = ids.length;
    const keyHash = hashText(clipKey);
    const rotation = hash01(seed, keyHash);
    ids.forEach((id, k) => {
      const jitter = (hash01(mix32(seed, keyHash), hashText(id)) * 2 - 1) * PHASE_JITTER;
      const raw = (k + 0.5 + jitter) / n + rotation;
      phases.set(id, raw - Math.floor(raw));
    });
  }
  return phases;
}

/** Shortest distance between two phases on the unit circle. */
export function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/** Loop time (seconds) for a normalised phase of a clip. */
export function phaseToClipTime(phase: number, durationS: number): number {
  const duration = Math.max(durationS, 1e-3);
  const p = phase - Math.floor(phase);
  return p * duration;
}

/* ------------------------------------------------------------------------ */
/* Idle / fidget schedule                                                   */
/* ------------------------------------------------------------------------ */

/** Idle dwell between two fidgets, seconds (the W2 brief: 8–20 s). */
export const FIDGET_DWELL_MIN_S = 8;
export const FIDGET_DWELL_MAX_S = 20;
/** Used when the manifest carries no duration for the fidget clip (pre-v3). */
export const DEFAULT_FIDGET_S = 3;
/** A fidget pass is clamped to this window so a long clip never stalls idle. */
export const FIDGET_MIN_S = 1.5;
export const FIDGET_MAX_S = 8;

const DWELL_MEAN_S = (FIDGET_DWELL_MIN_S + FIDGET_DWELL_MAX_S) / 2;
const DWELL_SWING_S = FIDGET_DWELL_MAX_S - DWELL_MEAN_S;

export interface FidgetFrame {
  /** Clip to play now; `null` means no usable non-locomotion clip exists. */
  clip: string | null;
  /** True while a fidget pass is playing. */
  fidget: boolean;
  /** Seconds since this segment began (a fidget starts its clip at 0). */
  elapsedS: number;
  /** Seconds until the segment ends (the next switch). Infinity if none. */
  remainingS: number;
  /** Monotonic fidget cycle index (for per-cycle seeded choices downstream). */
  cycle: number;
}

/** Non-locomotion clips other than `idle`, `idle2` first. */
export function fidgetClips(clips: readonly string[]): string[] {
  const candidates = clips.filter((clip) => clip !== 'idle' && !isLocomotionClip(clip));
  candidates.sort((a, b) => (a === 'idle2' ? -1 : b === 'idle2' ? 1 : a.localeCompare(b)));
  return candidates;
}

function fidgetDuration(clip: string, durations: Readonly<Record<string, number>> | undefined): number {
  const raw = durations?.[clip];
  const d = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FIDGET_S;
  return Math.min(Math.max(d, FIDGET_MIN_S), FIDGET_MAX_S);
}

/**
 * Which clip a stopped figure plays at accumulated time `tSeconds`.
 *
 * Construction (O(1), no iteration over history): time is cut into cycles of
 * `L = DWELL_MEAN + f` seconds (f = the fidget pass length); cycle c plays its
 * fidget over `[c·L + o_c, c·L + o_c + f)` with a seeded `o_c ∈ [0, 6]`. The
 * idle dwell between fidget c−1 and c is `DWELL_MEAN + o_c − o_{c−1}`, which
 * therefore always lies in [8, 20] s. A per-seed shift of the whole timeline
 * keeps same-species figures from fidgeting together.
 *
 * - No `idle` but a fidget-class clip → that clip loops (it IS the idle).
 * - `idle` and no fidget-class clip → `idle` forever.
 * - Neither → `clip: null` (the caller's documented low-motion fallback).
 */
export function idleFidgetSchedule(
  seed: number,
  clips: readonly string[],
  tSeconds: number,
  durations?: Readonly<Record<string, number>>,
): FidgetFrame {
  const hasIdle = clips.includes('idle');
  const fidgets = fidgetClips(clips);
  if (!hasIdle) {
    return { clip: fidgets[0] ?? null, fidget: false, elapsedS: Math.max(tSeconds, 0), remainingS: Infinity, cycle: 0 };
  }
  if (fidgets.length === 0) {
    return { clip: 'idle', fidget: false, elapsedS: Math.max(tSeconds, 0), remainingS: Infinity, cycle: 0 };
  }

  // Every fidget-class clip gets the same pass length inside one schedule so
  // the cycle arithmetic stays O(1); the longest candidate (clamped) wins.
  const f = Math.max(...fidgets.map((clip) => fidgetDuration(clip, durations)));
  const cycleS = DWELL_MEAN_S + f;
  const offsetS = (c: number) => hash01(seed, c * 2 + 1) * DWELL_SWING_S;
  const shift = hash01(seed, 0x5eed) * cycleS;
  const t = Math.max(tSeconds, 0) + shift;
  const c = Math.floor(t / cycleS);
  const start = c * cycleS + offsetS(c);
  const end = start + f;

  if (t >= start && t < end) {
    const clip = fidgets[Math.floor(hash01(seed, c * 2 + 2) * fidgets.length)] ?? fidgets[0];
    return { clip, fidget: true, elapsedS: t - start, remainingS: end - t, cycle: c };
  }
  if (t < start) {
    const previousEnd = (c - 1) * cycleS + offsetS(c - 1) + f;
    return { clip: 'idle', fidget: false, elapsedS: t - previousEnd, remainingS: start - t, cycle: c };
  }
  const nextStart = (c + 1) * cycleS + offsetS(c + 1);
  return { clip: 'idle', fidget: false, elapsedS: t - end, remainingS: nextStart - t, cycle: c + 1 };
}

/* ------------------------------------------------------------------------ */
/* Allocation-free schedule (POKEMON-CORE A1: the director's per-frame path) */
/* ------------------------------------------------------------------------ */

/**
 * `idleFidgetSchedule`'s per-figure constants, computed ONCE at registration
 * (the fidget list, the pass length, the cycle and the seeded shift), so the
 * director's frame loop reads the schedule without filtering, sorting or
 * allocating. `fidgetAt(plan, t, out)` returns exactly what
 * `idleFidgetSchedule(seed, clips, t, durations)` returns (tested).
 */
export interface FidgetPlan {
  seed: number;
  hasIdle: boolean;
  /** `fidgetClips(clips)`, idle2 first. */
  fidgets: readonly string[];
  /** The fidget pass length (s); 0 when there is no fidget. */
  passS: number;
  cycleS: number;
  shiftS: number;
}

export function createFidgetPlan(
  seed: number,
  clips: readonly string[],
  durations?: Readonly<Record<string, number>>,
): FidgetPlan {
  const fidgets = fidgetClips(clips);
  const hasIdle = clips.includes('idle');
  const passS = fidgets.length > 0 ? Math.max(...fidgets.map((clip) => fidgetDuration(clip, durations))) : 0;
  const cycleS = DWELL_MEAN_S + passS;
  return { seed, hasIdle, fidgets, passS, cycleS, shiftS: hash01(seed, 0x5eed) * cycleS };
}

/** A mutable `FidgetFrame` the caller owns (one per figure). */
export function createFidgetFrame(): FidgetFrame {
  return { clip: null, fidget: false, elapsedS: 0, remainingS: Infinity, cycle: 0 };
}

/** `idleFidgetSchedule` from a precomputed plan, written into `out` (no allocation). */
export function fidgetAt(plan: FidgetPlan, tSeconds: number, out: FidgetFrame): FidgetFrame {
  const t0 = Math.max(tSeconds, 0);
  if (!plan.hasIdle) {
    out.clip = plan.fidgets[0] ?? null;
    out.fidget = false;
    out.elapsedS = t0;
    out.remainingS = Infinity;
    out.cycle = 0;
    return out;
  }
  if (plan.fidgets.length === 0) {
    out.clip = 'idle';
    out.fidget = false;
    out.elapsedS = t0;
    out.remainingS = Infinity;
    out.cycle = 0;
    return out;
  }
  const { seed, cycleS, passS: f } = plan;
  const t = t0 + plan.shiftS;
  const c = Math.floor(t / cycleS);
  const start = c * cycleS + hash01(seed, c * 2 + 1) * DWELL_SWING_S;
  const end = start + f;
  if (t >= start && t < end) {
    out.clip = plan.fidgets[Math.floor(hash01(seed, c * 2 + 2) * plan.fidgets.length)] ?? plan.fidgets[0];
    out.fidget = true;
    out.elapsedS = t - start;
    out.remainingS = end - t;
    out.cycle = c;
    return out;
  }
  out.clip = 'idle';
  out.fidget = false;
  if (t < start) {
    const previousEnd = (c - 1) * cycleS + hash01(seed, (c - 1) * 2 + 1) * DWELL_SWING_S + f;
    out.elapsedS = t - previousEnd;
    out.remainingS = start - t;
    out.cycle = c;
    return out;
  }
  const nextStart = (c + 1) * cycleS + hash01(seed, (c + 1) * 2 + 1) * DWELL_SWING_S;
  out.elapsedS = t - end;
  out.remainingS = nextStart - t;
  out.cycle = c + 1;
  return out;
}
