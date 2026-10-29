/**
 * A real route module (`POST /api/ruleset-definitions/[id]/pins/impact`, the P-class binding of the plan) dispatched
 * through `invokeRoute`: its own body reader, zod schema, error helper and rate-limit response run for real; only the
 * guard, the limiter and the data layer are mocked, as the repo's route tests do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(message: string, public statusCode: number, public code?: string) {
      super(message);
    }
  },
}));
vi.mock('@/lib/ruleset-studio/guards', () => ({ requireRulesetViewer: vi.fn() }));
vi.mock('@/lib/ruleset-studio/pin-impact.server', () => ({ computePinImpact: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));

import { auth } from '@/auth';
import { getAgentAuditContext } from '@/lib/audit/agent-context';
import { authAndRecord, getVerifiedSession } from '@/lib/auth/session-override';
import { AuthError } from '@/lib/auth/helpers';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { computePinImpact } from '@/lib/ruleset-studio/pin-impact.server';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetDefinitionMeta } from '@/lib/ruleset-studio/library-types';
import { ltext } from '@/lib/studio-core/ltext';
import { bindingInput, createBindingRegistry, defineBinding } from '../binding';
import { invokeRoute } from '../invoke';
import type { DispatchContext } from '../types';

const ME = '11111111-1111-4111-8111-111111111111';
const DEF = '33333333-3333-4333-8333-333333333333';
const SEASON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const player = (): SessionPlayer => ({
  playerId: ME, name: 'League Admin', isAdmin: false, isResourceAdmin: true, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
});
const definition = (): RulesetDefinitionMeta => ({
  id: DEF, slug: 'spring-ou', name: ltext('en', 'Spring OU'), description: null, kind: 'custom', owner_id: ME, visibility: 'private', season_id: null,
  forked_from: null, draft_rev: 2, current_version_id: null, created_at: '', updated_at: '',
});

interface ImpactArgs {
  definitionId: string;
  toVersionNo: number;
  targets: Array<{ kind: 'season' | 'tournament'; id: string }>;
}

// The binding the plan lists as P (`ruleset_pin_impact_preview`): a literal import of the real route module.
const pinImpact = defineBinding<ImpactArgs>({
  operation: 'ruleset_pin_impact_preview',
  method: 'POST',
  path: '/api/ruleset-definitions/[id]/pins/impact',
  class: 'P',
  load: () => import('@/app/api/ruleset-definitions/[id]/pins/impact/route'),
  buildParams: (args) => ({ id: args.definitionId }),
  buildBody: (args) => ({ to_version_no: args.toVersionNo, targets: args.targets }),
});

const args: ImpactArgs = { definitionId: DEF, toVersionNo: 2, targets: [{ kind: 'season', id: SEASON }] };
const answer = { version_no: 2, checked: 9, would_break: 3, truncated: false, targets: [] };

async function context(): Promise<DispatchContext> {
  const session: Session = {
    user: { id: ME, name: 'Admin', email: 'admin@example.com', image: null },
    player: null,
    expires: '2099-01-01T00:00:00.000Z',
  };
  vi.mocked(auth).mockResolvedValueOnce(session as never);
  const recorded = await authAndRecord();
  if (recorded === null) throw new Error('expected a session');
  return {
    session: recorded,
    inbound: new Request('https://example.com/api/admin/agent/proposals/p/approve', { headers: { 'x-forwarded-for': '203.0.113.7' } }),
    audit: { agent_conversation_id: 'c1', agent_proposal_id: 'p1', agent_step: 'impact', approved_by: ME },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requireRulesetViewer).mockResolvedValue({
    player: player(),
    definition: definition(),
    actor: { playerId: ME, isAdmin: false },
  } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
  vi.mocked(computePinImpact).mockResolvedValue(answer);
});

describe('invokeRoute against a real route module', () => {
  it('answers ok with the route data, passing the params and the body the way the route expects them', async () => {
    const outcome = await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context());

    expect(outcome).toEqual({ kind: 'ok', httpStatus: 200, data: answer, body: { success: true, data: answer } });
    expect(requireRulesetViewer).toHaveBeenCalledWith(DEF);
    expect(computePinImpact).toHaveBeenCalledWith(expect.objectContaining({ toVersionNo: 2, targets: args.targets }));
  });

  it('runs the guard and the data layer inside the verified session and the agent audit context', async () => {
    const seen: Array<{ session: Session | undefined; audit: unknown }> = [];
    vi.mocked(requireRulesetViewer).mockImplementation(async () => {
      seen.push({ session: getVerifiedSession(), audit: getAgentAuditContext() });
      return { player: player(), definition: definition(), actor: { playerId: ME, isAdmin: false } } as never;
    });
    vi.mocked(computePinImpact).mockImplementation(async () => {
      seen.push({ session: getVerifiedSession(), audit: getAgentAuditContext() });
      return answer;
    });

    const ctx = await context();
    await invokeRoute(pinImpact, bindingInput(pinImpact, args), ctx);

    expect(seen).toHaveLength(2);
    for (const entry of seen) {
      expect(entry.session).toBe(ctx.session);
      expect(entry.audit).toMatchObject({
        agent_conversation_id: 'c1',
        agent_proposal_id: 'p1',
        agent_step: 'impact',
        approved_by: ME,
        agent_tool: 'ruleset_pin_impact_preview',
      });
    }
  });

  it('maps the route zod failure to validation with the issue list', async () => {
    const outcome = await invokeRoute(pinImpact, { params: { id: DEF }, body: { to_version_no: 0, targets: [] } }, await context());
    expect(outcome).toMatchObject({ kind: 'validation', httpStatus: 400, code: 'validation_failed' });
    expect(outcome.kind === 'validation' && outcome.issues).toMatch(/to_version_no|targets/);
    expect(computePinImpact).not.toHaveBeenCalled();
  });

  it('maps a RulesetStudioError from the guard to not_found with its catalogued code', async () => {
    vi.mocked(requireRulesetViewer).mockRejectedValue(new RulesetStudioError('ruleset_not_found'));
    const outcome = await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context());
    expect(outcome).toMatchObject({ kind: 'not_found', httpStatus: 404, code: 'ruleset_not_found' });
  });

  it('maps an AuthError 403 to forbidden, a locked pin to locked and a started pin to conflict', async () => {
    vi.mocked(requireRulesetViewer).mockRejectedValueOnce(new AuthError('Ruleset access required', 403, 'forbidden'));
    expect(await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context())).toMatchObject({ kind: 'forbidden', httpStatus: 403, code: 'forbidden' });

    vi.mocked(computePinImpact).mockRejectedValueOnce(new RulesetStudioError('ruleset_pin_locked'));
    expect(await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context())).toMatchObject({ kind: 'locked', code: 'ruleset_pin_locked' });

    vi.mocked(computePinImpact).mockRejectedValueOnce(new RulesetStudioError('ruleset_pin_started'));
    expect(await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context())).toMatchObject({ kind: 'conflict', code: 'ruleset_pin_started' });
  });

  it('maps the limiter refusal to rate_limited with the wait', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
    const outcome = await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context());
    expect(outcome).toEqual({ kind: 'rate_limited', httpStatus: 429, code: 'rate_limited', retryAfterSeconds: 17 });
  });

  it('maps an unexpected throw (masked by safeErrorResponse) to an unknown outcome without its message', async () => {
    vi.mocked(computePinImpact).mockRejectedValue(new Error('connection reset by peer 10.0.0.5'));
    const outcome = await invokeRoute(pinImpact, bindingInput(pinImpact, args), await context());
    // A P-class POST is still a POST: the harness cannot know it wrote nothing, so the rule for writes applies.
    expect(outcome).toMatchObject({ kind: 'masked_server_error', httpStatus: 500, unknownOutcome: true });
    expect(JSON.stringify(outcome)).not.toContain('10.0.0.5');
  });

  it('sits in an injected registry with its path params', () => {
    const registry = createBindingRegistry([pinImpact]);
    expect(registry.get('ruleset_pin_impact_preview')).toBe(pinImpact);
  });
});
