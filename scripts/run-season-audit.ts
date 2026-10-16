/**
 * Season derived-data audit (spec §28 one-time audit).
 *
 * Drives the existing reconcile engine (`src/lib/reconcile/reconcile-season.ts`)
 * in DRY-RUN mode by default and prints a §28-style per-season report, then an
 * aggregate summary. This is the one-time audit harness described in spec §28.
 *
 * It does NOT reimplement any reconciliation — it imports the shipped,
 * review-gated engine and only owns: argv parsing, env loading, the per-season
 * loop with per-season error isolation, report formatting, and the aggregate.
 *
 * ---------------------------------------------------------------------------
 * Prerequisites
 * ---------------------------------------------------------------------------
 *   1. A reachable Supabase database with the full migration set applied.
 *      The reconcile engine reads, per season:
 *        - seasons, season_participants, matches, games, battle_stats,
 *          player_ratings, rating_history          (baseline schema)
 *        - evolution_tracker, evo_progress_log, match_evolution_snapshots,
 *          evolution_events, evolution_tiers, format_rules (EPB migrations)
 *      If the EPB migrations are NOT applied, EPB seasons will error out
 *      (per-season) and non-EPB seasons still reconcile ratings.
 *   2. Service-role env vars present (`.env.local` is auto-loaded):
 *        NEXT_PUBLIC_SUPABASE_URL
 *        SUPABASE_SERVICE_ROLE_KEY
 *      Without these the script fails FAST with a clear §28 message (it does
 *      NOT silently swallow config errors).
 *
 * ---------------------------------------------------------------------------
 * How to run
 * ---------------------------------------------------------------------------
 *   # DRY-RUN audit (default; READ-ONLY — no writes):
 *   npx tsx --tsconfig scripts/tsconfig.audit.json scripts/run-season-audit.ts
 *
 *   # Audit a single season only:
 *   npx tsx --tsconfig scripts/tsconfig.audit.json scripts/run-season-audit.ts --season=<uuid>
 *
 *   # REPAIR mode (WRITES — only when you intend to fix mismatches):
 *   npx tsx --tsconfig scripts/tsconfig.audit.json scripts/run-season-audit.ts --repair
 *   npx tsx --tsconfig scripts/tsconfig.audit.json scripts/run-season-audit.ts --season=<uuid> --repair
 *
 *   # Or via the npm script:
 *   npm run audit:seasons
 *   npm run audit:seasons -- --season=<uuid>
 *   npm run audit:seasons -- --repair
 *
 * The `--tsconfig scripts/tsconfig.audit.json` flag is required because the
 * reconcile import chain pulls in `src/lib/supabase/client.ts`, which imports
 * the `server-only` marker package. Under `tsx` there is no Next build to alias
 * `server-only`, and it is not a top-level dependency, so the dedicated
 * tsconfig maps `server-only` to the existing no-op stub
 * `src/test/server-only-stub.ts` (the same stub Vitest uses). The root
 * `tsconfig.json` is left untouched so the Next.js server-only guard stays
 * intact for the app build.
 *
 * Flags:
 *   --season=<id>   Audit one season (by id). Default: all seasons.
 *   --repair        Run in REPAIR mode (writes). Default OFF = DRY-RUN.
 *
 * This script is READ-ONLY by default (dry-run). It only mutates data when run
 * with `--repair`. It never applies migrations.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Env loading (called from main() AFTER parseArgs()) ────────────────────
// The shared `supabase` client (`src/lib/supabase/client.ts`) reads
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY eagerly at module load
// via requireEnv(). If env isn't on process.env by then, the import itself
// throws. So we load `.env.local`/`.env` before importing the engine, mirroring
// import-point-buy.ts. This is invoked from main() AFTER parseArgs() so a
// malformed `--season` exits with a usage error before any env file is read
// or process.env is mutated.
function loadEnvFiles(): void {
  for (const name of ['.env.local', '.env']) {
    try {
      const content = readFileSync(resolve(process.cwd(), name), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      // optional file
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

/** Parsed argv, strictly typed (no `any`). */
interface AuditArgs {
  /** Single season id to audit, or null for all seasons. */
  seasonId: string | null;
  /** Repair mode (writes). Default false = dry-run. */
  repair: boolean;
}

