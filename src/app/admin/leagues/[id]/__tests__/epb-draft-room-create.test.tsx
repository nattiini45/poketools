/**
 * EpbDraftRoomCreate: EPB seasons get a summary of what `draft_create_pool`
 * sets up (no draft-type picker), a live / slow choice and one button. The body is the queue shape with
 * `config: { mode, pick_seconds }` only, so the RPC still takes budget and roster size from the format rules.
 *
 * Node + static markup: `Button` records its props and its `onClick` is called
 * after the render (setState after a server render is a no-op). `Target` runs
 * the component body inside `scope`, and only there does the `react` mock step
 * in: the component's `false` state is `loading` (each set recorded), its
 * `null` state the create error (seeded by `scope.errorSeed`, each set
 * recorded), its `'live'` state the chosen mode (seeded by `scope.modeSeed`, standing in for a
 * pick in the select). Hooks of anything the component renders run outside the scope.
 * The request paths themselves are unit-tested in
 * `src/lib/draft-ui/__tests__/create-pool.test.ts`.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createQueueDraftSchema } from '@/lib/draft/schemas';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const buttons = vi.hoisted(() => [] as { onClick?: () => Promise<void>; loading?: boolean }[]);
const scope = vi.hoisted(() => ({
  active: false,
  errorSeed: null as unknown,
  modeSeed: null as 'live' | 'slow' | null,
  errorSets: [] as unknown[],
  loadingSets: [] as unknown[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/ui/Button', () => ({
  default: (props: { onClick?: () => Promise<void>; loading?: boolean; children?: ReactNode }) => {
    buttons.push(props);
    return <button>{props.children}</button>;
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = <T,>(initial: T | (() => T)) => {
    const [value, set] = actual.useState(initial);
    if (scope.active && initial === 'live' && scope.modeSeed !== null) return [scope.modeSeed as T, set] as const;
    if (!scope.active || (initial !== false && initial !== null)) return [value, set] as const;
    const sets = initial === false ? scope.loadingSets : scope.errorSets;
    const record = (next: unknown) => {
      sets.push(next);
      (set as (v: unknown) => void)(next);
    };
    const shown = initial === null && scope.errorSeed !== null ? scope.errorSeed : value;
    return [shown as T, record] as const;
  };
  return { ...actual, default: { ...actual, useState }, useState };
});

const { default: EpbDraftRoomCreate } = await import('../_components/EpbDraftRoomCreate');

/** Runs the component body inside the interception scope; what it renders runs outside it. */
function Target(props: Parameters<typeof EpbDraftRoomCreate>[0]) {
  scope.active = true;
  try {
    return EpbDraftRoomCreate(props);
  } finally {
    scope.active = false;
  }
}

const SEASON = '00000000-0000-4000-a000-000000000001';
const fetchMock = vi.fn();
const element = <Target seasonId={SEASON} budget={100} rosterSize={6} fromFormatRules />;

/** The text of the `role="alert"` line, or null when there is none. */
function alertText(html: string): string | null {
  return /<p role="alert"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
}

/** Renders the form and clicks Create. */
async function create(): Promise<void> {
  buttons.length = 0;
  renderToStaticMarkup(element);
  await buttons[0].onClick?.();
}

beforeEach(() => {
  buttons.length = 0;
  scope.errorSeed = null;
  scope.modeSeed = null;
  scope.errorSets.length = 0;
  scope.loadingSets.length = 0;
  router.refresh.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { pool_id: 'pool-1' } }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EpbDraftRoomCreate summary', () => {
  it('summarises the draft the RPC creates, with no draft-type picker', () => {
    const en = renderToStaticMarkup(element);
    expect(en).toContain('Draft order');
    expect(en).toContain('The opening order is drawn at random, then snake: round 2 runs in reverse. From round 3 on, the order is drawn again every two rounds; an odd last round runs forward.');
    expect(en).toContain('From the bound point-buy list.');
    expect(en).toContain('100 points per player (format rules).');
    expect(en).toContain('6 picks per player (format rules).');
    expect(en).toContain('Live draft, 5 minutes per pick.');
    // The live / slow choice, live selected by default.
    expect(en).toContain('Draft mode');
    expect(en).toMatch(/<option value="live" selected="">Live draft<\/option><option value="slow">Slow draft<\/option>/);
    expect(en).toContain('you can change the draft order, budget, roster size, mode and timers in the draft control panel');
    expect(en).toContain('Create Draft Room');
    expect(en).not.toMatch(/Auction|Budget Draft|Snake Draft|seat order|Pick order/);
    expect(alertText(en)).toBeNull();
    expect(buttons.at(-1)?.loading).toBe(false);
  });

  it('renders German with one term for the order', () => {
    const de = renderWithI18n(element, { locale: 'de' });
    expect(de).toContain('Draft-Reihenfolge');
    expect(de).toContain('kannst du Draft-Reihenfolge, Budget');
    expect(de).not.toMatch(/Platzreihenfolge|Pick-Reihenfolge/);
    expect(de).toContain('100 Punkte pro Spieler (Formatregeln).');
    expect(de).toContain('6 Picks pro Spieler (Formatregeln).');
    expect(de).toContain('Live-Draft, 5 Minuten pro Pick.');
    expect(de).toContain('Die Anfangsreihenfolge wird zufällig ausgelost, danach Snake');
    expect(de).toContain('Draft-Modus');
    expect(de).toContain('Draft-Raum erstellen');
  });

  it('a slow draft summarises the slow pick time instead of the live one', () => {
    scope.modeSeed = 'slow';
    const en = renderToStaticMarkup(element);
    expect(en).toContain('Slow draft, 12 hours per pick at first; every missed pick shortens it.');
    expect(en).not.toContain('Live draft, 5 minutes per pick.');
    expect(en).toMatch(/<option value="live">Live draft<\/option><option value="slow" selected="">Slow draft<\/option>/);
    expect(renderWithI18n(element, { locale: 'de' })).toContain(
      'Slow-Draft, anfangs 12 Stunden pro Pick; jeder verpasste Pick verkürzt die Zeit.',
    );
  });

  it('without a format rules row, names the numbers as defaults, not format rules', () => {
    const fallback = <Target seasonId={SEASON} budget={100} rosterSize={6} fromFormatRules={false} />;
    const en = renderToStaticMarkup(fallback);
    expect(en).toContain('100 points per player (default).');
    expect(en).toContain('6 picks per player (default).');
    expect(en).not.toContain('(format rules)');
    expect(renderWithI18n(fallback, { locale: 'de' })).toContain('100 Punkte pro Spieler (Standardwert).');
  });

  it('uses the singular for one pick', () => {
    expect(renderToStaticMarkup(<Target seasonId={SEASON} budget={50} rosterSize={1} fromFormatRules />)).toContain(
      '1 pick per player (format rules).',
    );
  });
});

