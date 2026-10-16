'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { LEAGUE_TIME_ZONE } from './config';
import { useFormatter, useRequestTime, useT } from './client';
import type { DatePreset } from './format';
import { timeMessages } from './messages/time';

/**
 * Client leaves for instants (i18n-core §1.5). Server components render
 * these instead of formatting a time of day themselves (rule T2).
 */

type Instant = string | number | Date;

function toIso(value: Instant): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * `<time>` in the viewer's zone. `zone="both"` appends
 * " · {time} {zone} league time" in `LEAGUE_TIME_ZONE` when the viewer's zone
 * differs (the draft deadline display, rule T6).
 */
export function LocalTime({
  value,
  preset,
  zone = 'viewer',
  className,
}: {
  value: Instant;
  preset: DatePreset;
  zone?: 'viewer' | 'both';
  className?: string;
}) {
  const formatter = useFormatter();
  const t = useT(timeMessages);
  const iso = toIso(value);
  const viewer = formatter.instant(value, preset);
  let text = viewer;
  if (zone === 'both' && iso && formatter.timeZone !== LEAGUE_TIME_ZONE) {
    const league = t('leagueTime', {
      time: formatter.instant(value, preset, { timeZone: LEAGUE_TIME_ZONE }),
      zone: formatter.zoneLabel(new Date(iso), LEAGUE_TIME_ZONE),
    });
    text = `${viewer} · ${league}`;
  }
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}

// One shared minute clock for every <RelativeTime> (rule T4). The snapshot is
// cached so React sees a stable value between ticks.
const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let clockNow = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    clockNow = Date.now();
    timer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getClockSnapshot(): number {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/**
 * "5 minutes ago". The first render (server and hydration) uses the
 * provider's `requestTime`; after mount it follows the wall clock and
 * re-ticks every 60 s.
 */
export function RelativeTime({ value, className }: { value: Instant; className?: string }) {
  const formatter = useFormatter();
  const requestTime = useRequestTime();
  const getServerSnapshot = useMemo(() => () => requestTime, [requestTime]);
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerSnapshot);
  return (
    <time dateTime={toIso(value)} className={className}>
      {formatter.relative(value, now)}
    </time>
  );
}
