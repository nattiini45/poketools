/**
 * The verified-session override must decide exactly like the cookie: every identity x every guard gives the same
 * outcome (value or error) AND the same live reads, once with `auth()` returning the session (the ambient cookie) and
 * once with no cookie at all but `runAsVerifiedSession(session)` around the guard.
 *
 * The database is mocked the way the other auth tests do: `loadSessionPlayer` is the live player row,
 * `isResourceAdminFor` the `resource_admins` read, the definition queries the format and ruleset metadata.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';
import type { FormatDefinitionMeta } from '@/lib/format-studio/library-types';
import type { RulesetDefinitionMeta } from '@/lib/ruleset-studio/library-types';
import { ltext } from '@/lib/studio-core/ltext';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  loadSessionPlayer: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ getFormatDefinitionMeta: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  getDefinitionOfVersion: vi.fn(),
  getRulesetDefinitionMeta: vi.fn(),
}));

import { auth, loadSessionPlayer } from '@/auth';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getFormatDefinitionMeta } from '@/lib/supabase/queries/format-definitions';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getDefinitionOfVersion, getRulesetDefinitionMeta } from '@/lib/supabase/queries/ruleset-definitions';
import {
  getLiveAccess,
  getLiveSessionPlayer,
  getSession,
  requireAdmin,
  requireAnyAdmin,
  requireAuth,
  requireCreator,
  requireDraftAdmin,
  requireFormatOwner,
  requireFormatViewer,
  requirePlayer,
  requireResourceAdmin,
  requireSuperadmin,
} from '../helpers';
import { assertRulesetUsable, requireRulesetOwner, requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { authAndRecord, runAsVerifiedSession } from '../session-override';

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
const mockedLoad = vi.mocked(loadSessionPlayer);
const mockedResourceAdmin = vi.mocked(isResourceAdminFor);
const mockedPool = vi.mocked(getDraftPoolById);
const mockedFormatMeta = vi.mocked(getFormatDefinitionMeta);
const mockedRulesetMeta = vi.mocked(getRulesetDefinitionMeta);
const mockedVersionOwner = vi.mocked(getDefinitionOfVersion);

const SEASON_X = '10000000-0000-4000-8000-000000000001';
const SEASON_Y = '10000000-0000-4000-8000-000000000002';
const POOL = '20000000-0000-4000-8000-000000000001';
const FORMAT_DEF = '30000000-0000-4000-8000-000000000001';
const RULESET_DEF = '40000000-0000-4000-8000-000000000001';
const RULESET_VERSION = '50000000-0000-4000-8000-000000000001';
const FOREIGN_OWNER = '60000000-0000-4000-8000-000000000001';

const SUPERADMIN_DISCORD_ID = 'discord-superadmin';
const SUPERADMIN_EMAIL = 'root@example.com';

function livePlayer(playerId: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    playerId,
    name: playerId,
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  };
}

interface Identity {
  label: string;
  /** The session `auth()` returns; null for nobody signed in. */
  session: Session | null;
  /** The live row `loadSessionPlayer` answers. */
  live: SessionPlayer | null;
}

