import { describe, expect, it, vi } from 'vitest';
import { nextReleaseLatch, startDockedExit, type ExitDialog, type ExitTimers } from '../docked-exit';

type EndListener = (event: { target: unknown; animationName: string }) => void;

function fakeDialog() {
  const attributes = new Set<string>();
  const listeners = new Set<EndListener>();
  let open = true;
  let flushes = 0;
  const order: string[] = [];
  const dialog: ExitDialog & { fire: (name: string) => void } = {
    get open() {
      return open;
    },
    get offsetWidth() {
      flushes += 1;
      order.push('flush');
      return 416;
    },
    setAttribute: (name) => {
      attributes.add(name);
      order.push(`set:${name}`);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    close: () => {
      open = false;
    },
    fire: (name) => {
      for (const listener of [...listeners]) listener({ target: dialog, animationName: name });
    },
  };
  return { dialog, attributes, listeners, order, flushes: () => flushes };
}

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timers: ExitTimers = {
    setTimeout: (callback) => {
      const id = next++;
      pending.set(id, callback);
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
  };
  const runAll = () => {
    for (const [id, callback] of [...pending]) {
      pending.delete(id);
      callback();
    }
  };
  return { timers, pending, runAll };
}

describe('startDockedExit (W6 round 3)', () => {
  it('flushes style, sets data-closing, and finishes from animationend — not the fallback', () => {
    const { dialog, attributes, listeners, order } = fakeDialog();
    const { timers, pending } = fakeTimers();
    const done = vi.fn();
    startDockedExit(dialog, 400, done, timers);
    expect(attributes.has('data-closing')).toBe(true);
    expect(order).toEqual(['flush', 'set:data-closing']);
    expect(dialog.open).toBe(true); // stays open while the exit plays

    dialog.fire('world-focus-panel-fade-in'); // the body's entry: ignored
    expect(done).not.toHaveBeenCalled();
    dialog.fire('world-focus-panel-out');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('animationend');
    expect(dialog.open).toBe(false);
    expect(pending.size).toBe(0); // fallback cleared
    expect(listeners.size).toBe(0);
  });

  it('accepts the bottom-sheet and reduced-motion exits', () => {
    for (const name of ['world-focus-panel-out-bottom', 'world-focus-panel-fade-out']) {
      const { dialog } = fakeDialog();
      const { timers } = fakeTimers();
      const done = vi.fn();
      startDockedExit(dialog, 400, done, timers);
      dialog.fire(name);
      expect(done).toHaveBeenCalledWith('animationend');
    }
  });

  it('still closes through the fallback when no animation runs', () => {
    const { dialog } = fakeDialog();
    const { timers, runAll } = fakeTimers();
    const done = vi.fn();
    startDockedExit(dialog, 400, done, timers);
    runAll();
    expect(done).toHaveBeenCalledWith('fallback');
    expect(dialog.open).toBe(false);
    dialog.fire('world-focus-panel-out'); // late end: no second finish
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cancel (re-opened mid-exit) drops data-closing and never closes', () => {
    const { dialog, attributes, listeners } = fakeDialog();
    const { timers, pending } = fakeTimers();
    const done = vi.fn();
    const cancel = startDockedExit(dialog, 400, done, timers);
    cancel();
    expect(attributes.has('data-closing')).toBe(false);
    expect(pending.size).toBe(0);
    expect(listeners.size).toBe(0);
    dialog.fire('world-focus-panel-out');
    expect(done).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });
});

describe('nextReleaseLatch — the panel leaves with the camera', () => {
  const open = { docked: true, isOpen: true };

  it('latches on the releasing edge, before the param clears', () => {
    expect(nextReleaseLatch(false, { ...open, phase: 'focused' })).toBe(false);
    expect(nextReleaseLatch(false, { ...open, phase: 'releasing' })).toBe(true);
  });

  it('holds through idle while the param is still set (no re-open when the camera lands first)', () => {
    expect(nextReleaseLatch(true, { ...open, phase: 'idle' })).toBe(true);
  });

  it('clears once the param clears, or on a re-focus mid-exit', () => {
    expect(nextReleaseLatch(true, { docked: true, isOpen: false, phase: 'idle' })).toBe(false);
    expect(nextReleaseLatch(true, { ...open, phase: 'focusing' })).toBe(false);
  });

  it('never latches the Lite modal or a panel opened without focus', () => {
    expect(nextReleaseLatch(false, { docked: false, isOpen: true, phase: 'releasing' })).toBe(false);
    expect(nextReleaseLatch(false, { ...open, phase: 'idle' })).toBe(false);
  });
});
