/**
 * DraftPoolManager (plain `draft` seasons, legacy engine): the request body must
 * survive `draftPoolCreateSchema`, which `POST /api/drafts` parses and which
 * strips unknown keys. The form used to send `point_budget`, so auction/budget
 * pools always failed with POINT_BUDGET_REQUIRED.
 *
 * Tests run in node with static markup: `Button` records its props, and its
 * `onClick` is called after the render (setState after a server render is a
 * no-op). `Target` runs the component body inside `scope`, and only there does
 * the `react` mock step in: the pick order, pricing (draft type) and budget start
 * from `form` (a static render cannot click the option cards), the `null`-initial create
 * error is seeded by `scope.errorSeed` with each set recorded, and the first
 * `false`-initial state is `loading` (declared before `priceFieldShown`),
 * each set recorded. Hooks of anything the component renders run outside the
 * scope.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { draftPoolCreateSchema } from '@/lib/validation';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const form = vi.hoisted(() => ({ pickOrder: 'snake', draftType: 'snake', budget: '100', snakeCalls: 0 }));
const buttons = vi.hoisted(() => [] as { onClick?: () => Promise<void>; disabled?: boolean }[]);
const scope = vi.hoisted(() => ({
  active: false,
  falseStates: 0,
  errorSeed: null as unknown,
  errorSets: [] as unknown[],
  loadingSets: [] as unknown[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/ui/Button', () => ({
  default: (props: { onClick?: () => Promise<void>; disabled?: boolean; children?: ReactNode }) => {
    buttons.push(props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  /** The point-budget field's initial state, `{ value: '100', badInput: false }`. */
  const isBudgetField = (v: unknown) =>
    typeof v === 'object' && v !== null && 'badInput' in v && (v as { value?: unknown }).value === '100';
  const useState = <T,>(initial: T | (() => T)) => {
    const [value, set] = actual.useState(initial);
    if (!scope.active) return [value, set] as const;
    // Two states start at 'snake', always in this order per render: the pick order, then the pricing.
    if (initial === 'snake') return [(form.snakeCalls++ % 2 === 0 ? form.pickOrder : form.draftType) as T, set] as const;
    if (isBudgetField(initial)) return [{ value: form.budget, badInput: false } as T, set] as const;
    if (initial === false && scope.falseStates++ === 0) {
      const record = (next: unknown) => {
        scope.loadingSets.push(next);
        (set as (v: unknown) => void)(next);
      };
      return [value, record] as const;
    }
    if (initial === null) {
      const record = (next: unknown) => {
        scope.errorSets.push(next);
        (set as (v: unknown) => void)(next);
      };
      return [(scope.errorSeed ?? value) as T, record] as const;
    }
    return [value, set] as const;
  };
  return { ...actual, default: { ...actual, useState }, useState };
});

const { default: DraftPoolManager } = await import('../DraftPoolManager');

/** Runs the component body inside the interception scope; what it renders runs outside it. */
function Target(props: Parameters<typeof DraftPoolManager>[0]) {
  scope.active = true;
  scope.falseStates = 0;
  try {
    return DraftPoolManager(props);
  } finally {
    scope.active = false;
  }
}

const SEASON = '00000000-0000-4000-a000-000000000001';
const fetchMock = vi.fn();
const element = <Target seasonId={SEASON} seasonName="Season 3" />;

/** The text of the `role="alert"` line, or null when there is none. */
function alertText(html: string): string | null {
  return /<p role="alert"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
}