interface ParsedReport {
  seasonId: string;
  dryRun: boolean;
  evolutionMismatches: number;
  impossibleLineups: number;
  evolutionRepaired?: { trackersUpdated: number; eventsRewritten: number; evolutionPoints: number };
  ratingsMismatches: number;
  ratingsSampleFields: string[];
  ratingsRepairedPlayers?: number;
  aggregatesRebuilt?: { gamesProcessed: number; aggregatesDeleted: number };
  streaksRebuiltPlayers?: number;
  playersAffectedCount: number;
  playersAffectedIds: string[];
  totalMismatches: number;
  repaired: boolean;
}

// ── Arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): AuditArgs {
  const getArg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

  const repair = argv.includes('--repair');

  // Validate `--season` so a malformed flag can't silently widen scope to "all
  // seasons". Reject, with a usage error, BEFORE any env loading or DB work:
  //   - bare `--season` (no `=value`)            → treated as "all seasons" today
  //   - `--season=` (empty value)                → falsy → "all seasons" today
  //   - `--season=   ` (whitespace-only value)   → trimmed empty → "all seasons"
  // A non-empty trimmed value is the minimum requirement; we additionally
  // require it look like a UUID so a stray token doesn't reach the DB. An
  // unknown-but-UUID-shaped id is still allowed through — the reconcile engine
  // surfaces it as a clear per-season error ("season … not found").
  const USAGE =
    'Usage: npm run audit:seasons [-- --season=<uuid>] [-- --repair]';
  const bareSeason = argv.includes('--season');
  const seasonRaw = getArg('season');
  if (bareSeason && seasonRaw === null) {
    console.error(`\n--season requires a value.\n${USAGE}`);
    process.exit(1);
  }
  if (seasonRaw !== null) {
    const seasonId = seasonRaw.trim();
    if (!seasonId) {
      console.error(`\n--season requires a non-empty value.\n${USAGE}`);
      process.exit(1);
    }
    // Lightweight UUID shape check (8-4-4-4-12 hex). Accepts the canonical and
    // brace-wrapped forms; rejects obviously-non-id tokens early.
    if (!/^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/.test(seasonId)) {
      console.error(`\n--season expects a UUID, got: ${seasonId}\n${USAGE}`);
      process.exit(1);
    }
    return { seasonId, repair };
  }

  return { seasonId: null, repair };
}

// ── Report formatting ─────────────────────────────────────────────────────

/**
 * Render an error for the console. Supabase/PostgREST returns plain error
 * objects (not Error instances) shaped `{ code, message, details, hint }`;
 * `String()` on those yields the useless "[object Object]", so extract the
 * useful fields explicitly and fall back to message/stack for real Errors.
 */
