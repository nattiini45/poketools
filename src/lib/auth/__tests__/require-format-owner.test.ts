import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';
import type { FormatDefinitionMeta } from '@/lib/format-studio/library-types';

// The guards read the live player (loadSessionPlayer) and the definition metadata from the database on every call.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  loadSessionPlayer: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ getFormatDefinitionMeta: vi.fn() }));

import { auth, loadSessionPlayer } from '@/auth';
import { getFormatDefinitionMeta } from '@/lib/supabase/queries/format-definitions';
import { AuthError, requireFormatOwner, requireFormatViewer } from '../helpers';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
const mockedLoad = vi.mocked(loadSessionPlayer);
const mockedMeta = vi.mocked(getFormatDefinitionMeta);

const DEF_ID = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const OWNER_ID = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function player(overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    playerId: OWNER_ID,
    name: 'Owner',
    isAdmin: false,
    isResourceAdmin: true,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  };
}

function session(tokenPlayer: SessionPlayer | null): Session {
  return {
    user: { id: 'discord-1', name: 'T', email: 't@example.com', image: null },
    player: tokenPlayer,
    expires: '2099-01-01',
  };
}

/** The token says one thing, the live database row another. */
function signIn(token: SessionPlayer | null, live: SessionPlayer | null = token): void {
  mockedAuth.mockResolvedValue(session(token));
  mockedLoad.mockImplementation(async () => (live ? { ...live } : null));
}

function definition(overrides: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta {
  return {
    id: DEF_ID,
    slug: 'swiss-cup',
    name: { base: 'en', en: { v: 'Swiss Cup', s: 'human' } },
    description: null,
    kind: 'custom',
    owner_id: OWNER_ID,
    visibility: 'private',
    forked_from: null,
    draft_rev: 1,
    current_version_id: null,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the guard to reject');
    },
    (error: unknown) => error,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoad.mockReset();
  mockedMeta.mockReset();
  delete process.env.SUPERADMIN_DISCORD_ID;
  delete process.env.SUPERADMIN_EMAIL;
  mockedMeta.mockResolvedValue(definition());
});