function discordSession(userId: string, token: SessionPlayer | null): Session {
  return {
    user: { id: userId, name: userId, email: `${userId}@example.com`, image: null },
    player: token,
    provider: 'discord',
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function credentialsSession(userId: string, email: string, token: SessionPlayer | null): Session {
  return {
    user: { id: userId, name: userId, email, image: null },
    player: token,
    provider: 'credentials',
    expires: '2099-01-01T00:00:00.000Z',
  };
}

const RES_ADMIN = livePlayer('p-resource-admin', { isResourceAdmin: true });
const SITE_ADMIN = livePlayer('p-site-admin', { isAdmin: true });

const IDENTITIES: Identity[] = [
  { label: 'anonymous', session: null, live: null },
  { label: 'signed in without a player', session: discordSession('d-noplayer', null), live: null },
  {
    label: 'banned',
    session: discordSession('d-banned', livePlayer('p-banned')),
    live: livePlayer('p-banned', { status: 'banned' }),
  },
  {
    label: 'suspended',
    session: discordSession('d-suspended', livePlayer('p-suspended')),
    live: livePlayer('p-suspended', { status: 'suspended' }),
  },
  {
    label: 'plain player',
    session: discordSession('d-plain', livePlayer('p-plain')),
    live: livePlayer('p-plain'),
  },
  {
    label: 'plain player whose token still says site admin (revoked)',
    session: discordSession('d-revoked', livePlayer('p-revoked', { isAdmin: true })),
    live: livePlayer('p-revoked'),
  },
  {
    label: 'content creator',
    session: discordSession('d-creator', livePlayer('p-creator', { isCreator: true })),
    live: livePlayer('p-creator', { isCreator: true }),
  },
  {
    label: 'resource admin of league X',
    session: discordSession('d-resource', RES_ADMIN),
    live: RES_ADMIN,
  },
  {
    label: 'banned resource admin of league X',
    session: discordSession('d-resource-banned', { ...RES_ADMIN, status: 'banned' }),
    live: { ...RES_ADMIN, status: 'banned' },
  },
  {
    label: 'site admin',
    session: discordSession('d-admin', SITE_ADMIN),
    live: SITE_ADMIN,
  },
  {
    // The live row is NOT a site admin: readLivePlayer promotes the superadmin identity.
    label: 'superadmin (Discord id)',
    session: discordSession(SUPERADMIN_DISCORD_ID, livePlayer('p-superadmin')),
    live: livePlayer('p-superadmin'),
  },
  {
    // A credentials session is the superadmin through its sign-in email.
    label: 'superadmin (credentials session, reserved email)',
    session: credentialsSession('auth-uuid-root', SUPERADMIN_EMAIL, livePlayer('p-superadmin-cred')),
    live: livePlayer('p-superadmin-cred'),
  },
  {
    label: 'site admin on a credentials session (not the reserved email)',
    session: credentialsSession('auth-uuid-admin', 'admin@example.com', SITE_ADMIN),
    live: SITE_ADMIN,
  },
];

function formatMeta(): FormatDefinitionMeta {
  return {
    id: FORMAT_DEF,
    slug: 'swiss-cup',
    name: { base: 'en', en: { v: 'Swiss Cup', s: 'human' } },
    description: null,
    kind: 'custom',
    owner_id: RES_ADMIN.playerId,
    visibility: 'private',
    forked_from: null,
    draft_rev: 1,
    current_version_id: null,
    created_at: 't',
    updated_at: 't',
  };
}

function rulesetMeta(): RulesetDefinitionMeta {
  return {
    id: RULESET_DEF,
    slug: 'no-kingambit',
    name: ltext('en', 'No Kingambit'),
    description: null,
    kind: 'custom',
    owner_id: FOREIGN_OWNER,
    visibility: 'private',
    // Made for league X: the admins of X manage it (one extra resource_admins read).
    season_id: SEASON_X,
    forked_from: null,
    draft_rev: 1,
    current_version_id: RULESET_VERSION,
    created_at: 't',
    updated_at: 't',
  };
}

/** Every guard of `helpers.ts` and `ruleset-studio/guards.ts`, called the way the routes call them. */
const GUARDS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['requireAuth', () => requireAuth()],
  ['requirePlayer', () => requirePlayer()],
  ['requireAdmin', () => requireAdmin()],
  ['requireSuperadmin', () => requireSuperadmin()],
  ['requireAnyAdmin', () => requireAnyAdmin()],
  ['requireCreator', () => requireCreator()],
  ['requireResourceAdmin(season X)', () => requireResourceAdmin('season', SEASON_X)],
  ['requireResourceAdmin(season Y)', () => requireResourceAdmin('season', SEASON_Y)],
  ['requireResourceAdmin(malformed id)', () => requireResourceAdmin('tournament', 'not-a-uuid')],
  ['requireDraftAdmin', () => requireDraftAdmin(POOL)],
  ['requireFormatOwner', () => requireFormatOwner(FORMAT_DEF)],
  ['requireFormatViewer', () => requireFormatViewer(FORMAT_DEF)],
  ['requireRulesetOwner', () => requireRulesetOwner(RULESET_DEF)],
  ['requireRulesetViewer', () => requireRulesetViewer(RULESET_DEF)],
  ['assertRulesetUsable', async () => assertRulesetUsable(await requireAnyAdmin(), RULESET_VERSION)],
  ['getLiveAccess', () => getLiveAccess()],
  ['getLiveSessionPlayer', () => getLiveSessionPlayer()],
  ['getSession', () => getSession()],
];

type Outcome =
  | { kind: 'ok'; value: unknown }
  | { kind: 'error'; name: string; message: string; fields: Record<string, unknown> };

async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    const value = await run();
    return { kind: 'ok', value: value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown) };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'error', name: error.name, message: error.message, fields: { ...error } };
  }
}

