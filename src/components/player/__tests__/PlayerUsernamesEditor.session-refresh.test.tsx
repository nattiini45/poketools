/**
 * D37: after a successful usernames PATCH the editor forces the session to
 * re-read the player BEFORE router.refresh(), or server renders keep the old
 * usernames for up to the 5-minute session TTL. A failed PATCH refreshes
 * nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

const calls = vi.hoisted(() => ({ order: [] as string[] }));
const refresh = vi.hoisted(() => ({
  fn: vi.fn(async () => {
    calls.order.push('session');
    return true;
  }),
}));
const router = vi.hoisted(() => ({
  refresh: vi.fn(() => {
    calls.order.push('router');
  }),
}));

vi.mock('@/components/shared/SessionProvider', () => ({ useRefreshSessionPlayer: () => refresh.fn }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// The component is called as a plain function (no renderer, so no context):
// the i18n hooks are replaced by their pure, English equivalents.
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
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      () => undefined,
    ],
    useCallback: <T,>(fn: T) => fn,
  };
});

import PlayerUsernamesEditor from '../PlayerUsernamesEditor';

type SubmitHandler = (event: { preventDefault: () => void }) => Promise<void>;

/** Depth-first search for the <form>'s onSubmit. */
function findOnSubmit(node: ReactNode): SubmitHandler | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findOnSubmit(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onSubmit?: SubmitHandler; children?: ReactNode };
  if (node.type === 'form' && typeof props.onSubmit === 'function') return props.onSubmit;
  return findOnSubmit(props.children);
}

function submit() {
  const tree = PlayerUsernamesEditor({ playerId: 'p1', initialPlayer: null });
  const handler = findOnSubmit(tree);
  if (!handler) throw new Error('form onSubmit not found');
  return handler({ preventDefault: () => undefined });
}

describe('PlayerUsernamesEditor submit', () => {
  beforeEach(() => {
    calls.order = [];
    refresh.fn.mockClear();
    router.refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-reads the session player before router.refresh() after a successful save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })),
    );
    await submit();
    expect(calls.order).toEqual(['session', 'router']);
  });

  it('refreshes nothing when the PATCH fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'nope' }), { status: 400 })),
    );
    await submit();
    expect(refresh.fn).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
