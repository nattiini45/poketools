/**
 * The avatar page's onSaved refreshes the session player, then navigates.
 * AvatarBuilder awaits it before re-enabling its buttons, so a second save
 * cannot race the pending refresh and navigation. Saves are single-flight:
 * the slot is claimed synchronously (a ref, not the next render's state), so
 * a second click in the same tick, a Remove during a Save, or a mode switch
 * during a sibling panel's save cannot start a second POST or unlock early.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

const state = vi.hoisted(() => ({ order: [] as string[], mode: null as string | null }));

vi.mock('@/lib/avatar/renderer', () => ({ compositeToBase64: vi.fn(async () => 'data:image/png;base64,AA') }));
vi.mock('../AvatarCanvas', () => ({ default: () => null }));
vi.mock('../AvatarCategoryPicker', () => ({ default: () => null }));
vi.mock('../AiAvatarGenerator', () => ({ default: () => null }));
vi.mock('../ShowdownPicker', () => ({ default: () => null }));
vi.mock('../PhotoTransformPanel', () => ({ default: () => null }));
// No renderer, so no context: the i18n hooks are replaced by their pure, English equivalents.
vi.mock('@/i18n/client', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { useT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'), useLocale: () => 'en' };
});
vi.mock('@/i18n/use-api-error', async () => {
  const { apiErrorText } = await import('@/i18n/api-errors');
  return {
    useApiErrorText:
      () =>
      (res: Parameters<typeof apiErrorText>[0]) =>
        apiErrorText(res, { locale: 'en', catalogs: [] }),
  };
});
// Called as a plain function (no renderer), so the hooks run outside React.
// The `saving` setter (the only boolean initial) records into state.order;
// the `mode` setter (initial 'build') records `mode:<next>`, and state.mode
// overrides the initial mode so a sibling panel can be rendered.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      let value = typeof initial === 'function' ? (initial as () => T)() : initial;
      let set: (next: unknown) => void = () => undefined;
      if (typeof value === 'boolean') {
        set = (next) => {
          state.order.push(`saving:${String(next)}`);
        };
      } else if (value === 'build') {
        if (state.mode) value = state.mode as T;
        set = (next) => {
          state.order.push(`mode:${String(next)}`);
        };
      }
      return [value, set];
    },
    useCallback: <T,>(fn: T) => fn,
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

import AvatarBuilder from '../AvatarBuilder';

type Handler = () => Promise<void>;

/** Depth-first search for the button whose text is `label`. */
function findButton(node: ReactNode, label: string): Handler | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onClick?: Handler; children?: ReactNode };
  if (node.type === 'button' && props.children === label && props.onClick) return props.onClick;
  return findButton(props.children, label);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Depth-first search for the element that receives `onBusyChange` (a sibling panel). */
function findBusyReporter(node: ReactNode): ((busy: boolean) => void) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findBusyReporter(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onBusyChange?: (busy: boolean) => void; children?: ReactNode };
  if (props.onBusyChange) return props.onBusyChange;
  return findBusyReporter(props.children);
}

/** One render: every handler found in it shares that render's refs. */
function renderBuilder(onSaved: () => Promise<void>): ReactNode {
  return AvatarBuilder({
    playerId: 'p1',
    initialConfig: { gender: 'male' } as never,
    onSaved,
  });
}

function handlerIn(tree: ReactNode, label: string): Handler {
  const handler = findButton(tree, label);
  if (!handler) throw new Error(`${label} button not found`);
  return handler;
}

function buttonOf(onSaved: () => Promise<void>, label: string): Handler {
  return handlerIn(renderBuilder(onSaved), label);
}

describe('AvatarBuilder onSaved', () => {
  beforeEach(() => {
    state.order = [];
    state.mode = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const label of ['Save Avatar', 'Remove custom avatar']) {
    it(`${label}: keeps the buttons disabled until onSaved settles`, async () => {
      const gate = deferred();
      const onSaved = vi.fn(() => {
        state.order.push('onSaved');
        return gate.promise;
      });

      const done = buttonOf(onSaved, label)();
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(state.order).toEqual(['saving:true', 'onSaved']);

      gate.resolve();
      await done;
      expect(state.order).toEqual(['saving:true', 'onSaved', 'saving:false']);
    });
  }

  it('Save is single-flight: a second click in the same tick does not POST again', async () => {
    const gate = deferred();
    const onSaved = vi.fn(() => gate.promise);
    const save = handlerIn(renderBuilder(onSaved), 'Save Avatar');

    const first = save();
    const second = save();
    await second;
    gate.resolve();
    await first;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(state.order).toEqual(['saving:true', 'saving:false']);
  });

  it('Remove does not start while a Save holds the slot, and the stale click cannot unlock it', async () => {
    const gate = deferred();
    const onSaved = vi.fn(() => {
      state.order.push('onSaved');
      return gate.promise;
    });
    const tree = renderBuilder(onSaved);

    const saving = handlerIn(tree, 'Save Avatar')();
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await handlerIn(tree, 'Remove custom avatar')();

    // The refused Remove neither POSTed/DELETEd nor released the Save's lock.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.order).toEqual(['saving:true', 'onSaved']);

    gate.resolve();
    await saving;
    expect(state.order).toEqual(['saving:true', 'onSaved', 'saving:false']);
  });

  it('ignores a mode switch while a sibling save is in flight, in the same tick as its start', () => {
    state.mode = 'pick';
    const tree = renderBuilder(vi.fn(async () => undefined));
    const reportBusy = findBusyReporter(tree);
    expect(reportBusy).not.toBeNull();
    const toBuild = handlerIn(tree, 'Build');

    reportBusy!(true);
    void toBuild();
    expect(state.order).toEqual([]);

    reportBusy!(false);
    void toBuild();
    expect(state.order).toEqual(['mode:build']);
  });

  it('keeps the tabs locked until every overlapping sibling save has ended', () => {
    state.mode = 'pick';
    const tree = renderBuilder(vi.fn(async () => undefined));
    const reportBusy = findBusyReporter(tree)!;
    const toBuild = handlerIn(tree, 'Build');

    reportBusy(true);
    reportBusy(true);
    reportBusy(false);
    void toBuild();
    expect(state.order).toEqual([]);

    reportBusy(false);
    void toBuild();
    expect(state.order).toEqual(['mode:build']);
  });
});
