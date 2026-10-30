import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { PLAN_BLOCKER_CODES } from '@/lib/ai/admin-agent/plans/readiness';
import { workedExample, workedExampleUnpublished } from '@/lib/ai/admin-agent/plans/__tests__/fixtures';
import { toPlanView } from '../_lib/plan-view';
import { parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import { awaitsContinue, projectTranscript, readSeed, toCapabilities, toConversationSummary, toProposalSummaryView } from '../_lib/views';
import { CONVERSATION, conversation, message, plan, proposal } from './support';

const msg = (seq: number, role: 'user' | 'assistant' | 'system', kind: 'chat' | 'tool_results' | 'harness_event', rest: Record<string, unknown> = {}) =>
  message({ seq, role, kind, ...rest } as never);

describe('projectTranscript', () => {
  it('shows the admin\'s words, the assistant\'s prose and one status line per tool call', () => {
    const items = projectTranscript([
      msg(1, 'user', 'chat', { content: [{ type: 'text', text: 'hello' }] }),
      msg(2, 'assistant', 'chat', {
        content: [
          { type: 'thinking', thinking: 'private chain of thought', signature: 'sig' },
          { type: 'text', text: 'Let me look.' },
          { type: 'tool_use', id: 'a', name: 'league_list', input: {} },
          { type: 'tool_use', id: 'b', name: 'player_search', input: { q: 'x' } },
        ],
        ui: { text: 'Let me look.', tool_calls: [{ id: 'a', name: 'league_list' }, { id: 'b', name: 'player_search' }] },
      }),
      msg(3, 'user', 'tool_results', {
        content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"ok":true}' }],
        ui: { results: [{ tool_use_id: 'a', name: 'league_list', ok: true }, { tool_use_id: 'b', name: 'player_search', ok: false, code: 'rate_limited' }] },
      }),
    ]);
    expect(items).toEqual([
      { type: 'user', seq: 1, at: expect.any(String), text: 'hello' },
      { type: 'assistant', seq: 2, at: expect.any(String), text: 'Let me look.' },
      { type: 'tool', seq: 2, id: 'a', name: 'league_list', status: 'ok', code: null, proposalId: null },
      { type: 'tool', seq: 2, id: 'b', name: 'player_search', status: 'failed', code: 'rate_limited', proposalId: null },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/private chain|"sig"|thinking/);
  });

  it('hides the prose of a refused step but keeps its tool lines, and reads old rows by their stop reason', () => {
    const refused = (seq: number, rest: Record<string, unknown>) =>
      msg(seq, 'assistant', 'chat', {
        content: [{ type: 'text', text: 'I will start by' }, { type: 'tool_use', id: `t${seq}`, name: 'plan_set', input: {} }],
        ...rest,
      });
    const items = projectTranscript([
      msg(1, 'user', 'chat', { content: [{ type: 'text', text: 'hello' }] }),
      refused(2, { ui: { text: 'I will start by', tool_calls: [{ id: 't2', name: 'plan_set' }], refused: true, refusal_category: 'cyber' } }),
      msg(3, 'user', 'tool_results', { content: [{ type: 'tool_result', tool_use_id: 't2', content: '{}', is_error: true }], ui: { results: [{ tool_use_id: 't2', name: 'plan_set', ok: false, code: 'agent_refused' }] } }),
      // A row stored before the flag existed: the stop reason column says the same.
      refused(4, { ui: { text: 'I will start by', tool_calls: [{ id: 't4', name: 'plan_set' }] }, stop_reason: 'refusal' }),
      msg(5, 'assistant', 'chat', { content: [{ type: 'text', text: 'Here is the real answer.' }], ui: { text: 'Here is the real answer.', tool_calls: [] }, stop_reason: 'end_turn' }),
    ]);
    expect(items.filter((i) => i.type === 'assistant').map((i) => (i as { text: string | null }).text)).toEqual(['Here is the real answer.']);
    expect(items.filter((i) => i.type === 'tool').map((i) => (i as { id: string }).id)).toEqual(['t2', 't4']);
    expect(JSON.stringify(items)).not.toMatch(/cyber|refusal_category|I will start by/);
  });

  it('leaves a tool pending until its result is stored', () => {
    const items = projectTranscript([msg(1, 'assistant', 'chat', { content: [{ type: 'tool_use', id: 'a', name: 'league_get', input: {} }], ui: { text: '', tool_calls: [{ id: 'a', name: 'league_get' }] } })]);
    expect(items).toEqual([{ type: 'tool', seq: 1, id: 'a', name: 'league_get', status: 'pending', code: null, proposalId: null }]);
  });

  it('reads results from the stored blocks when the message has no UI projection', () => {
    const items = projectTranscript([
      msg(1, 'assistant', 'chat', { content: [{ type: 'tool_use', id: 'a', name: 'league_get', input: {} }], ui: null }),
      msg(2, 'user', 'tool_results', { content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"ok":false}', is_error: true }], ui: null }),
    ]);
    expect(items[0]).toMatchObject({ type: 'tool', status: 'failed' });
  });

  it('links a staged proposal to its tool line, accepting only a real uuid', () => {
    const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const items = projectTranscript([
      msg(1, 'assistant', 'chat', { content: [], ui: { text: '', tool_calls: [{ id: 'a', name: 'propose_build' }, { id: 'b', name: 'propose_build' }] } }),
      msg(2, 'user', 'tool_results', { ui: { results: [{ tool_use_id: 'a', ok: true, ui: { proposal_id: id } }, { tool_use_id: 'b', ok: true, ui: { proposal_id: '../../etc' } }] } }),
    ]);
    expect(items.filter((i) => i.type === 'tool').map((i) => (i as { proposalId: string | null }).proposalId)).toEqual([id.toLowerCase(), null]);
  });

  it('carries the question of a request_clarification to its tool line, re-validated and bounded', () => {
    const items = projectTranscript([
      msg(1, 'assistant', 'chat', { content: [], ui: { text: '', tool_calls: [{ id: 'a', name: 'request_clarification' }, { id: 'b', name: 'request_clarification' }, { id: 'c', name: 'request_clarification' }] } }),
      msg(2, 'user', 'tool_results', {
        ui: {
          results: [
            { tool_use_id: 'a', ok: true, ui: { clarification: { kind: 'choice', question: 'Which Monday?', options: [{ value: '2026-11-02', label: 'Next Monday' }, { value: 1, label: 'broken' }] } } },
            { tool_use_id: 'b', ok: true, ui: { clarification: { kind: 'dance', question: 'x' } } },
            { tool_use_id: 'c', ok: true, ui: { clarification: { kind: 'text', question: 'q'.repeat(400), options: 'none' } } },
          ],
        },
      }),
    ]);
    const tools = items.filter((i) => i.type === 'tool') as Array<{ clarification?: { kind: string; question: string; options: unknown[] } }>;
    expect(tools[0].clarification).toEqual({ kind: 'choice', question: 'Which Monday?', options: [{ value: '2026-11-02', label: 'Next Monday' }] });
    expect(tools[1].clarification).toBeUndefined();
    expect(tools[2].clarification).toMatchObject({ kind: 'text', options: [] });
    expect(tools[2].clarification?.question).toHaveLength(300);
  });

  it('shows purged messages as removed, not as empty', () => {
    const items = projectTranscript([
      msg(1, 'user', 'chat', { content: null, content_purged_at: '2026-10-27T00:00:00Z' }),
      msg(2, 'assistant', 'chat', { content: null, ui: null }),
    ]);
    expect(items).toMatchObject([{ type: 'user', text: null }, { type: 'assistant', text: null }]);
  });

  it('shows the harness events an admin should see and hides the model\'s bookkeeping', () => {
    const items = projectTranscript([
      msg(1, 'system', 'harness_event', { ui: { event: 'state_refresh', data: { today: '2026-10-27' } }, content: [{ type: 'text', text: '[harness_event] state_refresh' }] }),
      msg(2, 'system', 'harness_event', { ui: { event: 'proposal_declined', data: { proposal_id: '44444444-4444-4444-8444-444444444444', token: 'must-not-travel' } }, content: [{ type: 'text', text: '[harness_event] proposal_declined' }] }),
      msg(3, 'system', 'harness_event', { ui: { event: 'Bad Name!', data: {} }, content: [{ type: 'text', text: 'x' }] }),
    ]);
    expect(items).toEqual([{ type: 'event', seq: 2, at: expect.any(String), event: 'proposal_declined', proposalId: '44444444-4444-4444-8444-444444444444' }]);
    expect(JSON.stringify(items)).not.toContain('must-not-travel');
  });

  it('knows whether a harness event waits for the model', () => {
    expect(awaitsContinue([])).toBe(false);
    expect(awaitsContinue([{ kind: 'chat' }, { kind: 'harness_event' }])).toBe(true);
    expect(awaitsContinue([{ kind: 'harness_event' }, { kind: 'chat' }])).toBe(false);
  });
});

describe('readSeed', () => {
  it('keeps only the whitelisted keys and uuid ids, whatever the column holds', () => {
    expect(readSeed({ area: 'league', seed: 'readiness', entity: '11111111-1111-4111-8111-111111111111', tab: 'phases', note: 'drop table' })).toEqual({
      area: 'league',
      seed: 'readiness',
      entity: '11111111-1111-4111-8111-111111111111',
      tab: 'phases',
    });
    expect(readSeed({ area: 'league', entity: 'javascript:alert(1)', seed: 'nope' })).toEqual({ area: 'league' });
    expect(readSeed({ area: 'payments' })).toBeNull();
    expect(readSeed({})).toBeNull();
    expect(readSeed('text')).toBeNull();
    expect(readSeed(null)).toBeNull();
  });
});

describe('summaries', () => {
  it('a conversation is read-only for a tier other than the one it was made for', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(toConversationSummary(conversation({ tool_set: 'site' }), 'site', now).readOnly).toBe(false);
    expect(toConversationSummary(conversation({ tool_set: 'site' }), 'scoped', now).readOnly).toBe(true);
    expect(toConversationSummary(conversation({ turn_lease_until: '2026-10-27T12:00:30Z' }), 'site', now).busy).toBe(true);
    expect(toConversationSummary(conversation({ turn_lease_until: '2026-10-27T11:59:00Z' }), 'site', now).busy).toBe(false);
    expect(toConversationSummary(conversation({ id: CONVERSATION }), 'site', now).id).toBe(CONVERSATION);
  });

  it('a proposal summary carries the plan code and the effective status, never the hashes', () => {
    const view = toProposalSummaryView(proposal({ status: 'proposed', expires_at: '2020-01-01T00:00:00Z' }), new Date('2026-10-27T12:00:00Z'));
    expect(view).toMatchObject({ planCode: '01234567', status: 'proposed', effectiveStatus: 'expired' });
    expect(JSON.stringify(view)).not.toContain(proposal().proposal_hash);
    expect(toProposalSummaryView(proposal({ status: 'declined', expires_at: '2020-01-01T00:00:00Z' }), new Date()).effectiveStatus).toBe('declined');
  });
});

describe('toPlanView', () => {
  it('shows the worked example section by section, with names as text and the rest as structured values', () => {
    const view = toPlanView(plan({ doc: workedExample() as never }));
    expect(view).not.toBeNull();
    expect(view).toMatchObject({ title: 'Gen 9 OU league', revision: 2, code: 'abcdef01', status: 'drafting', contentLocale: 'de' });
    expect(view!.sections.map((s) => s.section)).toEqual(['ruleset', 'league', 'phases', 'roster']);

    const league = view!.sections.find((s) => s.section === 'league')!;
    expect(league.rows).toEqual([
      { label: 'name', value: { kind: 'text', text: 'Gen 9 OU League' } },
      { label: 'formatType', value: { kind: 'enum', group: 'formatType', value: 'singles' } },
      { label: 'language', value: { kind: 'word', group: 'languages', value: 'de' } },
      { label: 'startDate', value: { kind: 'date', value: '2026-11-02' } },
    ]);
    const phases = view!.sections.find((s) => s.section === 'phases')!;
    expect(phases.items).toEqual([
      { title: 'Regular season', rows: [{ label: 'bracket', value: { kind: 'phase', bracket: 'round_robin', bestOf: 1, doubles: false } }] },
      { title: 'Playoffs', rows: [{ label: 'bracket', value: { kind: 'phase', bracket: 'single_elim', bestOf: 3, doubles: false } }] },
    ]);
    expect(view!.sections.find((s) => s.section === 'roster')!.rows[0]).toEqual({ label: 'matched', value: { kind: 'matched', resolved: 12, total: 12 } });
  });

  it('counts the bans of a new ruleset and says how it was chosen', () => {
    const view = toPlanView(plan({ doc: workedExampleUnpublished() as never }))!;
    const ruleset = view.sections.find((s) => s.section === 'ruleset')!;
    expect(ruleset.rows).toEqual(
      expect.arrayContaining([
        { label: 'kind', value: { kind: 'word', group: 'modes', value: 'new' } },
        { label: 'bans', value: { kind: 'number', value: 1 } },
        { label: 'unbans', value: { kind: 'number', value: 0 } },
      ]),
    );
    expect(view.assumptions[0]).toMatchObject({ key: 'ruleset.own_copy', source: 'default', confirmed: false, value: { kind: 'bool', value: true } });
    // A new ruleset has to be published through its own card before a Build can pin it: a real blocker, not a fact check.
    expect(view.blockers.map((blocker) => blocker.code)).toContain('ruleset_unpublished');
    expect(view.ready).toBe(false);
    expect(ruleset.state).toBe('needs_input');
  });

  it('does not count the checks that need live facts against the plan', () => {
    const view = toPlanView(plan({ doc: workedExample() as never }))!;
    // Rulesets, players and the dex are looked up when the Build card is staged; without them readiness reports
    // `fact_unavailable`, which the panel leaves out instead of calling the plan blocked.
    expect(view.blockers.map((b) => b.code)).not.toContain('fact_unavailable');
    expect(view.ready).toBe(true);
    for (const section of view.sections) expect(section.state).not.toBe('needs_input');
  });

  it('reports a real blocker, as a code with plain-valued params', () => {
    const doc = workedExample();
    doc.slots.phases![1].advancement_rule = { type: 'top_n', count: 4, per_group: false };
    doc.slots.phases![0].advancement_rule = { type: 'top_n', count: 4, per_group: false };
    const view = toPlanView(plan({ doc: doc as never }))!;
    expect(view.ready).toBe(false);
    expect(view.blockers).toContainEqual({ code: 'advancement_rule_on_first_phase', section: 'phases', path: '/slots/phases/0/advancement_rule', params: { phase: 'regular_season' } });
    expect(view.sections.find((s) => s.section === 'phases')).toMatchObject({ state: 'needs_input', blockers: 1 });
  });

  it('flags a double round robin as an engine gap in the phases section', () => {
    const doc = workedExample();
    doc.assumptions = [{ key: 'legs.regular_season', value: 2, source: 'admin', confirmed: true }];
    const view = toPlanView(plan({ doc: doc as never }))!;
    expect(view.blockers.map((b) => b.code)).toContain('double_round_robin_unsupported');
    expect(view.sections.find((s) => s.section === 'phases')!.state).toBe('engine_gap');
  });

  it('has a catalogued blocker text for every blocker code the plan module can report', async () => {
    const { default: en } = await import('@/i18n/messages/admin-assistant-cards/en');
    const { default: de } = await import('@/i18n/messages/admin-assistant-cards/de');
    for (const code of PLAN_BLOCKER_CODES) {
      expect(Object.keys(en.blockers), code).toContain(code);
      expect(Object.keys(de.blockers), code).toContain(code);
    }
  });

  it('returns null for a document that no longer parses', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toPlanView(plan({ doc: { v: 9 } as never }))).toBeNull();
    log.mockRestore();
  });
});

describe('toCapabilities', () => {
  it('offers Confirm from phase 1 on, because the approve and resume routes execute then', () => {
    const config = (phase: string) => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'true', ADMIN_AGENT_MAX_PHASE: phase });
    expect(toCapabilities(config('0'))).toEqual({ approve: false, maxPhase: 0 });
    expect(toCapabilities(config('1'))).toEqual({ approve: true, maxPhase: 1 });
    expect(toCapabilities(config('2'))).toEqual({ approve: true, maxPhase: 2 });
  });
});
