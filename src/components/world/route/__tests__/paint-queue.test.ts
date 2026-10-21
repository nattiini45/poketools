import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completedPaints,
  paintQueueIdle,
  pendingPaints,
  queuePaint,
  resetPaintQueueForTests,
  subscribePaintQueue,
} from '../paint-queue';

/** Resolve after the queue drained (each job runs in its own macrotask). */
function drained(): Promise<void> {
  return new Promise((resolve) => {
    const stop = subscribePaintQueue(() => {
      if (paintQueueIdle()) {
        stop();
        resolve();
      }
    });
  });
}

describe('paint queue (ENGINE r3: one canvas face per task)', () => {
  afterEach(() => resetPaintQueueForTests());

  it('runs every job in submission order, never inside the submitting task', async () => {
    const order: number[] = [];
    queuePaint(() => order.push(1));
    queuePaint(() => order.push(2));
    queuePaint(() => order.push(3));
    expect(order).toEqual([]);
    expect(pendingPaints()).toBe(3);
    expect(paintQueueIdle()).toBe(false);
    await drained();
    expect(order).toEqual([1, 2, 3]);
    expect(completedPaints()).toBe(3);
  });

  it('runs one job per task: a job sees the next one still pending', async () => {
    const seen: number[] = [];
    queuePaint(() => seen.push(pendingPaints()));
    queuePaint(() => seen.push(pendingPaints()));
    await drained();
    expect(seen).toEqual([1, 0]);
  });

  it('a cancelled job never runs and stops counting as pending', async () => {
    const ran: string[] = [];
    const cancel = queuePaint(() => ran.push('a'));
    queuePaint(() => ran.push('b'));
    cancel();
    expect(pendingPaints()).toBe(1);
    await drained();
    expect(ran).toEqual(['b']);
  });

  it('a throwing job does not stop the queue', async () => {
    const ran: string[] = [];
    const original = console.error;
    console.error = () => {};
    try {
      queuePaint(() => {
        throw new Error('boom');
      });
      queuePaint(() => ran.push('after'));
      await drained();
    } finally {
      console.error = original;
    }
    expect(ran).toEqual(['after']);
  });

  it('a throwing job is logged in a production build too (PR #65 review)', async () => {
    // A failed paint leaves its face's residency pending, and the load
    // resolves to Lite: the console line is the production record of why.
    vi.stubEnv('NODE_ENV', 'production');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('boom');
    try {
      queuePaint(() => {
        throw boom;
      });
      await drained();
      expect(errors).toHaveBeenCalledWith('[paint-queue] paint failed', boom);
      expect(completedPaints()).toBe(1);
    } finally {
      errors.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe('queued face painters record a missing 2D context (PR #65 review)', () => {
  const WORLD = join(__dirname, '..', '..');
  // Each queued paint job's detached canvas: no context means no publish (the
  // face stays pending and the load resolves to Lite), so the branch must log.
  const painters = [
    'themes/sakura/content/use-painted-texture.ts',
    'themes/mountain/content/use-painted-texture.ts',
    'themes/clouds/content/use-painted-texture.ts',
    'evoliga/route/plaza/ChallengeGate.tsx',
    'evoliga/route/plaza/DeskHolo.tsx',
    'evoliga/route/plaza/CenterDesk.tsx',
  ];

  it.each(painters)('%s logs before it returns without a texture', (file) => {
    const source = readFileSync(join(WORLD, file), 'utf8');
    const branches = source.split("source.getContext('2d');").slice(1);
    expect(branches.length).toBe(1);
    expect(branches[0]).toMatch(/^\s*(?:\/\/[^\n]*\n\s*)*if \(!ctx\) \{\s*console\.error\('\[[a-z-]+\] canvas 2d unavailable'\);\s*return( null)?;\s*\}/);
  });
});
