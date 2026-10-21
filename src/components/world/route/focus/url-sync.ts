import type { SubjectPanel } from '@/lib/route-world/focus';

/**
 * Pure decisions behind `FocusUrlSync` (focus store ⇄ panel search params).
 *
 * Review r5 (W6, "after a cross-tap the panel sometimes never closes"):
 * open A, tap B, close before B's `router.replace` has landed. The old
 * release branch saw the URL still carrying A — not the panel it had last
 * written (B) — so it wrote nothing and forgot B. B's replace then landed,
 * the URL → store side read it as a fresh deep link and FOCUSED B AGAIN: the
 * phase went releasing → idle → focusing → focused and the panel stayed up
 * ("phase stayed focused for 12 s"). Under `next dev` a search-param
 * replace is an RSC round trip, so the window is seconds wide.
 *
 * Now every panel this sync wrote is remembered as `outgoing` until the URL
 * has been seen carrying none of them. A release always issues a clearing
 * replace (the router is last-write-wins, so it supersedes a write still in
 * flight), an outgoing panel in the URL is never read as a deep link, and a
 * late landing of one is cleared again.
 */
export interface UrlSyncState {
  /** The panel we last wrote for the live subject. */
  panel: SubjectPanel | null;
  /** Whether the URL has been seen carrying `panel`. */
  inUrl: boolean;
  /** Panels we wrote that must leave the URL (a clear may be in flight). */
  outgoing: readonly SubjectPanel[];
  /**
   * The query string the URL showed when the last clearing replace was
   * issued, or null. While the URL still shows it, that clear is in flight
   * and re-running the effect (the phase reaching idle) does not re-issue it
   * — a new replace would discard the pending one and restart its round trip.
   */
  clearedFrom: string | null;
}

export const INITIAL_URL_SYNC: UrlSyncState = { panel: null, inUrl: false, outgoing: [], clearedFrom: null };

export function samePanel(a: SubjectPanel | null, b: SubjectPanel | null): boolean {
  return a !== null && b !== null && a.param === b.param && a.value === b.value;
}

function carries(params: URLSearchParams, panel: SubjectPanel): boolean {
  return params.get(panel.param) === panel.value;
}

function without(list: readonly SubjectPanel[], panel: SubjectPanel): SubjectPanel[] {
  return list.filter((entry) => !samePanel(entry, panel));
}

function withPanel(list: readonly SubjectPanel[], panel: SubjectPanel | null): SubjectPanel[] {
  if (!panel || list.some((entry) => samePanel(entry, panel))) return [...list];
  return [...list, panel];
}

export interface StoreToUrlInput {
  live: boolean;
  panel: SubjectPanel | null;
  params: URLSearchParams;
  panelParams: readonly string[];
  sync: UrlSyncState;
}

export interface StoreToUrlResult {
  sync: UrlSyncState;
  /** The query string to `router.replace` with, or null to write nothing. */
  write: string | null;
}

/** Store → URL: what the focus state asks of the URL. */
export function storeToUrl({ live, panel, params, panelParams, sync }: StoreToUrlInput): StoreToUrlResult {
  if (live && panel) {
    const clearing = sync.outgoing.some((entry) => samePanel(entry, panel));
    if (carries(params, panel) && !clearing) {
      return { sync, write: null };
    }
    // The URL dropped our param while the subject is still focused — the
    // panel closed itself; the URL → store side releases, do not rewrite.
    if (samePanel(sync.panel, panel) && sync.inUrl && !clearing) return { sync, write: null };
    const next = new URLSearchParams(params.toString());
    for (const name of panelParams) next.delete(name);
    next.set(panel.param, panel.value);
    // The previous panel (A on a cross-tap) is on its way out.
    const outgoing = without(samePanel(sync.panel, panel) ? sync.outgoing : withPanel(sync.outgoing, sync.panel), panel);
    return { sync: { panel, inUrl: false, outgoing, clearedFrom: null }, write: next.toString() };
  }

  // Released (or live on a subject without a panel): everything we wrote
  // leaves. A write of ours that has not landed yet is cleared too — the
  // clearing replace supersedes it.
  const outgoing = withPanel(sync.outgoing, sync.panel);
  if (outgoing.length === 0) return { sync, write: null };
  const pending = sync.panel !== null && !sync.inUrl;
  const carried = outgoing.filter((entry) => carries(params, entry));
  const current = params.toString();
  if (carried.length === 0 && !pending) {
    // Nothing of ours in the URL and nothing in flight: done.
    return { sync: { panel: null, inUrl: false, outgoing: [], clearedFrom: null }, write: null };
  }
  if (!pending && sync.clearedFrom === current) {
    // Our clear for exactly this URL is already in flight.
    return { sync: { panel: null, inUrl: false, outgoing, clearedFrom: current }, write: null };
  }
  const next = new URLSearchParams(current);
  for (const entry of carried) next.delete(entry.param);
  return { sync: { panel: null, inUrl: false, outgoing, clearedFrom: current }, write: next.toString() };
}

export interface UrlToStoreInput {
  live: boolean;
  panel: SubjectPanel | null;
  params: URLSearchParams;
  panelParams: readonly string[];
  sync: UrlSyncState;
  /** Whether a registered subject owns this panel (a deep link can focus it). */
  hasSubject: (panel: SubjectPanel) => boolean;
}

export type UrlToStoreAction = { kind: 'focus'; panel: SubjectPanel } | { kind: 'release' } | null;

export interface UrlToStoreResult {
  sync: UrlSyncState;
  action: UrlToStoreAction;
}

/** URL → store: a deep link, or a panel that closed itself. */
export function urlToStore({ live, panel, params, panelParams, sync, hasSubject }: UrlToStoreInput): UrlToStoreResult {
  // An outgoing value is our own write on its way out. The list is pruned by
  // `storeToUrl` once a URL change shows none of it — not here: in the
  // release commit the clear (and possibly the write it supersedes) has not
  // landed yet, so an empty URL proves nothing.
  const state = sync;

  for (const param of panelParams) {
    const value = params.get(param);
    if (!value) continue;
    const incoming: SubjectPanel = { param, value };
    if (live && samePanel(panel, incoming)) {
      return { sync: { ...state, panel: incoming, inUrl: true }, action: null };
    }
    // Live on another subject, our own write on its way in, or a cleared
    // write on its way out: the store → URL side owns this transition.
    if (live || samePanel(state.panel, incoming)) return { sync: state, action: null };
    if (state.outgoing.some((entry) => samePanel(entry, incoming))) return { sync: state, action: null };
    if (hasSubject(incoming)) {
      return {
        sync: { ...state, panel: incoming, inUrl: true, clearedFrom: null },
        action: { kind: 'focus', panel: incoming },
      };
    }
    return { sync: state, action: null };
  }

  if (live && panel && samePanel(state.panel, panel) && state.inUrl) {
    return { sync: { ...state, panel: null, inUrl: false }, action: { kind: 'release' } };
  }
  return { sync: state, action: null };
}
