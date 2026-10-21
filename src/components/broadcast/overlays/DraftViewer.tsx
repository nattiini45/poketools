'use client';

import { useEffect, useRef, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig } from '@/types/broadcast';
import type { DraftMode, DraftSnapshotDTO, LineId } from '@/types/draft-queue';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeLineLabel, localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { createVisiblePoller, type PollOutcome } from '@/lib/draft/use-visible-poll';
import { formatCountdown, type ActiveSlotLike } from '@/lib/draft-ui/clock';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { useClock } from '@/components/draft-tool/hooks/use-clock';

// ─── Shared draft-overlay model (DraftViewer + DraftPickReveal) ─────────────

/**
 * English stage names of one list line, `[base, finalStage]`: the final stage is
 * stage 3, or stage 2 on a two-stage line (`stage3 ?? stage2`, the same stage the
 * line id names). Built on the server from the bound point-buy list; the overlay
 * localizes it with `localizeLineLabel` (critique S13). A null final stage (a
 * single-stage line) labels the line by its base alone.
 */
export type OverlayLineRef = readonly [base: string, finalStage: string | null];
export type OverlayLines = Readonly<Record<LineId, OverlayLineRef>>;

const NO_LINES: OverlayLines = {};

export interface OverlayPick {
  key: string;
  pickNumber: number;
  round: number;
  playerId: string;
  /** null when the state names no player for this id. */
  playerName: string | null;
  /** Localized line label (EPB) or species name (legacy). */
  label: string;
  /** English species name for the sprite. */
  sprite: string;
  price: number | null;
  /** Legacy tier drafts only. */
  tier: string | null;
}

export interface OverlayColumn {
  playerId: string;
  name: string | null;
  budget: number | null;
  roster: { key: string; label: string; sprite: string }[];
}

export interface OverlayBoard {
  engine: 'legacy' | 'queue';
  /** Queue pools only. */
  mode: DraftMode | null;
  complete: boolean;
  paused: boolean;
  round: number | null;
  pickNumber: number | null;
  /** The player on the clock (null when nobody is or the draft is not running). */
  onClock: { playerId: string; name: string | null } | null;
  /** Queue pools only: the active slot timing for `computeClock`. */
  activeSlot: ActiveSlotLike | null;
  /** Epoch ms of the snapshot's `server_now` (queue) or the receipt time (legacy). */
  serverNow: number;
  columns: OverlayColumn[];
  /** Ascending by pick number. */
  picks: OverlayPick[];
}

/** The legacy `/api/drafts/[id]/state` payload fields the overlays read. */
interface LegacyDraftState {
  pool: { status: string; point_budget: number | null };
  picks: {
    player_id: string;
    player_name?: string | null;
    pokemon_name: string;
    pick_number: number;
    round: number;
    points_spent: number | null;
    power_tier?: string | null;
    line_id?: string | null;
  }[];
  rosters: Record<string, string[]>;
  budgets: Record<string, number> | null;
  current_picker: string | null;
  /** False for free pick order: `current_picker` is only a suggestion, so nobody is on the clock. */
  turn_enforced?: boolean;
  current_round: number;
  next_pick_number: number;
}

function isSnapshot(data: unknown): data is DraftSnapshotDTO {
  return typeof data === 'object' && data !== null && 'state_version' in data && 'participants' in data;
}

function isLegacyState(data: unknown): data is LegacyDraftState {
  return typeof data === 'object' && data !== null && 'rosters' in data && Array.isArray((data as { picks?: unknown }).picks);
}

/**
 * The display label of a drafted line: the list line when the pick carries a
 * known `line_id` (`localizeLineLabel(base, finalStage, dl)`, "Oshawott → Samurott"
 * for a two-stage line too), else the localized
 * species name the pick stores.
 */
export function overlayLineLabel(
  lineId: string | null | undefined,
  pokemonName: string | null,
  lines: OverlayLines,
  dl: DataLocale,
): { label: string; sprite: string } {
  const ref = lineId ? lines[lineId] : undefined;
  if (ref) return { label: localizeLineLabel(ref[0], ref[1], dl), sprite: ref[0] };
  const name = pokemonName ?? lineId ?? '';
  return { label: localizeSpecies(name, dl), sprite: name };
}

