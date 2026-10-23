import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BEAT_FACE_NDC_MIN,
  createAmbientBeatBus,
  emitRollCall,
  FACE_SOURCE_DENIED_NDC,
  type FaceSourceReason,
  HERO_BEAT_KINDS,
  HERO_SPACING_S,
  NO_BEAT_FORCE,
  parseBeatForce,
  parseBeatParams,
  READING_WINDOW_S,
  ROTATING_HERO_KINDS,
  type AmbientBeatBus,
  type BeatEvent,
  type BeatGrantContext,
  type BeatSphere,
  type HeroBeatKind,
} from '../ambient-beats';
import { FACE_NDC_FAR, guardedFaceDistanceNdc } from '../figure-director';

/** A sphere every test passes unless it probes the NDC precondition. */
const S: BeatSphere = { x: 0, y: 1, z: -10, r: 0.5 };

function ctx(overrides: Partial<BeatGrantContext> = {}): BeatGrantContext {
  return {
    dt: 1 / 30,
    hidden: false,
    loader: false,
    focusOpen: false,
    focusSubjectId: null,
    live: true,
    settled: true,
    sinceSettleS: 10,
    station: 0,
    staticMotion: false,
    faceDistanceNdc: () => null,
    ...overrides,
  };
}

/** Step `seconds` of frames at `dt` (granting); returns every grant as `kind:actor@t`. */
function run(bus: AmbientBeatBus, seconds: number, overrides: Partial<BeatGrantContext> = {}, dt = 1 / 30): string[] {
  const out: string[] = [];
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) {
    for (const ticket of bus.grant(ctx({ dt, ...overrides }))) out.push(`${ticket.kind}:${ticket.actorId}@${bus.now().toFixed(3)}`);
  }
  return out;
}

describe('ambient-beats: frozen kinds and params', () => {
  it('reserves the rules ceremony and keeps roll call a hero kind', () => {
    expect(HERO_BEAT_KINDS).toEqual(['flyover', 'surfacing', 'attack', 'rollCall', 'rulesCeremony']);
    expect(ROTATING_HERO_KINDS).toEqual(['flyover', 'surfacing', 'attack', 'rulesCeremony']);
  });

  it('parses beatForce kind@seconds, first value wins, junk reported', () => {
    const { force, invalid } = parseBeatForce(' surfacing@10, flyover@18.5 ,play@25,surfacing@3,wobble@2,play@-1,flyover@x');
    expect(force).toEqual({ surfacing: 10, flyover: 18.5, play: 25 });
    expect(invalid).toEqual(['wobble@2', 'play@-1', 'flyover@x']);
    expect(parseBeatForce(null).force).toEqual(NO_BEAT_FORCE);
    expect(parseBeatForce('surfacing@99999').invalid).toEqual(['surfacing@99999']);
  });

  it('honours beatForce and beatSeed only in a routeDebug session', () => {
    const search = '?routeDebug=1&beatForce=surfacing@10,play@25&beatSeed=7';
    expect(parseBeatParams(search, true)).toEqual({ force: { surfacing: 10, flyover: null, play: 25 }, seed: 7, invalid: [] });
    expect(parseBeatParams(search, false)).toEqual({ force: NO_BEAT_FORCE, seed: null, invalid: [] });
    expect(parseBeatParams('?beatSeed=abc', true).invalid).toEqual(['beatSeed=abc']);
  });
});

