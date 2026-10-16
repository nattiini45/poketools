/**
 * Every POST /api/matches/[id]/social-image stores the card under a NEW
 * immutable URL (matches/<matchId>/<uuid>.png). After a successful upload the
 * button must re-render the page with router.refresh(), or the page keeps the
 * old URL (or none) and the label falls back to 'Create Social Image'.
 * A failed upload refreshes nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const capture = vi.hoisted(() => ({ fn: vi.fn(async () => 'data:image/png;base64,AAAA') }));

// The admin's UI and Pokémon-name languages (English viewer by default).
const viewer = vi.hoisted(() => ({ locale: 'en' as 'en' | 'de', dataLocale: 'en' as 'en' | 'de' }));

const palette = vi.hoisted(() => ({
  withDefault: vi.fn(async <T,>(task: () => Promise<T>) => task()),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/utils/capture-node', () => ({ captureNodeAsDataUrl: capture.fn }));
// The stored card is captured in the default palette (node env: no document).
vi.mock('@/lib/design/site-palette-store', () => ({ withDefaultSitePalette: palette.withDefault }));
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
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});
// The i18n hooks read React context, which needs a renderer: stub them (`viewer`).
vi.mock('@/i18n/client', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    I18nProvider: ({ children }: { children: ReactNode }) => children,
    useLocale: () => viewer.locale,
    useDataLocale: () => viewer.dataLocale,
    useRequestTime: () => 0,
    useT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});

import CreateSocialImageButton, { MOUNT_COPY_TIMEOUT_MS, socialCaptureTarget } from '../CreateSocialImageButton';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

type ClickHandler = () => Promise<void>;

/** Depth-first search for the <button>'s onClick. */
function findOnClick(node: ReactNode): ClickHandler | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findOnClick(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onClick?: ClickHandler; children?: ReactNode };
  if (node.type === 'button' && typeof props.onClick === 'function') return props.onClick;
  return findOnClick(props.children);
}

function click() {
  const tree = CreateSocialImageButton({ targetId: 'match-highlight-card', matchId: MATCH_ID, existingUrl: null });
  const handler = findOnClick(tree);
  if (!handler) throw new Error('button onClick not found');
  return handler();
}

describe('CreateSocialImageButton', () => {
  beforeEach(() => {
    router.refresh.mockClear();
    capture.fn.mockClear();
    palette.withDefault.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });

  afterEach(() => {
    viewer.locale = 'en';
    viewer.dataLocale = 'en';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refreshes the page after a 201 so the new immutable URL is shown', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { url: `https://example.supabase.co/storage/v1/object/public/social-images/matches/${MATCH_ID}/x.png` },
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await click();

    expect(palette.withDefault).toHaveBeenCalledTimes(1);
    expect(capture.fn).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/matches/${MATCH_ID}/social-image`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes nothing when the upload fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'nope' }), { status: 500 })),
    );

    await click();

    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('captures the on-screen card when the viewer reads the league language', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { url: 'x' } }), { status: 201 })),
    );
    const tree = CreateSocialImageButton({
      targetId: 'match-highlight-card',
      matchId: MATCH_ID,
      contentLocale: 'en',
      contentCard: 'copy',
      contentTargetId: 'match-social-highlight-card',
    });
    const handler = findOnClick(tree);
    if (!handler) throw new Error('button onClick not found');
    await handler();

    expect(capture.fn).toHaveBeenCalledWith('match-highlight-card');
  });

  it('captures via the content copy when the admin keeps Pokémon names in another language', async () => {
    // League 'de', UI 'de', Pokémon names 'en': the on-screen card shows English
    // names, so the stored PNG must not be captured from it.
    viewer.locale = 'de';
    viewer.dataLocale = 'en';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const getElementById = vi.fn(() => ({ offsetWidth: 640 }));
    vi.stubGlobal('document', { getElementById });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tree = CreateSocialImageButton({
      targetId: 'match-highlight-card',
      matchId: MATCH_ID,
      contentLocale: 'de',
      contentCard: 'copy',
      contentTargetId: 'match-social-highlight-card',
    });
    const handler = findOnClick(tree);
    if (!handler) throw new Error('button onClick not found');
    // The copy path measures the on-screen card, then waits for the copy to
    // mount (it never does here: setState is stubbed), so it times out.
    const done = handler();
    await vi.advanceTimersByTimeAsync(MOUNT_COPY_TIMEOUT_MS);
    await done;

    expect(getElementById).toHaveBeenCalledWith('match-highlight-card');
    expect(capture.fn).not.toHaveBeenCalledWith('match-highlight-card');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes nothing when the capture fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    capture.fn.mockRejectedValueOnce(new Error('capture failed'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await click();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('socialCaptureTarget (the stored image follows the league language, i18n-core §6.3)', () => {
  const base = { targetId: 'card', contentTargetId: 'copy-card', hasContentCard: true };

  it('captures the content-language copy when the viewer reads another language', () => {
    expect(socialCaptureTarget({ ...base, viewerLocale: 'en', contentLocale: 'de' })).toEqual({
      id: 'copy-card',
      viaCopy: true,
    });
  });

  it('captures the on-screen card when the languages match', () => {
    expect(socialCaptureTarget({ ...base, viewerLocale: 'de', contentLocale: 'de' })).toEqual({
      id: 'card',
      viaCopy: false,
    });
  });

  it('captures the copy when the UI matches but the Pokémon-name language differs', () => {
    expect(
      socialCaptureTarget({ ...base, viewerLocale: 'de', viewerDataLocale: 'en', contentLocale: 'de' }),
    ).toEqual({ id: 'copy-card', viaCopy: true });
  });

  it('captures the on-screen card when UI and Pokémon-name languages both match', () => {
    expect(
      socialCaptureTarget({ ...base, viewerLocale: 'de', viewerDataLocale: 'de', contentLocale: 'de' }).viaCopy,
    ).toBe(false);
  });

  it('captures the on-screen card without a content locale or without a copy', () => {
    expect(socialCaptureTarget({ ...base, viewerLocale: 'en' }).viaCopy).toBe(false);
    expect(socialCaptureTarget({ ...base, viewerLocale: 'en', contentLocale: 'de', hasContentCard: false }).viaCopy).toBe(false);
    expect(
      socialCaptureTarget({ ...base, viewerLocale: 'en', contentLocale: 'de', contentTargetId: undefined }).viaCopy,
    ).toBe(false);
  });
});