function describeError(err: unknown): string {
  if (err == null) return String(err);
  if (err instanceof Error) {
    return err.message || err.stack || err.constructor.name;
  }
  if (typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    if (typeof e.message === 'string') {
      const code = typeof e.code === 'string' ? e.code : '';
      const hint = typeof e.hint === 'string' && e.hint ? ` (hint: ${e.hint})` : '';
      return `${code ? `[${code}] ` : ''}${e.message}${hint}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return '[object Object]';
    }
  }
  return String(err);
}

// ── Infrastructure-error classification ───────────────────────────────────
// In all-seasons mode, a DB/config-level failure (no service-role env, missing
// `seasons` table, schema cache not built, unreachable DB, …) aborts the run
// with the §28 diagnostic. In single-season mode the SAME class of failure used
// to be swallowed by the per-season try/catch and printed only as
// `[ERROR] season …`, which is inconsistent operator messaging. This helper
// distinguishes infrastructure failures (fatal, §28) from season-specific
// reconciliation errors (per-season, aggregated, exit 2) so the single-season
// path can route them identically to all-seasons mode.
//
// Detected signals (any one match ⇒ infrastructural):
//   - PostgREST error codes (PGRST…, e.g. PGRST205 "schema cache miss")
//   - Postgres/PostgREST text: "Could not find the table", "schema cache"
//   - Network/connection codes: ECONNREFUSED, ENOTFOUND, ETIMEDOUT,
//     "connect ETIMEDOUT" (and a few related connect-time errors)
//   - Missing-env / requireEnv config errors thrown by the shared client
function isInfrastructureError(err: unknown): boolean {
  const text = describeError(err);
  // PostgREST error codes are surfaced as `[PGRST205] …` by describeError and as
  // a `.code` field on the raw PostgREST error object; check both.
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  if (/^PGRST\d+/.test(code) || /\bPGRST\d+/.test(text)) return true;
  if (/Could not find the table/i.test(text)) return true;
  if (/schema cache/i.test(text)) return true;
  if (/\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN)\b/.test(text)) return true;
  if (/connect ETIMEDOUT/i.test(text)) return true;
  if (/Missing required environment variable/i.test(text)) return true;
  return false;
}

function header(mode: 'DRY-RUN' | 'REPAIR', scope: string): void {
  const ts = new Date().toISOString();
  const bar = '═'.repeat(72);
  console.log(`\n${bar}`);
  console.log('  SEASON DERIVED-DATA AUDIT  (spec §28)');
  console.log(bar);
  console.log(`  Mode    : ${mode}`);
  console.log(`  Scope   : ${scope}`);
  console.log(`  Run at  : ${ts}`);
  console.log(`${bar}`);
}

function printSeasonBlock(r: ParsedReport): void {
  const line = '─'.repeat(72);
  console.log(`\n${line}`);
  console.log(`  Season: ${r.seasonId}   [${r.dryRun ? 'DRY-RUN' : 'REPAIR'}]`);
  console.log(line);

  // Evolution
  console.log('  evolution:');
  console.log(`    mismatches        : ${r.evolutionMismatches}`);
  console.log(`    impossibleLineups : ${r.impossibleLineups}`);
  if (r.evolutionRepaired) {
    console.log('    repaired          :');
    console.log(`      trackersUpdated : ${r.evolutionRepaired.trackersUpdated}`);
    console.log(`      eventsRewritten : ${r.evolutionRepaired.eventsRewritten}`);
    console.log(`      evolutionPoints  : ${r.evolutionRepaired.evolutionPoints}`);
  }

  // Ratings
  console.log('  ratings:');
  console.log(`    mismatches        : ${r.ratingsMismatches}`);
  if (r.ratingsSampleFields.length > 0) {
    console.log(`    sample fields     : ${r.ratingsSampleFields.join(', ')}`);
  }
  if (r.ratingsRepairedPlayers !== undefined) {
    console.log(`    repaired players  : ${r.ratingsRepairedPlayers}`);
  }

  // Aggregates / streaks (repair-only; absent in dry-run)
  if (r.aggregatesRebuilt) {
    console.log('  aggregates (rebuilt, league scope):');
    console.log(`    gamesProcessed    : ${r.aggregatesRebuilt.gamesProcessed}`);
    console.log(`    aggregatesDeleted : ${r.aggregatesRebuilt.aggregatesDeleted}`);
  }
  if (r.streaksRebuiltPlayers !== undefined) {
    console.log(`  streaks (rebuilt)   : players=${r.streaksRebuiltPlayers}`);
  }

  // Players affected
  console.log(`  playersAffected     : ${r.playersAffectedCount}`);
  if (r.playersAffectedIds.length > 0) {
    const shown = r.playersAffectedIds.slice(0, 10);
    const more = r.playersAffectedIds.length - shown.length;
    console.log(`    ids (first ≤10)   : ${shown.join(', ')}${more > 0 ? `  …(+${more} more)` : ''}`);
  }

  // Summary
  console.log(`  summary             : totalMismatches=${r.totalMismatches}, repaired=${r.repaired}`);
}

function printAggregate(
  reports: ParsedReport[],
  mode: 'DRY-RUN' | 'REPAIR',
  errorCount: number
): void {
  const totalSeasons = reports.length;
  const totalMismatches = reports.reduce((s, r) => s + r.totalMismatches, 0);
  const totalImpossible = reports.reduce((s, r) => s + r.impossibleLineups, 0);
  const allAffected = new Set<string>();
  for (const r of reports) for (const id of r.playersAffectedIds) allAffected.add(id);

  const bar = '═'.repeat(72);
  console.log(`\n${bar}`);
  console.log('  AGGREGATE');
  console.log(bar);
  console.log(`  seasons audited (ok) : ${totalSeasons}`);
  console.log(`  seasons errored      : ${errorCount}`);
  console.log(`  total mismatches     : ${totalMismatches}`);
  console.log(`  total impossibleLineups : ${totalImpossible}`);
  console.log(`  total players affected : ${allAffected.size}`);
  if (mode === 'DRY-RUN') {
    console.log('  REPAIR was NOT run (dry-run) — no data was written.');
  } else if (errorCount > 0 && totalSeasons === 0) {
    console.log(
      `  REPAIR FAILED for all ${errorCount} season(s) — NO season completed; check the per-season [ERROR] lines above.`
    );
  } else if (errorCount > 0) {
    console.log(
      `  REPAIR applied to ${totalSeasons} season(s); ${errorCount} season(s) ERRORED mid-repair — their remaining drift is re-detectable by a fresh dry-run; check the per-season [ERROR] lines above.`
    );
  } else {
    console.log('  REPAIR applied — derived rows were rewritten for reported seasons.');
  }
  console.log(bar);
}

// ── Map a ReconcileReport into the slim ParsedReport for printing ──────────
// Done as a separate function (not inline) so the printer stays decoupled from
// the engine's exact exported shape and is easy to unit-inspect.

interface EvolutionRepaired {
  trackersUpdated: number;
  eventsRewritten: number;
  evolutionPoints: number;
}
interface RatingMismatchLite {
  playerId: string;
  field: string;
}
interface RawReport {
  seasonId: string;
  dryRun: boolean;
  evolution: {
    mismatches: { trackerId: string; field: string }[];
    impossibleLineups: unknown[];
    repaired?: EvolutionRepaired;
  };
  ratings: {
    mismatches: RatingMismatchLite[];
    repaired?: { players: number };
  };
  aggregates: { rebuilt?: { gamesProcessed: number; aggregatesDeleted: number } };
  streaks: { rebuilt?: { players: number } };
  playersAffected: string[];
  summary: { totalMismatches: number; repaired: boolean };
}

function toParsedReport(r: RawReport): ParsedReport {
  // Sample a few rating mismatch fields (deduped, first ≤5) so the report
  // hints at WHICH columns drift without dumping every field.
  const seenFields = new Set<string>();
  const sampleFields: string[] = [];
  for (const m of r.ratings.mismatches) {
    if (!seenFields.has(m.field)) {
      seenFields.add(m.field);
      sampleFields.push(m.field);
      if (sampleFields.length >= 5) break;
    }
  }

  return {
    seasonId: r.seasonId,
    dryRun: r.dryRun,
    evolutionMismatches: r.evolution.mismatches.length,
    impossibleLineups: r.evolution.impossibleLineups.length,
    evolutionRepaired: r.evolution.repaired,
    ratingsMismatches: r.ratings.mismatches.length,
    ratingsSampleFields: sampleFields,
    ratingsRepairedPlayers: r.ratings.repaired?.players,
    aggregatesRebuilt: r.aggregates.rebuilt,
    streaksRebuiltPlayers: r.streaks.rebuilt?.players,
    playersAffectedCount: r.playersAffected.length,
    playersAffectedIds: r.playersAffected,
    totalMismatches: r.summary.totalMismatches,
    repaired: r.summary.repaired,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Parse + validate argv FIRST, before any env-file work. A malformed
  // `--season` (bare, empty, or non-UUID) must exit with a usage error before
  // `.env.local`/`.env` are read or process.env is mutated.
  const args = parseArgs(process.argv.slice(2));

  // Args are valid → load env files before any env-dependent code (header,
  // env check, dynamic engine import). Keeps the engine import after env load.
  loadEnvFiles();

  const mode: 'DRY-RUN' | 'REPAIR' = args.repair ? 'REPAIR' : 'DRY-RUN';
  const scope = args.seasonId ? `single season (${args.seasonId})` : 'all seasons';
  header(mode, scope);

  // Fail FAST on missing env before attempting to load the engine. The shared
  // client throws on import if these are absent; we surface a §28-grade message
  // instead of a raw `requireEnv` stack.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '\nSupabase environment not configured (need service-role URL+KEY) and/or ' +
        'migrations not applied. This script requires a live DB. See §28.'
    );
    console.error('  Missing:' + (!url ? ' NEXT_PUBLIC_SUPABASE_URL' : '') + (!key ? ' SUPABASE_SERVICE_ROLE_KEY' : ''));
    process.exit(1);
  }

  // Load the engine AFTER env is set. This is dynamic so a module-load failure
  // (e.g. `server-only` not resolvable, or a transitive init error) becomes a
  // clean §28 message rather than an uncaught top-level throw.
  let engine: typeof import('@/lib/reconcile/reconcile-season');
  try {
    engine = await import('@/lib/reconcile/reconcile-season');
  } catch (err) {
    console.error(
      '\nSupabase environment not configured (need service-role URL+KEY) and/or ' +
        'migrations not applied. This script requires a live DB. See §28.'
    );
    console.error('  Engine import failed:', describeError(err));
    process.exit(1);
  }

  const opts = { repair: args.repair }; // dryRun defaults true inside the engine; repair:true forces writes.

  const parsedReports: ParsedReport[] = [];
  let errorCount = 0;

  if (args.seasonId) {
    // Single season — surface its error inline but don't abort the aggregate.
    try {
      const report = await engine.reconcileSeasonDerivedData(args.seasonId, opts);
      const p = toParsedReport(report as unknown as RawReport);
      parsedReports.push(p);
      printSeasonBlock(p);
    } catch (err) {
      if (isInfrastructureError(err)) {
        // DB/config-level failure (missing env, missing `seasons` table, schema
        // cache miss, unreachable DB, …) — fatal, identical to all-seasons mode.
        // Print the §28 diagnostic + underlying cause and exit nonzero (1).
        console.error(
          '\nSupabase environment not configured (need service-role URL+KEY) and/or ' +
            'migrations not applied. This script requires a live DB. See §28.'
        );
        console.error('  Single-season reconcile failed:', describeError(err));
        process.exit(1);
      }
      // Season-specific reconciliation error (e.g. unknown season id, EPB-table
      // mismatch for one season) — keep per-season isolation: aggregate it and
      // exit 2 so CI distinguishes partial failure from a clean dry-run.
      errorCount += 1;
      console.error(`\n  [ERROR] season ${args.seasonId}: ${describeError(err)}`);
      console.error('  (per-season error — audit continued for the aggregate.)');
    }
  } else {
    // All seasons. We deliberately do NOT call reconcileAllSeasons here: it
    // rejects the WHOLE batch on the first season error (Promise.all). For an
    // audit we want per-season isolation so one bad season (e.g. missing EPB
    // tables) doesn't hide the others. So we fetch the season list ourselves
    // and run each season in its own try/catch.
    let seasonIds: string[];
    try {
      // listAllSeasonIds is exported alongside the reconcile functions; reach it
      // through the same module to avoid a second import surface.
      const { listAllSeasonIds } = await import('@/lib/supabase/queries/seasons');
      seasonIds = await listAllSeasonIds();
    } catch (err) {
      console.error(
        '\nSupabase environment not configured (need service-role URL+KEY) and/or ' +
          'migrations not applied. This script requires a live DB. See §28.'
      );
      console.error('  Could not list seasons:', describeError(err));
      process.exit(1);
    }

    console.log(`\n  Found ${seasonIds.length} season(s). Auditing each (per-season error isolation on).\n`);

    for (const seasonId of seasonIds) {
      try {
        const report = await engine.reconcileSeasonDerivedData(seasonId, opts);
        const p = toParsedReport(report as unknown as RawReport);
        parsedReports.push(p);
        printSeasonBlock(p);
      } catch (err) {
        errorCount += 1;
        console.error(`\n  [ERROR] season ${seasonId}: ${describeError(err)}`);
        console.error('  (per-season error — audit continued to the next season.)');
      }
    }
  }

  printAggregate(parsedReports, mode, errorCount);

  // Non-zero exit when any season errored, so CI/automation can detect a
  // partial failure distinctly from a clean dry-run with zero mismatches.
  if (errorCount > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('\nAudit failed unexpectedly:', describeError(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});