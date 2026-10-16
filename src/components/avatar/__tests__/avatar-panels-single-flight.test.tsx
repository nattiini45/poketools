/**
 * The avatar panels' POSTs are single-flight: each claims a ref synchronously
 * before its await, because the `saving` / `generating` / `transforming` state
 * only lands on the next render. A second click in the same tick (the same
 * render's handler called twice) therefore cannot start a second POST.
 *
 * The panels run as plain functions with React's hooks replaced: setters
 * never re-render, which is exactly the same-tick case. Initial state and refs
 * are overridden by hook call order (documented per panel below).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

const hooks = vi.hoisted(() => ({
  stateIndex: 0,
  refIndex: 0,
  stateOverrides: new Map<number, unknown>(),
  refOverrides: new Map<number, unknown>(),
}));

// The panels run as plain functions (no renderer, so no context): the i18n
// hooks are replaced by their pure, English equivalents.
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

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.stateIndex++;
      const value = hooks.stateOverrides.has(index)
        ? (hooks.stateOverrides.get(index) as T)
        : typeof initial === 'function'
          ? (initial as () => T)()
          : initial;
      return [value, () => undefined];
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.refIndex++;
      return { current: hooks.refOverrides.has(index) ? hooks.refOverrides.get(index) : initial };
    },
    useEffect: () => undefined,
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

import ShowdownPicker from '../ShowdownPicker';
import AiAvatarGenerator from '../AiAvatarGenerator';
import PhotoTransformPanel from '../PhotoTransformPanel';

type Handler = () => Promise<void>;

/** Depth-first search for the button whose text (or title) is `label`. */
function findButton(node: ReactNode, label: string): Handler | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onClick?: Handler; children?: ReactNode; title?: string };
  if (node.type === 'button' && props.onClick && (props.children === label || props.title === label)) {
    return props.onClick;
  }
  return findButton(props.children, label);
}

function handlerIn(tree: ReactNode, label: string): Handler {
  const handler = findButton(tree, label);
  if (!handler) throw new Error(`${label} button not found`);
  return handler;
}

/** One render with the given initial state / refs (by hook call index). */
function render(
  panel: () => ReactNode,
  state: Record<number, unknown> = {},
  refs: Record<number, unknown> = {},
): ReactNode {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.stateOverrides = new Map(Object.entries(state).map(([k, v]) => [Number(k), v]));
  hooks.refOverrides = new Map(Object.entries(refs).map(([k, v]) => [Number(k), v]));
  return panel();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A fetch whose responses wait on `gate` (so a POST stays in flight until released). */
function gatedFetch(gate: Promise<void>, data: Record<string, unknown> = {}) {
  return vi.fn(async () => {
    await gate;
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  });
}

const GALLERY_ITEM = {
  id: 'g1',
  player_id: 'p1',
  image_url: 'https://example.com/g1.png',
  choices: {},
  style: 'anime',
  created_at: '2026-10-01T00:00:00.000Z',
};

describe('avatar panels: single-flight POSTs', () => {
  let gate: ReturnType<typeof deferred>;

  beforeEach(() => {
    gate = deferred();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ShowdownPicker useState order: activeCategory 0, search 1, selected 2, saving 3, ...
  it('ShowdownPicker: a second "Use This" in the same tick does not POST again', async () => {
    const fetchMock = gatedFetch(gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onBusyChange = vi.fn();
    const onSaved = vi.fn(async () => undefined);
    const tree = render(() => ShowdownPicker({ playerId: 'p1', onSaved, onBusyChange }), { 2: 'red' });
    const save = handlerIn(tree, 'Use This');

    const first = save();
    const second = save();
    gate.resolve();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);

    // The slot is released once the save settles.
    await save();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // AiAvatarGenerator useState order: choices 0, generatedImage 1, generating 2, saving 3, error 4,
  // remaining 5, openCategory 6, personalGallery 7, ...
  describe('AiAvatarGenerator', () => {
    const renderGenerator = (onBusyChange = vi.fn(), onSaved = vi.fn(async () => undefined)) =>
      render(() => AiAvatarGenerator({ playerId: 'p1', onSaved, onBusyChange }), {
        1: 'data:image/png;base64,AA',
        7: [GALLERY_ITEM],
      });

    it('a second "Use This" in the same tick does not POST again', async () => {
      const fetchMock = gatedFetch(gate.promise);
      vi.stubGlobal('fetch', fetchMock);
      const onBusyChange = vi.fn();
      const save = handlerIn(renderGenerator(onBusyChange), 'Use This');

      const first = save();
      const second = save();
      gate.resolve();
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    });

    it('a gallery pick in the same tick as a save does not POST again', async () => {
      const fetchMock = gatedFetch(gate.promise);
      vi.stubGlobal('fetch', fetchMock);
      const onBusyChange = vi.fn();
      const tree = renderGenerator(onBusyChange);

      const first = handlerIn(tree, 'Use This')();
      const second = handlerIn(tree, 'Click to use as avatar')();
      gate.resolve();
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    });

    it('a double-clicked gallery pick POSTs once', async () => {
      const fetchMock = gatedFetch(gate.promise);
      vi.stubGlobal('fetch', fetchMock);
      const pick = handlerIn(renderGenerator(), 'Click to use as avatar');

      const first = pick();
      const second = pick();
      gate.resolve();
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a second Generate in the same tick does not generate again, and blocks "Use This" meanwhile', async () => {
      const fetchMock = gatedFetch(gate.promise, { image: 'data:image/png;base64,BB', remaining: 4 });
      vi.stubGlobal('fetch', fetchMock);
      const tree = renderGenerator();
      const generate = handlerIn(tree, 'Regenerate');

      const first = generate();
      const second = generate();
      const save = handlerIn(tree, 'Use This')();
      gate.resolve();
      await Promise.all([first, second, save]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]).toEqual(['/api/avatar/generate', expect.anything()]);

      await generate();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // PhotoTransformPanel useState order: photoPreview 0, consentChecked 1, transforming 2, saving 3,
  // resultImage 4, ...; useRef order: fileInputRef 0, cleanedBase64Ref 1, ...
  describe('PhotoTransformPanel', () => {
    it('a second "Use as Avatar" in the same tick does not POST again', async () => {
      const fetchMock = gatedFetch(gate.promise);
      vi.stubGlobal('fetch', fetchMock);
      const onBusyChange = vi.fn();
      const onSaved = vi.fn(async () => undefined);
      const tree = render(() => PhotoTransformPanel({ playerId: 'p1', onSaved, onBusyChange }), {
        4: 'data:image/png;base64,AA',
      });
      const save = handlerIn(tree, 'Use as Avatar');

      const first = save();
      const second = save();
      gate.resolve();
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(onBusyChange.mock.calls).toEqual([[true], [false]]);

      await save();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a second Transform in the same tick does not transform again', async () => {
      const fetchMock = gatedFetch(gate.promise, { image: 'data:image/png;base64,BB', remaining: 2 });
      vi.stubGlobal('fetch', fetchMock);
      const tree = render(
        () => PhotoTransformPanel({ playerId: 'p1' }),
        { 0: 'data:image/png;base64,AA', 1: true },
        { 1: 'AA' },
      );
      const transform = handlerIn(tree, 'Transform');

      const first = transform();
      const second = transform();
      gate.resolve();
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]).toEqual(['/api/avatar/transform', expect.anything()]);
    });
  });
});
