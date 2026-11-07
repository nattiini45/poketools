/**
 * Fixtures and response builders of the admin island tests. The islands call the real request layer, so the tests stub
 * `fetch` and assert the URL, method and body that went out and the words that came back.
 */
import type {
  AdjustmentTargets,
  AdjustmentView,
  AdminActionView,
  AdminRelationView,
  ChallengeView,
  CheckView,
} from '@/lib/format-engine/runtime/view-types';
import type { LText } from '@/lib/studio-core/ltext';

export const SEASON = '5e150000-0000-4000-8000-000000000001';
export const MARA = 'b0000000-0000-4000-8000-000000000001';
export const MISTY = 'b0000000-0000-4000-8000-000000000002';
export const BROCK = 'b0000000-0000-4000-8000-000000000003';
export const MATCH = 'e0000000-0000-4000-8000-000000000001';

export const NAMES = { [MARA]: 'Mara', [MISTY]: 'Misty', [BROCK]: 'Brock' } as const;

export const text = (value: string): LText => ({ base: 'en', en: { v: value, s: 'human' } });

/** The success envelope of every route. */
export function okResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * A failed route: `{ error, code, params }`. `error` is the server's English text; an English UI shows it, any other
 * language looks the code up in the catalogs.
 */
export function failResponse(status: number, code: string, error: string, params?: Record<string, string | number>): Response {
  return new Response(JSON.stringify({ success: false, error, code, ...(params ? { params } : {}) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The method, URL and parsed body of the nth call of a `fetch` mock. */
export function sent(fetchMock: { mock: { calls: unknown[][] } }, n = 0): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit | undefined];
  return {
    url,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

export function check(overrides: Partial<CheckView> = {}): CheckView {
  return {
    id: 'f0000000-0000-4000-8000-000000000001',
    source: 'standings_tie',
    rule_id: 'tie_rule',
    rule_label: null,
    subject: { stage: 'cup', players: [MARA, MISTY], tie_group: 1 },
    state: 'open',
    note: null,
    opened_at: '2026-11-01T10:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

export const TARGETS: AdjustmentTargets = {
  stages: [
    { key: 'cup', label: text('Cup'), players: [{ id: MARA, name: 'Mara' }, { id: MISTY, name: 'Misty' }] },
    { key: 'side', label: text('Side event'), players: [{ id: BROCK, name: 'Brock' }] },
  ],
  players: [
    { id: MARA, name: 'Mara' },
    { id: MISTY, name: 'Misty' },
    { id: BROCK, name: 'Brock' },
  ],
  resources: [
    { key: 'gifts', label: text('Gifts'), holds_domain: 'pool', exclusive: true, items: ['pikachu', 'eevee'] },
    { key: 'coins', label: text('Coins'), holds_domain: null, exclusive: false, items: [] },
  ],
  relations: [{ key: 'santa', label: text('Secret Santa'), has_links: true }],
  actions: [{ id: 'gift', label: text('Gift') }],
};

export function adjustment(overrides: Partial<AdjustmentView> = {}): AdjustmentView {
  return {
    id: 'a1',
    kind: 'points',
    target: { stage: 'cup', player_id: MARA },
    delta: { points: 2.5 },
    reason: 'Penalty for a late team',
    admin: { id: BROCK, name: 'Brock' },
    created_at: '2026-11-02T09:00:00.000Z',
    ...overrides,
  };
}

export function actionView(overrides: Partial<AdminActionView> = {}): AdminActionView {
  return {
    id: 'gift',
    label: text('Gift'),
    window: 'open',
    lock: 'on_close',
    actors: 3,
    counts: { missing: 1, draft: 0, submitted: 2, locked: 0 },
    ...overrides,
  };
}

export function relationView(overrides: Partial<AdminRelationView> = {}): AdminRelationView {
  return {
    key: 'santa',
    label: text('Secret Santa'),
    shape: 'derangement',
    links: [],
    masked: true,
    link_count: 3,
    ...overrides,
  };
}

export function challengeView(overrides: Partial<ChallengeView> = {}): ChallengeView {
  return {
    id: 'c1',
    phase_id: 'p1',
    challenger: { id: MARA, name: 'Mara' },
    defender: { id: MISTY, name: 'Misty' },
    state: 'open',
    lapsed: false,
    round: 2,
    created_at: '2026-11-01T10:00:00.000Z',
    expires_at: '2999-01-01T00:00:00.000Z',
    responded_at: null,
    match_id: null,
    ...overrides,
  };
}