interface Run {
  outcome: Outcome;
  /** The live reads the guard made, in order. */
  reads: unknown[][];
  /** How often `auth()` ran while the guard ran. */
  authCalls: number;
}

function liveReads(): unknown[][] {
  return [
    ...mockedLoad.mock.calls.map((call) => ['loadSessionPlayer', ...call]),
    ...mockedResourceAdmin.mock.calls.map((call) => ['isResourceAdminFor', ...call]),
    ...mockedPool.mock.calls.map((call) => ['getDraftPoolById', ...call]),
    ...mockedFormatMeta.mock.calls.map((call) => ['getFormatDefinitionMeta', ...call]),
    ...mockedRulesetMeta.mock.calls.map((call) => ['getRulesetDefinitionMeta', ...call]),
    ...mockedVersionOwner.mock.calls.map((call) => ['getDefinitionOfVersion', ...call]),
  ];
}

function clearReads(): void {
  for (const mock of [mockedLoad, mockedResourceAdmin, mockedPool, mockedFormatMeta, mockedRulesetMeta, mockedVersionOwner]) {
    mock.mockClear();
  }
}

/** The cookie way: `auth()` answers the session. */
async function runAmbient(identity: Identity, guard: () => Promise<unknown>): Promise<Run> {
  mockedAuth.mockReset();
  mockedAuth.mockResolvedValue(identity.session);
  clearReads();
  const outcome = await outcomeOf(guard);
  return { outcome, reads: liveReads(), authCalls: mockedAuth.mock.calls.length };
}

/**
 * The override way: the chat route's `authAndRecord()` ran once, then the cookie is gone (`auth()` answers nobody) and
 * the guard runs inside `runAsVerifiedSession`. Nobody signed in cannot enter the override, so that identity runs the
 * guard plainly (and the test below pins that it cannot be entered).
 */
async function runOverridden(identity: Identity, guard: () => Promise<unknown>): Promise<Run> {
  mockedAuth.mockReset();
  mockedAuth.mockResolvedValueOnce(identity.session);
  const recorded = await authAndRecord();
  mockedAuth.mockReset();
  mockedAuth.mockResolvedValue(null);
  clearReads();
  const outcome = await outcomeOf(() => (recorded === null ? guard() : runAsVerifiedSession(recorded, guard)));
  return { outcome, reads: liveReads(), authCalls: mockedAuth.mock.calls.length };
}

