/**
 * D32 — a day/night switch after the reveal is covered by a fade. Pure
 * sequencer behind the theme veil (`theme-veil-store.ts`, `RouteThemeVeil`);
 * no DOM and no timers — every step takes `now` (wall-clock ms) and the host
 * steps it once per animation frame while it is not idle.
 *
 * Owner (2026-09-28): "I'd go with the fade as well!" — pre-warming both
 * themes at load is rejected (seconds on every visit). Instead:
 *
 *   idle ─request─▶ in ──(inMs)──▶ opaque ─commit─▶ opaque·committed
 *                    │                                   │ armed + ceremony settled
 *                    └─cancel (flipped back)─▶ out ◀─────┘ + releaseFrames drawn
 *                                              │ (outMs, no ball reveal left)
 *                                              ▼
 *                                             idle
 *
 * - `in`: the veil fades to the page background colour (never a dark slab,
 *   D25) over `inMs` while the world keeps drawing the OLD palette — nothing
 *   of the new theme is begun yet, so no frame shows a half-switched world.
 * - `opaque`: the host commits the swap one frame after the veil is fully
 *   opaque (the palette state and the new scene generation), and the new
 *   theme's HDRI fetch / decode, PMREM, program links and uploads run behind
 *   it through the same load warm and reveal gate as the first reveal.
 * - release: only once that generation's reveal gate ARMED (resident + warm),
 *   the ball's invisible ceremony for it ended at least `releaseAfterBallMs`
 *   ago (past the ceremony render hold and the ceremony DPR clamp, so the
 *   restored buffer is already drawn) and `releaseFrames` renderer frames
 *   were drawn since — then `out` fades the veil away over `outMs`.
 * - `maxHoldAfterArmMs` bounds the release on a stuck ceremony: a veil can
 *   never strand the world. Failures (Lite) `abort` straight to idle.
 *
 * Reduced motion: `inMs` / `outMs` are 0 — the swap happens behind the veil
 * without animation (the veil still holds for one frame before the commit).
 */

import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/core';
import { worldRouteMessages } from '@/i18n/messages/world-route';

/** What the veil says while it holds, in `locale` (`world-route.veil`, the viewer's language — i18n D11). */
export function themeVeilCopy(locale: Locale): { readonly day: string; readonly night: string } {
  return getMessages(worldRouteMessages, locale).veil;
}

export const THEME_VEIL = {
  /** Fade to the veil (the specified ~200–250 ms). */
  inMs: 220,
  /** Fade back to the world. */
  outMs: 240,
  /**
   * After the (invisible) ball ceremony of the veiled generation is done:
   * past `CEREMONY_RENDER_HOLD.releaseAfterDoneMs` (250) and
   * `CEREMONY_DPR_RELEASE_MS` (300), both pinned by test.
   */
  releaseAfterBallMs: 350,
  /** Renderer frames drawn after the release conditions first held. */
  releaseFrames: 3,
  /** A stuck ceremony can never hold the veil longer than this after the arm. */
  maxHoldAfterArmMs: 4000,
  /**
   * ENGINE-FIX (D32): after a SILENT ball is done, where no DPR clamp is to
   * be outwaited: the arm's own commits (the Station Card's re-mount, the
   * ball's exit, the handoff marks) settle under the opaque veil, never in
   * its fade-out (a 128 ms main-thread gap there read as a card pop).
   */
  releaseAfterSilentBallMs: 120,
} as const;

export type ThemeVeilPhase = 'idle' | 'in' | 'opaque' | 'out';

export interface ThemeVeilState {
  phase: ThemeVeilPhase;
  /** When the phase was entered (wall clock). */
  since: number;
  reducedMotion: boolean;
  /** The swap has been committed behind the opaque veil. */
  committed: boolean;
  /** The scene generation begun behind the veil (the latest commit). */
  generation: number | null;
  /** When the release conditions first held (null = not holding). */
  settledAt: number | null;
  /** The renderer frame count when they first held. */
  framesAtSettle: number | null;
}

