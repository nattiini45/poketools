/**
 * R49 (tools seat, the K8 film crash): classify a failed FBO present and
 * decide whether ONE re-acquire + retry is honest.
 *
 * Root cause of record: `window.__routeWorldPresent` returns `null` — its
 * typed not-ready contract — while the C-083 page-lane present gate is held
 * (`presentGate.held`: the render-path key changed less than
 * PRESENT_KIT_SETTLE_MIN_MS ago). The key counts instanced meshes, batches,
 * HIDDEN meshes and material maps, so a quality-rung step (fewer roster
 * figures, post off) or a focus transition / probe-actor visibility flip
 * re-arms the 2 s quiet window. `--frames` presents skip the C-057 kit-settle
 * wait (traceFrame), so the next sampled frame could land inside that window
 * and the harness reported the null as "invalid-payload" (v-k8 / v-k8r1 at
 * frame 3 after `--rung-step 10:4`; k1 at trace frame 0 after a focus still).
 *
 * The fix keeps failures honest: a held gate is named `present-gate-held`
 * (with the gate state), the harness waits a bounded time for the page's own
 * gate to reopen and retries the present ONCE, and every retry is recorded
 * in the sidecar / trace sample. A gate that stays held, a second failure,
 * or a malformed payload outside a rung-step window still fails the run.
 */

/** Bound for the page's present gate to reopen (2 s quiet + 1 s sampler, with margin). */
export const PRESENT_GATE_REOPEN_WAIT_MS = 10_000;
/** Poll cadence of the gate wait. */
export const PRESENT_GATE_POLL_MS = 250;
/** Frames after a rung step that still count as "after a rung change". */
export const RUNG_STEP_TRANSITION_FRAMES = 2;

/**
 * Describe what `__routeWorldPresent()` returned (the same test the in-page
 * check applies): 'png' is the only good kind.
 */
export function describePresentPayload(frame) {
  if (frame === null) return 'null';
  if (frame === undefined) return 'undefined';
  if (typeof frame !== 'object') return typeof frame;
  if (typeof frame.dataUrl !== 'string') return 'no-dataUrl';
  if (frame.dataUrl.startsWith('data:image/png')) return 'png';
  return `non-png:${frame.dataUrl.slice(0, 16)}`;
}

/**
 * The failure class of a not-ok in-page present result. A `null` payload
 * while the page's gate reports held is the typed not-ready answer
 * (`present-gate-held`); every other bad payload stays `invalid-payload`;
 * any other reason (missing-hook, a thrown message, an arm refusal) passes
 * through unchanged.
 */
export function classifyPresentFailure(result) {
  if (!result || result.ok) return null;
  if (result.reason !== 'invalid-payload') return result.reason ?? 'unknown';
  if (result.payloadKind === 'null' && result.gate && result.gate.held === true) return 'present-gate-held';
  return 'invalid-payload';
}

/**
 * Whether one re-acquire + retry is allowed for this failure. Only the first
 * attempt ever retries. A held gate always may (it is the page saying "not
 * yet", and the wait re-checks the page's own gate); a malformed payload
 * (incl. a null under an OPEN or unread gate) only right after a
 * quality-rung step (a DPR / post-stack resize window) — never for a focus
 * transition (fix round TOOLS-2: the diagnosed focus case is the held gate,
 * which the first rule already covers); everything else fails immediately.
 */
export function shouldRetryPresent(reason, { attempt = 0, transition = null } = {}) {
  if (attempt > 0) return false;
  if (reason === 'present-gate-held') return true;
  if (reason === 'invalid-payload') return transition === 'rung-step';
  return false;
}

/**
 * Which transition (if any) a present follows: a `--rung-step` fired within
 * RUNG_STEP_TRANSITION_FRAMES frames before this one, else a focus settle —
 * bounded to the focused still (no frameIndex) and trace frame 0, the
 * presents right after the focus lands (fix round TOOLS-2) — else none.
 */
export function presentTransition({ frameIndex = null, rungStep = null, focus = null } = {}) {
  if (
    rungStep &&
    rungStep.fired === true &&
    typeof rungStep.frameIndex === 'number' &&
    typeof frameIndex === 'number' &&
    frameIndex >= rungStep.frameIndex &&
    frameIndex - rungStep.frameIndex <= RUNG_STEP_TRANSITION_FRAMES
  ) {
    return 'rung-step';
  }
  if (focus && (frameIndex === null || frameIndex === undefined || frameIndex === 0)) return 'focus';
  return null;
}

/**
 * Poll the page's present gate until it reports not-held (or the bound runs
 * out). `readGate` returns the `presentGate` report (or null when the bridge
 * is absent — treated as held, the gate's fail-closed reading).
 */