describe('ambient-beats: one hero at a time, spacing and fairness (A2 step 1)', () => {
  it('grants one hero beat at a time, one per frame', () => {
    const bus = createAmbientBeatBus();
    const a = bus.request('surfacing', 'surfacer-1', S);
    const b = bus.request('flyover', 'flyer-1', S);
    const first = bus.grant(ctx());
    expect(first).toHaveLength(1);
    const other = first[0] === a ? b : a;
    expect(other.state).toBe('pending');
    expect(bus.grant(ctx())).toEqual([]);
    expect(other.deniedReason).toBe('busy');
    expect(bus.snapshot().suppression).toBe('busy');
  });

  it('keeps ≥ 8 awake seconds between the end of one hero beat and the next grant', () => {
    const bus = createAmbientBeatBus();
    const a = bus.request('surfacing', 's', S);
    bus.grant(ctx());
    expect(a.state).toBe('granted');
    run(bus, 3); // the beat runs 3 s
    bus.release(a);
    const endedAt = bus.now();
    const b = bus.request('flyover', 'f', S);
    const grants = run(bus, HERO_SPACING_S + 1);
    expect(grants).toHaveLength(1);
    expect(b.state).toBe('granted');
    expect(b.grantedAtS! - endedAt).toBeGreaterThanOrEqual(HERO_SPACING_S - 1e-9);
    expect(b.grantedAtS! - endedAt).toBeLessThan(HERO_SPACING_S + 0.05);
    expect(bus.snapshot().denials.spacing).toBeGreaterThan(200);
  });

  it('is fair: round-robin across kinds, request order within a kind', () => {
    const bus = createAmbientBeatBus({ seed: 0 });
    // Two surfacers asked first, then a flyer and an attack: the kinds alternate.
    for (const [kind, id] of [
      ['surfacing', 's1'],
      ['surfacing', 's2'],
      ['flyover', 'f1'],
      ['attack', 'a1'],
    ] as const) {
      bus.request(kind, id, S);
    }
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const granted = run(bus, HERO_SPACING_S + 1);
      expect(granted).toHaveLength(1);
      const ticket = bus.snapshot().granted[0];
      order.push(`${ticket.kind}:${ticket.actorId}`);
      bus.release(bus.request(ticket.kind, ticket.actorId, S));
    }
    // seed 0 starts at flyover; then surfacing, attack, (rulesCeremony: none) → flyover (none left) → surfacing.
    expect(order).toEqual(['flyover:f1', 'surfacing:s1', 'attack:a1', 'surfacing:s2']);
    expect(bus.snapshot().denials['round-robin']).toBeGreaterThan(0);
  });

  it('the same beatSeed yields the same (kind, id, order) sequence; the seed rotates the first kind', () => {
    const script = (seed: number) => {
      const bus = createAmbientBeatBus({ seed });
      const kinds: HeroBeatKind[] = ['surfacing', 'flyover', 'attack'];
      const log: string[] = [];
      for (let frame = 0; frame < 30 * 120; frame += 1) {
        // Every actor re-requests each frame (idempotent) and holds a grant for 2 s.
        for (let k = 0; k < 6; k += 1) bus.request(kinds[k % 3], `actor-${k}`, S);
        for (const ticket of bus.grant(ctx())) log.push(`${ticket.kind}:${ticket.actorId}:${ticket.grantedAtS!.toFixed(4)}`);
        for (const open of bus.snapshot().granted) {
          if (bus.now() - open.grantedAtS >= 2) bus.release(bus.request(open.kind, open.actorId, S));
        }
      }
      return log;
    };
    const a = script(7);
    expect(a.length).toBeGreaterThan(8);
    expect(script(7)).toEqual(a);
    const firstKinds = new Set([0, 1, 2, 3].map((seed) => script(seed)[0].split(':')[0]));
    expect(firstKinds.size).toBeGreaterThan(1);
  });
});

