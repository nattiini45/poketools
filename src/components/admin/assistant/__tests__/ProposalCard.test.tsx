/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposalCard as StoredCard } from '@/lib/ai/admin-agent/proposals/card';
import { withI18n } from '@/test/i18n';
import ProposalCard from '../ProposalCard';
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
    steps: card.steps.map((step) => ({ key: step.key, status: 'pending', errorCode: null, httpStatus: null, actionId: null })),
    details: card.steps.map((step) => ({ key: step.key, method: 'POST', routeTemplate: '/api/seasons', path: '/api/seasons', query: {}, body: { name: 'Spring OU' } })) as CardView['details'],
    ...overrides,
  };
}

interface Calls {
  approve: unknown[];
  decline: number;
}

/** Answers the three routes the card uses. `state` is what `GET /proposals/[id]` returns next. */
function mockRoutes(state: { detail: CardView | null; token: string | null }, answers: { approve?: Response; decline?: Response } = {}): Calls {
  const calls: Calls = { approve: [], decline: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/approve')) {
        calls.approve.push(JSON.parse(String(init?.body)));
        return answers.approve ?? Response.json({ success: true, data: {} });
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

const mount = (props: { approveEnabled?: boolean; locale?: 'en' | 'de'; onChanged?: () => void } = {}) =>
  render(withI18n(<ProposalCard proposalId={ID} approveEnabled={props.approveEnabled ?? true} onChanged={props.onChanged} />, { locale: props.locale ?? 'en' }));

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
    const done = view(buildCard(), { status: 'completed', effectiveStatus: 'completed', actionable: false, steps: [{ key: 'league', status: 'ok', errorCode: null, httpStatus: 201, actionId: 'a1' }, { key: 'roster', status: 'failed', errorCode: 'participant_already_enrolled', httpStatus: 409, actionId: 'a2' }] });
    mockRoutes({ detail: done, token: null });
    mount();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('Executed')).toBeTruthy();
    expect(within(card).queryByText('Create league')).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Show details' }));
    expect(within(card).getByText('Create league')).toBeTruthy();
    expect(within(card).getByText('This player is already in the league.')).toBeTruthy();
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
