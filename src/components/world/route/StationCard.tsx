'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, type AnimationEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { DataSurfaceTheme } from '@/lib/route-world/data-surfaces';
import type { ScreenRect } from '@/lib/route-world/evidence-probe';
import {
  CARD_PILL_H,
  CARD_PILL_W,
  CARD_VELOCITY_EPS,
  EMPTY_DIGEST_FACTS,
  INITIAL_CARD_EPISODE,
  cardKicker,
  cardRegionName,
  collapsedPillKeepOuts,
  finishCardExit,
  stepCardEpisode,
  formatStationDigest,
  liteHref,
  panelHref,
  pillPreferPoint,
  placeCollapsedPill,
  placeStationCard,
  resolveStationCta,
  stationCardChrome,
  subjectKeepOuts,
  type CardTravel,
  type ProjectedSubject,
  type StationDigestFacts,
  type TeamChip,
} from '@/lib/route-world/station-digest';
import type { BallPhase } from '@/lib/route-world/ball-loader-state';
import { useLocale } from '@/i18n/client';
import { localizeThemeStations } from '@/components/world/themes/station-copy';
import { getBallPhase } from './scene-progress';
import { useWorldHandoff, useWorldState } from './WorldStateProvider';
import { useStationSettle } from './useStationSettle';
import { focusStore, useFocusRegistryVersion, useFocusState } from './focus/focus-store';
import { projectToViewport } from './focus/hover-geometry';
import TeamsRollCallRail from './TeamsRollCallRail';

/**
 * Fidelity wave 2 (2B; D15) — the Station Card: a small DOM caption over the
 * route canvas that says where the visitor is, what the station shows and
 * how to open it. Route tier only; the semantic page stays the full task
 * surface (the card's links are the same panels the world's taps open).
 *
 * Content: the kicker `n/5 · TITLE`, the station's authored `beat` line, ONE
 * digest fact at every viewport (station-digest.ts — row 1 of the painter
 * input; at Teams on a phone the roll-call chip rail instead, on desktop the
 * trainer count and leader), one real CTA link to a docked panel
 * (`resolveStationCta`: `?board=pulse`, `?board=roster`, `?rules=gate`, the
 * rank-1 `?team=<id>` at Teams — label from ONE table; FocusUrlSync turns it
 * into a focus), and the "Als Text lesen" / "Read as text" exit to
 * `?tier=lite`. The compact and strip variants drop only the beat line.
 *
 * When it shows: only while the ball ceremony is `done` (or never ran,
 * `hidden`) AND the latched `settled` signal (2A `useStationSettle`) holds —
 * never mid-crossing, never over the loader. It exits the way the rendered
 * world moves (forward → leaves upward, backward → downward) and the next
 * card enters from the opposite edge, an 8 px translate plus fade; under
 * reduced motion (the forced-route reduced-motion case) opacity only. The
 * enter edge keys on the station step from the last card shown; the exit
 * edge on the sign of the SMOOTHED progress velocity at exit start; the
 * conductor's latched `direction` is only the fallback (wave-2 r2: the latch
 * lags a jitter reversal by its dwell). One latch per episode
 * (`stepCardEpisode`, station-digest.ts), never on raw x.5 progress. While a docked panel is open (or a focus blend runs) the card
 * collapses to its kicker — no sheet over a sheet at 390 — and that pill is
 * re-placed at the pose the camera lands in (`placeCollapsedPill`): clear of
 * every on-screen ace, the focused subject and the docked panel's region, or
 * hidden (it yields) when no slot is clear.
 *
 * Where: `placeStationCard` (station-digest.ts) over this world's data faces
 * (2A) at the live viewport — the phone caption band, or a desktop corner
 * box clear of every padded face — AND clear of the live keep-outs (LOOK r6,
 * C1): once the camera rests at the settled station, every registered focus
 * subject is projected through the live camera (`projectToViewport`, the
 * same AABB projection the harness audits) and `subjectKeepOuts` turns the
 * on-screen aces into padded rects the placement must avoid. That happens
 * once per settle (not per frame), and the card waits for it, so it never
 * appears at a stale slot. The box is drawn inside the chosen rect
 * (`max-height` + overflow clip), so the tested rect bounds the real card.
 *
 * Harness hooks: `[data-station-caption]` on the card box (2H reads its rect,
 * opacity and visibility), plus `data-card-state` (enter | exit),
 * `data-edge`, `data-direction`, `data-travel` (smoothed velocity sign), `data-variant`, `data-collapsed`,
 * `data-station`, `data-keep-outs` (live keep-out count), `data-keep-out-clear`
 * and, while collapsed, `data-pill` (placed | yield).
 *
 * Honest limits:
 *  - The data faces are loaded lazily per theme (a dynamic import) so DOM-only
 *    worlds never ship them; until they arrive there is no card.
 *  - A live viewport with no clear placement (an unusual aspect) gets no card
 *    rather than chrome over data; the HUD chip still names the station.
 *  - The digest needs the page's route data, which WorldShell passes in as
 *    `facts`; a world root that does not hand WorldShell its payload gets the
 *    honest empty-state lines.
 *  - Ball phase is a module value with no change channel, so it is polled
 *    (250 ms) while the route scene is live; the card can trail the ball's
 *    `done` by up to one poll.
 */