describe('ambient-beats: the reading window and suppression (A2 step 1)', () => {
  it('holds hero beats for 6 s after a settle, then grants', () => {
    const bus = createAmbientBeatBus();
    const t = bus.request('flyover', 'f', S);
    bus.grant(ctx({ sinceSettleS: 0 }));
    expect(t.deniedReason).toBe('reading-window');
    expect(bus.snapshot().readingWindow).toEqual({ open: true, sinceSettleS: 0 });
    bus.grant(ctx({ sinceSettleS: READING_WINDOW_S - 0.01 }));
    expect(t.state).toBe('pending');
    bus.grant(ctx({ sinceSettleS: READING_WINDOW_S }));
    expect(t.state).toBe('granted');
    expect(bus.snapshot().readingWindow.open).toBe(false);
  });

  /** The 16-row truth table over (settled, loader, focus, hidden): a hero grant only in the all-clear row. */
  it('suppresses while unsettled, loading, focused or hidden (16 rows)', () => {
    let grantedRows = 0;
    for (let row = 0; row < 16; row += 1) {
      const settled = (row & 1) !== 0;
      const loader = (row & 2) !== 0;
      const focusOpen = (row & 4) !== 0;
      const hidden = (row & 8) !== 0;
      const bus = createAmbientBeatBus();
      const t = bus.request('surfacing', 's', S);
      const granted = bus.grant(ctx({ settled, loader, focusOpen, hidden, sinceSettleS: settled ? 10 : null }));
      const expected: string | null = hidden ? 'hidden' : loader ? 'loader' : focusOpen ? 'focus' : !settled ? 'not-settled' : null;
      expect(t.deniedReason, `row ${row}`).toBe(expected);
      expect(bus.snapshot().suppression, `row ${row}`).toBe(expected);
      expect(granted.length, `row ${row}`).toBe(expected === null ? 1 : 0);
      if (expected === null) grantedRows += 1;
    }
    expect(grantedRows).toBe(1);
  });

  it('reduced motion (static) and the pre-reveal suppress every kind, roll call and forced included', () => {
    for (const [override, reason] of [
      [{ staticMotion: true }, 'reduced-motion'],
      [{ live: false }, 'not-live'],
    ] as const) {
      const bus = createAmbientBeatBus({ force: { surfacing: 0, flyover: null, play: null } });
      const hero = bus.request('flyover', 'f', S);
      expect(bus.consumeForce('surfacing', 0)).toBe(true);
      const forced = bus.request('surfacing', 's', S, { forced: true });
      const call = bus.request('rollCall', 'roll-call', null);
      expect(bus.grant(ctx(override))).toEqual([]);
      for (const t of [hero, forced, call]) expect(t.deniedReason).toBe(reason);
    }
  });

  it('a participant focus is quiet mode: hero beats defer with reason quiet', () => {
    const bus = createAmbientBeatBus();
    const t = bus.request('flyover', 'f', S);
    bus.grant(ctx({ focusOpen: true, focusSubjectId: 'player-0001' }));
    expect(t.deniedReason).toBe('quiet');
    expect(bus.snapshot().quiet).toEqual({ active: true, subjectId: 'player-0001' });
    bus.grant(ctx());
    expect(t.state).toBe('granted');
    expect(bus.snapshot().quiet).toEqual({ active: false, subjectId: null });
  });

  it('a repeated request returns the open ticket (no backlog)', () => {
    const bus = createAmbientBeatBus();
    const first = bus.request('surfacing', 's', null);
    const again = bus.request('surfacing', 's', { x: 1, y: 2, z: 3, r: 0.5 });
    expect(again).toBe(first);
    expect(again.sphere).toEqual({ x: 1, y: 2, z: 3, r: 0.5 });
    expect(bus.snapshot().pending).toHaveLength(1);
  });

  it('a 60 s hidden gap yields at most one grant on resume, and the clock does not move', () => {
    const bus = createAmbientBeatBus();
    const ids = ['a', 'b', 'c', 'd'];
    const tickets = ids.map((id) => bus.request('flyover', id, S));
    for (let i = 0; i < 1800; i += 1) {
      for (const id of ids) bus.request('flyover', id, S);
      expect(bus.grant(ctx({ hidden: true }))).toEqual([]);
    }
    expect(bus.now()).toBe(0);
    expect(bus.snapshot().pending).toHaveLength(4);
    const granted = bus.grant(ctx());
    expect(granted).toHaveLength(1);
    expect(granted[0]).toBe(tickets[0]);
    // …and the rest stay pending behind the running beat: no burst.
    expect(run(bus, 20)).toEqual([]);
  });
});

