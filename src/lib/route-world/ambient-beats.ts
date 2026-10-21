/**
 * Ambient beat bus (POKEMON-CORE-PLAN §4 SEAT A1 step 4; D35 3A).
 *
 * FROZEN PUBLIC TYPES (the A1 → A2 / B / D contract freeze): `HeroBeatKind`,
 * `BeatSphere`, `BeatTicket` and its states, `BeatRequestOptions`,
 * `BeatGrantContext`, `BeatEvent` (the event channel), `BeatForce` and its
 * parser, `BeatParams`, `AmbientBeatBus` (request / grant / release / emit /
 * subscribe / force / snapshot), `BeatBusSnapshot` (with the reading-window
 * and roll-call state) and `BeatsReport` (the `__routeWorldBeats` shape).
 * They change only through the lead. The BODY of `createAmbientBeatBus` is
 * A2's real bus (fairness, the 6 s reading window, 8 s spacing,
 * round-robin, quiet mode, the NDC precondition, the data-bound roll call),
 * behind the same types. A2's additive, optional fields:
 * `BeatGrantRecord.faceNdc`, `FigureBeatRecord`,
 * `BeatBusSnapshot.quiet` / `figureBeats` / `sinceHeroEndS` and
 * `AmbientBeatBus.noteFigureBeat`; after R34, `BeatsReport.faceSource`
 * (`FaceSourceStatus`), and after R35 the `emitRollCall` helper.
 *
 * Two channels, never mixed up (coverage P10):
 *  - HERO BEATS are exclusive, requested by an actor, granted by the bus and
 *    released by the actor (`request` → `grant` → `release`). `rollCall` is a
 *    hero-beat KIND so that, while a roll call runs, the bus can refuse other
 *    hero grants; it is requested by the DIRECTOR (actor id `roll-call`), never
 *    by the ledger.
 *  - EVENTS are fire-and-forget notifications (`emit` / `subscribe`). The Roll
 *    Call Ledger PUBLISHES on the event channel (`{kind: 'rollCall', …}`: the
 *    ordered participant ids and per-column start offsets); the director maps
 *    them to `subjectId`s. Water play rides `play`.
 *
 * Time (D40, C9): every duration the bus keeps is in ACCUMULATED AWAKE
 * SECONDS — the clamped r3f delta the director hands each rendered frame,
 * nothing while `document.hidden` or parked. A hidden hour therefore resumes
 * with no backlog: a pending request is one ticket per (kind, actor), and at
 * most one grant is issued per frame.
 *
 * Pure data — no React, no three, no DOM.
 */

/** Exclusive, staged hero beats. `rulesCeremony` is reserved (deferred to 4P / wave 6, plan §7). */
export type HeroBeatKind = 'flyover' | 'surfacing' | 'attack' | 'rollCall' | 'rulesCeremony';

export const HERO_BEAT_KINDS: readonly HeroBeatKind[] = ['flyover', 'surfacing', 'attack', 'rollCall', 'rulesCeremony'];

/** The requester's WORLD-space bounding sphere (the NDC face-distance precondition projects it, A2). */
export interface BeatSphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * `pending` → `granted` → `released`; `pending` → `released` when the actor
 * withdraws. A released ticket is never granted again (re-request instead).
 */
export type BeatTicketState = 'pending' | 'granted' | 'released';

/** Why the bus did not grant this frame (`quiet`: a participant focus is open — quiet mode defers hero beats). */
export type BeatDenyReason =
  | 'hidden'
  | 'loader'
  | 'focus'
  | 'not-live'
  | 'busy'
  | 'not-settled'
  | 'reading-window'
  | 'spacing'
  | 'round-robin'
  | 'ndc'
  | 'quiet'
  | 'roll-call'
  | 'reduced-motion';

