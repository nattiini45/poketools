/**
 * The league-admin settings controls (test flag, 3D theme, content language,
 * description) refresh the route after a successful save, so the server props
 * they follow (`useServerSyncedState`) carry the persisted value. After a failed
 * save the theme, language and description do not refresh; the test flag does
 * (the request may have died after the flag was saved, so the checkbox must
 * show the stored value).
 *
 * Node + static markup (no DOM): `capture` runs the component body inside a
 * server render, keeps the element tree it returned and calls the change/save
 * handler from that tree. setState after a server render is a no-op, so only the
 * requests and `router.refresh()` are observed. For the description the `react`
 * mock opens the editor (`scope.openEditor` turns the first `useState(false)`,
 * `editing`, into `true`) so the Save button's handler is reachable.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const scope = vi.hoisted(() => ({ openEditor: false, falseSeen: 0 }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = <T,>(initial: T | (() => T)) => {
    if (scope.openEditor && initial === false && scope.falseSeen++ === 0) {
      return actual.useState(true as T);
    }
    return actual.useState(initial);
  };
  return { ...actual, default: { ...actual, useState }, useState };
});

const { default: LeagueTestFlagControl } = await import('../LeagueTestFlagControl');
const { default: LeagueThemeControl } = await import('../LeagueThemeControl');
const { default: ContentLanguageControl } = await import(
  '@/app/admin/leagues/[id]/_components/ContentLanguageControl'
);
const { default: EditableDescription } = await import('@/components/shared/EditableDescription');

type El = ReactElement<Record<string, unknown>>;

/** Renders `Component` on the server and returns the element tree its body returned. */
function capture<P extends object>(Component: (props: P) => ReactNode, props: P): ReactNode {
  let tree: ReactNode = null;
  function Probe() {
    tree = Component(props);
    return tree;
  }
  renderToStaticMarkup(<Probe />);
  return tree;
}

function find(node: ReactNode, match: (el: El) => boolean): El | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n as ReactNode, match);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (match(node)) return node;
  return find(node.props.children as ReactNode, match);
}

/** Lets every pending promise of a fire-and-forget handler settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const fetchMock = vi.fn();
const ok = () => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
const fail = () =>
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ success: false, error: 'Forbidden', code: 'forbidden' }),
  });

function lastBody(): unknown {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  router.refresh.mockReset();
  scope.openEditor = false;
  scope.falseSeen = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function toggleTestFlag(next: boolean): Promise<void> {
  const tree = capture(LeagueTestFlagControl, { seasonId: 's1', isTestSeason: !next });
  const input = find(tree, (el) => el.type === 'input');
  const onChange = input?.props.onChange as (e: { target: { checked: boolean } }) => unknown;
  await onChange({ target: { checked: next } });
  await settle();
}

async function pickTheme(next: string): Promise<void> {
  const tree = capture(LeagueThemeControl, { seasonId: 's1', currentTheme: 'auto' });
  const select = find(tree, (el) => typeof el.props.onChange === 'function');
  const onChange = select?.props.onChange as (e: { target: { value: string } }) => unknown;
  await onChange({ target: { value: next } });
  await settle();
}

async function pickLanguage(next: string): Promise<void> {
  const tree = capture(ContentLanguageControl, { seasonId: 's1', currentLanguage: 'de' });
  const select = find(tree, (el) => typeof el.props.onChange === 'function');
  const onChange = select?.props.onChange as (e: { target: { value: string } }) => unknown;
  onChange({ target: { value: next } });
  await settle();
}

async function saveDescription(): Promise<void> {
  scope.openEditor = true;
  const tree = capture(EditableDescription, { resourceType: 'season', resourceId: 's1', initialValue: 'Old text' });
  scope.openEditor = false;
  const save = find(tree, (el) => 'loading' in el.props);
  await (save?.props.onClick as () => Promise<void>)();
  await settle();
}

describe('admin settings controls refresh after a successful save', () => {
  it('test-league flag', async () => {
    ok();
    await toggleTestFlag(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/seasons/s1', expect.objectContaining({ method: 'PATCH' }));
    expect(lastBody()).toEqual({ is_test_season: true });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('3D world theme', async () => {
    ok();
    await pickTheme('sakura');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody()).toEqual({ route_theme: 'sakura' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('content language', async () => {
    ok();
    await pickLanguage('en');
    expect(lastBody()).toEqual({ language: 'en' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('description', async () => {
    ok();
    await saveDescription();
    expect(lastBody()).toEqual({ description: 'Old text' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the test-league flag refreshes after a failed save too', () => {
  it('when the route answered with an error', async () => {
    fail();
    await toggleTestFlag(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('when no answer arrived (network error)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await toggleTestFlag(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('when the answer was not JSON (a gateway 504)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    await toggleTestFlag(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('admin settings controls do not refresh after a failed save', () => {
  it('3D world theme', async () => {
    fail();
    await pickTheme('sakura');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('content language', async () => {
    fail();
    await pickLanguage('en');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('description', async () => {
    fail();
    await saveDescription();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