describe('ambient-beats: the NDC precondition (clarity law)', () => {
  it('defers a hero grant whose sphere is closer than 0.06 NDC to the active padded face', () => {
    const bus = createAmbientBeatBus();
    const distance = { value: BEAT_FACE_NDC_MIN - 0.01 };
    const seen: BeatSphere[] = [];
    const face = (sphere: BeatSphere) => {
      seen.push(sphere);
      return distance.value;
    };
    const t = bus.request('surfacing', 's', S);
    bus.grant(ctx({ faceDistanceNdc: face }));
    expect(t.deniedReason).toBe('ndc');
    expect(seen[0]).toEqual(S);
    distance.value = BEAT_FACE_NDC_MIN;
    bus.grant(ctx({ faceDistanceNdc: face }));
    expect(t.state).toBe('granted');
    expect(bus.snapshot().grants[0].faceNdc).toBe(BEAT_FACE_NDC_MIN);
  });

  it('passes with no active face (null), fails without a sphere, and holds for forced beats too', () => {
    const bus = createAmbientBeatBus({ force: { surfacing: 0, flyover: null, play: null } });
    const blind = bus.request('flyover', 'no-sphere', null);
    bus.grant(ctx());
    expect(blind.deniedReason).toBe('ndc');
    bus.release(blind);
    expect(bus.consumeForce('surfacing', 1)).toBe(true);
    const forced = bus.request('surfacing', 's', S, { forced: true });
    bus.grant(ctx({ faceDistanceNdc: () => 0 }));
    expect(forced.deniedReason).toBe('ndc');
    bus.grant(ctx({ faceDistanceNdc: () => null }));
    expect(forced.state).toBe('granted');
    expect(bus.snapshot().grants.at(-1)).toMatchObject({ kind: 'surfacing', forced: true, faceNdc: null });
  });
});

describe('ambient-beats: beatForce', () => {
  it('fires exactly once at the forced awake second, and wins over the loader, focus, the reading window and spacing', () => {
    const bus = createAmbientBeatBus({ force: { surfacing: 10, flyover: null, play: null } });
    expect(bus.forced('surfacing')).toBe(10);
    expect(bus.consumeForce('surfacing', null)).toBe(false);
    expect(bus.consumeForce('surfacing', 9.99)).toBe(false);
    expect(bus.consumeForce('flyover', 100)).toBe(false);
    expect(bus.consumeForce('surfacing', 10)).toBe(true);
    expect(bus.consumeForce('surfacing', 11)).toBe(false);
    // A hero just ended (spacing) and the station just settled (reading window).
    const early = bus.request('flyover', 'f', S);
    bus.grant(ctx());
    bus.release(early);
    const t = bus.request('surfacing', 's', S, { forced: true });
    bus.grant(ctx({ focusOpen: true, loader: true, settled: true, sinceSettleS: 0.5 }));
    expect(t.state).toBe('granted');
    expect(t.forced).toBe(true);
    expect(bus.snapshot().grants.at(-1)).toEqual({ ticket: t.id, kind: 'surfacing', actorId: 's', grantedAtS: bus.now(), forced: true, faceNdc: null });
  });

  it('never wins over a running hero beat or a running roll call', () => {
    const bus = createAmbientBeatBus({ force: { surfacing: 0, flyover: null, play: null } });
    const hero = bus.request('flyover', 'f', S);
    bus.grant(ctx());
    expect(hero.state).toBe('granted');
    bus.consumeForce('surfacing', 0);
    const forced = bus.request('surfacing', 's', S, { forced: true });
    bus.grant(ctx());
    expect(forced.deniedReason).toBe('busy');
    bus.release(hero);
    const call = bus.request('rollCall', 'roll-call', null);
    bus.grant(ctx());
    expect(call.state).toBe('granted');
    expect(forced.deniedReason).toBe('roll-call');
  });
});

