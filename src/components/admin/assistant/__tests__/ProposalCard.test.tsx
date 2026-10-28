/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposalCard as StoredCard } from '@/lib/ai/admin-agent/proposals/card';
import { withI18n } from '@/test/i18n';
import ProposalCard, { entityLink } from '../ProposalCard';
import type { CardView } from '../types';

const ID = '44444444-4444-4444-8444-444444444444';
const HASH = 'a'.repeat(64);
const PREVIEW_HASH = 'b'.repeat(64);
const TOKEN = 'c'.repeat(64);
const text = (value: string, hidden = 0) => ({ text: value, hidden });

const buildCard = (overrides: Partial<StoredCard> = {}): StoredCard => ({
  v: 1,
  kind: 'build',
  class: 'B',
  tool: 'propose_build',
  planCode: 'abcdef12',
  plan: { id: 'plan-1', revision: 2, title: text('Gen 9 OU league'), intent: 'league', contentLocale: 'en' },
  summary: { steps: 2, creates: 1 },
  steps: [
    { key: 'league', op: 'league_create', action: 'create', target: { entity: 'league', id: null, name: text('Spring OU') }, items: [], lines: [{ kind: 'pins_ruleset', params: { ruleset: text('gen9ou'), version: 1 } }] },
    { key: 'roster', op: 'roster_add', action: 'add', target: { entity: 'roster', id: null, name: null, count: 12 }, items: [], lines: [] },
  ],
  lines: [{ kind: 'visible_publicly' }, { kind: 'will_not_start' }],
  warnings: [],
  assumptions: [],
  acks: [{ id: 'visible_publicly', kind: 'checkbox' }],
  outwardEffects: [],
  reversibility: { kind: 'undoable' },
  existingEntity: false,
  ...overrides,
});

const goLiveCard = (): StoredCard =>
  buildCard({
    kind: 'go_live',
    class: 'G',
    tool: 'propose_start_phase',
    plan: null,
    summary: { steps: 1, creates: 0 },
    steps: [{ key: 'start', op: 'start_phase', action: 'start', target: { entity: 'tournament', id: ID, name: text('Spring OU') }, items: [], lines: [{ kind: 'locks_after_start' }] }],
    lines: [],
    acks: [
      { id: 'round_generated', kind: 'checkbox', effect: 'round_generated' },
      { id: 'typed_name', kind: 'typed_name', of: 'league', expected: text('Spring OU') },
    ],
    outwardEffects: [
      { key: 'round_generated', channels: { kind: 'counted', discord: 2, social: 1, names: [text('#pairings')] } },
      { key: 'tournament_started', channels: { kind: 'unknown' } },
    ],
    reversibility: { kind: 'irreversible', reason: 'posted_outward' },
    existingEntity: true,
  });

/** One step of the served ledger state; the defaults are a step that has not run. */
const stepView = (key: string, overrides: Partial<CardView['steps'][number]> = {}): CardView['steps'][number] => ({
  key,
  status: 'pending',
  errorCode: null,
  httpStatus: null,
  actionId: null,
  entityType: null,
  entityId: null,
  verify: null,
  ...overrides,
});

function view(card: StoredCard, overrides: Partial<CardView> = {}): CardView {
  return {
    id: ID,
    kind: card.kind === 'build' ? 'build' : 'action',
    class: card.class,
    status: 'proposed',
    effectiveStatus: 'proposed',
    actionable: true,
    createdAt: '2026-10-27T10:00:00.000Z',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    secondsLeft: 900,
    locale: 'en',
    planCode: card.planCode,
    proposalHash: HASH,
    previewHash: PREVIEW_HASH,
    planId: 'plan-1',
    planRevision: 2,
    toolRegistryVersion: 'rv',
    acksRequired: card.acks.map((ack) => ack.id),
    card,
    steps: card.steps.map((step) => stepView(step.key)),
    details: card.steps.map((step) => ({ key: step.key, method: 'POST', routeTemplate: '/api/seasons', path: '/api/seasons', query: {}, body: { name: 'Spring OU' } })) as CardView['details'],
    resume: null,
    undoable: false,
    ...overrides,
  };
}

