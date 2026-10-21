/**
 * Rollout harness (CAR judge r11 / ROLLOUT-PLAN §4.3): every loader sidecar
 * and summary line carries the reveal time BOTH since the product's
 * `generationBegunAt` (the anchor the §4.3 bars are judged on) and since
 * navigation start, plus the product's generation log and the warm audit's
 * late links when the debug bridges expose them.
 *
 * Pure: `revealAnchors`, `revealLine` (tested by
 * scripts/__tests__/reveal-anchors.test.mjs). In-page: `readRevealBridges`
 * (pass to page.evaluate; self-contained).
 */

const round1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/**
 * @param {object} a
 * @param {number|null} a.routeLiveAt        world-route-live, ms since navigation start (page clock)
 * @param {number|null} a.generationBegunAt  the revealed generation's begin, same clock
 * @param {string|null} [a.anchorSource]     where generationBegunAt came from
 * @param {object|null} [a.bridges]          readRevealBridges() result
 */
export function revealAnchors({ routeLiveAt, generationBegunAt, anchorSource = null, bridges = null }) {
  const live = round1(routeLiveAt);
  const begun = round1(generationBegunAt);
  const sinceGen = live !== null && begun !== null ? round1(live - begun) : null;
  const warm = bridges?.warmAudit ?? null;
  return {
    sinceGenerationBegunMs: sinceGen,
    sinceNavigationMs: live,
    generationBegunAt: begun,
    anchorSource: begun === null ? null : anchorSource ?? 'generationBegunAt',
    generationLog: Array.isArray(bridges?.generationLog) ? bridges.generationLog : null,
    lateLinks: warm && typeof warm.lateLinks === 'number' ? warm.lateLinks : null,
    warmAudit: warm,
    ...(bridges?.errors?.length ? { bridgeErrors: bridges.errors } : {}),
    notes: [
      'ROLLOUT-PLAN §4.3: reveal bars are judged on sinceGenerationBegunMs (world-route-live − the revealed generation\'s generationBegunAt); sinceNavigationMs (world-route-live since navigation start) is reported alongside',
      'generationLog = __routeWorldReadiness().generationLog (null = not exposed); lateLinks = __warmAudit().lateLinks (programs first linked after the reveal arm; null = not exposed, needs ?routeDebug=1)',
    ],
  };
}

/** One summary-line fragment. */
export function revealLine(r) {
  if (!r) return 'reveal=n/a';
  const f = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v)}ms`);
  return `reveal=${f(r.sinceGenerationBegunMs)} since generationBegunAt (${f(r.sinceNavigationMs)} since navigation)${r.lateLinks === null || r.lateLinks === undefined ? '' : ` lateLinks=${r.lateLinks}`}${Array.isArray(r.generationLog) ? ` generationLog=${r.generationLog.length}` : ''}`;
}

/** In-page: the product's generation log and the warm audit (debug bridges). */
export function readRevealBridges() {
  const errors = [];
  let generationLog = null;
  let generationBegunAt = null;
  let generation = null;
  let liveAt = null;
  try {
    const r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
    if (r) {
      if (Array.isArray(r.generationLog)) generationLog = JSON.parse(JSON.stringify(r.generationLog.slice(-60)));
      if (typeof r.generationBegunAt === 'number') generationBegunAt = r.generationBegunAt;
      if (typeof r.generation === 'number') generation = r.generation;
      if (typeof r.liveAt === 'number') liveAt = r.liveAt;
    }
  } catch (err) {
    errors.push(`readiness: ${err instanceof Error ? err.message : String(err)}`);
  }
  let warmAudit = null;
  try {
    if (typeof window.__warmAudit === 'function') {
      const w = window.__warmAudit();
      warmAudit = w ? JSON.parse(JSON.stringify({ ...w, late: Array.isArray(w.late) ? w.late.slice(0, 40) : w.late })) : null;
    }
  } catch (err) {
    errors.push(`warmAudit: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { generationLog, generationBegunAt, generation, liveAt, warmAudit, errors };
}
