/**
 * The back-button guard of the editor (no DOM): a fake window records the history calls. While the editor is dirty
 * one extra entry sits on the stack; stepping back from it asks, "stay" sends the user forward again, "leave" goes
 * back once more, and a clean editor or the editor's own way out is never interrupted.
 */
import { describe, expect, it } from 'vitest';
import { installBackGuard, type BackGuardWindow } from '../useUnsavedGuard';

function setup(answers: boolean[] = []) {
  const calls: string[] = [];
  let listener: (() => void) | null = null;
  const win: BackGuardWindow = {
    history: {
      state: { __NA: true },
      pushState: (data, _unused, url) => calls.push(`push:${JSON.stringify(data)}:${String(url)}`),
      go: (delta) => calls.push(`go:${delta}`),
      back: () => calls.push('back'),
    },
    location: { href: 'https://example.test/admin/formats/f1/edit' },
    addEventListener: (_type, fn) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
    confirm: (message) => {
      calls.push(`confirm:${message}`);
      return answers.shift() ?? false;
    },
  };
  const flags = { dirty: false, skip: false };
  const guard = installBackGuard(win, { isDirty: () => flags.dirty, skip: () => flags.skip, message: () => 'Discard?' });
  return { calls, flags, guard, popstate: () => listener?.(), listening: () => listener !== null };
}

describe('installBackGuard', () => {
  it('adds nothing while the editor is clean', () => {
    const { calls, guard } = setup();
    guard.sync();
    expect(calls).toEqual([]);
  });

  it('adds one history entry for the same address, keeping the history state, the first time it is dirty', () => {
    const { calls, flags, guard } = setup();
    flags.dirty = true;
    guard.sync();
    guard.sync();
    expect(calls).toEqual(['push:{"__NA":true}:https://example.test/admin/formats/f1/edit']);
  });

  it('asks on Back from the extra entry and, when the user stays, sends them forward onto it again', () => {
    const { calls, flags, guard, popstate } = setup([false]);
    flags.dirty = true;
    guard.sync();
    calls.length = 0;
    popstate();
    expect(calls).toEqual(['confirm:Discard?', 'go:1']);
    // The move forward is itself a popstate: it is not asked about again.
    popstate();
    expect(calls).toEqual(['confirm:Discard?', 'go:1']);
    // A second Back asks again.
    calls.length = 0;
    popstate();
    expect(calls).toEqual(['confirm:Discard?', 'go:1']);
  });

  it('goes back once more when the user chooses to leave, and stops guarding', () => {
    const { calls, flags, guard, popstate } = setup([true]);
    flags.dirty = true;
    guard.sync();
    calls.length = 0;
    popstate();
    expect(calls).toEqual(['confirm:Discard?', 'back']);
    // The page that was left behind answers the move it caused; a later popstate is none of the guard's business.
    popstate();
    expect(calls).toEqual(['confirm:Discard?', 'back']);
  });

  it('does not ask when the changes were saved meanwhile: it just continues back', () => {
    const { calls, flags, guard, popstate } = setup();
    flags.dirty = true;
    guard.sync();
    flags.dirty = false;
    calls.length = 0;
    popstate();
    expect(calls).toEqual(['back']);
  });

  it('stays quiet for the editor\'s own way out', () => {
    const { calls, flags, guard, popstate } = setup();
    flags.dirty = true;
    guard.sync();
    flags.skip = true;
    calls.length = 0;
    popstate();
    expect(calls).toEqual([]);
  });

  it('ignores a popstate it did not arm for, and no longer listens once disposed', () => {
    const { calls, guard, popstate, listening } = setup();
    popstate();
    expect(calls).toEqual([]);
    expect(listening()).toBe(true);
    guard.dispose();
    expect(listening()).toBe(false);
  });
});
