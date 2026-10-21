/**
 * Domain errors of `updateParticipantSeeds` (`src/lib/supabase/queries/tournaments.ts`).
 * Dependency-free so routes can `instanceof`-check them while their tests mock
 * the query module.
 */
import { UserFacingError } from '@/lib/api/user-facing-error';

/**
 * A seed request would leave two enrollees of the tournament on the same seed:
 * a requested seed is held by a player the request does not reseed. Raised
 * before anything is written.
 */
export class SeedConflictError extends UserFacingError<'SEED_CONFLICT'> {
  constructor(seed: number) {
    super(
      `Seed ${seed} is already held by another participant — include them in the reseed or pick a free seed.`,
      { code: 'SEED_CONFLICT', params: { seed }, status: 409 },
    );
    this.name = 'SeedConflictError';
  }
}

/**
 * Some seed writes landed and some failed (for example a concurrent reseed
 * took a seed between the read and the write). The participants whose seed
 * was cleared or rewritten keep their new value, so the seeding is
 * incomplete until the admin saves it again. `cause` holds the failed writes'
 * errors.
 */
export class SeedUpdatePartialError extends UserFacingError<'SEED_UPDATE_PARTIAL'> {
  readonly failedPlayerIds: readonly string[];

  constructor(failedPlayerIds: readonly string[], cause: unknown) {
    super(
      `Seeding was only partly saved — ${failedPlayerIds.length} participant(s) could not be updated. Reload and save the seeding again.`,
      { code: 'SEED_UPDATE_PARTIAL', params: { count: failedPlayerIds.length }, status: 500 },
    );
    this.name = 'SeedUpdatePartialError';
    this.failedPlayerIds = failedPlayerIds;
    this.cause = cause;
  }
}
