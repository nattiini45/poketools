'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, DraftReplayEvent, DraftReplayPickData, DraftReplayCommentaryData, DraftReplayPauseData } from '@/types/broadcast';
import {
  createReplayState,
  stepForward,
  stepBackward,
  jumpToRound,
  getCurrentEvent,
  getDisplayDuration,
  getTotalRounds,
  type DraftReplayState,
} from '@/lib/broadcast/draft-replay';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { overlayLineLabel, type OverlayLines } from './DraftViewer';
import type { Translator } from '@/i18n/core';
import type { Formatter } from '@/i18n/format';
import type { DataLocale } from '@/lib/pkmn/i18n/types';

interface DraftReplayPlayerProps {
  config: OverlayConfig;
  draftPoolId: string;
  /** Line id → English stage names from the bound list (server-built); labels EPB picks as lines. */
  lines?: OverlayLines;
}

/** A replay event as GET /api/drafts/[id]/replay-events sends it: plus its pick's line id (EPB). */
type ReplayEventWithLine = DraftReplayEvent & { line_id?: string | null };

const NO_LINES: OverlayLines = {};

/** `player:species` → line id of every pick event, so roster entries can be labelled as lines. */
function lineIdsOf(events: readonly ReplayEventWithLine[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const event of events) {
    if (event.event_type !== 'pick' || !event.line_id) continue;
    const data = event.event_data as DraftReplayPickData;
    out.set(`${data.player_id}:${data.pokemon_name}`, event.line_id);
  }
  return out;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4];