const savedEnv = { id: process.env.SUPERADMIN_DISCORD_ID, email: process.env.SUPERADMIN_EMAIL };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPERADMIN_DISCORD_ID = SUPERADMIN_DISCORD_ID;
  process.env.SUPERADMIN_EMAIL = SUPERADMIN_EMAIL;
  mockedLoad.mockReset();
  mockedLoad.mockImplementation(async (_provider, identityId) => {
    const found = IDENTITIES.find((i) => i.session?.user?.id === identityId);
    return found?.live ? { ...found.live } : null;
  });
  mockedResourceAdmin.mockReset();
  mockedResourceAdmin.mockImplementation(
    async (playerId, resourceType, resourceId) =>
      playerId === RES_ADMIN.playerId && resourceType === 'season' && resourceId === SEASON_X,
  );
  mockedPool.mockReset();
  mockedPool.mockResolvedValue({ season_id: SEASON_X } as Awaited<ReturnType<typeof getDraftPoolById>>);
  mockedFormatMeta.mockReset();
  mockedFormatMeta.mockResolvedValue(formatMeta());
  mockedRulesetMeta.mockReset();
  mockedRulesetMeta.mockResolvedValue(rulesetMeta());
  mockedVersionOwner.mockReset();
  mockedVersionOwner.mockResolvedValue({ definition: rulesetMeta(), version_no: 1 });
});

afterEach(() => {
  if (savedEnv.id === undefined) delete process.env.SUPERADMIN_DISCORD_ID;
  else process.env.SUPERADMIN_DISCORD_ID = savedEnv.id;
  if (savedEnv.email === undefined) delete process.env.SUPERADMIN_EMAIL;
  else process.env.SUPERADMIN_EMAIL = savedEnv.email;
});

describe('override equals cookie: identity x guard', () => {
  describe.each(IDENTITIES)('$label', (identity) => {
    it.each(GUARDS)('%s: same outcome, same live reads, no cookie read', async (_name, guard) => {
      const ambient = await runAmbient(identity, guard);
      const overridden = await runOverridden(identity, guard);

      expect(overridden.outcome).toEqual(ambient.outcome);
      expect(overridden.reads).toEqual(ambient.reads);
      // The override replaces auth() inside the run; the cookie way reads it (nobody-signed-in runs read it either way).
      if (identity.session !== null) expect(overridden.authCalls).toBe(0);
    });
  });
});

// ── The matrix is not vacuous: pin outcomes that matter ──────────────────────

type Expected = 'ok' | { statusCode: number; code?: string };

const SPOT_CHECKS: ReadonlyArray<readonly [identity: string, guard: string, expected: Expected]> = [
  ['anonymous', 'requireAuth', { statusCode: 401, code: 'unauthenticated' }],
  ['anonymous', 'requireSuperadmin', { statusCode: 401, code: 'unauthenticated' }],
  ['signed in without a player', 'requirePlayer', { statusCode: 403, code: 'forbidden' }],
  ['banned', 'requireAuth', { statusCode: 403, code: 'account_banned' }],
  ['suspended', 'requirePlayer', { statusCode: 403, code: 'account_suspended' }],
  ['plain player', 'requirePlayer', 'ok'],
  ['plain player', 'requireAnyAdmin', { statusCode: 403, code: 'forbidden' }],
  ['plain player whose token still says site admin (revoked)', 'requireAdmin', { statusCode: 403, code: 'forbidden' }],
  ['content creator', 'requireCreator', 'ok'],
  ['resource admin of league X', 'requireAnyAdmin', 'ok'],
  ['resource admin of league X', 'requireAdmin', { statusCode: 403, code: 'forbidden' }],
  ['resource admin of league X', 'requireResourceAdmin(season X)', 'ok'],
  ['resource admin of league X', 'requireResourceAdmin(season Y)', { statusCode: 403, code: 'forbidden' }],
  ['resource admin of league X', 'requireDraftAdmin', 'ok'],
  ['resource admin of league X', 'requireFormatOwner', 'ok'],
  ['resource admin of league X', 'requireRulesetOwner', 'ok'],
  ['resource admin of league X', 'assertRulesetUsable', 'ok'],
  ['banned resource admin of league X', 'requireResourceAdmin(season X)', { statusCode: 403, code: 'account_banned' }],
  ['site admin', 'requireAdmin', 'ok'],
  ['site admin', 'requireSuperadmin', { statusCode: 403, code: 'forbidden' }],
  ['site admin', 'requireRulesetOwner', 'ok'],
  ['superadmin (Discord id)', 'requireAdmin', 'ok'],
  ['superadmin (Discord id)', 'requireSuperadmin', 'ok'],
  ['superadmin (credentials session, reserved email)', 'requireAdmin', 'ok'],
  ['superadmin (credentials session, reserved email)', 'requireSuperadmin', 'ok'],
  ['site admin on a credentials session (not the reserved email)', 'requireSuperadmin', { statusCode: 403, code: 'forbidden' }],
];

