/**
 * EditableDescription keeps unsaved text across an unmount (a league admin tab
 * switch, a collapse, a reload): each keystroke goes to the tab's
 * sessionStorage, the next mount offers it back, and Save / Cancel / Discard
 * drop it.
 *
 * Node + static markup (no DOM): `capture` runs the component body inside a
 * server render and keeps the element tree it returned; handlers are called
 * from that tree. The `react` mock makes `useSyncExternalStore` read the client
 * snapshot (a server render would take the server one, which is always null)
 * and, with `scope.openEditor`, turns the first `useState(false)` (`editing`)
 * into `true` so the textarea and Save are reachable.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
/** `trueAt`: indexes of the component's `useState(false)` calls forced to true (0 = editing, 2 = draftNotKept). */
const scope = vi.hoisted(() => ({ openEditor: false, falseSeen: 0, trueAt: [] as number[] }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = <T,>(initial: T | (() => T)) => {
    if (initial === false) {
      const index = scope.falseSeen++;
      if ((scope.openEditor && index === 0) || scope.trueAt.includes(index)) return actual.useState(true as T);
    }
    return actual.useState(initial);
  };
  const useSyncExternalStore = <T,>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot();
  return {
    ...actual,
    default: { ...actual, useState, useSyncExternalStore },
    useState,
    useSyncExternalStore,
  };
});

const { default: EditableDescription } = await import('../EditableDescription');
const { descriptionDraftKey } = await import('../description-draft');

type El = ReactElement<Record<string, unknown>>;

function capture<P extends object>(Component: (props: P) => ReactNode, props: P): ReactNode {
  let tree: ReactNode = null;
  function Probe() {
    tree = Component(props);
    return tree;
  }
  renderToStaticMarkup(<Probe />);
  return tree;
}

function findAll(node: ReactNode, match: (el: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n as ReactNode, match, out);
    return out;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return out;
  if (match(node)) out.push(node);
  findAll(node.props.children as ReactNode, match, out);
  return out;
}

function text(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((n) => text(n as ReactNode)).join('');
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode);
  return '';
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const KEY = descriptionDraftKey('season', 's1');
const PROPS = { resourceType: 'season' as const, resourceId: 's1', initialValue: 'Saved rules' };

let storage: Map<string, string>;
const fetchMock = vi.fn();

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  router.refresh.mockReset();
  scope.openEditor = false;
  scope.falseSeen = 0;
  scope.trueAt = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openEditor(): ReactNode {
  scope.openEditor = true;
  scope.falseSeen = 0;
  const tree = capture(EditableDescription, PROPS);
  scope.openEditor = false;
  return tree;
}

function type(tree: ReactNode, value: string): void {
  const [area] = findAll(tree, (el) => el.type === 'textarea');
  (area.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
}

describe('EditableDescription unsaved draft', () => {
  it('keeps every keystroke in sessionStorage; typing back to the saved text drops it', () => {
    const tree = openEditor();
    type(tree, 'New house rules');
    expect(storage.get(KEY)).toBe('New house rules');
    type(tree, 'Saved rules');
    expect(storage.has(KEY)).toBe(false);
  });

  it('a later mount offers the draft back (Resume / Discard)', () => {
    storage.set(KEY, 'Half-written rules');
    const tree = capture(EditableDescription, PROPS);
    const status = findAll(tree, (el) => el.props.role === 'status');
    expect(status).toHaveLength(1);
    expect(text(status[0])).toContain('You have an unsaved description draft.');
    expect(text(status[0])).toContain('Resume editing');
    expect(text(status[0])).toContain('Discard draft');
  });

  it('no notice when there is no draft or it equals the saved text', () => {
    expect(findAll(capture(EditableDescription, PROPS), (el) => el.props.role === 'status')).toHaveLength(0);
    storage.set(KEY, 'Saved rules');
    expect(findAll(capture(EditableDescription, PROPS), (el) => el.props.role === 'status')).toHaveLength(0);
  });

  it('Discard drops the stored draft', () => {
    storage.set(KEY, 'Half-written rules');
    const tree = capture(EditableDescription, PROPS);
    const discard = findAll(tree, (el) => text(el) === 'Discard draft' && typeof el.props.onClick === 'function');
    (discard[0].props.onClick as () => void)();
    expect(storage.has(KEY)).toBe(false);
  });

  it('a successful save drops the draft; a failed save keeps it', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Forbidden', code: 'forbidden' }) });
    storage.set(KEY, 'Draft text');
    let tree = openEditor();
    let save = findAll(tree, (el) => 'loading' in el.props)[0];
    await (save.props.onClick as () => Promise<void>)();
    await settle();
    expect(storage.get(KEY)).toBe('Draft text');
    expect(router.refresh).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    tree = openEditor();
    save = findAll(tree, (el) => 'loading' in el.props)[0];
    await (save.props.onClick as () => Promise<void>)();
    await settle();
    expect(storage.has(KEY)).toBe(false);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('"Edit" with an offered draft opens the draft (seeded through descriptionEditSeed), not the saved text', () => {
    storage.set(KEY, 'Half-written rules');
    const tree = capture(EditableDescription, PROPS);
    const edit = findAll(tree, (el) => el.type === 'button' && text(el) === 'Edit description');
    expect(edit).toHaveLength(1);
    expect(String(edit[0].props.className)).toContain('min-h-11');
    // Clicking it runs the state setters only; the seed rule itself is unit-tested in description-draft.test.ts.
    expect(() => (edit[0].props.onClick as () => void)()).not.toThrow();
    expect(storage.get(KEY)).toBe('Half-written rules');
  });

  it('a keystroke the browser cannot store shows a notice instead of failing silently', () => {
    const quiet = openEditor();
    expect(findAll(quiet, (el) => el.props.role === 'status')).toHaveLength(0);
    // `draftNotKept` (the third useState(false)) set, as a failed write sets it.
    scope.trueAt = [2];
    const tree = openEditor();
    const status = findAll(tree, (el) => el.props.role === 'status');
    expect(status).toHaveLength(1);
    expect(text(status[0])).toContain('This browser cannot keep an unsaved draft');
  });

  it('Resume / Discard and the editor buttons are 44 px tall on phones', () => {
    storage.set(KEY, 'Half-written rules');
    const notice = capture(EditableDescription, PROPS);
    for (const label of ['Resume editing', 'Discard draft']) {
      const [button] = findAll(notice, (el) => text(el) === label && typeof el.props.onClick === 'function');
      expect(String(button.props.className), label).toContain('min-h-11');
    }
    const editor = openEditor();
    for (const label of ['Save', 'Cancel']) {
      const [button] = findAll(editor, (el) => text(el) === label && typeof el.props.onClick === 'function');
      expect(String(button.props.className), label).toContain('min-h-11');
    }
  });

  it('Cancel drops the draft', () => {
    storage.set(KEY, 'Draft text');
    const tree = openEditor();
    const cancel = findAll(tree, (el) => text(el) === 'Cancel' && typeof el.props.onClick === 'function');
    (cancel[0].props.onClick as () => void)();
    expect(storage.has(KEY)).toBe(false);
  });
});