/** Renders the form and clicks Create; returns the parsed JSON body (or null when nothing was sent). */
async function create(): Promise<Record<string, unknown> | null> {
  buttons.length = 0;
  renderToStaticMarkup(element);
  const [createButton] = buttons;
  await createButton.onClick?.();
  if (fetchMock.mock.calls.length === 0) return null;
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/drafts');
  expect(init.method).toBe('POST');
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  form.pickOrder = 'snake';
  form.draftType = 'snake';
  form.snakeCalls = 0;
  form.budget = '100';
  scope.errorSeed = null;
  scope.errorSets.length = 0;
  scope.loadingSets.length = 0;
  router.refresh.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ success: true, data: { id: 'pool-1' } }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DraftPoolManager request body', () => {
  it('auction: sends the budget as `budget` and forces free order, whatever order was chosen', async () => {
    form.draftType = 'auction';
    form.budget = '120';
    const body = await create();

    expect(body).toEqual({ season_id: SEASON, draft_type: 'auction', pick_order: 'free', budget: 120 });
    expect(body).not.toHaveProperty('point_budget');
    expect(draftPoolCreateSchema.parse(body)).toEqual({ season_id: SEASON, draft_type: 'auction', pick_order: 'free', budget: 120 });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('fixed costs in snake order: the setup that was impossible before the split', async () => {
    form.draftType = 'budget';
    form.budget = '90';
    const body = await create();
    expect(draftPoolCreateSchema.parse(body)).toEqual({ season_id: SEASON, draft_type: 'budget', pick_order: 'snake', budget: 90 });
  });

  it('fixed costs in free order (the old budget draft)', async () => {
    form.pickOrder = 'free';
    form.draftType = 'budget';
    expect(await create()).toEqual({ season_id: SEASON, draft_type: 'budget', pick_order: 'free', budget: 100 });
  });

  it('no points: sends no budget; linear order is kept', async () => {
    expect(await create()).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'snake' });
    fetchMock.mockClear();
    form.pickOrder = 'linear';
    const body = await create();
    expect(body).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'linear' });
    expect(draftPoolCreateSchema.parse(body)).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'linear' });
  });

  it.each(['0', '2.5', '', '100001'])('refuses the budget %j (whole number from 1 to the route maximum)', async (value) => {
    form.draftType = 'budget';
    form.budget = value;
    expect(await create()).toBeNull();
    expect(buttons[0].disabled).toBe(true);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(scope.loadingSets).toEqual([]);
  });

  it('accepts the route maximum', async () => {
    form.draftType = 'auction';
    form.budget = String(LEGACY_POINTS_MAX);
    expect(draftPoolCreateSchema.parse(await create())).toMatchObject({ budget: LEGACY_POINTS_MAX });
  });

  it('both number fields ask for the numeric keyboard (as InstanceConfigForm does)', () => {
    form.draftType = 'budget';
    const html = renderToStaticMarkup(element);
    expect(html.match(/<input[^>]*type="number"[^>]*>/g)).toHaveLength(2);
    expect(html.match(/<input[^>]*inputmode="numeric"[^>]*>/gi)).toHaveLength(2);
  });

  it('names the allowed range in the error, in English and German', () => {
    form.draftType = 'budget';
    form.budget = '0';
    expect(renderToStaticMarkup(element)).toContain('Enter a whole number from 1 to 100,000.');
    expect(renderWithI18n(element, { locale: 'de' })).toContain('Gib eine ganze Zahl von 1 bis 100.000 ein.');
  });
});

describe('DraftPoolManager create outcomes', () => {
  it('a 2xx reply with an unreadable body refreshes and sets no error: the pool exists', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    expect(await create()).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'snake' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(scope.errorSets).toEqual([null]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('a request that never reaches the server sets network_error and does not refresh', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await create()).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'snake' });
    expect(router.refresh).not.toHaveBeenCalled();
    expect(scope.errorSets).toEqual([null, { kind: 'api', error: { code: 'network_error' } }]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('a refusal sets the API error and does not refresh', async () => {
    const refusal = { success: false, error: 'This season already has a draft pool', code: 'POOL_EXISTS' };
    fetchMock.mockResolvedValue({ ok: false, json: async () => refusal });
    await create();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(scope.errorSets).toEqual([null, { kind: 'api', error: { error: refusal.error, code: 'POOL_EXISTS' } }]);
    expect(scope.loadingSets).toEqual([true, false]);
  });

  it('an unreadable error reply sets `unreadable` and does not refresh', async () => {
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
});

describe('DraftPoolManager error line', () => {
  it('no error, no alert', () => {
    expect(alertText(renderToStaticMarkup(element))).toBeNull();
  });

  it('shows the API refusal, in English and by code in German', () => {
    scope.errorSeed = { kind: 'api', error: { error: 'This season already has a draft pool', code: 'POOL_EXISTS' } };
    expect(alertText(renderToStaticMarkup(element))).toBe('This season already has a draft pool');
    expect(alertText(renderWithI18n(element, { locale: 'de' }))).toBe('Für diese Saison gibt es bereits einen Draft dieser Art.');
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
    expect(alertText(renderToStaticMarkup(element))).toBe('Failed to create draft pool');
    expect(alertText(renderWithI18n(element, { locale: 'de' }))).toBe('Der Draft-Pool konnte nicht erstellt werden.');
  });
});

/** Text content of the element carrying `id="<id>"` in static markup ('' when there is none). */
function textOfId(html: string, id: string | undefined): string {
  const at = id === undefined ? -1 : html.indexOf(`id="${id}"`);
  if (at < 0) return '';
  // React separates adjacent text nodes with `<!-- -->`: skipped, like any comment.
  const token = /<!--[\s\S]*?-->|<(\/?)[a-z][a-z0-9]*[^>]*?(\/?)>|([^<]+)/gi;
  token.lastIndex = html.lastIndexOf('<', at);
  let depth = 0;
  let text = '';
  for (let m = token.exec(html); m; m = token.exec(html)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[3] !== undefined) text += m[3];
    else if (m[2] !== '/') depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) break;
  }
  return text;
}

/** The toggles of the group labelled `heading`: [name text, description text, pressed, disabled][]. */
function groupToggles(html: string, heading: string) {
  const groups = [...html.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  const id = groups.find((g) => textOfId(html, g) === heading);
  if (!id) throw new Error(`no group labelled ${heading}`);
  const prefix = id.replace(/-heading$/, '');
  return [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`aria-labelledby="${prefix}-`))
    .map((tag) => [
      textOfId(html, /aria-labelledby="([^"]+)"/.exec(tag)?.[1]),
      textOfId(html, /aria-describedby="([^"]+)"/.exec(tag)?.[1]),
      tag.includes('aria-pressed="true"'),
      /\sdisabled=""/.test(tag),
    ]);
}

