'use client';

import { useEffect, useRef } from 'react';
import { useWorldState } from './WorldStateProvider';
import { getRouteTelemetry } from './post/post-store';
import { getFrameStats } from './perf/frame-stats';
import { endpointFor } from '@/lib/route-world/chapters';
import type { BeatsReport } from '@/lib/route-world/ambient-beats';

const NUMBER = (value: number, digits = 3) => value.toFixed(digits);
const VEC = (v: readonly [number, number, number]) => `${v[0]}, ${v[1]}, ${v[2]}`;
const K = (value: number) => `${(value / 1000).toFixed(1)}k`;

/** The beat readout refreshes at 4 Hz (the report copies the bus log and scans the warm-stats ring). */
const BEATS_EVERY_MS = 250;

type BeatsHost = Window & { __routeWorldBeats?: () => BeatsReport | null };

/** POKEMON-CORE A2: the bus lines (suppression, reading window, grants, roll call, quiet, director cost). */
function beatLines(report: BeatsReport | null): string {
  if (!report) return '';
  const last = report.grants.length > 0 ? report.grants[report.grants.length - 1] : null;
  const hits = Object.values(report.rollCall.hits).reduce((sum, n) => sum + n, 0);
  const ms = report.directorMs;
  const reading = report.readingWindow;
  return [
    `beats     t ${NUMBER(report.t, 1)} · hold ${report.suppression ?? '—'} · pend ${report.pending.length} · run ${report.granted.map((g) => g.kind).join(',') || '—'}`,
    `read win  ${reading.open ? 'open' : 'closed'}${reading.sinceSettleS !== null ? ` · ${NUMBER(reading.sinceSettleS, 1)} s` : ''}${report.sinceHeroEndS != null ? ` · since hero ${NUMBER(report.sinceHeroEndS, 1)} s` : ''}`,
    last
      ? `grant     #${report.grants.length} ${last.kind} ${last.actorId} @${NUMBER(last.grantedAtS, 1)}${last.forced ? ' forced' : ''}${last.faceNdc != null ? ` ndc ${NUMBER(last.faceNdc, 2)}` : ''}`
      : '',
    report.faceSource && !report.faceSource.available ? `faces     UNAVAILABLE (${report.faceSource.reason ?? '?'}) · hero beats denied` : '',
    `roll call ${report.rollCall.running ? 'running' : 'idle'} · hits ${hits} (${Object.keys(report.rollCall.hits).length} ids)${report.quiet?.active ? ` · quiet ${report.quiet.subjectId ?? 'focus'}` : ''}`,
    ms.p50 !== null ? `director  p50 ${NUMBER(ms.p50, 2)} · p95 ${NUMBER(ms.p95 ?? 0, 2)} ms (own ${NUMBER(ms.ownP50 ?? 0, 2)} / ${NUMBER(ms.ownP95 ?? 0, 2)})` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Live conductor readout, shown only with `?routeDebug=1`.
 *
 * Every field is written straight to the DOM from a rAF loop rather than
 * through React state: the overlay exists to observe the per-frame values,
 * and re-rendering the tree sixty times a second would change the very
 * frame timings it is meant to report.
 *
 * Stations and the world-state sampler come from the resolved route theme —
 * for DOM-only worlds (no theme) the readout shows the conductor alone.
 *
 * C-032 adds the render budget block — fps / frame ms / draw calls /
 * triangles / rung / DPR — sampled by the canvas' `TelemetrySampler` from
 * `renderer.info` (see `RouteWorldCanvas`). Absent while no canvas runs.
 *
 * POKEMON-CORE A2 adds the beat bus block from `window.__routeWorldBeats`
 * (the evidence bridge; no import of the canvas code), refreshed at 4 Hz.
 */
export default function RouteDebugOverlay() {
  const { conductor, tier, liteReason, mobile, debug, theme, sampleWorldState } = useWorldState();
  const readoutRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!debug) return;
    const stations = theme?.stations ?? [];
    let frame = 0;
    let beats = '';
    let beatsAt = -Infinity;

    const tick = () => {
      const node = readoutRef.current;
      if (node) {
        const p = conductor.progress.current;
        const station = stations[Math.min(p.index, stations.length - 1)];
        const world = sampleWorldState(p.smooth);
        const camera = station ? endpointFor(station, mobile) : null;
        const t = getRouteTelemetry();
        const f = getFrameStats();
        const now = performance.now();
        if (now - beatsAt >= BEATS_EVERY_MS) {
          beatsAt = now;
          beats = beatLines((window as BeatsHost).__routeWorldBeats?.() ?? null);
        }

        node.textContent = [
          `tier      ${tier}${liteReason ? ` (${liteReason})` : ''}`,
          `viewport  ${mobile ? 'mobile' : 'desktop'}`,
          `station   ${p.index} · ${station?.id ?? '—'}`,
          `exact     ${NUMBER(p.exact)}`,
          `smooth    ${NUMBER(p.smooth)}`,
          `localT    ${NUMBER(p.localT)}`,
          `dir/vel   ${p.direction >= 0 ? '+' : '-'} ${NUMBER(Math.abs(p.velocity), 2)}/s`,
          camera ? `cam pos   ${VEC(camera.position)}  fov ${camera.fov}` : '',
          camera ? `cam tgt   ${VEC(camera.target)}` : '',
          `key/fog   ${NUMBER(world.key, 2)} / ${NUMBER(world.fog, 4)}`,
          `prac/part ${NUMBER(world.practicals, 2)} / ${NUMBER(world.particles, 2)}`,
          t
            ? [
                `rung      ${t.rung} · fps ${NUMBER(t.fps, 1)} · ${NUMBER(t.frameMs, 1)} ms`,
                `draws     ${t.calls} · tris ${t.triangles.toLocaleString('en-US')} (${K(t.triangles)})`,
                `dpr       ${NUMBER(t.dpr, 2)}`,
              ].join('\n')
            : '',
          // Percentiles over the live window, not the EMA above: the D1 budgets
          // are p95/p99 because an average hides a hitch on every camera move.
          f.frames > 0
            ? `frame ms  p50 ${NUMBER(f.p50, 1)} · p95 ${NUMBER(f.p95, 1)} · p99 ${NUMBER(f.p99, 1)} · max ${NUMBER(f.max, 1)}${f.settled ? '' : ' (warming)'}`
            : '',
          f.longFrames > 0 ? `hitches   ${f.longFrames} over 50 ms in window` : '',
          beats,
        ]
          .filter(Boolean)
          .join('\n');
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [conductor, debug, liteReason, mobile, sampleWorldState, theme, tier]);

  if (!debug) return null;

  return (
    <div
      aria-hidden="true"
      data-route-debug-overlay=""
      className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-lg border border-arena-border bg-arena-surface/90 p-3 shadow-poke-lg backdrop-blur-sm"
    >
      <pre ref={readoutRef} className="font-mono text-[11px] leading-snug text-arena-ink" />
    </div>
  );
}
