/**
 * Shared fixtures for the assistant's route tests: a live player, same-site requests and store rows. The mocks themselves
 * (`vi.mock`) live in each test file, because Vitest hoists them per file.
 */
import { NextRequest } from 'next/server';
import type { ConversationRecord, MessageRecord, PlanRecord, ProposalRecord } from '@/lib/ai/admin-agent/store/types';
import type { SessionPlayer } from '@/types/auth';

export const ME = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const CONVERSATION = '33333333-3333-4333-8333-333333333333';
export const PROPOSAL = '44444444-4444-4444-8444-444444444444';
export const ORIGIN = 'http://localhost';

export const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ME,
  name: 'Site Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
  ...overrides,
});

export const SAME_SITE: Record<string, string> = {
  origin: ORIGIN,
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
};

export function post(path: string, body?: unknown, headers: Record<string, string> = SAME_SITE): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

export const get = (path: string, headers: Record<string, string> = {}): NextRequest => new NextRequest(`${ORIGIN}${path}`, { headers });

/** The `{ params }` argument of a dynamic route. */
export const params = (value: { id: string }) => ({ params: Promise.resolve(value) });

export const conversation = (overrides: Partial<ConversationRecord> = {}): ConversationRecord => ({
  active_plan_id: null,
  admin_id: ME,
  admin_name: 'Site Admin',
  blast_format_creates: 0,
  blast_golive_executions: 0,
  blast_league_creates: 0,
  blast_pin_targets: 0,
  blast_ruleset_creates: 0,
  blast_tournament_creates: 1,
  context: { area: 'leagues' },
  created_at: '2026-10-27T10:00:00.000Z',
  effort: 'medium',
  id: CONVERSATION,
  last_message_at: '2026-10-27T10:05:00.000Z',
  model: 'claude-opus-5-5',
  seq_head: 4,
  status: 'active',
  system_prompt_version: 'sp-secret-version',
  title: 'Spring league',
  tool_registry_version: 'registry-secret-version',
  tool_set: 'site',
  turn_lease_until: null,
  ui_locale: 'en',
  updated_at: '2026-10-27T10:05:00.000Z',
  version: 3,
  ...overrides,
});

export const message = (overrides: Partial<MessageRecord> & Pick<MessageRecord, 'seq' | 'role' | 'kind'>): MessageRecord =>
  ({
    conversation_id: CONVERSATION,
    content: [],
    ui: null,
    model: null,
    stop_reason: null,
    usage: null,
    client_msg_id: null,
    content_purged_at: null,
    created_at: '2026-10-27T10:01:00.000Z',
    ...overrides,
  }) as MessageRecord;

export const plan = (overrides: Partial<PlanRecord> = {}): PlanRecord =>
  ({
    admin_id: ME,
    admin_name: 'Site Admin',
    build_finished_at: null,
    build_started_at: null,
    conversation_id: CONVERSATION,
    created_at: '2026-10-27T10:00:00.000Z',
    doc: {},
    doc_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    id: '55555555-5555-4555-8555-555555555555',
    mode: 'create',
    revision: 2,
    status: 'drafting',
    updated_at: '2026-10-27T10:00:00.000Z',
    ...overrides,
  }) as PlanRecord;

export const proposal = (overrides: Partial<ProposalRecord> = {}): ProposalRecord =>
  ({
    id: PROPOSAL,
    admin_id: ME,
    admin_name: 'Site Admin',
    conversation_id: CONVERSATION,
    kind: 'build',
    class: 'B',
    status: 'proposed',
    proposal_hash: '0123456789abcdef'.repeat(4),
    preview_hash: 'fedcba9876543210'.repeat(4),
    expires_at: '2099-01-01T00:00:00.000Z',
    created_at: '2026-10-27T10:02:00.000Z',
    locale: 'en',
    steps: [],
    preview: {},
    ...overrides,
  }) as unknown as ProposalRecord;