describe('DraftPoolManager option groups', () => {
  it('step 1 is the draft order, step 2 the pricing; each toggle is named by its option and described by its line', () => {
    const html = renderToStaticMarkup(element);
    expect(groupToggles(html, '1. Draft order')).toEqual([
      ['Snake', 'Participant order, reversed every round: 1-2-3, then 3-2-1.', true, false],
      ['Same order every round', 'Participant order every round: 1-2-3, then 1-2-3.', false, false],
      ['Free order', 'No turns. Players pick any time, admins enter picks for them.', false, false],
    ]);
    expect(groupToggles(html, '2. Pricing')).toEqual([
      ['No points', 'Picks cost no points. Only tier limits apply.', true, false],
      ['Fixed prices', 'Each Pokémon costs its pool price, paid from the player’s budget.', false, false],
      ['Auction bids', 'Players bid from their budget; the pool price is the minimum bid. Always Free order.', false, false],
    ]);
    expect(html).toContain('Creates: Snake, No points.');
    // No block-level elements inside a button (phrasing content only).
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<(div|dl|dt|dd|p)[\s>]/s);
  });

  it('auction pricing forces Free order, disables the others and says why', () => {
    form.draftType = 'auction';
    form.budget = '150';
    const html = renderToStaticMarkup(element);
    expect(groupToggles(html, '1. Draft order').map(([name, , pressed, disabled]) => [name, pressed, disabled])).toEqual([
      ['Snake', false, true],
      ['Same order every round', false, true],
      ['Free order', true, false],
    ]);
    expect(html).toContain('Auctions use Free order: the winning bidder gets the pick, not whoever is up.');
    // The disabled cards are described by that reason too (screen readers hear why).
    const snakeTag = [...html.matchAll(/<button[^>]*disabled=""[^>]*>/g)].map((m) => m[0])[0];
    const described = /aria-describedby="([^"]+)"/.exec(snakeTag)?.[1].split(' ') ?? [];
    expect(described.map((id) => textOfId(html, id))).toContain(
      'Auctions use Free order: the winning bidder gets the pick, not whoever is up.',
    );
    expect(html).toContain('Creates: Free order, Auction bids, 150 points per player.');
  });

  it('summarises fixed prices in snake order with the budget (English and German)', () => {
    form.draftType = 'budget';
    form.budget = '90';
    expect(renderToStaticMarkup(element)).toContain('Creates: Snake, Fixed prices, 90 points per player.');
    form.snakeCalls = 0;
    const de = renderWithI18n(element, { locale: 'de' });
    expect(de).toContain('1. Draft-Reihenfolge');
    expect(de).not.toContain('Pick-Reihenfolge');
    expect(de).toContain('Du erstellst: Snake, Feste Preise, 90 Punkte pro Spieler.');
  });
});
