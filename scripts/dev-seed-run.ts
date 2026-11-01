/**
 * Runner of `npm run dev:seed` (started by scripts/dev-seed.mjs through tsx). Refuses a Supabase URL that is not the
 * loopback interface before the service-role client is even imported, so a hosted project can never be reached
 * whatever the environment holds.
 */
import { assertLoopbackUrl } from '../src/test/local-stack';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('[dev-seed] refusing to run with NODE_ENV=production');
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('[dev-seed] SUPABASE_SERVICE_ROLE_KEY is not set');

  // The client reads its env at import: load the seed only after the guard.
  const { runDevSeed, DEV_SEED_ADMIN, DEV_SEED_LEAGUE_NAME } = await import('../src/lib/dev-seed/seed');
  const report = await runDevSeed();

  console.log(`[dev-seed] standard rulesets created: ${report.rulesetsCreated}`);
  console.log(`[dev-seed] league "${DEV_SEED_LEAGUE_NAME}": ${report.leagueCreated ? 'created' : 'already there'} (${report.leagueId})`);
  console.log('[dev-seed] local admin (local stack only):');
  console.log(`[dev-seed]   email:    ${DEV_SEED_ADMIN.email}`);
  console.log(`[dev-seed]   password: ${DEV_SEED_ADMIN.password}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