/** One request's handle. Owned by the bus; the actor reads `state` each frame. */
export interface BeatTicket {
  readonly id: number;
  readonly kind: HeroBeatKind;
  readonly actorId: string;
  readonly state: BeatTicketState;
  /** Request order (monotonic across the bus's life). */
  readonly seq: number;
  /** Bus awake seconds at the request. */
  readonly requestedAtS: number;
  /** Bus awake seconds at the grant (null until granted). */
  readonly grantedAtS: number | null;
  /** The last reason a grant was refused (null once granted). */
  readonly deniedReason: BeatDenyReason | null;
  /** Requested through a `?beatForce=` second (wins over suppression, A2 rule). */
  readonly forced: boolean;
  /** The sphere as last requested (the actor may refresh it by requesting again). */
  readonly sphere: BeatSphere | null;
}

export interface BeatRequestOptions {
  /** The request comes from a `beatForce` second (`consumeForce` returned true). */
  forced?: boolean;
}

/**
 * The frame inputs a grant decision reads. The director builds it once per
 * rendered frame; the bus reads every field.
 */
export interface BeatGrantContext {
  /** Clamped frame delta (s); 0 while hidden. */
  dt: number;
  /** `document.hidden` (or the canvas parked). */
  hidden: boolean;
  /** The ball loader is up (loading / opening / releasing). */
  loader: boolean;
  /** A focus subject is open (focusing / focused / releasing). */
  focusOpen: boolean;
  /** The id of the open focus subject (quiet mode: `team:<participant>`), null when none. */
  focusSubjectId: string | null;
  /** The reveal armed for the current scene generation. */
  live: boolean;
  /** The latched station settle (`useStationSettle` semantics). */
  settled: boolean;
  /** Awake seconds since the latest settle (the reading window's clock); null while unsettled. */
  sinceSettleS: number | null;
  /** Hysteretic nearest station index. */
  station: number;
  /** Reduced motion under a forced route tier (D12): the director runs `static`, no hero beats. */
  staticMotion: boolean;
  /**
   * NDC distance (0..2) of `sphere`'s projection from the ACTIVE padded data
   * face at the current pose, or null when there is no active face. Supplied
   * by the director; the ≥ 0.06 precondition is A2's rule.
   *
   * R34: the route director's source FAILS CLOSED and never returns null —
   * `FACE_SOURCE_DENIED_NDC` (0, so every hero grant is denied `ndc`) when
   * the active world's faces are unavailable, `FACE_NDC_FAR` when they are
   * available but none is on screen (`figure-director.ts`
   * `guardedFaceDistanceNdc`). A null from any other source still passes.
   */
  faceDistanceNdc: (sphere: BeatSphere) => number | null;
}

/** The event channel (fire-and-forget). */
export type BeatEvent =
  | { kind: 'fidget'; figureId: string; clip: string; t: number }
  /**
   * Published by the Roll Call Ledger (A2): the ordered participant ids and
   * each column's start offset (s, relative to the call start), matched by the
   * director to registrations' `subjectId`.
   */
  | { kind: 'rollCall'; participants: readonly string[]; columnOffsetsS: readonly number[]; t: number }
  /** Water / actor play (breach, dive, spin, surfacing play, …). */
  | { kind: 'play'; actorId: string; play: string; t: number }
  | { kind: 'reveal'; generation: number; t: number }
  | { kind: 'attack'; actorId: string; move: string | null; t: number };

export type BeatEventKind = BeatEvent['kind'];

/**
 * routeDebug-only forced beats: `?beatForce=surfacing@10,flyover@18,play@25`
 * — the accumulated awake second after settle at which the named beat fires
 * (the first pass / surfacing / play event; later ones follow their own
 * seeded schedule).
 */
export interface BeatForce {
  surfacing: number | null;
  flyover: number | null;
  play: number | null;
}

export type BeatForceKind = keyof BeatForce;

export const BEAT_FORCE_KINDS: readonly BeatForceKind[] = ['surfacing', 'flyover', 'play'];

export const NO_BEAT_FORCE: BeatForce = Object.freeze({ surfacing: null, flyover: null, play: null });

/** Upper bound for a forced second (an hour of awake time). */
export const BEAT_FORCE_MAX_S = 3600;

export interface BeatForceParse {
  force: BeatForce;
  /** Tokens that did not parse (reported by the debug overlay, never thrown). */
  invalid: string[];
}