function fromSnapshot(dto: DraftSnapshotDTO, lines: OverlayLines, dl: DataLocale): OverlayBoard {
  const vm = toDraftViewModel(dto);
  const picks: OverlayPick[] = vm.picks.map((p) => {
    const { label, sprite } = overlayLineLabel(p.line_id, null, lines, dl);
    return {
      key: p.pick_id,
      pickNumber: p.pick_number,
      round: p.round,
      playerId: p.player_id,
      playerName: p.playerName || null,
      label,
      sprite,
      price: p.price,
      tier: null,
    };
  });
  const columns: OverlayColumn[] = vm.participants.map((part) => ({
    playerId: part.player_id,
    name: part.name || null,
    budget: part.budget_remaining,
    roster: picks
      .filter((p) => p.playerId === part.player_id)
      .map((p) => ({ key: p.key, label: p.label, sprite: p.sprite })),
  }));
  const active = vm.activeSlot;
  const last = picks.length > 0 ? picks[picks.length - 1] : null;
  return {
    engine: 'queue',
    mode: vm.mode,
    complete: vm.status === 'complete' || vm.phase === 'complete',
    paused: vm.paused,
    round: active?.round ?? last?.round ?? null,
    pickNumber: active?.pick_number ?? last?.pickNumber ?? null,
    onClock: active ? { playerId: active.player_id, name: active.playerName || null } : null,
    activeSlot: active,
    serverNow: vm.serverNow,
    columns,
    picks,
  };
}

function fromLegacy(state: LegacyDraftState, lines: OverlayLines, dl: DataLocale, now: number): OverlayBoard {
  const names: Record<string, string> = {};
  for (const pick of state.picks) {
    if (pick.player_name) names[pick.player_id] = pick.player_name;
  }
  const picks: OverlayPick[] = [...state.picks]
    .sort((a, b) => a.pick_number - b.pick_number)
    .map((p) => {
      const { label, sprite } = overlayLineLabel(p.line_id, p.pokemon_name, lines, dl);
      return {
        key: `${p.pick_number}`,
        pickNumber: p.pick_number,
        round: p.round,
        playerId: p.player_id,
        playerName: names[p.player_id] ?? null,
        label,
        sprite,
        price: p.points_spent,
        tier: p.power_tier ?? null,
      };
    });
  const columns: OverlayColumn[] = Object.keys(state.rosters).map((playerId) => ({
    playerId,
    name: names[playerId] ?? null,
    budget: state.budgets?.[playerId] ?? null,
    roster: picks
      .filter((p) => p.playerId === playerId)
      .map((p) => ({ key: p.key, label: p.label, sprite: p.sprite })),
  }));
  // Legacy pool statuses are pending | in_progress | complete; free order puts nobody on the clock.
  const running = state.pool.status === 'in_progress' && state.turn_enforced !== false;
  return {
    engine: 'legacy',
    mode: null,
    complete: state.pool.status === 'complete',
    paused: false,
    round: state.current_round,
    pickNumber: state.next_pick_number,
    onClock:
      running && state.current_picker
        ? { playerId: state.current_picker, name: names[state.current_picker] ?? null }
        : null,
    activeSlot: null,
    serverNow: now,
    columns,
    picks,
  };
}

/** Either state payload (queue snapshot or legacy state) → the overlay board; null for anything else. */
export function toOverlayBoard(data: unknown, lines: OverlayLines, dl: DataLocale, now: number): OverlayBoard | null {
  if (isSnapshot(data)) return fromSnapshot(data, lines, dl);
  if (isLegacyState(data)) return fromLegacy(data, lines, dl, now);
  return null;
}

/**
 * Polls the draft state for an OBS overlay at a constant cadence
 * (`config.poll`). Chained timeouts via `createVisiblePoller` (never a bare
 * `setInterval`, AGENTS.md), so requests never overlap; `visibility: null`
 * because an OBS browser source is always "visible". Queue pools send
 * `?since=` and keep the last board on `unchanged`. A 401/403 stops polling.
 */