describe('ambient-beats: the roll call (data-bound)', () => {
  it('is exempt from the reading window and the one-hero rule, and blocks other hero grants while it runs', () => {
    const bus = createAmbientBeatBus();
    const hero = bus.request('surfacing', 's', S);
    bus.grant(ctx());
    expect(hero.state).toBe('granted');
    // A fresh settle at the teams station: the reading window is open, a hero is running.
    const call = bus.request('rollCall', 'roll-call', null);
    bus.grant(ctx({ sinceSettleS: 0.1 }));
    expect(call.state).toBe('granted');
    expect(bus.snapshot().rollCall.running).toBe(true);
    bus.release(hero);
    const other = bus.request('flyover', 'f', S);
    run(bus, 20, { sinceSettleS: 30 });
    expect(other.state).toBe('pending');
    expect(other.deniedReason).toBe('roll-call');
    bus.release(call);
    expect(bus.snapshot().rollCall.running).toBe(false);
    // The call's end starts the spacing clock like a hero beat's.
    expect(run(bus, HERO_SPACING_S + 0.5, { sinceSettleS: 30 })).toHaveLength(1);
    expect(other.state).toBe('granted');
  });

  it('defers for the loader, a focus and an unsettled station, like the rest', () => {
    for (const [override, reason] of [
      [{ loader: true }, 'loader'],
      [{ focusOpen: true }, 'focus'],
      [{ settled: false, sinceSettleS: null }, 'not-settled'],
    ] as const) {
      const bus = createAmbientBeatBus();
      const call = bus.request('rollCall', 'roll-call', null);
      bus.grant(ctx(override));
      expect(call.deniedReason).toBe(reason);
    }
  });

  it('counts roll-call hits per subjectId in first-hit order and logs every figure beat', () => {
    const bus = createAmbientBeatBus();
    bus.noteFigureBeat?.({ source: 'rollCall', subjectId: 'p2', figureId: 'ace-p2', mode: 'look' });
    bus.noteFigureBeat?.({ source: 'rollCall', subjectId: 'p1', figureId: 'ace-p1', mode: 'idle2' });
    bus.noteFigureBeat?.({ source: 'quiet', subjectId: 'p1', figureId: 'ace-p1', mode: 'idle2' });
    bus.noteFigureBeat?.({ source: 'rollCall', subjectId: 'p2', figureId: 'ace-p2', mode: 'look' });
    const snap = bus.snapshot();
    expect(snap.rollCall.hits).toEqual({ p2: 2, p1: 1 });
    expect(Object.keys(snap.rollCall.hits)).toEqual(['p2', 'p1']);
    expect(snap.figureBeats?.map((b) => `${b.source}:${b.subjectId}:${b.mode}`)).toEqual([
      'rollCall:p2:look',
      'rollCall:p1:idle2',
      'quiet:p1:idle2',
      'rollCall:p2:look',
    ]);
  });
});

