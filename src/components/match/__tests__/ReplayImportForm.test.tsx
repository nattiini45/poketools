/**
 * The admin replay import records exactly the side mapping and winner on screen. While a
 * (re-)parse is in flight the old preview must not be importable or swappable, and a parse
 * response that is no longer the latest one must not replace the preview (PR #12 review).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

// A tiny hook store: the component is called as a plain function, and state and refs persist
// across calls by hook order, like a renderer would keep them.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const set = (next: T | ((prev: T) => T)) => {
        hooks.slots[i] = typeof next === 'function' ? (next as (prev: T) => T)(hooks.slots[i] as T) : next;
      };
      return [hooks.slots[i] as T, set];
    },
    useRef: <T,>(initial: T) => {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
      return hooks.slots[i] as { current: T };
    },
    useEffect: () => undefined,
  };
});
vi.mock('@/i18n/client', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    useDataLocale: () => 'en',
    useT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('@/i18n/use-api-error', () => ({ useApiErrorText: () => () => 'api error' }));

import ReplayImportForm from '../ReplayImportForm';
import Button from '@/components/ui/Button';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const PLAYERS: [{ id: string; name: string }, { id: string; name: string }] = [
  { id: 'p1', name: 'Mara' },
  { id: 'p2', name: 'Cilan' },
];
const URL_A = 'https://replay.pokemonshowdown.com/gen9-a';

function render(): ReactElement {
  hooks.index = 0;
  return ReplayImportForm({ matchId: MATCH_ID, players: PLAYERS, initialReplayUrl: URL_A }) as ReactElement;
}

function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => collect(child, out));
  else if (isValidElement(node)) {
    out.push(node);
    collect((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

type Props = Record<string, unknown> & { onSubmit?: (e: unknown) => Promise<void>; onClick?: () => void };
const event = { preventDefault: () => undefined };

const forms = () => collect(render()).filter((el) => el.type === 'form').map((el) => el.props as Props);
const buttons = () => collect(render()).filter((el) => el.type === Button).map((el) => el.props as Props);
const parse = () => forms()[0].onSubmit!(event);
const submitImport = () => forms()[1].onSubmit!(event);
const swapButton = () => buttons().find((b) => b.type === 'button')!;
const importButton = () => buttons().find((b) => b.variant === 'primary')!;
const text = () => JSON.stringify(collect(render()).map((el) => (el.props as { children?: unknown }).children));

/** A preview where `winner` won and the suggestions map side 0 to `side0Player`. */
function preview(winner: string, side0Player: 'p1' | 'p2', hash: string) {
  return {
    success: true,
    data: {
      parsed: {
        players: [
          { ps_username: 'alpha', pokemon: [] },
          { ps_username: 'bravo', pokemon: [] },
        ],
      },
      winner_ps_username: winner,
      suggestions: [{ suggested_player_id: side0Player }, { suggested_player_id: side0Player === 'p1' ? 'p2' : 'p1' }],
      replay_hash: hash,
    },
  };
}

/** A fetch whose replay-preview responses resolve only when the test says so. */
function deferredFetch() {
  const pending: Array<(body: unknown) => void> = [];
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    if (url.endsWith('/replay-preview')) {
      return new Promise((resolve) => {
        pending.push((body) => resolve(new Response(JSON.stringify(body))));
      });
    }
    return Promise.resolve(new Response(JSON.stringify({ success: true, data: { bo_reached: false } })));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, pending };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ReplayImportForm parse/import race', () => {
  beforeEach(() => {
    hooks.slots = [];
    router.refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cannot import or swap the old preview while a re-parse is in flight', async () => {
    const { fetchMock, pending } = deferredFetch();

    const first = parse();
    pending[0](preview('alpha', 'p1', 'hash-a'));
    await first;
    expect(importButton().disabled).toBe(false);
    expect(swapButton().disabled).toBe(false);

    const reparse = parse();
    expect(importButton().disabled).toBe(true);
    expect(swapButton().disabled).toBe(true);

    await submitImport();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/replay-import'))).toHaveLength(0);

    pending[1](preview('alpha', 'p1', 'hash-a'));
    await reparse;
    expect(importButton().disabled).toBe(false);
  });

  it('keeps the latest preview when an older parse response arrives late', async () => {
    const { fetchMock, pending } = deferredFetch();

    const older = parse();
    const newer = parse();
    // The newer replay: side 0 (alpha) is Cilan and alpha won.
    pending[1](preview('alpha', 'p2', 'hash-new'));
    await newer;
    // The older one lands afterwards with the opposite mapping and winner.
    pending[0](preview('bravo', 'p1', 'hash-old'));
    await older;
    await flush();

    expect(text()).toContain('Winner (from the replay): Cilan');
    await submitImport();
    const importCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/replay-import'));
    expect(importCall).toBeDefined();
    const body = JSON.parse(importCall![1]!.body as string);
    expect(body).toEqual({ replay_url: URL_A, replay_hash: 'hash-new', side_player_ids: ['p2', 'p1'] });
  });

  it('starts no parse while an import is submitting', async () => {
    const { fetchMock, pending } = deferredFetch();

    const first = parse();
    pending[0](preview('alpha', 'p1', 'hash-a'));
    await first;

    const submitting = submitImport();
    void parse();
    await submitting;
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/replay-preview'))).toHaveLength(1);
  });
});