/** The data faces of each route theme, loaded on demand (id → module). */
const SURFACE_LOADERS: Record<string, () => Promise<DataSurfaceTheme>> = {
  plaza: () => import('@/components/world/evoliga/route/plaza/data-faces').then((m) => m.PLAZA_DATA_SURFACES),
  sakura: () => import('@/components/world/themes/sakura/furniture/data-faces').then((m) => m.SAKURA_DATA_SURFACES),
  mountain: () =>
    import('@/components/world/themes/mountain/furniture/data-faces').then((m) => m.MOUNTAIN_DATA_SURFACES),
  clouds: () => import('@/components/world/themes/clouds/furniture/data-faces').then((m) => m.CLOUDS_DATA_SURFACES),
};

const BALL_POLL_MS = 250;

function noopSubscribe(): () => void {
  return () => undefined;
}

function pollBall(onChange: () => void): () => void {
  const id = window.setInterval(onChange, BALL_POLL_MS);
  return () => window.clearInterval(id);
}

function hiddenPhase(): BallPhase {
  return 'hidden';
}

function subscribeViewport(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function viewportSnapshot(): string {
  return `${window.innerWidth}x${window.innerHeight}`;
}

function serverViewport(): string {
  return '0x0';
}

/** The ball ceremony no longer owns the screen (finished, or never ran). */
function ballClear(phase: BallPhase): boolean {
  return phase === 'done' || phase === 'hidden';
}

/** No live keep-outs (a stable identity, so the placement memo holds). */
const NO_RECTS: readonly ScreenRect[] = [];
/** Consecutive unchanged camera frames that count as "at rest" for the projection. */
const CAMERA_REST_FRAMES = 2;
/** Project anyway after this long (a rig with an idle drift never reads fully still). */
const CAMERA_REST_MAX_MS = 400;
const MATRIX_EPS = 1e-5;

/** Every registered focus subject through the live camera (viewport CSS px); null with no view bound. */
function projectSubjects(): ProjectedSubject[] | null {
  const view = focusStore.view();
  if (!view) return null;
  const box = view.canvas.getBoundingClientRect();
  return focusStore.subjects().map((subject) => {
    const projected = projectToViewport(subject.bounds, view.camera, box);
    return { id: subject.id, kind: subject.kind, rect: projected.rect, onScreenFraction: projected.onScreenFraction };
  });
}

/**
 * Run `measure` once the live camera has held still for CAMERA_REST_FRAMES
 * frames (its world matrix unchanged), or after CAMERA_REST_MAX_MS at the
 * latest — the settle latch trips while the rig still trails the endpoint by
 * < 0.02 stations, and a turn ease can finish a frame or two later. Returns
 * the cancel.
 */
function whenCameraRests(measure: () => void): () => void {
  let frame = 0;
  let last: number[] | null = null;
  let still = 0;
  const started = performance.now();
  const tick = () => {
    frame = 0;
    const view = focusStore.view();
    const now = view ? Array.from(view.camera.matrixWorld.elements) : null;
    const prev = last;
    still = now && prev && now.every((v, i) => Math.abs(v - prev[i]) < MATRIX_EPS) ? still + 1 : 0;
    last = now;
    if (still >= CAMERA_REST_FRAMES || performance.now() - started >= CAMERA_REST_MAX_MS) {
      measure();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}

/** Live keep-outs measured at one settled station (the card's placement input). */
interface StationKeepOuts {
  themeId: string;
  station: number;
  width: number;
  height: number;
  rects: readonly ScreenRect[];
}

export default function StationCard({ facts = EMPTY_DIGEST_FACTS }: { facts?: StationDigestFacts }) {
  const { tier, theme, conductor, mobile } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const { station, settled } = useStationSettle();
  const focus = useFocusState();
  const searchParams = useSearchParams();
  const live = tier === 'route' && routeSceneLive && theme !== null;

  const ballPhase = useSyncExternalStore(live ? pollBall : noopSubscribe, getBallPhase, hiddenPhase);
  const viewportKey = useSyncExternalStore(subscribeViewport, viewportSnapshot, serverViewport);

  // ── Travel evidence for the enter / exit edge ────────────────────────────
  // `direction`: the conductor's last non-zero latched direction (fallback).
  // `velocitySign`: the sign of the SMOOTHED progress velocity — the motion
  // the visitor sees — sampled per frame while the world moves, and set in
  // state only when the sign changes (a handful of renders per crossing).
  const [direction, setDirection] = useState<1 | -1>(1);
  const [velocitySign, setVelocitySign] = useState<-1 | 0 | 1>(0);
  useEffect(() => {
    let raf = 0;
    let last: { smooth: number; t: number } | null = null;
    let sign: -1 | 0 | 1 = 0;
    const tick = () => {
      raf = 0;
      const progress = conductor.progress.current;
      if (!progress) return;
      if (progress.direction !== 0) setDirection(progress.direction);
      const t = performance.now();
      if (last && t > last.t) {
        const v = ((progress.smooth - last.smooth) * 1000) / (t - last.t);
        const next: -1 | 0 | 1 = Math.abs(v) < CARD_VELOCITY_EPS ? 0 : v > 0 ? 1 : -1;
        if (next !== sign) {
          sign = next;
          setVelocitySign(next);
        }
      }
      last = { smooth: progress.smooth, t };
      // Keep sampling while the rendered world moves (or has yet to report rest).
      if (sign !== 0 || Math.abs(progress.smooth - progress.exact) > 1e-4) raf = requestAnimationFrame(tick);
      else last = null;
    };
    const wake = () => {
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    wake();
    const unsubscribe = conductor.subscribe(wake);
    return () => {
      unsubscribe();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [conductor]);

  // ── This world's data faces (lazy) ───────────────────────────────────────
  const themeId = theme?.id ?? null;
  const [surfaces, setSurfaces] = useState<{ id: string; theme: DataSurfaceTheme } | null>(null);
  useEffect(() => {
    if (!live || themeId === null) return;
    const load = SURFACE_LOADERS[themeId];
    if (!load) return;
    let cancelled = false;
    load()
      .then((loaded) => {
        if (!cancelled) setSurfaces({ id: themeId, theme: loaded });
      })
      .catch(() => {
        // No faces, no placement law → no card (never chrome over data).
      });
    return () => {
      cancelled = true;
    };
  }, [live, themeId]);
  const faceTheme = surfaces && surfaces.id === themeId ? surfaces.theme : null;

  // i18n D11: the card speaks the viewer's language — the station titles and
  // beats from `world-themes` (`localizeThemeStations`), the chrome, digest
  // and CTA from `world-route`. A theme carries no language of its own.
  const locale = useLocale();
  const stations = useMemo(
    () => (theme ? localizeThemeStations(theme.id, theme.stations, locale) : []),
    [theme, locale],
  );
  const [vw, vh] = viewportKey.split('x').map(Number);

  // ── Live keep-outs (LOOK r6, C1) ─────────────────────────────────────────
  // Once per settle, with the camera at rest: every on-screen ace, padded.
  // The station latch stays set through a focus, so this also re-runs when a
  // focus releases (the camera is back at the station pose) and when a
  // subject re-registers with fresh bounds.
  const registryVersion = useFocusRegistryVersion();
  const focusIdle = focus.phase === 'idle';
  const [stationKeepOuts, setStationKeepOuts] = useState<StationKeepOuts | null>(null);
  useEffect(() => {
    if (!live || !settled || !focusIdle || themeId === null || vw <= 0 || vh <= 0) return;
    return whenCameraRests(() => {
      const projected = projectSubjects();
      setStationKeepOuts({
        themeId,
        station,
        width: vw,
        height: vh,
        rects: projected ? subjectKeepOuts(projected, null) : NO_RECTS,
      });
    });
  }, [live, settled, focusIdle, themeId, station, vw, vh, registryVersion]);
  /**
   * The keep-outs measured at station `s`, or null before its first
   * measurement (the card waits for it). A resize keeps the station's card
   * up with no keep-outs until the re-measure lands a frame or two later.
   */
  const keepOutsAt = (s: number): readonly ScreenRect[] | null => {
    if (!stationKeepOuts || stationKeepOuts.themeId !== themeId || stationKeepOuts.station !== s) return null;
    return stationKeepOuts.width === vw && stationKeepOuts.height === vh ? stationKeepOuts.rects : NO_RECTS;
  };
  const liveRects = keepOutsAt(station);

  const placement = useMemo(() => {
    if (!faceTheme || station < 0 || station >= faceTheme.stations.length || vw <= 0 || vh <= 0) return null;
    if (liveRects === null) return null;
    return placeStationCard(faceTheme, station, { width: vw, height: vh }, { keepOuts: liveRects });
  }, [faceTheme, station, vw, vh, liveRects]);

  // ── Collapsed pill keep-outs (a panel open / a focus running) ───────────
  // Measured at the pose the camera lands in: a landed focus, or the station
  // pose when a panel opened with no focus. While the camera travels
  // (focusing / releasing) there is no measurement and the pill yields.
  const search = searchParams.toString();
  const panelParams = theme?.focusVocabulary.panelParams ?? [];
  const panelOpen = panelParams.some((param) => searchParams.get(param) !== null);
  const collapsed = panelOpen || !focusIdle;
  const focusId = focus.subject?.id ?? null;
  const cameraAtRest = focus.phase === 'focused' || (focusIdle && settled);
  const { yaw, pitch, dolly } = focus.orbit;
  const pillToken =
    live && collapsed && cameraAtRest && themeId !== null
      ? `${themeId}|${station}|${focus.phase}|${focusId ?? ''}|${vw}x${vh}|${panelOpen ? 1 : 0}|${yaw.toFixed(3)},${pitch.toFixed(3)},${dolly.toFixed(3)}`
      : null;
  const [pillKeepOuts, setPillKeepOuts] = useState<{ token: string; rects: readonly ScreenRect[] } | null>(null);
  useEffect(() => {
    if (pillToken === null) return;
    return whenCameraRests(() => {
      const projected = projectSubjects() ?? [];
      setPillKeepOuts({
        token: pillToken,
        rects: collapsedPillKeepOuts(projected, focusId, { width: vw, height: vh }, panelOpen),
      });
    });
  }, [pillToken, focusId, vw, vh, panelOpen, registryVersion]);
  const pillRects = pillToken !== null && pillKeepOuts?.token === pillToken ? pillKeepOuts.rects : null;

  const target = live && settled && ballClear(ballPhase) && placement?.clear && stations[station]?.card ? station : null;

  // ── Enter / exit bookkeeping (state derived during render, React's
  //    "adjust state on prop change" pattern — no effect, no extra frame).
  //    One edge latch per episode (stepCardEpisode): enter keys on the
  //    station step from the last card, exit on the smoothed velocity. ──────
  const [episode, setEpisode] = useState(INITIAL_CARD_EPISODE);
  if (target !== episode.target) {
    const travel: CardTravel = { velocitySign, direction };
    setEpisode(stepCardEpisode(episode, target, travel));
  }
  const shown = episode.shown;

  if (!live || !theme || !shown || !faceTheme) return null;
  const copy = stations[shown.station];
  const card = copy?.card;
  if (!card) return null;
  // An exiting card keeps the slot its own station's keep-outs chose.
  const place =
    shown.station === station
      ? placement
      : placeStationCard(faceTheme, shown.station, { width: vw, height: vh }, { keepOuts: keepOutsAt(shown.station) ?? NO_RECTS });
  if (!place) return null;

  // Collapsed: the kicker pill at the landed pose, or nothing (it yields to
  // the aces, the focused subject and the docked panel — never covers them).
  const pill =
    collapsed && pillRects !== null
      ? placeCollapsedPill({ w: CARD_PILL_W, h: CARD_PILL_H }, { width: vw, height: vh }, pillRects, pillPreferPoint(place))
      : null;
  const yielded = collapsed && pill === null;
  const chrome = stationCardChrome(locale);
  const compact = place.variant === 'compact' || place.variant === 'strip';

  const rail = mobile && card.digest === 'teamChips' && facts.teams.length > 0;
  const digest =
    card.digest && !rail ? formatStationDigest(card.digest, facts, locale, { rail: mobile }) : null;
  const cta = resolveStationCta(card, facts, locale);
  // Phone band: the beat line only where the band has room for it beside
  // the digest (or rail) and the actions; the fact comes first.
  const beatRoom = mobile ? place.rect.h >= (rail ? 212 : 180) : true;
  const showBeat = !compact && beatRoom;

  const hrefFor = (chip: TeamChip) => panelHref(search, panelParams, { param: 'team', value: chip.id });
  const onAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (shown.exiting) setEpisode(finishCardExit);
  };

  const { rect } = place;
  const style = pill
    ? { left: pill.x, top: pill.y, width: pill.w, maxHeight: pill.h }
    : place.anchor === 'top'
      ? { left: rect.x, top: rect.y, width: rect.w, maxHeight: rect.h }
      : { left: rect.x, bottom: vh - (rect.y + rect.h), width: rect.w, maxHeight: rect.h };

  return (
    // A div region, never a <section>: WorldShell mounts the card inside
    // `[data-world-route]`, whose route-live rules size every section to
    // 100vh and hide its children (the wave-2 r1 full-height, empty box).
    <div
      role="region"
      // Keyed by station: a new station's card is a fresh box whose entry
      // animation starts at mount; enter → exit on the same box restarts the
      // CSS animation through its name change.
      key={shown.station}
      aria-label={cardRegionName(card.title, locale)}
      data-station-caption=""
      data-station={copy.id}
      data-card-state={shown.exiting ? 'exit' : 'enter'}
      data-edge={shown.edge}
      data-direction={direction}
      data-travel={velocitySign}
      data-variant={place.variant}
      data-side={place.side}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-keep-outs={(keepOutsAt(shown.station) ?? NO_RECTS).length}
      data-keep-out-clear={place.keepOutClear ? 'true' : 'false'}
      data-pill={collapsed ? (pill ? 'placed' : 'yield') : undefined}
      data-yield={yielded ? 'true' : undefined}
      className="world-station-card"
      style={style}
      onAnimationEnd={onAnimationEnd}
      // An exiting card is on its way out: no focus, no clicks.
      inert={shown.exiting || yielded}
    >
      <p className="world-station-card-kicker">{cardKicker(shown.station, stations.length, card.title, locale)}</p>
      {!collapsed && showBeat ? <p className="world-station-card-beat">{copy.beat}</p> : null}
      {!collapsed && rail ? (
        <TeamsRollCallRail chips={facts.teams} hrefFor={hrefFor} label={chrome.railLabel} />
      ) : null}
      {!collapsed && digest ? (
        <p className="world-station-card-digest" data-station-digest={card.digest}>
          {digest}
        </p>
      ) : null}
      {!collapsed ? (
        <div className="world-station-card-actions">
          <Link
            href={panelHref(search, panelParams, cta)}
            scroll={false}
            className="world-station-card-cta"
            data-station-cta={`${cta.param}=${cta.value}`}
          >
            {cta.label}
          </Link>
          {/* A plain anchor: Lite is a full load (the tier is read once, at
              mount), landing on this station's section. */}
          <a href={liteHref(search, panelParams, copy.id)} className="world-station-card-lite" data-station-lite="">
            {chrome.readAsText}
          </a>
        </div>
      ) : null}
    </div>
  );
}
