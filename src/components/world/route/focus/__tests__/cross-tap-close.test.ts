import { afterEach, describe, expect, it } from 'vitest';
import { focusStore } from '../focus-store';
import { INITIAL_URL_SYNC, storeToUrl, urlToStore, type UrlSyncState } from '../url-sync';
import { dampToward, focusBlendRate, IDLE_ORBIT, type FocusSubject } from '@/lib/route-world/focus';

/**
 * Review r5 (W6): after a cross-tap (A open, tap B) a close request that
 * arrives before B's URL write has landed must close the panel and bring the
 * focus phase to idle — it used to re-focus B when B's write landed late.
 */

const PANEL_PARAMS = ['team', 'mon'] as const;
const SETTLE_EPS = 0.004;

function subject(id: string, value: string): FocusSubject {
  return {
    id,
    kind: 'team',
    label: id,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    facing: [0, 0, 1],
    panel: { param: 'team', value },
  };
}

/**
 * A Next-style router: `replace` is asynchronous (an RSC round trip under
 * dev) and a newer navigation discards one still pending (the app-router
 * action queue), so writes land in issue order and never resurrect.
 */
function fakeRouter() {
  let url = '';
  let pending: { qs: string; landAt: number } | null = null;
  return {
    get url() {
      return url;
    },
    replace(qs: string, now: number, latency: number) {
      pending = { qs, landAt: now + latency };
    },
    /** Land the pending write if it is due; true when the URL changed. */
    tick(now: number): boolean {
      if (!pending || pending.landAt > now) return false;
      const { qs } = pending;
      pending = null;
      if (qs === url) return false;
      url = qs;
      return true;
    },
    set(qs: string) {
      url = qs;
    },
  };
}

/** Drives the two FocusUrlSync effects + the rig's blend/clear loop. */
function harness(latency: (write: number) => number) {
  const router = fakeRouter();
  const registry = new Map<string, FocusSubject>();
  let sync: UrlSyncState = INITIAL_URL_SYNC;
  let writes = 0;
  let blend = 0;
  const effects = (now: number) => {
    const state = focusStore.get();
    const live = state.phase === 'focusing' || state.phase === 'focused';
    const panel = state.subject?.panel ?? null;
    const params = new URLSearchParams(router.url);
    const out = storeToUrl({ live, panel, params, panelParams: PANEL_PARAMS, sync });
    sync = out.sync;
    if (out.write !== null) {
      router.replace(out.write, now, latency(writes));
      writes += 1;
    }
    const inbound = urlToStore({
      live,
      panel,
      params,
      panelParams: PANEL_PARAMS,
      sync,
      hasSubject: (p) => [...registry.values()].some((s) => s.panel?.value === p.value),
    });
    sync = inbound.sync;
    if (inbound.action?.kind === 'focus') {
      const value = inbound.action.panel.value;
      const found = [...registry.values()].find((s) => s.panel?.value === value);
      if (found) focusStore.focus(found);
    } else if (inbound.action?.kind === 'release') {
      focusStore.release();
    }
  };
  /** One 60 fps frame of the rig: blend toward the phase, settle / clear. */
  const frame = () => {
    const state = focusStore.get();
    const want = state.phase === 'focusing' || state.phase === 'focused';
    blend = dampToward(blend, want ? 1 : 0, focusBlendRate(8), 1 / 60);
    if (state.phase === 'focusing' && blend > 1 - SETTLE_EPS) focusStore.settle();
    else if (state.phase === 'releasing' && blend < SETTLE_EPS) {
      blend = 0;
      focusStore.clear();
    }
  };
  return { router, registry, effects, frame, get sync() { return sync; } };
}

/** React-style: the effects re-run only when their inputs change. */
function effectKey(h: ReturnType<typeof harness>): string {
  const state = focusStore.get();
  const live = state.phase === 'focusing' || state.phase === 'focused';
  return `${live}|${state.subject?.panel?.value ?? ''}|${h.router.url}`;
}

function run(h: ReturnType<typeof harness>, from: number, to: number) {
  let key = effectKey(h);
  for (let t = from; t <= to; t += 1000 / 60) {
    h.router.tick(t);
    h.frame();
    const next = effectKey(h);
    if (next !== key) {
      key = next;
      h.effects(t);
    }
  }
}