interface Calls {
  approve: unknown[];
  decline: number;
  resume: number;
}

/** Answers the three routes the card uses. `state` is what `GET /proposals/[id]` returns next. */
function mockRoutes(state: { detail: CardView | null; token: string | null }, answers: { approve?: Response; decline?: Response; resume?: Response } = {}): Calls {
  const calls: Calls = { approve: [], decline: 0, resume: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/approve')) {
        calls.approve.push(JSON.parse(String(init?.body)));
        return answers.approve ?? Response.json({ success: true, data: {} });
      }
      if (url.endsWith('/resume')) {
        calls.resume += 1;
        return answers.resume ?? Response.json({ success: true, data: {} });
      }
      if (url.endsWith('/decline')) {
        calls.decline += 1;
        return answers.decline ?? Response.json({ success: true, data: {} });
      }
      if (state.detail === null) return Response.json({ success: false, error: 'Proposal not found.', code: 'proposal_not_found' }, { status: 404 });
      return Response.json({ success: true, data: { card: state.detail, token: state.token } });
    }),
  );
  return calls;
}

const mount = (props: { approveEnabled?: boolean; locale?: 'en' | 'de'; onChanged?: () => void; onUndo?: (id: string) => void } = {}) =>
  render(withI18n(<ProposalCard proposalId={ID} approveEnabled={props.approveEnabled ?? true} onChanged={props.onChanged} onUndo={props.onUndo} />, { locale: props.locale ?? 'en' }));

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProposalCard: what it shows', () => {
  it('renders the Build card from stored data in English, with the status as a chip', async () => {
    mockRoutes({ detail: view(buildCard()), token: TOKEN });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('Not executed yet')).toBeTruthy();
    expect(within(card).getByText('Change')).toBeTruthy();
    expect(within(card).getByText(/Plan code/)).toBeTruthy();
    expect(within(card).getByText('abcdef12')).toBeTruthy();
    // The model's plan title is labelled as the assistant's writing.
    expect(within(card).getByText('Gen 9 OU league')).toBeTruthy();
    expect(within(card).getByText(/Written by the assistant/)).toBeTruthy();
    expect(within(card).getByText('2 steps · Creates 1 item')).toBeTruthy();
    expect(within(card).getByText('Create league')).toBeTruthy();
    expect(within(card).getByText('Spring OU')).toBeTruthy();
    expect(within(card).getByText('Add players (12 players)')).toBeTruthy();
    expect(within(card).getByText('Pins gen9ou version 1')).toBeTruthy();
    expect(within(card).getByText('Visible to everyone as soon as it is created')).toBeTruthy();
    expect(within(card).getByText('This build will not start the league or post anything.')).toBeTruthy();
    expect(within(card).getByText('Undo available')).toBeTruthy();
  });

  it('renders the same card in German from the same stored data', async () => {
    mockRoutes({ detail: view(buildCard()), token: TOKEN });
    mount({ locale: 'de' });
    const card = await screen.findByRole('region', { name: 'Bauen' });
    expect(within(card).getByText('Noch nicht ausgeführt')).toBeTruthy();
    expect(within(card).getByText('Liga erstellen')).toBeTruthy();
    expect(within(card).getByText('Spieler hinzufügen (12 Spieler)')).toBeTruthy();
    expect(within(card).getByText('Legt gen9ou Version 1 fest')).toBeTruthy();
    expect(within(card).getByText('Für alle sichtbar, sobald es erstellt ist')).toBeTruthy();
    expect(within(card).getByText('Rückgängig machen möglich')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Bestätigen' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Ablehnen' })).toBeTruthy();
  });

  it('shows the Go-live card with its effects, its channels and why it cannot be undone', async () => {
    mockRoutes({ detail: view(goLiveCard()), token: TOKEN });
    mount();
    const card = await screen.findByRole('region', { name: 'Go live' });
    expect(within(card).getByText('Start')).toBeTruthy();
    // The effect is listed once as what happens and once as the acknowledgement that covers it.
    expect(within(card).getAllByText(/Posts the pairings, with player names/)).toHaveLength(2);
    expect(within(card).getByText(/3 matching channels: #pairings/)).toBeTruthy();
    expect(within(card).getByText('May post to Discord and social channels; the app cannot tell you which.')).toBeTruthy();
    expect(within(card).getByText('Cannot be undone: posts that went out cannot be taken back')).toBeTruthy();
    expect(within(card).getByText('This is an existing league, not one created in this chat.')).toBeTruthy();
    expect(within(card).getByText(/Expires in/)).toBeTruthy();
  });

  it('marks a name that hides characters', async () => {
    const card = buildCard();
    card.steps[0].target.name = text('Spring OU', 3);
    mockRoutes({ detail: view(card), token: TOKEN });
    mount();
    expect(await screen.findByText('Contains 3 hidden characters')).toBeTruthy();
  });

  it('shows the exact method, path and body under technical details', async () => {
    mockRoutes({ detail: view(buildCard()), token: TOKEN });
    mount();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Build' });
    await user.click(screen.getByText('Technical details'));
    expect(screen.getAllByText('/api/seasons').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/"name": "Spring OU"/).length).toBeGreaterThan(0);
  });

  it('collapses a card that is done and opens it on request', async () => {
    const done = view(buildCard(), { status: 'completed', effectiveStatus: 'completed', actionable: false, steps: [stepView('league', { status: 'ok', httpStatus: 201, actionId: 'a1' }), stepView('roster', { status: 'failed', errorCode: 'participant_already_enrolled', httpStatus: 409, actionId: 'a2' })] });
    mockRoutes({ detail: done, token: null });
    mount();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getAllByText('Executed').length).toBeGreaterThan(0);
    // The result lists the steps with their outcome without opening the frozen card; the frozen card (lines, items) opens on request.
    expect(within(card).getByText('This player is already in the league.')).toBeTruthy();
    expect(within(card).queryByText('Pins gen9ou version 1')).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Show details' }));
    expect(within(card).getByText('Pins gen9ou version 1')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('offers no way to answer a card that has expired', async () => {
    const expired = view(buildCard(), { status: 'proposed', effectiveStatus: 'expired', actionable: false });
    mockRoutes({ detail: expired, token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('Expired')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(card).queryByRole('checkbox')).toBeNull();
  });

  it('says so, with a way to retry, when the card cannot be loaded', async () => {
    mockRoutes({ detail: null, token: null });
    mount();
    expect(await screen.findByText('Proposal not found.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('ProposalCard: confirming', () => {
  it('keeps Confirm off until every acknowledgement is ticked, takes no focus and sends exactly what the card holds', async () => {
    const calls = mockRoutes({ detail: view(buildCard()), token: TOKEN });
    const onChanged = vi.fn();
    mount({ onChanged });
    const user = userEvent.setup();
    const confirm = await screen.findByRole('button', { name: 'Confirm' });

    expect(document.activeElement).not.toBe(confirm);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Tick every box to enable Confirm.')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'I understand this is visible to everyone at once.' }));
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    expect(calls.approve).toHaveLength(0);

    await user.click(confirm);
    await waitFor(() => expect(calls.approve).toHaveLength(1));
    expect(calls.approve[0]).toEqual({ token: TOKEN, proposal_hash: HASH, preview_hash: PREVIEW_HASH, acks: ['visible_publicly'] });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('unticking a box turns Confirm off again', async () => {
    mockRoutes({ detail: view(buildCard()), token: TOKEN });
    mount();
    const user = userEvent.setup();
    const confirm = (await screen.findByRole('button', { name: 'Confirm' })) as HTMLButtonElement;
    const box = screen.getByRole('checkbox');
    await user.click(box);
    expect(confirm.disabled).toBe(false);
    await user.click(box);
    expect(confirm.disabled).toBe(true);
  });

  it('keeps Confirm off while the approve route does not execute yet, and says why', async () => {
    const calls = mockRoutes({ detail: view(buildCard()), token: TOKEN });
    mount({ approveEnabled: false });
    const user = userEvent.setup();
    const confirm = (await screen.findByRole('button', { name: 'Confirm' })) as HTMLButtonElement;
    await user.click(screen.getByRole('checkbox'));
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText('The assistant can only look things up for now; changes are not switched on yet.')).toBeTruthy();
    expect(calls.approve).toHaveLength(0);
  });

  it('keeps Confirm off when the token did not arrive', async () => {
    mockRoutes({ detail: view(buildCard()), token: null });
    mount();
    const user = userEvent.setup();
    const confirm = (await screen.findByRole('button', { name: 'Confirm' })) as HTMLButtonElement;
    await user.click(screen.getByRole('checkbox'));
    expect(confirm.disabled).toBe(true);
  });

  it('asks for the typed name too, compared as Unicode-normalised text, and needs every box', async () => {
    const card = goLiveCard();
    card.acks[1] = { id: 'typed_name', kind: 'typed_name', of: 'league', expected: text('Café Liga') };
    const calls = mockRoutes({ detail: view(card), token: TOKEN });
    mount();
    const user = userEvent.setup();
    const confirm = (await screen.findByRole('button', { name: 'Confirm' })) as HTMLButtonElement;
    const box = screen.getByRole('checkbox', { name: /I understand:/ });
    const input = screen.getByLabelText('Type the name to confirm: Café Liga');

    await user.click(box);
    expect(confirm.disabled).toBe(true);
    await user.type(input, 'cafe liga');
    expect(confirm.disabled).toBe(true);
    await user.clear(input);
    // "e" + combining acute accent: the same name as the stored "é" once normalised.
    await user.type(input, 'Café Liga');
    await waitFor(() => expect(confirm.disabled).toBe(false));

    await user.click(confirm);
    await waitFor(() => expect(calls.approve).toHaveLength(1));
    expect((calls.approve[0] as { acks: string[] }).acks).toEqual(['round_generated', 'typed_name']);
    // The typed text travels with the request: the server compares it with the card, so the box is not only a client-side friction.
    expect((calls.approve[0] as { typed?: Record<string, string> }).typed).toEqual({ typed_name: 'Café Liga'.normalize('NFC') });
  });

  it('shows the server\'s refusal in the viewer\'s language and leaves the card as it was', async () => {
    const refusal = Response.json({ success: false, error: 'This action is not enabled yet.', code: 'phase_disabled' }, { status: 501 });
    mockRoutes({ detail: view(buildCard()), token: TOKEN }, { approve: refusal });
    const onChanged = vi.fn();
    mount({ locale: 'de', onChanged });
    const user = userEvent.setup();
    const confirm = await screen.findByRole('button', { name: 'Bestätigen' });
    await user.click(screen.getByRole('checkbox'));
    await user.click(confirm);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Diese Aktion ist noch nicht freigeschaltet.');
    expect(onChanged).not.toHaveBeenCalled();
    expect((await screen.findByRole('button', { name: 'Bestätigen' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ProposalCard: declining', () => {
  it('declines without any acknowledgement, then shows the card as declined', async () => {
    const state = { detail: view(buildCard()) as CardView | null, token: TOKEN as string | null };
    const calls = mockRoutes(state);
    const onChanged = vi.fn();
    mount({ onChanged });
    const user = userEvent.setup();
    const decline = await screen.findByRole('button', { name: 'Decline' });
    expect((decline as HTMLButtonElement).disabled).toBe(false);

    state.detail = view(buildCard(), { status: 'declined', effectiveStatus: 'declined', actionable: false });
    state.token = null;
    await user.click(decline);

    await waitFor(() => expect(calls.decline).toBe(1));
    await waitFor(() => expect(screen.getByText('Declined')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows why a decline failed (the turn is still running)', async () => {
    const busy = Response.json({ success: false, error: 'The assistant is still working on the previous message in this conversation.', code: 'agent_conversation_busy' }, { status: 409 });
    mockRoutes({ detail: view(buildCard()), token: TOKEN }, { decline: busy });
    mount({ locale: 'de' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ablehnen' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/noch an der vorherigen Nachricht/);
  });
});

/** A Build that has run, as the served view shows it. */
const ran = (status: CardView['effectiveStatus'], steps: CardView['steps'], overrides: Partial<CardView> = {}) =>
  view(buildCard(), { status, effectiveStatus: status, actionable: false, secondsLeft: null, steps, ...overrides });
const LEAGUE_ID = '55555555-5555-4555-8555-555555555555';
const ok = (key: string, extra: Partial<CardView['steps'][number]> = {}) => stepView(key, { status: 'ok', httpStatus: 201, actionId: `a-${key}`, ...extra });

describe('ProposalCard: the result', () => {
  const CASES: Array<[CardView['effectiveStatus'], CardView['steps'], string, string]> = [
    ['completed', [ok('league'), ok('roster')], 'Done', 'Every step ran and was confirmed.'],
    ['partial', [ok('league'), stepView('roster', { status: 'failed', errorCode: 'step_failed' })], 'Partly done', 'Some steps ran and the rest did not. What ran stays as it is; nothing was rolled back.'],
    ['failed', [stepView('league', { status: 'failed', errorCode: 'step_failed' }), stepView('roster', { status: 'skipped', errorCode: 'step_failed' })], 'Failed', 'No step was completed. Nothing was changed by this card.'],
    ['stale', [ok('league'), stepView('roster', { status: 'skipped', errorCode: 'proposal_stale' })], 'Stopped: out of date', 'Things changed since this card was shown, so it stopped before the next step. Steps that already ran stay done.'],
    ['unknown', [stepView('league', { status: 'unknown', errorCode: 'unknown_outcome' }), stepView('roster', { status: 'skipped' })], 'Outcome unknown', 'The outcome could not be confirmed. Nothing was retried. Check the steps below before you ask for anything again.'],
    ['executing', [ok('league'), stepView('roster', { status: 'executing' })], 'Running', 'The steps are running, or stopped before the end. This card shows where they stand.'],
  ];

  it.each(CASES)('says what happened for %s: a headline and a one-line explanation', async (status, steps, headline, explain) => {
    mockRoutes({ detail: ran(status, steps), token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    const result = card.querySelector('[data-result]') as HTMLElement;
    expect(result.getAttribute('data-result')).toBe(status);
    expect(within(result).getByRole('heading', { name: headline })).toBeTruthy();
    expect(within(result).getByText(explain)).toBeTruthy();
    // One row per step, each with its own chip.
    expect(within(result).getAllByRole('listitem')).toHaveLength(2);
  });

  it('words a final status in German too', async () => {
    mockRoutes({ detail: ran('partial', [ok('league'), stepView('roster', { status: 'failed', errorCode: 'participant_already_enrolled' })]), token: null });
    mount({ locale: 'de' });
    const card = await screen.findByRole('region', { name: 'Bauen' });
    expect(within(card).getByRole('heading', { name: 'Teilweise erledigt' })).toBeTruthy();
    expect(within(card).getByText(/Einige Schritte wurden ausgeführt/)).toBeTruthy();
    expect(within(card).getByText('Dieser Spieler ist schon in der Liga.')).toBeTruthy();
  });

  it('shows no result for a card that has not run', async () => {
    mockRoutes({ detail: view(buildCard()), token: TOKEN });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(card.querySelector('[data-result]')).toBeNull();
  });

  it('shows the catalogued code text of a failed step and the status chip of each step', async () => {
    mockRoutes({ detail: ran('partial', [ok('league'), stepView('roster', { status: 'failed', errorCode: 'participant_already_enrolled' })]), token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    const rows = within(card.querySelector('[data-result]') as HTMLElement).getAllByRole('listitem');
    expect(within(rows[0]).getByText('Executed')).toBeTruthy();
    expect(within(rows[1]).getByText('Failed')).toBeTruthy();
    expect(within(rows[1]).getByText('This player is already in the league.')).toBeTruthy();
  });

  it('says for an unknown step that the outcome could not be confirmed and nothing was retried', async () => {
    mockRoutes({ detail: ran('unknown', [stepView('league', { status: 'unknown', errorCode: 'unknown_outcome' }), stepView('roster', { status: 'skipped' })]), token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('The outcome could not be confirmed. Nothing was retried.')).toBeTruthy();
  });

  it('says for reconcile_ambiguous that several matches were found and none adopted', async () => {
    mockRoutes({ detail: ran('executing', [stepView('league', { status: 'unknown', errorCode: 'reconcile_ambiguous' }), stepView('roster')]), token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('Several matching items were found and none was adopted. Nothing was retried.')).toBeTruthy();
  });

  it('counts a partly done roster add: N of M players added', async () => {
    const detail = ran('executing', [ok('league'), stepView('roster', { status: 'unknown', errorCode: 'unknown_outcome', verify: { present: 5, expected: 12 } })]);
    mockRoutes({ detail, token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('5 of 12 players added')).toBeTruthy();
  });

  it('shows no count for a roster add that added nobody', async () => {
    mockRoutes({ detail: ran('failed', [ok('league'), stepView('roster', { status: 'failed', errorCode: 'step_failed', verify: { present: 0, expected: 12 } })]), token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).queryByText(/players added/)).toBeNull();
  });

  it('explains a tournament that was created without admin access, with a link to it', async () => {
    const stored = buildCard({
      steps: [{ key: 'tournament', op: 'tournament_create', action: 'create', target: { entity: 'tournament', id: null, name: text('Cup') }, items: [], lines: [] }],
      summary: { steps: 1, creates: 1 },
    });
    const detail = view(stored, {
      status: 'failed',
      effectiveStatus: 'failed',
      actionable: false,
      steps: [stepView('tournament', { status: 'failed', errorCode: 'created_but_unadministrable', entityType: 'tournament', entityId: LEAGUE_ID })],
    });
    mockRoutes({ detail, token: null });
    mount();
    const region = await screen.findByRole('region', { name: 'Build' });
    expect(within(region).getByText('The tournament was created, but you were not made an admin of it. Ask a site admin.')).toBeTruthy();
    expect(within(region).getByRole('link', { name: 'Open the tournament' }).getAttribute('href')).toBe(`/tournaments/${LEAGUE_ID}`);
  });

  it('links a created league to its admin page, only for ids that are uuids', async () => {
    const detail = ran('completed', [ok('league', { entityType: 'season', entityId: LEAGUE_ID }), ok('roster', { entityId: 'not-an-id' })]);
    mockRoutes({ detail, token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getAllByRole('link')).toHaveLength(1);
    expect(within(card).getByRole('link', { name: 'Open the league' }).getAttribute('href')).toBe(`/admin/leagues/${LEAGUE_ID}`);
  });

  it('maps the steps that made or moved something to the existing routes, and nothing else', () => {
    expect(entityLink('publish_ruleset', LEAGUE_ID)).toEqual({ key: 'ruleset', href: `/admin/rulesets/${LEAGUE_ID}` });
    expect(entityLink('move_pin', LEAGUE_ID)?.key).toBe('ruleset');
    expect(entityLink('roster_add', LEAGUE_ID)).toBeNull();
    expect(entityLink('league_create', null)).toBeNull();
    expect(entityLink('league_create', `${LEAGUE_ID}/../x`)).toBeNull();
  });

  it('renders no model prose: the plan title stays out of a finished card until the details are opened', async () => {
    mockRoutes({ detail: ran('completed', [ok('league'), ok('roster')]), token: null });
    mount();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(card.textContent).not.toContain('Gen 9 OU league');
    expect(card.textContent).not.toContain('Written by the assistant');
  });

  it('shows the approve answer at once, even when the stored state cannot be read back', async () => {
    const state = { detail: view(buildCard()) as CardView | null, token: TOKEN as string | null };
    const answer = {
      kind: 'proposal_result',
      proposal_id: ID,
      plan_code: 'abcdef12',
      status: 'partial',
      steps: [
        { key: 'league', status: 'ok', entity_id: LEAGUE_ID },
        { key: 'roster', status: 'failed', code: 'participant_already_enrolled' },
      ],
    };
    mockRoutes(state, { approve: Response.json({ success: true, data: answer }) });
    const onChanged = vi.fn();
    mount({ onChanged });
    const user = userEvent.setup();
    const confirm = await screen.findByRole('button', { name: 'Confirm' });
    await user.click(screen.getByRole('checkbox'));
    state.detail = null;
    await user.click(confirm);
    const card = await screen.findByRole('region', { name: 'Build' });
    await waitFor(() => expect(within(card).getByRole('heading', { name: 'Partly done' })).toBeTruthy());
    expect(within(card).getByText('This player is already in the league.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open the league' }).getAttribute('href')).toBe(`/admin/leagues/${LEAGUE_ID}`);
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('follows a running Build by re-reading the stored ledger', { timeout: 15_000 }, async () => {
    const deadline = new Date(Date.now() + 5 * 60_000).toISOString();
    const state = { detail: ran('executing', [ok('league'), stepView('roster', { status: 'executing' })], { resume: { eligible: true, deadline } }) as CardView | null, token: null as string | null };
    mockRoutes(state);
    mount();
    expect(await screen.findByRole('heading', { name: 'Running' })).toBeTruthy();
    state.detail = ran('completed', [ok('league'), ok('roster')]);
    expect(await screen.findByRole('heading', { name: 'Done' }, { timeout: 8000 })).toBeTruthy();
  });
});

describe('ProposalCard: resume', () => {
  const inWindow = () => new Date(Date.now() + 5 * 60_000).toISOString();
  const stopped = [ok('league'), stepView('roster', { status: 'unknown', errorCode: 'unknown_outcome' })];
  const resumed = { kind: 'proposal_result', proposal_id: ID, plan_code: 'abcdef12', status: 'completed', steps: [{ key: 'league', status: 'ok' }, { key: 'roster', status: 'ok' }] };

  it('offers Resume for a Build still inside its window, with the time it lasts to, and sends an empty request', async () => {
    const state = { detail: ran('executing', stopped, { resume: { eligible: true, deadline: inWindow() } }) as CardView | null, token: null as string | null };
    const calls = mockRoutes(state, { resume: Response.json({ success: true, data: resumed }) });
    const onChanged = vi.fn();
    mount({ onChanged });
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Resume' });
    expect(screen.getByText(/Available until/)).toBeTruthy();
    state.detail = ran('completed', [ok('league'), ok('roster')]);
    await user.click(button);
    await waitFor(() => expect(calls.resume).toBe(1));
    expect(calls.approve).toHaveLength(0);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('shows why a resume was refused', async () => {
    const detail = ran('executing', stopped, { resume: { eligible: true, deadline: inWindow() } });
    mockRoutes({ detail, token: null }, { resume: Response.json({ success: false, error: 'This proposal cannot be resumed.', code: 'proposal_not_resumable' }, { status: 409 }) });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This proposal cannot be resumed.');
  });

  it('offers no Resume after the window: it says the Build can no longer be resumed and to ask for a fresh one', async () => {
    const detail = ran('executing', stopped, { resume: { eligible: false, deadline: new Date(Date.now() - 60_000).toISOString() } });
    mockRoutes({ detail, token: null });
    mount();
    expect(await screen.findByText('This Build can no longer be resumed. Ask the assistant for a fresh Build for the rest.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('never offers Resume on a Go-live card, and says nothing about it', async () => {
    const detail = view(goLiveCard(), { status: 'executing', effectiveStatus: 'executing', actionable: false, resume: null, steps: [stepView('start', { status: 'unknown', errorCode: 'unknown_outcome' })] });
    mockRoutes({ detail, token: null });
    mount();
    const region = await screen.findByRole('region', { name: 'Go live' });
    expect(within(region).queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(region.textContent).not.toMatch(/resume/i);
  });

  it('keeps Resume off while the approve routes do not execute', async () => {
    mockRoutes({ detail: ran('executing', stopped, { resume: { eligible: true, deadline: inWindow() } }), token: null });
    mount({ approveEnabled: false });
    expect(((await screen.findByRole('button', { name: 'Resume' })) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ProposalCard: the undo entry point', () => {
  const done = [ok('league'), ok('roster')];

  it('offers Undo when the server says something is undoable, and only asks: it hands the proposal id to the conversation', async () => {
    mockRoutes({ detail: ran('completed', done, { undoable: true }), token: null });
    const onUndo = vi.fn();
    mount({ onUndo });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith(ID);
    expect(screen.getByText('Asks the assistant to prepare a card that undoes this. Nothing is undone until you confirm that card.')).toBeTruthy();
  });

  it('offers it on a partly executed card too', async () => {
    mockRoutes({ detail: ran('partial', done, { undoable: true }), token: null });
    mount({ onUndo: vi.fn() });
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('hides Undo when nothing is undoable', async () => {
    mockRoutes({ detail: ran('completed', done, { undoable: false }), token: null });
    mount({ onUndo: vi.fn() });
    await screen.findByRole('region', { name: 'Build' });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('hides Undo when no turn can start', async () => {
    mockRoutes({ detail: ran('completed', done, { undoable: true }), token: null });
    mount();
    await screen.findByRole('region', { name: 'Build' });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('hides Undo on a card that did not run', async () => {
    mockRoutes({ detail: view(buildCard(), { undoable: true }), token: TOKEN });
    mount({ onUndo: vi.fn() });
    await screen.findByRole('region', { name: 'Build' });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('words the button in German', async () => {
    mockRoutes({ detail: ran('completed', done, { undoable: true }), token: null });
    mount({ onUndo: vi.fn(), locale: 'de' });
    expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeTruthy();
  });
});

describe('ProposalCard: an undo card', () => {
  const undoCard = (): StoredCard =>
    buildCard({
      kind: 'undo',
      class: 'G',
      tool: 'propose_undo',
      plan: null,
      summary: { steps: 1, creates: 0 },
      steps: [{ key: 'undo.row', op: 'league_archive', action: 'archive', target: { entity: 'league', id: LEAGUE_ID, name: text('Spring OU') }, items: [], lines: [{ kind: 'archived_stays_reachable' }] }],
      lines: [],
      acks: [{ id: 'compensating_changes', kind: 'checkbox', effect: 'compensating_changes' }],
      outwardEffects: [{ key: 'compensating_changes', channels: { kind: 'none' } }],
      reversibility: { kind: 'irreversible', reason: 'compensating' },
      undo: {
        leftAlone: [],
        residue: [{ op: 'phase_create', entity: 'phase', id: null, name: text('Playoffs'), reason: 'residue' }],
        notUndoable: [{ op: 'start_phase', entity: 'tournament', id: null, name: null, reason: 'outward_effect' }],
        truncated: false,
      },
    });

  it('confirms with its acknowledgement, and its notes (residue, what cannot be recalled) show', async () => {
    const calls = mockRoutes({ detail: view(undoCard(), { kind: 'undo' }), token: TOKEN });
    mount();
    const user = userEvent.setup();
    const region = await screen.findByRole('region', { name: 'Undo' });
    expect(within(region).getByText(/Posts and starts cannot be taken back\./)).toBeTruthy();
    expect(within(region).getByText(/Phases and pools stay with the archived league\./)).toBeTruthy();
    const confirm = within(region).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(within(region).getByRole('checkbox'));
    await user.click(confirm);
    await waitFor(() => expect(calls.approve).toHaveLength(1));
    expect((calls.approve[0] as { acks: string[] }).acks).toEqual(['compensating_changes']);
  });

  it('renders its result like any card, and never offers an undo of an undo', async () => {
    const detail = view(undoCard(), { kind: 'undo', status: 'completed', effectiveStatus: 'completed', actionable: false, undoable: false, steps: [stepView('undo.row', { status: 'ok', entityType: 'season', entityId: LEAGUE_ID })] });
    mockRoutes({ detail, token: null });
    mount({ onUndo: vi.fn() });
    const region = await screen.findByRole('region', { name: 'Undo' });
    expect(within(region).getByRole('heading', { name: 'Done' })).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