/**
 * Parse a `beatForce` value (`kind@seconds`, comma separated, whitespace
 * tolerated). Unknown kinds, non-numeric or negative seconds and values above
 * `BEAT_FORCE_MAX_S` are reported in `invalid`; a repeated kind keeps the
 * FIRST value. Never throws.
 */
export function parseBeatForce(raw: string | null | undefined): BeatForceParse {
  const force: { -readonly [K in BeatForceKind]: number | null } = { surfacing: null, flyover: null, play: null };
  const invalid: string[] = [];
  if (!raw) return { force, invalid };
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const match = /^([a-zA-Z]+)@(\d+(?:\.\d+)?)$/.exec(trimmed);
    if (!match) {
      invalid.push(trimmed);
      continue;
    }
    const kind = match[1] as BeatForceKind;
    const seconds = Number(match[2]);
    if (!BEAT_FORCE_KINDS.includes(kind) || !Number.isFinite(seconds) || seconds < 0 || seconds > BEAT_FORCE_MAX_S) {
      invalid.push(trimmed);
      continue;
    }
    if (force[kind] === null) force[kind] = seconds;
  }
  return { force, invalid };
}

export interface BeatParams {
  force: BeatForce;
  /** `?beatSeed=` (uint32), null when absent or invalid. */
  seed: number | null;
  invalid: string[];
}

/**
 * The bus's URL params, honoured ONLY in a routeDebug session (L4). Outside it
 * every value is inert: no force, no seed.
 */
export function parseBeatParams(search: string, routeDebug: boolean): BeatParams {
  if (!routeDebug) return { force: NO_BEAT_FORCE, seed: null, invalid: [] };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { force: NO_BEAT_FORCE, seed: null, invalid: [] };
  }
  const { force, invalid } = parseBeatForce(params.get('beatForce'));
  const rawSeed = params.get('beatSeed');
  let seed: number | null = null;
  if (rawSeed !== null) {
    if (/^\d{1,10}$/.test(rawSeed) && Number(rawSeed) <= 0xffffffff) seed = Number(rawSeed) >>> 0;
    else invalid.push(`beatSeed=${rawSeed}`);
  }
  return { force, seed, invalid };
}


/** One entry of the bus's bounded grant log (evidence: `__routeWorldBeats`, A2). */
export interface BeatGrantRecord {
  ticket: number;
  kind: HeroBeatKind;
  actorId: string;
  grantedAtS: number;
  forced: boolean;
  /**
   * A2 (additive, optional): the requester's NDC distance from the active
   * padded face at the grant (`BeatGrantContext.faceDistanceNdc`), null when
   * there was no active face or the kind is data-bound (`rollCall`). K4 reads
   * it: every non-roll-call grant has it ≥ `BEAT_FACE_NDC_MIN` or null.
   */
  faceNdc?: number | null;
}

/**
 * A2 (additive): one figure beat the director fired — a roll-call column
 * (`rollCall`) or the focused ace's quiet-mode beat (`quiet`). `mode` is
 * `idle2` when the figure has that clip, else `look` (breath plus the 6°
 * look through `FigureRegistration.look`, D16 / R17).
 */
export interface FigureBeatRecord {
  source: 'rollCall' | 'quiet';
  subjectId: string;
  figureId: string;
  mode: 'idle2' | 'look';
  /** Bus awake seconds when it fired. */
  atS: number;
  /**
   * Fix round (additive, optional): seconds the figure's beat had already run when this record was
   * written. Set when a roll-call hit takes over a beat that is still running (the director never
   * restarts it), so the beat began at `atS - intoS`; absent for a fresh start.
   */
  intoS?: number;
}