describe('the matrix pins outcomes that matter (both ways)', () => {
  it.each(SPOT_CHECKS)('%s / %s', async (identityLabel, guardLabel, expected) => {
    const identity = IDENTITIES.find((i) => i.label === identityLabel);
    const guard = GUARDS.find(([name]) => name === guardLabel)?.[1];
    if (!identity || !guard) throw new Error(`unknown spot check: ${identityLabel} / ${guardLabel}`);

    for (const run of [await runAmbient(identity, guard), await runOverridden(identity, guard)]) {
      if (expected === 'ok') {
        expect(run.outcome.kind).toBe('ok');
      } else {
        expect(run.outcome).toMatchObject({ kind: 'error', fields: { statusCode: expected.statusCode, code: expected.code } });
      }
    }
  });

  it('the matrix covers both outcomes and every status class the guards answer', async () => {
    const seen = new Set<string>();
    for (const identity of IDENTITIES) {
      for (const [, guard] of GUARDS) {
        const { outcome } = await runOverridden(identity, guard);
        seen.add(outcome.kind === 'ok' ? 'ok' : String(outcome.fields.statusCode));
      }
    }
    expect([...seen].sort()).toEqual(['401', '403', '404', 'ok']);
  });
});

// ── What the override must not do ────────────────────────────────────────────

describe('the override is scoped to the run', () => {
  it('nobody signed in has no session to enter the override with', async () => {
    mockedAuth.mockResolvedValue(null);
    expect(await authAndRecord()).toBeNull();
    expect(() => runAsVerifiedSession(null as unknown as Session, async () => 1)).toThrow();
  });

  it('after the run the guards read the cookie again', async () => {
    const admin = IDENTITIES.find((i) => i.label === 'site admin');
    if (!admin) throw new Error('missing identity');
    mockedAuth.mockResolvedValueOnce(admin.session);
    const recorded = await authAndRecord();
    if (!recorded) throw new Error('expected a session');
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue(null);

    await expect(runAsVerifiedSession(recorded, () => requireAdmin())).resolves.toMatchObject({ playerId: SITE_ADMIN.playerId });
    await expect(requireAdmin()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('honours a revocation mid-run: the roles are re-read live by every guard', async () => {
    const admin = IDENTITIES.find((i) => i.label === 'site admin');
    if (!admin) throw new Error('missing identity');
    mockedAuth.mockResolvedValueOnce(admin.session);
    const recorded = await authAndRecord();
    if (!recorded) throw new Error('expected a session');
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue(null);

    await runAsVerifiedSession(recorded, async () => {
      await expect(requireAdmin()).resolves.toMatchObject({ playerId: SITE_ADMIN.playerId });
      // The admin is demoted and banned while the run is in flight.
      mockedLoad.mockImplementation(async () => livePlayer(SITE_ADMIN.playerId, { status: 'banned' }));
      await expect(requireAdmin()).rejects.toMatchObject({ statusCode: 403, code: 'account_banned' });
    });
  });

  it('a session that expires between recording and the run is refused', async () => {
    mockedAuth.mockResolvedValueOnce({ ...discordSession('d-short', livePlayer('p-short')), expires: new Date(Date.now() + 20).toISOString() });
    const recorded = await authAndRecord();
    if (!recorded) throw new Error('expected a session');
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(() => runAsVerifiedSession(recorded, () => requirePlayer())).toThrow(/expired/);
  });
});
