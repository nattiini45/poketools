/**
 * What `npm run dev:seed` creates, by name. Dependency-free on purpose: the seed (`./seed.ts`), its runner and the
 * Playwright suite (`e2e/`) all import it, and none of them can load the other's server-only modules.
 */

/** The password of every seeded account. Public on purpose: the accounts open nothing but a local stack. */
export const DEV_SEED_PASSWORD = 'poketools-local-admin';

export const DEV_SEED_ADMIN = {
  email: 'local-admin@poketools.test',
  password: DEV_SEED_PASSWORD,
  name: 'Local Admin',
} as const;

export const DEV_SEED_LEAGUE_NAME = 'Dev Seed League';
export const DEV_SEED_TOURNAMENT_NAME = 'Dev Seed Regular Season';
export const DEV_SEED_PLAYER_COUNT = 8;

/** Email login of seeded player `n` (1 to `DEV_SEED_PLAYER_COUNT`); the password is `DEV_SEED_PASSWORD`. */
export const devSeedPlayerEmail = (n: number): string => `seed-player-${n}@poketools.test`;