export interface BeatBusSnapshot {
  /** Bus awake seconds. */
  t: number;
  pending: { ticket: number; kind: HeroBeatKind; actorId: string; deniedReason: BeatDenyReason | null }[];
  granted: { ticket: number; kind: HeroBeatKind; actorId: string; grantedAtS: number }[];
  /** Oldest first, bounded (`BEAT_LOG_MAX`). */
  grants: BeatGrantRecord[];
  /** Refusals counted per reason (frames × pending tickets). */
  denials: Partial<Record<BeatDenyReason, number>>;
  /** Why the last frame granted nothing, null when it could have. */
  suppression: BeatDenyReason | null;
  force: BeatForce;
  /** Force kinds already consumed. */
  forcedFired: BeatForceKind[];
  seed: number | null;
  /**
   * The 6 s reading window after a settle (A2's rule): `open` while it holds
   * grants back; `sinceSettleS` is the grant context's clock at the last
   * frame.
   */
  readingWindow: { open: boolean; sinceSettleS: number | null };
  /**
   * The roll call (A2): `running` while a `rollCall` hero ticket is granted;
   * `hits` counts the director's roll-call beats per `subjectId` (idle2, or
   * breath plus the 6° look), in the ledger's order of first hit.
   */
  rollCall: { running: boolean; hits: Record<string, number> };
  /** A2 (additive, optional): quiet mode (a focus open) at the last frame, with the focused participant id. */
  quiet?: { active: boolean; subjectId: string | null };
  /** A2 (additive, optional): the figure beats fired (roll call and quiet mode), oldest first, bounded (`BEAT_LOG_MAX`). */
  figureBeats?: FigureBeatRecord[];
  /** A2 (additive, optional): awake seconds since the last hero beat ended (the 8 s spacing clock); null before the first. */
  sinceHeroEndS?: number | null;
}

/**
 * `window.__routeWorldBeats()` (routeDebug; A2 step 4 publishes it from
 * `EvidenceBridges.tsx`): the bus snapshot plus the director's cost from the
 * warm-stats ledger's `directorMs` ring (ms; null before a window exists).
 * `p50` / `p95` include the mixer sampling the director drives; `ownP50` /
 * `ownP95` exclude it.
 */
export interface BeatsReport extends BeatBusSnapshot {
  directorMs: { p50: number | null; p95: number | null; ownP50: number | null; ownP95: number | null };
  /**
   * R34 (additive, optional): the director's face source at the last frame.
   * When it is unavailable, every hero grant is denied `ndc` (fail closed)
   * and `reason` says why.
   */
  faceSource?: FaceSourceStatus;
}

/** Why the director's face source cannot judge a sphere (R34: it then denies every hero grant). */
export type FaceSourceReason = 'no-surfaces' | 'no-camera' | 'no-viewport' | 'no-station';

/** R34: the director's face source (`__routeWorldBeats().faceSource`). */
export interface FaceSourceStatus {
  /** The active world's padded faces can be measured this frame. */
  available: boolean;
  /** Null when available. */
  reason: FaceSourceReason | null;
  /** Active-station faces projected on screen at the last rebuild. */
  faces: number;
}

/** R34: the sentinel distance a face source reports when it is unavailable (below `BEAT_FACE_NDC_MIN`: denied). */
export const FACE_SOURCE_DENIED_NDC = 0;

export const BEAT_LOG_MAX = 64;

/* ── A2 rules (POKEMON-CORE-PLAN §4 SEAT A2 step 1; §1 Clarity law) ──────── */

/** No hero beat in the first 6 awake seconds after a station settle (the reading window). */
export const READING_WINDOW_S = 6;
/** At least 8 awake seconds between the end of one hero beat and the next grant. */
export const HERO_SPACING_S = 8;
/** A hero grant needs the requester's projected sphere at least this far (NDC) from the active padded face. */
export const BEAT_FACE_NDC_MIN = 0.06;
/** The hero kinds the round-robin rotates through (`rollCall` is data-bound and never rotates). */
export const ROTATING_HERO_KINDS: readonly HeroBeatKind[] = HERO_BEAT_KINDS.filter((kind) => kind !== 'rollCall');

