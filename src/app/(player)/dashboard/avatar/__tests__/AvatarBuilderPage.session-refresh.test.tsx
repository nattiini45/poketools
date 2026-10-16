/**
 * D37: the session re-reads its player at most every 5 minutes, so an avatar
 * save must force the re-read BEFORE navigating, or the dashboard and the
 * NavBar keep the old avatar_url (whose Storage object is already deleted).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

const refresh = vi.hoisted(() => ({ fn: vi.fn<() => Promise<boolean>>() }));

vi.mock('@/components/shared/SessionProvider', () => ({ useRefreshSessionPlayer: () => refresh.fn }));
vi.mock('@/components/avatar/AvatarBuilder', () => ({ default: () => null }));
vi.mock('@/components/player/PlayerUsernamesEditor', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
// Called as a plain function (no renderer, so no context): useT is replaced by its pure, English equivalent.
vi.mock('@/i18n/client', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { useT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});

import AvatarBuilderPage from '../AvatarBuilderPage';

/** Depth-first search of an element tree for the first props.onSaved. */
function findOnSaved(node: ReactNode): (() => unknown) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findOnSaved(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onSaved?: () => unknown; children?: ReactNode };
  if (typeof props.onSaved === 'function') return props.onSaved;
  return findOnSaved(props.children);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('AvatarBuilderPage onSaved', () => {
  const location = { href: '' };

  beforeEach(() => {
    location.href = '';
    vi.stubGlobal('window', { location });
    refresh.fn.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const onSaved = () => {
    const tree = AvatarBuilderPage({ playerId: 'p1', initialConfig: null, initialPlayer: null });
    const handler = findOnSaved(tree);
    if (!handler) throw new Error('AvatarBuilder onSaved not found');
    return handler;
  };

  it('awaits the session refresh before the hard navigation', async () => {
    const gate = deferred<boolean>();
    refresh.fn.mockReturnValue(gate.promise);

    const done = onSaved()();
    await Promise.resolve();
    expect(refresh.fn).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('');

    gate.resolve(true);
    await done;
    expect(location.href).toBe('/dashboard');
  });

  it('still navigates when every refresh attempt failed', async () => {
    refresh.fn.mockResolvedValue(false);
    await onSaved()();
    expect(location.href).toBe('/dashboard');
  });
});