export function useDraftOverlayBoard(
  draftPoolId: string,
  pollMs: number,
  lines: OverlayLines,
): { board: OverlayBoard | null; serverOffsetMs: number; freshPickKey: string | null } {
  const dl = useDataLocale();
  const [raw, setRaw] = useState<{
    data: unknown;
    receivedAt: number;
    offset: number;
    /** Key of the newest pick when it arrived after the first load (the on-air reveal). */
    freshPickKey: string | null;
  } | null>(null);
  const versionRef = useRef<number | null>(null);
  /** Pick count and newest key of the last payload; null before the first one. */
  const lastPicksRef = useRef<{ count: number; newest: string | null } | null>(null);

  useEffect(() => {
    versionRef.current = null;
    lastPicksRef.current = null;
    const poller = createVisiblePoller(
      async (signal): Promise<PollOutcome> => {
        try {
          const since = versionRef.current;
          const url =
            since === null
              ? `/api/drafts/${encodeURIComponent(draftPoolId)}/state`
              : `/api/drafts/${encodeURIComponent(draftPoolId)}/state?since=${since}`;
          const res = await fetch(url, { signal, cache: 'no-store' });
          if (res.status === 401 || res.status === 403) return 'stop';
          const json: unknown = await res.json();
          if (signal.aborted || typeof json !== 'object' || json === null) return 'live';
          const body = json as { success?: boolean; data?: unknown };
          if (!body.success || body.data === undefined) return 'live';
          const data = body.data;
          if (typeof data === 'object' && data !== null && 'unchanged' in data) return 'live';
          const receivedAt = Date.now();
          let offset = 0;
          if (isSnapshot(data)) {
            versionRef.current = data.state_version;
            const serverNow = Date.parse(data.server_now);
            if (Number.isFinite(serverNow)) offset = serverNow - receivedAt;
          }
          const picks = toOverlayBoard(data, NO_LINES, 'en', receivedAt)?.picks ?? [];
          const newest = picks.length > 0 ? picks[picks.length - 1].key : null;
          const before = lastPicksRef.current;
          lastPicksRef.current = { count: picks.length, newest };
          const fresh = before !== null && picks.length > before.count && newest !== before.newest ? newest : null;
          setRaw((prev) => ({ data, receivedAt, offset, freshPickKey: fresh ?? prev?.freshPickKey ?? null }));
        } catch {
          // Transient network error: keep the last board, try again next tick.
        }
        // Constant cadence for OBS, also after the draft completes.
        return 'live';
      },
      { liveIntervalMs: pollMs },
      { visibility: null },
    );
    poller.start();
    return () => poller.stop();
  }, [draftPoolId, pollMs]);

  const board = raw ? toOverlayBoard(raw.data, lines, dl, raw.receivedAt) : null;
  return { board, serverOffsetMs: raw?.offset ?? 0, freshPickKey: raw?.freshPickKey ?? null };
}

// ─── Viewer ─────────────────────────────────────────────────────────────────

interface DraftViewerProps {
  config: OverlayConfig;
  draftPoolId: string;
  /** Line id → English stage names from the bound list (server-built). */
  lines?: OverlayLines;
  showBudget?: boolean;
  showTiers?: boolean;
}

const REVEAL_MS = 3000;

export default function DraftViewer({
  config,
  draftPoolId,
  lines = NO_LINES,
  showBudget = true,
  showTiers = true,
}: DraftViewerProps) {
  const { board, serverOffsetMs, freshPickKey } = useDraftOverlayBoard(draftPoolId, config.poll, lines);
  // The reveal shows a pick that arrived on air (not the backlog on load) for REVEAL_MS.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const latestKey = freshPickKey !== null && freshPickKey !== dismissedKey ? freshPickKey : null;

  useEffect(() => {
    if (latestKey === null) return;
    const id = setTimeout(() => setDismissedKey(latestKey), REVEAL_MS);
    return () => clearTimeout(id);
  }, [latestKey]);

  if (!board) return null;
  const latest = latestKey ? board.picks.find((p) => p.key === latestKey) ?? null : null;
  return (
    <DraftViewerBoard
      config={config}
      board={board}
      serverOffsetMs={serverOffsetMs}
      latest={latest}
      showBudget={showBudget}
      showTiers={showTiers}
    />
  );
}

interface DraftViewerBoardProps {
  config: OverlayConfig;
  board: OverlayBoard;
  serverOffsetMs: number;
  latest: OverlayPick | null;
  showBudget: boolean;
  showTiers: boolean;
}