export interface AmbientBeatBus {
  /**
   * Ask for a hero beat. Idempotent per (kind, actorId): while that actor has
   * an open (pending or granted) ticket of that kind, the SAME ticket is
   * returned (its sphere refreshed) — requests never queue up (no backlog).
   */
  request(kind: HeroBeatKind, actorId: string, sphere: BeatSphere | null, options?: BeatRequestOptions): BeatTicket;
  /**
   * The director's once-per-frame grant decision: advances the bus clock by
   * `ctx.dt` and returns the tickets granted THIS frame (a shared, reused
   * array — read it before the next call).
   */
  grant(ctx: BeatGrantContext): readonly BeatTicket[];
  /**
   * The actor is done (or withdraws a pending request). Idempotent. An actor
   * that unmounts with an open ticket releases it too: the bus never expires
   * a ticket, so a granted one left behind holds every later hero beat `busy`
   * until the next `pin` / `reset`.
   */
  release(ticket: BeatTicket): void;
  /** Publish on the event channel. */
  emit(event: BeatEvent): void;
  /** Listen to the event channel; returns the unsubscribe. */
  subscribe(listener: (event: BeatEvent) => void): () => void;
  /** The forced second for `kind` (null when not forced). */
  forced(kind: BeatForceKind): number | null;
  /**
   * True EXACTLY ONCE: the first call with `sinceSettleS` ≥ the forced second
   * for `kind`. Steppers (D's surfacer / lane / play timers) call it each
   * frame and request with `{ forced: true }` when it fires.
   */
  consumeForce(kind: BeatForceKind, sinceSettleS: number | null): boolean;
  /**
   * Canonical clock for the phase pin (`director.pinPhase`). Open tickets are
   * released; the evidence (grant log, denials, hits, figure beats) is kept.
   */
  pin(t: number): void;
  /**
   * A new scene generation: every ticket released, force re-armed, the roll
   * call's hits and the figure-beat log cleared (R35: no evidence from an
   * earlier generation); the grant log and the denial counts are kept.
   */
  reset(): void;
  /** Bus awake seconds. */
  now(): number;
  snapshot(): BeatBusSnapshot;
  /**
   * A2 (additive, optional): the director reports a figure beat it fired. A
   * `rollCall` beat counts one hit for its `subjectId` (`snapshot().rollCall.hits`).
   */
  noteFigureBeat?(beat: Omit<FigureBeatRecord, 'atS'>): void;
}

export interface AmbientBeatBusOptions {
  force?: BeatForce;
  seed?: number | null;
}

interface MutableTicket {
  id: number;
  kind: HeroBeatKind;
  actorId: string;
  state: BeatTicketState;
  seq: number;
  requestedAtS: number;
  grantedAtS: number | null;
  deniedReason: BeatDenyReason | null;
  forced: boolean;
  sphere: BeatSphere | null;
  /** The grant frame that last denied it (one reason per ticket per frame). */
  deniedFrame: number;
}

/**
 * The bus (A2). Every rendered frame (`grant`) it issues AT MOST ONE grant,
 * so a resume never releases a backlog. The rules, in the order a pending
 * ticket meets them:
 *
 *  - `hidden` suppresses everything (a hidden tab renders no frame to show a
 *    beat in, and its clock does not move).
 *  - `rollCall` (data-bound, requested by the director for the ledger's
 *    call): needs live, no loader, no focus, a settle and full motion. It is
 *    EXEMPT from the reading window, the one-hero rule, the spacing, the
 *    round-robin and the NDC precondition (it stages no actor); while it
 *    runs, no other hero beat is granted (`roll-call`).
 *  - A FORCED ticket (`consumeForce` → `request(…, {forced: true})`, routeDebug
 *    only) wins over the loader, focus / quiet mode, the settle, the reading
 *    window, the spacing and the round-robin — never over `hidden`, reduced
 *    motion, the pre-reveal, a running hero or roll call (one at a time) or
 *    the NDC precondition (the clarity law holds for forced beats too, K4).
 *  - Any other hero ticket: reduced motion (`static`, D12), live, no loader,
 *    no focus (`quiet` when the focus is a participant: quiet mode defers
 *    hero beats), settled, no roll call running, no hero running (`busy`),
 *    past the 6 s reading window, ≥ 8 s after the last hero beat ended
 *    (`spacing`); then one kind is chosen ROUND-ROBIN (the kind after the last
 *    granted one, in `ROTATING_HERO_KINDS` order, rotated by the seed at
 *    start) and its oldest ticket whose sphere passes the NDC precondition is
 *    granted. A ticket without a sphere cannot pass it (`ndc`).
 *
 * Deterministic: the same requests on the same frames give the same (kind,
 * actor, order) sequence for the same seed (K2).
 */