export async function waitForPresentGateOpen(
  readGate,
  { boundMs = PRESENT_GATE_REOPEN_WAIT_MS, pollMs = PRESENT_GATE_POLL_MS, sleep, now = () => Date.now() } = {},
) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = now();
  let polls = 0;
  let last = null;
  for (;;) {
    polls += 1;
    try {
      last = await readGate();
    } catch (err) {
      last = { error: err instanceof Error ? err.message : String(err) };
    }
    if (last && last.held === false) return { reopened: true, waitedMs: now() - started, polls, gate: last };
    if (now() - started >= boundMs) return { reopened: false, waitedMs: now() - started, polls, gate: last };
    await wait(pollMs);
  }
}

/** The sidecar / trace-sample record of one present retry. */
export function presentRetryRecord({ reason, transition = null, first = null, wait = null, second = null }) {
  return {
    reason,
    transition,
    firstPayload: first?.payloadKind ?? null,
    firstGate: first?.gate ?? null,
    wait,
    retried: true,
    ok: second?.ok === true,
    secondReason: second && !second.ok ? classifyPresentFailure(second) : null,
  };
}

/** The error-message detail for a failed present (payload kind, gate, retry). */
export function presentFailureDetail(result, retry) {
  const parts = [];
  if (result?.payloadKind && result.payloadKind !== 'png') parts.push(`payload=${result.payloadKind}`);
  if (result?.gate) parts.push(`gate=${JSON.stringify(result.gate)}`);
  if (retry) parts.push(`retry=${JSON.stringify({ reason: retry.reason, transition: retry.transition, wait: retry.wait })}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** The error a failed present throws (the classified reason + detail). */
export function presentFailureError(result, retry) {
  const reason = classifyPresentFailure(result);
  const detail =
    (result?.materialPatch ? ` materialPatch=${JSON.stringify(result.materialPatch)}` : '') + presentFailureDetail(result, retry);
  const err = new Error(`FBO present failed (${reason}) — refusing compositor screenshot${detail}`);
  err.presentRetry = retry ?? null;
  return err;
}

/**
 * Fix round TOOLS-3: the whole present orchestration, pure. Present once;
 * on a failure classify it and, when shouldRetryPresent allows, wait (the
 * page's own gate for a held gate, `waitFrames` otherwise), present exactly
 * once more and record it. Returns `{ presented, presentRetry }` (presentRetry
 * null = clean first attempt); a final failure throws presentFailureError.
 * Every caller must carry `presentRetry` into its record.
 */
export async function presentWithRetry(presentOnce, { transition = null, readGate, waitFrames, gateWait = {}, onRetry } = {}) {
  let presented = await presentOnce();
  let presentRetry = null;
  if (!presented.ok) {
    const reason = classifyPresentFailure(presented);
    if (shouldRetryPresent(reason, { attempt: 0, transition })) {
      let wait = null;
      if (reason === 'present-gate-held') {
        wait = await waitForPresentGateOpen(readGate ?? (async () => null), gateWait);
      } else if (waitFrames) {
        try {
          wait = await waitFrames();
        } catch (err) {
          wait = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      const first = presented;
      presented = await presentOnce();
      presentRetry = presentRetryRecord({ reason, transition, first, wait, second: presented });
      if (onRetry) onRetry(presentRetry, presented);
    }
  }
  if (!presented.ok) throw presentFailureError(presented, presentRetry);
  return { presented, presentRetry };
}

/**
 * Fix round TOOLS-2: the verdict over a trace's / still's present re-acquire
 * records. 'clean' = none; 'recorded' = every one is the diagnosed case
 * (present-gate-held, the gate seen reopened, the retry presented); any
 * other record (an invalid-payload retry, a gate not seen reopened) makes it
 * 'inconclusive' — a bar judged on that capture must not pass on it.
 */
export function presentRetryVerdict(records) {
  const list = (Array.isArray(records) ? records : [records]).filter(Boolean);
  if (list.length === 0) return { verdict: 'clean', count: 0, inconclusive: [] };
  const inconclusive = [];
  for (const r of list) {
    const why = [];
    if (r.reason !== 'present-gate-held') why.push(`reason ${r.reason}`);
    if (r.wait?.reopened !== true) why.push('gate not seen reopened');
    if (r.ok !== true) why.push('retry did not present');
    if (why.length) inconclusive.push({ ...(typeof r.i === 'number' ? { i: r.i } : {}), why: why.join(', ') });
  }
  return { verdict: inconclusive.length ? 'inconclusive' : 'recorded', count: list.length, inconclusive };
}