/** The rendered board (exported for tests: it renders without fetching). */
export function DraftViewerBoard({ config, board, serverOffsetMs, latest, showBudget, showTiers }: DraftViewerBoardProps) {
  const tg = useT(glossaryMessages);
  const ts = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tb = useT(broadcastOverlaysMessages);
  const f = useFormatter();
  const clock = useClock(board.activeSlot, board.serverNow, serverOffsetMs);

  const nameOf = (name: string | null) => name ?? tb('common.unknownPlayer');
  const countdown =
    clock && board.mode && !board.paused ? formatCountdown(clock.remainingMs, board.mode, f, tShared) : null;

  return (
    <div className="relative w-full h-full flex flex-col p-6 gap-4">
      {/* Header */}
      <AnimatedReveal animation="fadeIn">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3 text-xl font-bold" style={{ color: 'var(--broadcast-text)' }}>
            <span className="uppercase">{tg('draft.draft')}</span>
            {board.round !== null && board.pickNumber !== null && (
              <span>{ts('clock.roundPick', { round: board.round, pick: board.pickNumber })}</span>
            )}
          </div>
          {board.paused ? (
            <div
              className="uppercase px-4 py-2 rounded-xl text-sm font-bold"
              style={{ background: 'var(--broadcast-surface-light)', color: 'var(--broadcast-text)' }}
              data-testid="draft-paused"
            >
              {tg('draft.paused')}
            </div>
          ) : (
            !board.complete &&
            board.onClock && (
              <div
                className="flex items-center gap-3 px-4 py-2 rounded-xl"
                style={{
                  background: 'var(--broadcast-accent)',
                  animation: 'broadcast-pulse-glow 2s ease-in-out infinite',
                }}
              >
                <span className="uppercase text-sm font-bold text-white">
                  {tg('draft.playerOnClock', { name: nameOf(board.onClock.name) })}
                </span>
                {countdown && (
                  <span
                    className="text-sm font-bold tabular-nums text-white"
                    aria-label={ts('clock.timerAria', { player: nameOf(board.onClock.name), time: countdown })}
                  >
                    {countdown}
                  </span>
                )}
              </div>
            )
          )}
          {board.complete && (
            <div className="text-sm font-bold" style={{ color: 'var(--broadcast-text-muted)' }}>
              {ts('clock.complete')}
            </div>
          )}
        </div>
      </AnimatedReveal>

      {/* Pick reveal overlay */}
      {latest && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <AnimatedReveal animation="scaleReveal">
            <div
              className="flex flex-col items-center gap-2 px-8 py-6 rounded-2xl"
              style={{
                background: 'var(--broadcast-surface)',
                border: '3px solid var(--broadcast-accent)',
                boxShadow: '0 0 60px var(--broadcast-accent)',
              }}
            >
              <OverlayPokemonSprite pokemon={latest.sprite} size={96} />
              <div className="text-2xl font-black" style={{ color: 'var(--broadcast-text)' }}>
                {latest.label}
              </div>
            </div>
          </AnimatedReveal>
        </div>
      )}

      {/* Player columns */}
      <div
        className="flex-1 grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(board.columns.length, 6))}, 1fr)` }}
      >
        {board.columns.map((col) => {
          const isCurrent = board.onClock?.playerId === col.playerId && !board.complete;
          return (
            <div
              key={col.playerId}
              className="flex flex-col gap-2 p-3 rounded-xl"
              style={{
                background: isCurrent ? 'rgba(239, 68, 68, 0.1)' : 'var(--broadcast-surface-light)',
                border: isCurrent ? '2px solid var(--broadcast-accent)' : '1px solid var(--broadcast-border)',
              }}
            >
              <OverlayPlayerBadge player={{ name: nameOf(col.name), avatar_url: null }} avatarSize={32} />

              {showBudget && col.budget != null && (
                <div className="text-xs" style={{ color: 'var(--broadcast-text-muted)' }}>
                  {ts('players.budget', { n: col.budget })}
                </div>
              )}

              <div className="flex flex-col gap-1">
                {col.roster.map((entry) => (
                  <div key={entry.key} className="flex items-center gap-1">
                    <OverlayPokemonSprite pokemon={entry.sprite} size={28} />
                    <span className="text-xs truncate" style={{ color: 'var(--broadcast-text)' }}>
                      {entry.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent picks ticker */}
      <div
        className="flex items-center gap-3 px-4 py-2 rounded-lg overflow-hidden"
        style={{ background: 'var(--broadcast-surface-light)' }}
      >
        <span className="text-xs font-bold" style={{ color: 'var(--broadcast-text-muted)' }}>
          {ts('recent.title')}
        </span>
        {board.picks
          .slice(-5)
          .reverse()
          .map((pick) => (
            <span key={pick.key} className="text-xs whitespace-nowrap" style={{ color: 'var(--broadcast-text)' }}>
              <span style={{ color: 'var(--broadcast-text-muted)' }}>{ts('recent.round', { round: pick.round })}</span>
              {' · '}
              {nameOf(pick.playerName)}
              {' · '}
              {pick.label}
              {showTiers && pick.price != null ? ` · ${tShared('points', { n: pick.price })}` : ''}
            </span>
          ))}
      </div>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
