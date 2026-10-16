import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';

/**
 * Stub AuthError class for use inside vi.mock() blocks where the real
 * AuthError can't be imported (circular dependency with the mock target).
 */
export class MockAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

/** Build a SessionPlayer with sensible defaults. */
export function makePlayer(overrides?: Partial<SessionPlayer>): SessionPlayer {
  return {
    playerId: 'player-1',
    name: 'Test Player',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active' as const,
    ...overrides,
  };
}

/** Build a next-auth Session wrapping the given player. */
export function makeSession(player?: SessionPlayer | null): Session {
  return {
    user: { id: 'discord-1', name: 'Test', email: 'test@example.com', image: null },
    player: player ?? null,
    expires: '2099-01-01',
  };
}

/**
 * Standard auth mock factory for vi.mock('@/lib/auth/helpers', () => authMock()).
 * All guard functions reject by default; configure them per-test with vi.mocked().
 */
export function authMockFactory() {
  return {
    requireAuth: async () => { throw new MockAuthError('Not authenticated', 401); },
    requirePlayer: async () => { throw new MockAuthError('Not authenticated', 401); },
    requireAdmin: async () => { throw new MockAuthError('Not authenticated', 401); },
    requireAnyAdmin: async () => { throw new MockAuthError('Not authenticated', 401); },
    requireCreator: async () => { throw new MockAuthError('Not authenticated', 401); },
    requireResourceAdmin: async () => { throw new MockAuthError('Not authenticated', 401); },
    requireDraftAdmin: async () => { throw new MockAuthError('Not authenticated', 401); },
    AuthError: MockAuthError,
  };
}