describe('requireFormatOwner', () => {
  it('answers 401 when nobody is signed in, before any database read', async () => {
    mockedAuth.mockResolvedValue(null);
    const error = await rejection(requireFormatOwner(DEF_ID));
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ statusCode: 401, code: 'unauthenticated' });
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it('answers 403 for a signed-in identity without a player', async () => {
    signIn(null);
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it('answers 403 for a player who is no admin of any kind, before any definition read', async () => {
    signIn(player({ isResourceAdmin: false }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403, code: 'forbidden' });
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it('answers 403 for a banned or suspended league admin', async () => {
    signIn(player({ status: 'banned' }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403, code: 'account_banned' });
    signIn(player({ status: 'suspended' }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403, code: 'account_suspended' });
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it('lets the owner (a league admin) through and returns the live player and the definition', async () => {
    signIn(player());
    const access = await requireFormatOwner(DEF_ID);
    expect(access.player.playerId).toBe(OWNER_ID);
    expect(access.definition.slug).toBe('swiss-cup');
    expect(mockedMeta).toHaveBeenCalledWith(DEF_ID);
  });

  it('answers 403 to another league admin on a private definition', async () => {
    signIn(player({ playerId: OTHER_ID }));
    const error = await rejection(requireFormatOwner(DEF_ID));
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ statusCode: 403, code: 'forbidden', message: 'Format owner access required' });
  });

  it('answers 403 to another league admin even when the definition is shared with all admins', async () => {
    signIn(player({ playerId: OTHER_ID }));
    mockedMeta.mockResolvedValue(definition({ visibility: 'league' }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
    mockedMeta.mockResolvedValue(definition({ visibility: 'gallery' }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
  });

  it('lets a site admin through on any definition, a preset row and an ownerless row included', async () => {
    signIn(player({ playerId: 'admin-1', isAdmin: true, isResourceAdmin: false }));
    for (const meta of [
      definition(),
      definition({ kind: 'preset', owner_id: null, visibility: 'gallery' }),
      definition({ owner_id: null }),
    ]) {
      mockedMeta.mockResolvedValue(meta);
      expect((await requireFormatOwner(DEF_ID)).definition.id).toBe(DEF_ID);
    }
  });

  it('answers 403 to the owner of a preset row (only site admins edit presets)', async () => {
    signIn(player());
    mockedMeta.mockResolvedValue(definition({ kind: 'preset', owner_id: OWNER_ID, visibility: 'league' }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
  });

  it('answers 403 to an admin when the definition lost its owner', async () => {
    signIn(player());
    mockedMeta.mockResolvedValue(definition({ owner_id: null }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
  });

  it('decides from the live player: a stale token that says site admin does not help', async () => {
    signIn(player({ playerId: OTHER_ID, isAdmin: true }), player({ playerId: OTHER_ID, isAdmin: false }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
  });

  it('decides from the live player: a revoked league admin is refused at once', async () => {
    signIn(player(), player({ isResourceAdmin: false }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it('decides from the live definition: ownership that moved since the token was minted is honoured', async () => {
    signIn(player());
    mockedMeta.mockResolvedValue(definition({ owner_id: OTHER_ID }));
    expect(await rejection(requireFormatOwner(DEF_ID))).toMatchObject({ statusCode: 403 });
  });

  it('reads the definition from the database on every call', async () => {
    signIn(player());
    await requireFormatOwner(DEF_ID);
    await requireFormatOwner(DEF_ID);
    expect(mockedMeta).toHaveBeenCalledTimes(2);
  });

  it('answers 404 format_not_found for an unknown definition', async () => {
    signIn(player());
    mockedMeta.mockResolvedValue(null);
    const error = await rejection(requireFormatOwner(DEF_ID));
    expect(error).toBeInstanceOf(FormatStudioError);
    expect(error).toMatchObject({ statusCode: 404, code: 'format_not_found' });
  });

  it('answers 404 format_not_found for a malformed id, for site admins too, without a database read', async () => {
    for (const live of [player(), player({ isAdmin: true })]) {
      signIn(live);
      for (const id of ['not-a-uuid', '', '123', `${DEF_ID}x`, "' or 1=1 --"]) {
        expect(await rejection(requireFormatOwner(id))).toMatchObject({ statusCode: 404, code: 'format_not_found' });
      }
    }
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it('checks the role before the id: a non-admin sees 403, not 404, for a malformed id', async () => {
    signIn(player({ isResourceAdmin: false }));
    expect(await rejection(requireFormatOwner('nope'))).toMatchObject({ statusCode: 403 });
  });

  it('fails closed when the definition read fails', async () => {
    signIn(player());
    const boom = new Error('db down');
    mockedMeta.mockRejectedValue(boom);
    expect(await rejection(requireFormatOwner(DEF_ID))).toBe(boom);
  });

  it('turns into the typed responses safeErrorResponse sends', async () => {
    signIn(player({ playerId: OTHER_ID }));
    const forbidden = safeErrorResponse(await rejection(requireFormatOwner(DEF_ID)), 'Failed');
    expect(forbidden.status).toBe(403);
    mockedMeta.mockResolvedValue(null);
    const missing = safeErrorResponse(await rejection(requireFormatOwner(DEF_ID)), 'Failed');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'format_not_found' });
  });
});

describe('requireFormatViewer', () => {
  it('lets the owner see a private definition', async () => {
    signIn(player());
    expect((await requireFormatViewer(DEF_ID)).definition.visibility).toBe('private');
  });

  it("answers 403 to another admin on a private definition", async () => {
    signIn(player({ playerId: OTHER_ID }));
    expect(await rejection(requireFormatViewer(DEF_ID))).toMatchObject({ statusCode: 403, code: 'forbidden' });
  });

  it.each(['league', 'gallery'] as const)('lets any admin see a %s definition', async (visibility) => {
    signIn(player({ playerId: OTHER_ID }));
    mockedMeta.mockResolvedValue(definition({ visibility }));
    const access = await requireFormatViewer(DEF_ID);
    expect(access.player.playerId).toBe(OTHER_ID);
    expect(access.definition.visibility).toBe(visibility);
  });

  it('lets a site admin see a foreign private definition and a preset row', async () => {
    signIn(player({ playerId: 'admin-1', isAdmin: true, isResourceAdmin: false }));
    expect((await requireFormatViewer(DEF_ID)).definition.id).toBe(DEF_ID);
    mockedMeta.mockResolvedValue(definition({ kind: 'preset', owner_id: null }));
    expect((await requireFormatViewer(DEF_ID)).definition.kind).toBe('preset');
  });

  it('answers 401, 403 for non-admins and 404 for unknown or malformed ids', async () => {
    mockedAuth.mockResolvedValue(null);
    expect(await rejection(requireFormatViewer(DEF_ID))).toMatchObject({ statusCode: 401 });
    signIn(player({ isResourceAdmin: false }));
    expect(await rejection(requireFormatViewer(DEF_ID))).toMatchObject({ statusCode: 403 });
    signIn(player());
    mockedMeta.mockResolvedValue(null);
    expect(await rejection(requireFormatViewer(DEF_ID))).toMatchObject({ statusCode: 404, code: 'format_not_found' });
    mockedMeta.mockClear();
    expect(await rejection(requireFormatViewer('x'))).toMatchObject({ statusCode: 404, code: 'format_not_found' });
    expect(mockedMeta).not.toHaveBeenCalled();
  });
});