export const THEME_VEIL_IDLE: ThemeVeilState = {
  phase: 'idle',
  since: 0,
  reducedMotion: false,
  committed: false,
  generation: null,
  settledAt: null,
  framesAtSettle: null,
};

export interface ThemeVeilTick {
  now: number;
  /** The current scene generation (world-readiness). */
  generation: number;
  /** The reveal gate armed for the current generation at, else null. */
  armedAt: number | null;
  /** The ball's ceremony for the current generation is over (see `veilBallSettled`). */
  ballSettled: boolean;
  /**
   * The ball is still in its reveal (the canvas release rule must not come
   * back), or armed but not stepped into it yet (ENGINE-FIX: a `loading`
   * ball must never show when the veil goes idle).
   */
  ballRevealing: boolean;
  /** Monotone renderer frame count (scene-progress `getRenderedFrames`). */
  frames: number;
}

export type ThemeVeilEvent =
  | { type: 'request'; now: number; reducedMotion: boolean }
  | { type: 'cancel'; now: number }
  | { type: 'commit'; now: number; generation: number }
  | ({ type: 'tick' } & ThemeVeilTick)
  | { type: 'abort' };

function fadeMs(state: Pick<ThemeVeilState, 'reducedMotion'>, ms: number): number {
  return state.reducedMotion ? 0 : ms;
}

function enter(state: ThemeVeilState, phase: ThemeVeilPhase, now: number, extra: Partial<ThemeVeilState> = {}): ThemeVeilState {
  return { ...state, phase, since: now, settledAt: null, framesAtSettle: null, ...extra };
}

/** One step. Returns `state` itself when nothing changed. */
export function stepThemeVeil(state: ThemeVeilState, event: ThemeVeilEvent): ThemeVeilState {
  switch (event.type) {
    case 'abort':
      return state.phase === 'idle' ? state : THEME_VEIL_IDLE;

    case 'request': {
      // A flip while the veil is fading out turns it around (the CSS
      // transition reverses from its current opacity); a flip under the
      // opaque veil is committed by the host at once (see `veilCommitsNow`).
      if (state.phase === 'idle') {
        return enter(THEME_VEIL_IDLE, 'in', event.now, { reducedMotion: event.reducedMotion });
      }
      if (state.phase === 'out') {
        return enter(state, 'in', event.now, { reducedMotion: event.reducedMotion, committed: false });
      }
      return state;
    }

    case 'cancel': {
      // The theme flipped back before anything was begun: nothing to hide.
      if (state.committed || (state.phase !== 'in' && state.phase !== 'opaque')) return state;
      return enter(state, 'out', event.now);
    }

    case 'commit': {
      if (state.phase !== 'opaque' && state.phase !== 'in') return state;
      return enter(state, 'opaque', event.now, { committed: true, generation: event.generation });
    }

    case 'tick': {
      switch (state.phase) {
        case 'idle':
          return state;
        case 'in':
          return event.now - state.since >= fadeMs(state, THEME_VEIL.inMs) ? enter(state, 'opaque', event.now) : state;
        case 'opaque': {
          if (!state.committed) return state;
          // Armed for the veiled generation (or a later one begun under the veil).
          const armed = event.armedAt !== null && state.generation !== null && event.generation >= state.generation;
          if (armed && event.armedAt !== null && event.now - event.armedAt >= THEME_VEIL.maxHoldAfterArmMs) {
            return enter(state, 'out', event.now);
          }
          if (!armed || !event.ballSettled) {
            return state.settledAt === null ? state : { ...state, settledAt: null, framesAtSettle: null };
          }
          if (state.settledAt === null) return { ...state, settledAt: event.now, framesAtSettle: event.frames };
          if (event.frames - (state.framesAtSettle ?? event.frames) >= THEME_VEIL.releaseFrames) {
            return enter(state, 'out', event.now);
          }
          return state;
        }
        case 'out':
          return event.now - state.since >= fadeMs(state, THEME_VEIL.outMs) && !event.ballRevealing
            ? THEME_VEIL_IDLE
            : state;
      }
    }
  }
}