export function createAmbientBeatBus(options: AmbientBeatBusOptions = {}): AmbientBeatBus {
  const force: BeatForce = options.force ?? NO_BEAT_FORCE;
  const seed = options.seed ?? null;
  const kindCount = ROTATING_HERO_KINDS.length;
  /** The round-robin's starting kind (seeded), before any grant. */
  const rotationStart = seed === null ? 0 : (seed >>> 0) % kindCount;
  /**
   * The per-frame scalars on one object (not closure `let`s), so the grant
   * boxes no double per frame: `t` the bus awake clock; `heroEnd` the clock
   * when the last hero beat (or roll call) ended (−1: none yet); `next` the
   * index in `ROTATING_HERO_KINDS` the round-robin tries first; `frame`
   * counts grant calls (one denial reason per ticket per frame).
   */
  const clk = { t: 0, heroEnd: -1, next: rotationStart, frame: 0 };
  /** The last grant context (the director's reused scratch): the snapshot reads its clocks. */
  let lastCtx: BeatGrantContext | null = null;
  let nextId = 1;
  let nextSeq = 1;
  /** Open tickets (pending or granted), request order. */
  const open: MutableTicket[] = [];
  const grantedNow: BeatTicket[] = [];
  const log: BeatGrantRecord[] = [];
  const beats: FigureBeatRecord[] = [];
  const hits: Record<string, number> = {};
  const denials: Partial<Record<BeatDenyReason, number>> = {};
  const listeners = new Set<(event: BeatEvent) => void>();
  const fired = new Set<BeatForceKind>();
  let suppression: BeatDenyReason | null = null;
  let readingOpen = false;

  const closeTicket = (ticket: MutableTicket) => {
    if (ticket.state === 'granted') clk.heroEnd = clk.t;
    ticket.state = 'released';
    const i = open.indexOf(ticket);
    if (i >= 0) open.splice(i, 1);
  };

  const deny = (ticket: MutableTicket, reason: BeatDenyReason) => {
    ticket.deniedFrame = clk.frame;
    ticket.deniedReason = reason;
    denials[reason] = (denials[reason] ?? 0) + 1;
  };

  const doGrant = (ticket: MutableTicket, faceNdc: number | null) => {
    ticket.state = 'granted';
    ticket.grantedAtS = clk.t;
    ticket.deniedReason = null;
    grantedNow.push(ticket);
    log.push({ ticket: ticket.id, kind: ticket.kind, actorId: ticket.actorId, grantedAtS: clk.t, forced: ticket.forced, faceNdc });
    if (log.length > BEAT_LOG_MAX) log.splice(0, log.length - BEAT_LOG_MAX);
  };

  /**
   * The NDC precondition: the distance of the ticket's sphere from the active
   * padded face, `undefined` when it fails (no sphere, or closer than
   * `BEAT_FACE_NDC_MIN`), null when there is no active face (it passes).
   */
  const faceCheck = (ticket: MutableTicket, ctx: BeatGrantContext): number | null | undefined => {
    if (ticket.sphere === null) return undefined;
    const d = ctx.faceDistanceNdc(ticket.sphere);
    if (d === null) return null;
    return d >= BEAT_FACE_NDC_MIN ? d : undefined;
  };

  const focusReason = (ctx: BeatGrantContext): BeatDenyReason => (ctx.focusSubjectId !== null ? 'quiet' : 'focus');

  return {
    request(kind, actorId, sphere, requestOptions) {
      for (let i = 0; i < open.length; i += 1) {
        const ticket = open[i];
        if (ticket.kind === kind && ticket.actorId === actorId) {
          ticket.sphere = sphere;
          if (requestOptions?.forced) ticket.forced = true;
          return ticket;
        }
      }
      const ticket: MutableTicket = {
        id: nextId++,
        kind,
        actorId,
        state: 'pending',
        seq: nextSeq++,
        requestedAtS: clk.t,
        grantedAtS: null,
        deniedReason: null,
        forced: requestOptions?.forced === true,
        sphere,
        deniedFrame: -1,
      };
      open.push(ticket);
      return ticket;
    },

    // Index loops only: the grant runs every rendered frame and allocates
    // nothing while no ticket changes state.
    grant(ctx) {
      grantedNow.length = 0;
      clk.frame += 1;
      lastCtx = ctx;
      const dt = ctx.hidden ? 0 : Math.max(0, Number.isFinite(ctx.dt) ? ctx.dt : 0);
      clk.t += dt;
      const since = ctx.settled ? ctx.sinceSettleS : null;
      readingOpen = ctx.settled && (since === null || since < READING_WINDOW_S);
      if (ctx.hidden) {
        suppression = 'hidden';
        for (let i = 0; i < open.length; i += 1) if (open[i].state === 'pending') deny(open[i], 'hidden');
        return grantedNow;
      }
      let heroRunning = false;
      let callRunning = false;
      for (let i = 0; i < open.length; i += 1) {
        if (open[i].state !== 'granted') continue;
        if (open[i].kind === 'rollCall') callRunning = true;
        else heroRunning = true;
      }
      // What holds back each class of ticket this frame (null: nothing).
      const callBlock: BeatDenyReason | null = ctx.staticMotion
        ? 'reduced-motion'
        : !ctx.live
          ? 'not-live'
          : ctx.loader
            ? 'loader'
            : ctx.focusOpen
              ? focusReason(ctx)
              : !ctx.settled
                ? 'not-settled'
                : null;
      const forcedBlock: BeatDenyReason | null = ctx.staticMotion
        ? 'reduced-motion'
        : !ctx.live
          ? 'not-live'
          : callRunning
            ? 'roll-call'
            : heroRunning
              ? 'busy'
              : null;
      const heroBlock: BeatDenyReason | null =
        callBlock ??
        (callRunning
          ? 'roll-call'
          : heroRunning
            ? 'busy'
            : readingOpen
              ? 'reading-window'
              : clk.heroEnd >= 0 && clk.t - clk.heroEnd < HERO_SPACING_S
                ? 'spacing'
                : null);
      suppression = heroBlock;
      let granted = false;

      // 1. The roll call (data-bound), request order.
      for (let i = 0; i < open.length; i += 1) {
        const ticket = open[i];
        if (ticket.state !== 'pending' || ticket.kind !== 'rollCall') continue;
        if (granted) deny(ticket, 'busy');
        else if (callBlock !== null) deny(ticket, callBlock);
        else {
          doGrant(ticket, null);
          granted = true;
          callRunning = true;
        }
      }
      // 2. Forced hero tickets, request order.
      for (let i = 0; i < open.length; i += 1) {
        const ticket = open[i];
        if (ticket.state !== 'pending' || !ticket.forced || ticket.kind === 'rollCall') continue;
        const block = granted ? (callRunning ? 'roll-call' : 'busy') : forcedBlock;
        if (block !== null) {
          deny(ticket, block);
          continue;
        }
        const face = faceCheck(ticket, ctx);
        if (face === undefined) {
          deny(ticket, 'ndc');
          continue;
        }
        doGrant(ticket, face);
        granted = true;
        heroRunning = true;
      }
      // 3. Every other hero ticket: round-robin over the kinds.
      const block: BeatDenyReason | null = granted ? (callRunning ? 'roll-call' : 'busy') : heroBlock;
      if (block !== null) {
        for (let i = 0; i < open.length; i += 1) {
          const ticket = open[i];
          if (ticket.state === 'pending' && !ticket.forced && ticket.kind !== 'rollCall') deny(ticket, block);
        }
        return grantedNow;
      }
      let winner: MutableTicket | null = null;
      let winnerFace: number | null = null;
      for (let step = 0; step < kindCount && winner === null; step += 1) {
        const k = (clk.next + step) % kindCount;
        const kind = ROTATING_HERO_KINDS[k];
        for (let i = 0; i < open.length; i += 1) {
          const ticket = open[i];
          if (ticket.state !== 'pending' || ticket.forced || ticket.kind !== kind) continue;
          if (winner !== null) {
            deny(ticket, 'busy');
            continue;
          }
          const face = faceCheck(ticket, ctx);
          if (face === undefined) {
            deny(ticket, 'ndc');
            continue;
          }
          winner = ticket;
          winnerFace = face;
          clk.next = (k + 1) % kindCount;
        }
      }
      if (winner !== null) {
        doGrant(winner, winnerFace);
        for (let i = 0; i < open.length; i += 1) {
          const ticket = open[i];
          if (ticket.state === 'pending' && !ticket.forced && ticket.kind !== 'rollCall' && ticket.deniedFrame !== clk.frame) deny(ticket, 'round-robin');
        }
      }
      return grantedNow;
    },

    release(ticket) {
      for (let i = 0; i < open.length; i += 1) {
        if (open[i] === ticket) {
          closeTicket(open[i]);
          return;
        }
      }
    },

    emit(event) {
      for (const listener of listeners) listener(event);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    forced(kind) {
      return force[kind];
    },

    consumeForce(kind, sinceSettleS) {
      const at = force[kind];
      if (at === null || fired.has(kind) || sinceSettleS === null || !(sinceSettleS >= at)) return false;
      fired.add(kind);
      return true;
    },

    pin(at) {
      clk.t = Math.max(0, at);
      while (open.length > 0) closeTicket(open[0]);
      clk.heroEnd = -1;
      clk.next = rotationStart;
    },

    reset() {
      while (open.length > 0) closeTicket(open[0]);
      fired.clear();
      // R35: a new generation's K1 / K3 evidence starts empty.
      beats.length = 0;
      for (const id of Object.keys(hits)) delete hits[id];
      suppression = null;
      clk.heroEnd = -1;
      clk.next = rotationStart;
    },

    now() {
      return clk.t;
    },

    noteFigureBeat(beat) {
      beats.push({ ...beat, atS: clk.t });
      if (beats.length > BEAT_LOG_MAX) beats.splice(0, beats.length - BEAT_LOG_MAX);
      if (beat.source === 'rollCall') hits[beat.subjectId] = (hits[beat.subjectId] ?? 0) + 1;
    },

    snapshot() {
      const t = clk.t;
      return {
        t,
        pending: open
          .filter((ticket) => ticket.state === 'pending')
          .map((ticket) => ({ ticket: ticket.id, kind: ticket.kind, actorId: ticket.actorId, deniedReason: ticket.deniedReason })),
        granted: open
          .filter((ticket) => ticket.state === 'granted')
          .map((ticket) => ({ ticket: ticket.id, kind: ticket.kind, actorId: ticket.actorId, grantedAtS: ticket.grantedAtS ?? t })),
        grants: log.map((entry) => ({ ...entry })),
        denials: { ...denials },
        suppression,
        force: { ...force },
        forcedFired: [...fired],
        seed,
        readingWindow: { open: readingOpen, sinceSettleS: lastCtx ? lastCtx.sinceSettleS : null },
        rollCall: { running: open.some((ticket) => ticket.state === 'granted' && ticket.kind === 'rollCall'), hits: { ...hits } },
        quiet: { active: lastCtx !== null && lastCtx.focusOpen, subjectId: lastCtx ? lastCtx.focusSubjectId : null },
        figureBeats: beats.map((entry) => ({ ...entry })),
        sinceHeroEndS: clk.heroEnd >= 0 ? t - clk.heroEnd : null,
      };
    },
  };
}

/**
 * R35: publish the Roll Call Ledger's call on `bus`'s event channel, stamped
 * with the bus's awake clock (`bus.now()`, D40) like every other event. A
 * no-op without a bus (no director mounted).
 */
export function emitRollCall(
  bus: AmbientBeatBus | null | undefined,
  participants: readonly string[],
  columnOffsetsS: readonly number[],
): void {
  if (!bus) return;
  bus.emit({ kind: 'rollCall', participants, columnOffsetsS, t: bus.now() });
}