describe('ambient-beats: clock, pin, reset and events', () => {
  it('accumulates only awake seconds, pins and resets', () => {
    const bus = createAmbientBeatBus({ force: { surfacing: 1, flyover: null, play: null } });
    for (let i = 0; i < 30; i += 1) bus.grant(ctx({ dt: 0.1 }));
    expect(bus.now()).toBeCloseTo(3, 9);
    const t = bus.request('flyover', 'f', S);
    bus.pin(0.5);
    expect(bus.now()).toBe(0.5);
    expect(t.state).toBe('released');
    // A pin clears the spacing clock: the next hero may be granted at once.
    expect(bus.snapshot().sinceHeroEndS).toBeNull();
    expect(bus.consumeForce('surfacing', 2)).toBe(true);
    bus.reset();
    expect(bus.consumeForce('surfacing', 2)).toBe(true);
  });

  it('carries events to subscribers until they unsubscribe', () => {
    const bus = createAmbientBeatBus();
    const seen: BeatEvent[] = [];
    const off = bus.subscribe((event) => seen.push(event));
    bus.emit({ kind: 'rollCall', participants: ['p1', 'p2'], columnOffsetsS: [0, 0.18], t: 1 });
    off();
    bus.emit({ kind: 'reveal', generation: 2, t: 2 });
    expect(seen).toEqual([{ kind: 'rollCall', participants: ['p1', 'p2'], columnOffsetsS: [0, 0.18], t: 1 }]);
  });

  it('PR #65 review: a granted ticket never expires; only its owner\'s release (the actor unmount) frees the bus', () => {
    const bus = createAmbientBeatBus();
    const flyover = bus.request('flyover', 'flyer-1', S);
    expect(run(bus, 1 / 30)).toHaveLength(1);
    expect(flyover.state).toBe('granted');
    bus.request('surfacing', 'surfacer-1', S);
    // The flyer's owner is gone without a release: two minutes on, every later hero beat is still `busy`.
    expect(run(bus, 120)).toEqual([]);
    expect(bus.snapshot().pending).toEqual([expect.objectContaining({ actorId: 'surfacer-1', deniedReason: 'busy' })]);
    // The unmount's release (SkyLaneFlyer / WaterResident cleanup): one spacing later the next hero is granted.
    bus.release(flyover);
    const after = run(bus, HERO_SPACING_S + 1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatch(/^surfacing:surfacer-1@/);
  });
});

describe('ambient-beats: R34 / R35 fix pass', () => {
  /** A face source built like the route director's: fail closed while `reason` is set. */
  const source = (status: { reason: FaceSourceReason | null }) => (sphere: BeatSphere) =>
    guardedFaceDistanceNdc(status.reason, IDENTITY, 1, 1, sphere, new Float64Array(0), 0);
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it('R34: a missing face source denies every hero grant (ndc), forced included, and grants once the faces exist', () => {
    const bus = createAmbientBeatBus({ force: { surfacing: 0, flyover: null, play: null } });
    const status = { reason: 'no-surfaces' as FaceSourceReason | null };
    const face = source(status);
    expect(face(S)).toBe(FACE_SOURCE_DENIED_NDC);
    const hero = bus.request('flyover', 'f', S);
    expect(bus.consumeForce('surfacing', 1)).toBe(true);
    const forced = bus.request('surfacing', 's', S, { forced: true });
    for (let i = 0; i < 30; i += 1) bus.grant(ctx({ faceDistanceNdc: face }));
    expect(hero.state).toBe('pending');
    expect(hero.deniedReason).toBe('ndc');
    expect(forced.state).toBe('pending');
    expect(forced.deniedReason).toBe('ndc');
    expect(bus.snapshot().grants).toEqual([]);
    expect(bus.snapshot().denials.ndc).toBeGreaterThanOrEqual(60);
    // Faces available, none on screen: FACE_NDC_FAR, never null, so the grant passes with a logged distance.
    status.reason = null;
    expect(face(S)).toBe(FACE_NDC_FAR);
    bus.grant(ctx({ faceDistanceNdc: face }));
    expect(forced.state).toBe('granted');
    expect(bus.snapshot().grants.at(-1)?.faceNdc).toBe(FACE_NDC_FAR);
  });

  it('R35: reset() clears the roll-call hits and the figure-beat log; pin() keeps them', () => {
    const bus = createAmbientBeatBus();
    bus.noteFigureBeat?.({ source: 'rollCall', subjectId: 'p1', figureId: 'ace-p1', mode: 'look' });
    bus.noteFigureBeat?.({ source: 'quiet', subjectId: 'p2', figureId: 'ace-p2', mode: 'look' });
    bus.pin(1);
    expect(bus.snapshot().rollCall.hits).toEqual({ p1: 1 });
    expect(bus.snapshot().figureBeats).toHaveLength(2);
    bus.reset();
    expect(bus.snapshot().rollCall.hits).toEqual({});
    expect(bus.snapshot().figureBeats).toEqual([]);
    bus.noteFigureBeat?.({ source: 'rollCall', subjectId: 'p3', figureId: 'ace-p3', mode: 'idle2' });
    expect(bus.snapshot().rollCall.hits).toEqual({ p3: 1 });
  });

  it('R35: emitRollCall stamps the event with the bus awake clock', () => {
    const bus = createAmbientBeatBus();
    for (let i = 0; i < 25; i += 1) bus.grant(ctx({ dt: 0.1 }));
    const seen: BeatEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    emitRollCall(bus, ['p1', 'p2'], [0, 0.14]);
    emitRollCall(null, ['p9'], [0]);
    expect(seen).toEqual([{ kind: 'rollCall', participants: ['p1', 'p2'], columnOffsetsS: [0, 0.14], t: bus.now() }]);
    expect(bus.now()).toBeCloseTo(2.5, 9);
  });

  it('R35: the Roll Call Ledger publishes through emitRollCall (bus clock), never a wall-clock t', () => {
    const src = readFileSync(resolve(__dirname, '../../../components/world/route/teams/RollCallLedger.tsx'), 'utf8');
    expect(src).toMatch(/emitRollCall\(\s*getActiveFigureDirector\(\)\?\.bus/);
    expect(src).not.toMatch(/kind:\s*'rollCall'/);
  });

  it('R34: FigureDirector imports the four worlds’ data faces statically (no dynamic import)', () => {
    const src = readFileSync(resolve(__dirname, '../../../components/world/route/figures/FigureDirector.tsx'), 'utf8');
    expect(src).not.toMatch(/\bimport\s*\(/);
    for (const name of ['PLAZA_DATA_SURFACES', 'SAKURA_DATA_SURFACES', 'MOUNTAIN_DATA_SURFACES', 'CLOUDS_DATA_SURFACES']) {
      expect(src).toMatch(new RegExp(`^import \\{ ${name} \\} from '[^']+/data-faces';$`, 'm'));
    }
  });
});