/**
 * Whether a palette swap requested now is committed at once rather than
 * deferred: the veil is already fully opaque (a second flip while the new
 * theme loads behind it). Pure.
 */
export function veilCommitsNow(state: ThemeVeilState): boolean {
  return state.phase === 'opaque';
}

/**
 * The host commits the deferred swap on the first frame AFTER the veil
 * turned opaque, so the fully opaque veil has been presented at least once
 * before any new-palette work can reach the canvas. Pure.
 */
export function veilCommitDue(state: ThemeVeilState, now: number): boolean {
  return state.phase === 'opaque' && !state.committed && now > state.since;
}

/**
 * ENGINE-FIX (D32): the world's draws are held while the veil fades IN (and
 * for the frame it is opaque before the commit). The world under a veil that
 * is closing over it keeps its last drawn frame — the old palette, so still
 * no half-switched frame — and the main thread and GPU are free for the
 * fade itself: a full world frame there (the plaza's 50-65 ms at 1440) was a
 * long task inside the fade-in, and its rAF gap made the Station Card's
 * fade skip (a judged pop). Pure.
 */
export function veilHoldsWorldDraws(state: Pick<ThemeVeilState, 'phase' | 'committed'>): boolean {
  return state.phase === 'in' || (state.phase === 'opaque' && !state.committed);
}

/** Whether the veil paints (anything but idle). */
export function veilActive(state: ThemeVeilState): boolean {
  return state.phase !== 'idle';
}

/**
 * The ball's ceremony for the veiled generation is over for the release:
 * no loader at all, or the ball rests (`done` / `hidden`) for at least
 * `releaseAfterBallMs`. Pure.
 */
export function veilBallSettled(input: { hasBall: boolean; phase: string; since: number; now: number; dprClamp?: boolean }): boolean {
  if (!input.hasBall) return true;
  if (input.phase !== 'done' && input.phase !== 'hidden') return false;
  return input.now - input.since >= veilReleaseAfterBallMs(input.dprClamp !== false);
}

/**
 * ENGINE-FIX (D32): how long the veil holds after the (silent) ball is done.
 * The veiled generation's renderer is never held for a ceremony
 * (`exemptCeremonyRenderHold`), so the one thing left to outwait is the
 * ceremony DPR clamp's restore (`CEREMONY_DPR_RELEASE_MS`, a buffer resize)
 * — and only where that clamp changes anything: a device-pixel ratio above
 * the ladder floor's 1. On a DPR-1 screen only the silent ball's own
 * commits are outwaited (`releaseAfterSilentBallMs`). Pure.
 */
export function veilReleaseAfterBallMs(dprClamp: boolean): number {
  return dprClamp ? THEME_VEIL.releaseAfterBallMs : THEME_VEIL.releaseAfterSilentBallMs;
}

/**
 * What the palette observer does with a day/night flip (pure, WorldStateProvider):
 * - `immediate`: begin the new generation now (the world is not the page yet —
 *   loading or Lite — so the page itself covers the swap, as before D32);
 * - `veil`: the world is live — fade the veil in and defer the swap to it;
 * - `commit`: the veil is already opaque — begin the swap now, behind it;
 * - `cancel`: no swap any more (the theme flipped back while the veil was
 *   still fading in) — fade the veil back out;
 * - `none`: nothing to do.
 */
export type PaletteSwapPlan = 'immediate' | 'veil' | 'commit' | 'cancel' | 'none';

export function planPaletteSwap(input: {
  /** The DOM's day/night key differs from the begun generation's (tier route, scene not idle). */
  swapping: boolean;
  /** The current generation's reveal is live (the world is the page). */
  worldLive: boolean;
  veil: Pick<ThemeVeilState, 'phase' | 'committed'>;
}): PaletteSwapPlan {
  const { swapping, worldLive, veil } = input;
  if (!swapping) {
    return (veil.phase === 'in' || veil.phase === 'opaque') && !veil.committed ? 'cancel' : 'none';
  }
  if (veil.phase === 'opaque') return 'commit';
  if (veil.phase === 'in') return 'none';
  if (worldLive || veil.phase === 'out') return 'veil';
  return 'immediate';
}