afterEach(() => {
  focusStore.release();
  for (let i = 0; i < 2000 && focusStore.get().phase !== 'idle'; i += 1) focusStore.clear();
});

describe('focus store: a close request is never dropped', () => {
  it('release while focusing moves straight to releasing', () => {
    const a = subject('team:a', 'a');
    focusStore.focus(a);
    expect(focusStore.get().phase).toBe('focusing');
    focusStore.release();
    expect(focusStore.get().phase).toBe('releasing');
    focusStore.clear();
    expect(focusStore.get().phase).toBe('idle');
  });

  it('release during a cross-blend (B focusing over A) moves to releasing', () => {
    focusStore.focus(subject('team:a', 'a'));
    focusStore.settle();
    focusStore.focus(subject('team:b', 'b'));
    expect(focusStore.get()).toMatchObject({ phase: 'focusing', orbit: IDLE_ORBIT });
    focusStore.release();
    expect(focusStore.get().phase).toBe('releasing');
  });
});

describe('cross-tap then close before B has landed in the URL', () => {
  for (const [name, latency] of [
    ['B write slow (lands after the close)', (write: number) => (write === 1 ? 2500 : 300)],
    ['every write slow (2 s RSC round trips)', () => 2000],
    ['B write lands before the close (the ordinary case)', (write: number) => (write === 1 ? 400 : 1500)],
    ['instant router', () => 0],
  ] as const) {
    it(`${name}: the panel closes and the phase reaches idle`, () => {
      const h = harness(latency);
      const a = subject('team:a', 'a');
      const b = subject('team:b', 'b');
      h.registry.set(a.id, a);
      h.registry.set(b.id, b);

      // Open A and let it land.
      focusStore.focus(a);
      h.effects(0);
      run(h, 0, 4000);
      expect(h.router.url).toBe('team=a');
      expect(focusStore.get().phase).toBe('focused');

      // Cross-tap B, then close 700 ms later — before B's write landed in
      // the slow cases, while B is still `focusing`.
      focusStore.focus(b);
      h.effects(4000);
      run(h, 4000, 4700);
      const closeAt = 4700;
      focusStore.release();
      h.effects(closeAt);
      expect(focusStore.get().phase).toBe('releasing');

      // Panel param gone and the store idle: the DOM panel (OverlaySwitch
      // keys on the param) gets data-closing as soon as the URL clears.
      let urlClearedAt: number | null = null;
      let idleAt: number | null = null;
      let refocused = false;
      let key = effectKey(h);
      for (let t = closeAt; t <= closeAt + 8000; t += 1000 / 60) {
        h.router.tick(t);
        h.frame();
        const next = effectKey(h);
        if (next !== key) {
          key = next;
          h.effects(t);
        }
        const phase = focusStore.get().phase;
        if (phase === 'focusing' || phase === 'focused') refocused = true;
        if (urlClearedAt === null && !new URLSearchParams(h.router.url).has('team')) urlClearedAt = t;
        if (idleAt === null && phase === 'idle') idleAt = t;
      }
      expect(refocused).toBe(false);
      expect(focusStore.get().phase).toBe('idle');
      expect(new URLSearchParams(h.router.url).has('team')).toBe(false);
      expect(idleAt).not.toBeNull();
      expect((idleAt ?? Infinity) - closeAt).toBeLessThanOrEqual(2000);
      // The panel closes once the clearing write lands (router latency), not never.
      expect(urlClearedAt).not.toBeNull();
      expect(h.sync.outgoing).toEqual([]);
    });
  }

  it('a real deep link after the clear still focuses (outgoing does not block forever)', () => {
    const h = harness(() => 100);
    const a = subject('team:a', 'a');
    h.registry.set(a.id, a);
    focusStore.focus(a);
    h.effects(0);
    run(h, 0, 3000);
    focusStore.release();
    h.effects(3000);
    run(h, 3000, 6000);
    expect(focusStore.get().phase).toBe('idle');
    expect(h.router.url).toBe('');
    // A trigger link writes ?team=a again.
    h.router.set('team=a');
    h.effects(6000);
    expect(focusStore.get().phase).toBe('focusing');
  });
});