describe('EpbDraftRoomCreate create', () => {
  it('posts the queue-engine initial pool as a live draft with the live pick time and refreshes the page', async () => {
    await create();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/drafts');
    const body: unknown = JSON.parse(String(init.body));
    expect(body).toEqual({ season_id: SEASON, kind: 'initial', config: { mode: 'live', pick_seconds: 300 } });
    // The route's strict queue schema accepts it as is.
    expect(createQueueDraftSchema.parse(body)).toEqual(body);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(scope.errorSets).toEqual([null]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('a slow draft posts mode slow with the 12 h slow pick time', async () => {
    scope.modeSeed = 'slow';
    await create();

    const body: unknown = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toEqual({ season_id: SEASON, kind: 'initial', config: { mode: 'slow', pick_seconds: 43_200 } });
    expect(createQueueDraftSchema.parse(body)).toEqual(body);
  });

  it("a league group's draft also names the group", async () => {
    const GROUP = '00000000-0000-4000-a000-0000000000a1';
    buttons.length = 0;
    renderToStaticMarkup(<Target seasonId={SEASON} budget={100} rosterSize={6} fromFormatRules seasonGroupId={GROUP} />);
    await buttons[0].onClick?.();

    const body: unknown = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toEqual({
      season_id: SEASON,
      kind: 'initial',
      season_group_id: GROUP,
      config: { mode: 'live', pick_seconds: 300 },
    });
  });

  it('a refusal sets the API error, re-enables the button and does not refresh', async () => {
    const refusal = { success: false, error: 'This league has no bound point-buy list.', code: 'SEASON_HAS_NO_LIST' };
    fetchMock.mockResolvedValue({ ok: false, json: async () => refusal });
    await create();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(scope.errorSets).toEqual([null, { kind: 'api', error: { error: refusal.error, code: 'SEASON_HAS_NO_LIST' } }]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('a request that never reached the server sets network_error and re-enables the button', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await create();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(scope.errorSets).toEqual([null, { kind: 'api', error: { code: 'network_error' } }]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('an unreadable error reply sets `unreadable` and re-enables the button', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    await create();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(scope.errorSets).toEqual([null, { kind: 'unreadable' }]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('a 2xx reply with an unreadable body still refreshes: the draft exists', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    await create();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(scope.errorSets).toEqual([null]);
    expect(scope.loadingSets).toEqual([true, false]);
  });
});

describe('EpbDraftRoomCreate error line', () => {
  it('shows the API refusal, in English and by code in German', () => {
    scope.errorSeed = {
      kind: 'api',
      error: { error: 'This league has no bound point-buy list.', code: 'SEASON_HAS_NO_LIST' },
    };
    expect(alertText(renderToStaticMarkup(element))).toBe('This league has no bound point-buy list.');
    expect(alertText(renderWithI18n(element, { locale: 'de' }))).toBe('Diese Liga hat keine verknüpfte Point-Buy-Liste.');
  });

  it('shows the network error text, in English and German', () => {
    scope.errorSeed = { kind: 'api', error: { code: 'network_error' } };
    expect(alertText(renderToStaticMarkup(element))).toBe('Network error. Check your connection and try again.');
    expect(alertText(renderWithI18n(element, { locale: 'de' }))).toBe(
      'Netzwerkfehler. Prüfe deine Verbindung und versuche es noch einmal.',
    );
  });

  it('shows the create-failed text for an unreadable error reply, in English and German', () => {
    scope.errorSeed = { kind: 'unreadable' };
    expect(alertText(renderToStaticMarkup(element))).toBe('Failed to create the Draft Room');
    expect(alertText(renderWithI18n(element, { locale: 'de' }))).toBe('Der Draft-Raum konnte nicht erstellt werden.');
  });
});
