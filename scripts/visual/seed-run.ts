/**
 * Runner of `node scripts/visual/seed.mjs` (started through tsx). Refuses a Supabase URL that is not the loopback
 * interface before the service-role client is even imported, so a hosted project can never be reached whatever the
 * environment holds. Prints created/skipped counts: a second run on the same stack creates nothing.
 */
import { VISUAL_SEED_IDS } from '../../src/lib/visual-seed/ids';
import { assertLoopbackUrl } from '../../src/test/local-stack';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('[visual-seed] refusing to run with NODE_ENV=production');
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('[visual-seed] SUPABASE_SERVICE_ROLE_KEY is not set');

  // The client reads its env at import: load the seed only after the guard.
  const { runVisualSeed } = await import('../../src/lib/visual-seed/seed');
  const report = await runVisualSeed();

  let created = 0;
  for (const [kind, { created: c, skipped }] of Object.entries(report.counts).sort(([a], [b]) => a.localeCompare(b))) {
    created += c;
    console.log(`[visual-seed] ${kind}: ${c} created, ${skipped} skipped`);
  }
  console.log(`[visual-seed] aggregate jobs applied: ${report.aggregateJobsProcessed}, failed: ${report.aggregateJobsFailed}`);
  console.log(created === 0 ? '[visual-seed] nothing to do: the stack already holds the seed' : `[visual-seed] ${created} rows created`);
  console.log(`[visual-seed] sign in as ${report.adminEmail} (dev seed admin) for the signed-in overlays`);
  console.log(`[visual-seed] ids: scripts/visual/seed-ids.json (${Object.keys(VISUAL_SEED_IDS).length} ids)`);
  if (report.aggregateJobsFailed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
