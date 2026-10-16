'use client';

/**
 * `window.__paintAudit` (LOOK-PLAN §2 SEAT L item 3) — dev and capture only.
 *
 * A getter-backed snapshot the harness reads with `--debug`/`--audit`:
 * `{ unpatched, exempt, patched, programs, scopeLeaks }`. `unpatched` counts
 * lit Standard/Physical materials in the scene that are neither painted nor
 * exempt, plus painted ones whose CURRENT program was linked without the
 * paint key (compiled before the sweep reached them). The acceptance bar is
 * `unpatched = 0` in both palettes. Pure inspection: nothing is mutated.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { auditPaint, type PaintAuditRenderer } from './paint-sweep';
import { paintScopeLeaks } from './painted-light';

export interface PaintAuditSnapshot {
  unpatched: number;
  exempt: number;
  patched: number;
  /** `renderer.info.programs.length` at read time. */
  programs: number;
  /** Paint-marked materials compiled while no paint scope was held. */
  scopeLeaks: number;
}

interface PaintAuditHost {
  __paintAudit?: PaintAuditSnapshot;
}

/** Mount inside the canvas of a painted world (the plaza light rig does). */
export default function PaintAudit() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const { debug } = useWorldState();
  const enabled = debug || process.env.NODE_ENV !== 'production';

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const host = window as Window & PaintAuditHost;
    Object.defineProperty(host, '__paintAudit', {
      configurable: true,
      enumerable: true,
      get: (): PaintAuditSnapshot => {
        const counts = auditPaint(scene, gl as unknown as PaintAuditRenderer);
        return {
          ...counts,
          programs: gl.info.programs?.length ?? 0,
          scopeLeaks: paintScopeLeaks(),
        };
      },
    });
    return () => {
      delete host.__paintAudit;
    };
  }, [enabled, gl, scene]);

  return null;
}