export default function DraftReplayPlayer({
  config,
  draftPoolId,
  lines = NO_LINES,
}: DraftReplayPlayerProps) {
  const [state, setState] = useState<DraftReplayState | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tc = useT(commonMessages);
  const ts = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tLegacy = useT(draftLegacyBoardMessages);
  const tb = useT(broadcastOverlaysMessages);
  const f = useFormatter();
  const dl = useDataLocale();

  // Load events
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/drafts/${encodeURIComponent(draftPoolId)}/replay-events`);
        const json = await res.json();
        if (!json.success) return;

        const events: ReplayEventWithLine[] = json.data ?? [];
        setState(createReplayState(draftPoolId, events));
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [draftPoolId]);

  // Auto-advance when playing
  useEffect(() => {
    if (!state?.playing) return;

    const duration = getDisplayDuration(state);
    if (duration <= 0) {
      setState((s) => s ? { ...stepForward(s), playing: true } : s);
      return;
    }

    timerRef.current = setTimeout(() => {
      setState((s) => {
        if (!s) return s;
        const next = stepForward(s);
        return { ...next, playing: next.currentIndex < next.events.length - 1 };
      });
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state]);

  const handlePlayPause = useCallback(() => {
    setState((s) => s ? { ...s, playing: !s.playing } : s);
  }, []);

  const handleStep = useCallback((direction: 'forward' | 'backward') => {
    setState((s) => {
      if (!s) return s;
      const next = direction === 'forward' ? stepForward(s) : stepBackward(s);
      return { ...next, playing: false };
    });
  }, []);

  const handleSpeed = useCallback((speed: number) => {
    setState((s) => s ? { ...s, speed } : s);
  }, []);

  const handleJumpRound = useCallback((round: number) => {
    setState((s) => {
      if (!s) return s;
      return { ...jumpToRound(s, round), playing: false };
    });
  }, []);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div style={{ color: 'var(--broadcast-text-muted)' }}>{tc('states.loading')}</div>
      </div>
    );
  }

  if (!state || state.events.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div style={{ color: 'var(--broadcast-text-muted)' }}>{ts('recent.none')}</div>
      </div>
    );
  }

  const currentEvent = getCurrentEvent(state);
  const totalRounds = getTotalRounds(state);
  const progress = state.events.length > 0
    ? ((state.currentIndex + 1) / state.events.length) * 100
    : 0;

  // Get player roster columns
  const playerIds = Object.keys(state.rosters);
  const lineIds = lineIdsOf(state.events);

  return (
    <div className="relative w-full h-full flex flex-col p-6 gap-4">
      {/* Draft board */}
      <div className="flex-1 flex gap-3 overflow-hidden">
        {/* Roster columns */}
        <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(playerIds.length || 1, 6)}, 1fr)` }}>
          {playerIds.map((playerId) => {
            const roster = state.rosters[playerId] ?? [];
            const name = state.playerNames[playerId] ?? tb('common.unknownPlayer');
            const budget = state.budgets?.[playerId];

            return (
              <div
                key={playerId}
                className="flex flex-col gap-1 p-2 rounded-lg"
                style={{ background: 'var(--broadcast-surface-light)', border: '1px solid var(--broadcast-border)' }}
              >
                <OverlayPlayerBadge player={{ name, avatar_url: null }} avatarSize={24} />
                {budget != null && (
                  <div className="text-[10px]" style={{ color: 'var(--broadcast-text-muted)' }}>
                    {ts('players.budget', { n: budget })}
                  </div>
                )}
                {roster.map((pokemon) => {
                  const { label, sprite } = overlayLineLabel(lineIds.get(`${playerId}:${pokemon}`), pokemon, lines, dl);
                  return (
                    <div key={pokemon} className="flex items-center gap-1">
                      <OverlayPokemonSprite pokemon={sprite} size={22} />
                      <span className="text-[10px] truncate" style={{ color: 'var(--broadcast-text)' }}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Current event display */}
        <div className="w-80 flex flex-col items-center justify-center gap-4">
          {currentEvent && (
            <AnimatedReveal key={state.currentIndex} animation="scaleReveal">
              {renderEventCard(currentEvent, { ts, tShared, tLegacy, f, dl, lines })}
            </AnimatedReveal>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--broadcast-surface-light)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress}%`, background: 'var(--broadcast-accent)' }}
        />
      </div>

      {/* Scrubber: event dots */}
      <div className="flex items-center gap-[2px] h-4">
        {state.events.map((event, i) => (
          <button
            key={event.id}
            type="button"
            onClick={() => setState((s) => s ? { ...s, ...jumpToRound(s, 0), currentIndex: i, playing: false } : s)}
            className="flex-1 h-2 rounded-full transition-opacity"
            style={{
              background: i <= state.currentIndex ? 'var(--broadcast-accent)' : 'var(--broadcast-surface-light)',
              opacity: i === state.currentIndex ? 1 : 0.5,
              maxWidth: '8px',
            }}
            aria-label={`${i + 1}/${state.events.length}`}
          />
        ))}
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => handleStep('backward')}
          aria-label={ts('overlay.replay.back')}
          title={ts('overlay.replay.back')}
          className="px-3 py-1.5 rounded-lg text-sm font-bold"
          style={{ background: 'var(--broadcast-surface-light)', color: 'var(--broadcast-text)' }}
        >
          ◀◀
        </button>
        <button
          type="button"
          onClick={handlePlayPause}
          aria-label={state.playing ? ts('overlay.replay.pause') : ts('overlay.replay.play')}
          title={state.playing ? ts('overlay.replay.pause') : ts('overlay.replay.play')}
          className="px-5 py-2 rounded-xl text-base font-bold"
          style={{ background: 'var(--broadcast-accent)', color: '#fff' }}
        >
          {state.playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          onClick={() => handleStep('forward')}
          aria-label={ts('overlay.replay.skip')}
          title={ts('overlay.replay.skip')}
          className="px-3 py-1.5 rounded-lg text-sm font-bold"
          style={{ background: 'var(--broadcast-surface-light)', color: 'var(--broadcast-text)' }}
        >
          ▶▶
        </button>

        {/* Speed picker */}
        <div className="flex items-center gap-1 ml-4">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSpeed(s)}
              className="px-2 py-1 rounded text-xs font-bold transition-colors"
              style={{
                background: state.speed === s ? 'var(--broadcast-accent)' : 'var(--broadcast-surface-light)',
                color: state.speed === s ? '#fff' : 'var(--broadcast-text-muted)',
              }}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Round picker */}
        {totalRounds > 1 && (
          <div className="flex items-center gap-1 ml-4">
            {Array.from({ length: totalRounds }, (_, i) => i + 1).map((r) => (
              <button
                key={r}
                type="button"
                title={ts('recent.round', { round: r })}
                aria-label={ts('recent.round', { round: r })}
                onClick={() => handleJumpRound(r)}
                className="w-6 h-6 rounded text-xs font-bold"
                style={{
                  background: 'var(--broadcast-surface-light)',
                  color: 'var(--broadcast-text)',
                }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

// ─── Event card renderer ──────────────────────────────────────────────

interface EventCardText {
  ts: Translator<(typeof draftScreenMessages)['en']>;
  tShared: Translator<(typeof draftSharedMessages)['en']>;
  tLegacy: Translator<(typeof draftLegacyBoardMessages)['en']>;
  f: Formatter;
  dl: DataLocale;
  lines: OverlayLines;
}

function renderEventCard(event: ReplayEventWithLine, { ts, tShared, tLegacy, f, dl, lines }: EventCardText) {
  switch (event.event_type) {
    case 'pick': {
      const data = event.event_data as DraftReplayPickData;
      // The list line when the event carries a known line id, else the species the pick stores.
      const { label, sprite } = overlayLineLabel(event.line_id, data.pokemon_name, lines, dl);
      return (
        <div
          className="flex flex-col items-center gap-3 px-6 py-4 rounded-xl"
          style={{ background: 'var(--broadcast-surface)', border: '2px solid var(--broadcast-accent)' }}
        >
          <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--broadcast-text-muted)' }}>
            {ts('clock.roundPick', { round: data.round, pick: data.pick_number })}
          </div>
          <OverlayPokemonSprite pokemon={sprite} size={80} />
          <div className="text-lg font-black" style={{ color: 'var(--broadcast-text)' }}>
            {label}
          </div>
          <div className="text-sm font-semibold" style={{ color: 'var(--broadcast-accent)' }}>
            {data.player_name}
          </div>
          {data.power_tier && (
            <div className="text-xs" style={{ color: 'var(--broadcast-text-muted)' }}>
              {tLegacy('tierList.tier', { tier: data.power_tier })}
              {data.points_spent != null ? ` · ${tShared('points', { n: data.points_spent })}` : ''}
            </div>
          )}
        </div>
      );
    }

    case 'commentary': {
      const data = event.event_data as DraftReplayCommentaryData;
      return (
        <div
          className="px-6 py-4 rounded-xl text-center"
          style={{ background: 'var(--broadcast-surface)', border: '1px solid var(--broadcast-border)' }}
        >
          <div className="text-base italic" style={{ color: 'var(--broadcast-text)' }}>
            &ldquo;{data.text}&rdquo;
          </div>
          <div className="text-xs mt-2" style={{ color: 'var(--broadcast-text-muted)' }}>
            — {data.author}
          </div>
        </div>
      );
    }

    case 'pause': {
      const data = event.event_data as DraftReplayPauseData;
      return (
        <div
          className="px-6 py-4 rounded-xl text-center"
          style={{ background: 'var(--broadcast-surface-light)', border: '1px solid var(--broadcast-border)' }}
        >
          <div className="text-sm" style={{ color: 'var(--broadcast-text-muted)' }}>
            ⏸ {data.reason}
          </div>
          {data.original_duration_hours != null && (
            <div className="text-xs mt-1" style={{ color: 'var(--broadcast-text-muted)' }}>
              {f.duration(Math.round(data.original_duration_hours * 3600))}
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
