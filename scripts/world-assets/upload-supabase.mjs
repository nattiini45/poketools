#!/usr/bin/env node
/**
 * Step 4: publish the world assets to the Supabase Storage public bucket
 * `world-assets` (DATA-PLAN fix 7, design decision D37).
 *
 * DRY RUN BY DEFAULT. Nothing is uploaded, no env is read and no client is
 * created unless `--live` is passed, and a live publish runs only with the
 * maintainer's approval at upload time (AGENTS.md: automation never spends the Supabase
 * quota; no Storage publishing without a maintainer's approval).
 *
 * What gets published (see publish-set.mjs for the rules):
 *  - every asset the manifest references, under a CONTENT-HASHED name
 *    (`models/regular/4.<sha256[:12]>.glb`), cacheControl 31536000 (1 year);
 *  - env files ALSO under their logical names with the one-day cache, because
 *    world-env.ts resolves them by logical name (drop with --no-env-compat
 *    once it resolves through the manifest's `files` map);
 *  - ATTRIBUTION.md under its logical name;
 *  - the manifest LAST, under --manifest-name (D42: manifest.v3.json, WORLD_MANIFEST_FILE), rewritten to
 *    the hashed names, cacheControl 0 so the client revalidates it by ETag. No object named
 *    manifest.json is ever written: the live v2 manifest stays what older deployed builds read
 *    (publish-verify fails a live plan that would write it).
 * The source directory is never modified: the local mirror and the dev loop
 * (/models/world with logical names) keep working unchanged.
 *
 * Usage (the default name is refused on the promoted mirror: its GLBs are meshopt, TA-B1):
 *   node scripts/world-assets/upload-supabase.mjs --from-mirror --manifest-name manifest.v3.json --plan-dir <R1>          # R1 dry run
 *   node scripts/world-assets/upload-supabase.mjs --from-mirror --manifest-name manifest.v3.json --live --expect-plan <R1> # R2, maintainer approval only
 * Options:
 *   --from-mirror          publish from public/models/world (default source: scripts/world-assets/out)
 *   --source <dir>         publish from any directory holding a manifest.json
 *   --only models|props|env|manifest
 *                          dry run only: a partial set never passes the live plan checks (it publishes
 *                          no manifest, or a manifest naming objects outside the set), so --live refuses it
 *   --no-env-compat        skip the logical-name copies of env files
 *   --plan-dir <dir>       where the dry run writes publish-plan.json and the
 *                          published manifest (default: scripts/world-assets/.cache/publish)
 *   --manifest-name <name> publish the manifest under <name> (D42: manifest.v3.json, read only by
 *                          N1-armed code; the live manifest.json is never written). The source
 *                          manifest is <source>/<name> when the source holds one (D42 commit P: the
 *                          promoted mirror keeps the v2 manifest.json beside manifest.v3.json, and
 *                          the v3 one is what is published), else <source>/manifest.json (an arm
 *                          mirror such as public/models/world/d42m); the plan dir gets <name>
 *   --expect-plan <dir>    R2 is bound to R1: refuse unless the recomputed set equals <dir>'s
 *                          publish-plan.json and <dir>/<manifest name>, compared by sha256
 *                          (publish-verify.mjs planDigest; every plan entry records its sha256).
 *                          Required for EVERY --live run (TA-B1); a live run must also pass
 *                          publish-verify's plan checks (no manifest.json object among them), and a
 *                          set under manifest.json carrying a meshopt GLB is refused, dry run included
 *   --dry-run              the default; accepted for clarity
 *   --live                 really upload (needs NEXT_PUBLIC_SUPABASE_URL and
 *                          SUPABASE_SERVICE_ROLE_KEY from .env.local)
 *
 * Exit codes: 0 ok, 1 nothing to publish / missing files / failed uploads,
 * 2 usage error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKET, CACHE_DIR, MIRROR_DIR, OUT_DIR, loadEnvLocal, log, parallel, relPosix, walkFiles } from './lib.mjs';
import { MANIFEST_FILE, ONLY_SCOPES, buildPublishSet, uploadPhases } from './publish-set.mjs';
import { comparePlans, isMeshopt, sha256, verifyPlan } from './publish-verify.mjs';

const USAGE = 'usage: upload-supabase.mjs [--from-mirror | --source <dir>] [--only models|props|env|manifest] [--no-env-compat] [--plan-dir <dir>] [--manifest-name <name>] [--expect-plan <dir>] [--dry-run | --live]';
/** TOOLS-13: a published manifest name: manifest.json or manifest.<tag>.json (D42: manifest.v3.json). */
const MANIFEST_NAME_RE = /^manifest(?:\.[a-z0-9-]+)*\.json$/;

/** Parse argv (without node + script). Returns { options } or { error }. */
export function parseArgs(argv) {
  const options = { live: false, dryRunFlag: false, fromMirror: false, source: null, only: null, envCompat: true, planDir: null, manifestName: MANIFEST_FILE, expectPlan: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i += 1;
      return next;
    };
    if (token === '--live') options.live = true;
    else if (token === '--dry-run') options.dryRunFlag = true;
    else if (token === '--from-mirror') options.fromMirror = true;
    else if (token === '--no-env-compat') options.envCompat = false;
    else if (token === '--source') {
      options.source = value();
      if (!options.source) return { error: '--source needs a directory' };
    } else if (token === '--plan-dir') {
      options.planDir = value();
      if (!options.planDir) return { error: '--plan-dir needs a directory' };
    } else if (token === '--manifest-name') {
      options.manifestName = value();
      if (!options.manifestName || !MANIFEST_NAME_RE.test(options.manifestName)) return { error: '--manifest-name must be manifest.json or manifest.<tag>.json (e.g. manifest.v3.json)' };
    } else if (token === '--expect-plan') {
      options.expectPlan = value();
      if (!options.expectPlan) return { error: '--expect-plan needs the R1 plan directory' };
    } else if (token === '--only') {
      options.only = value();
      if (!ONLY_SCOPES.includes(options.only ?? '')) return { error: `--only must be one of ${ONLY_SCOPES.join('|')}` };
    } else if (token === '--help' || token === '-h') return { help: true };
    else return { error: `unknown argument "${token}"` };
  }
  if (options.live && options.dryRunFlag) return { error: '--live and --dry-run are mutually exclusive' };
  if (options.fromMirror && options.source) return { error: '--from-mirror and --source are mutually exclusive' };
  // A partial set always fails livePlanFails (no manifest entry, or --only manifest's unpublished references): refuse it up front.
  if (options.live && options.only) return { error: `--only is dry-run only: a partial set (--only ${options.only}) never passes the live plan checks` };
  // TA-B1: every live run is bound to R1's plan (the default name included: the live manifest.json is never written).
  if (options.live && !options.expectPlan) return { error: `--live needs --expect-plan <R1 plan dir> (R2 is bound to R1's plan)${options.manifestName === MANIFEST_FILE ? '; D42 publishes --manifest-name manifest.v3.json, the live manifest.json is never written' : ''}` };
  return { options };
}

function sourceDirOf(options) {
  if (options.source) return resolve(options.source);
  return options.fromMirror ? MIRROR_DIR : OUT_DIR;
}

/**
 * D42 commit P: the source manifest a publish reads. The promoted mirror holds the shipped manifest under its
 * published name (manifest.v3.json, WORLD_MANIFEST_FILE in model-manifest.ts) beside the tracked v2 manifest.json,
 * so <source>/<manifestName> wins when it exists; an arm mirror (bake output) holds only manifest.json.
 */
export function sourceManifestFile(sourceDir, manifestName) {
  return manifestName !== MANIFEST_FILE && existsSync(join(sourceDir, manifestName)) ? manifestName : MANIFEST_FILE;
}

async function ensureBucket(client) {
  const { data, error } = await client.storage.getBucket(BUCKET);
  if (data) return;
  if (error && !/not found/i.test(error.message)) throw error;
  const created = await client.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '25MB',
  });
  if (created.error) throw created.error;
  log(`created public bucket ${BUCKET}`);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function uploadLive(entries, { sourceDir, manifestBytes }) {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local) for --live');
    return 1;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await ensureBucket(client);

  const bodyOf = (entry) => (entry.kind === 'manifest' ? Buffer.from(manifestBytes) : readFileSync(join(sourceDir, entry.logical)));
  const failures = [];
  const upload = async (entry) => {
    const { error } = await client.storage.from(BUCKET).upload(entry.path, bodyOf(entry), {
      contentType: entry.contentType,
      cacheControl: entry.cacheControl,
      upsert: true,
    });
    if (error) {
      failures.push(entry.path);
      console.error(`  FAILED ${entry.path}: ${error.message}`);
    } else {
      log(`  ${entry.path} ${kb(entry.bytes)} max-age=${entry.cacheControl}`);
    }
  };

  const phases = uploadPhases(entries);
  await parallel(phases.assets, 6, upload);
  await parallel(phases.logical, 6, upload);
  if (failures.length > 0) {
    console.error(`\n${failures.length} upload(s) failed; manifest.json NOT published (it would name missing objects)`);
    return 1;
  }
  for (const entry of phases.manifest) await upload(entry);
  if (failures.length > 0) return 1;
  log(`\n${entries.length}/${entries.length} uploaded`);
  log(`NEXT_PUBLIC_WORLD_ASSETS_URL=${url}/storage/v1/object/public/${BUCKET}`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.error(`upload-supabase: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { options } = parsed;
  const sourceDir = sourceDirOf(options);
  const sourceManifest = sourceManifestFile(sourceDir, options.manifestName);
  const manifestPath = join(sourceDir, sourceManifest);
  if (!existsSync(manifestPath)) {
    console.error(`upload-supabase: nothing to publish: ${manifestPath} does not exist${options.fromMirror || options.source ? '' : ' (out/ is not built; use --from-mirror to publish the local mirror)'}`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = walkFiles(sourceDir).map((file) => relPosix(sourceDir, file));
  const set = buildPublishSet({
    manifest,
    files,
    readBytes: (file) => readFileSync(join(sourceDir, file)),
    envCompat: options.envCompat,
    only: options.only,
    sourceManifest,
  });

  if (set.missing.length > 0) {
    console.error(`upload-supabase: ${set.missing.length} file(s) the manifest references are missing from ${sourceDir}:`);
    for (const file of set.missing.slice(0, 20)) console.error(`  ${file}`);
    if (set.missing.length > 20) console.error(`  ... and ${set.missing.length - 20} more`);
    return 1;
  }
  // TOOLS-13: the manifest object's name (D42: manifest.v3.json) and every entry's sha256 (R2 is bound to R1's plan).
  set.entries = set.entries.map((e) => {
    const named = e.kind === 'manifest' ? { ...e, logical: options.manifestName, path: options.manifestName } : e;
    return { ...named, sha256: sha256(e.kind === 'manifest' ? set.manifestBytes : readFileSync(join(sourceDir, e.logical))) };
  });
  // TA-B1: a manifest.json naming a meshopt object would hand every decoder-less deployment an unloadable figure.
  // Refused in the dry run too (no plan is written), so no R1 plan can ever carry it.
  if (options.manifestName === MANIFEST_FILE) {
    const mo = meshoptUnderLiveName(set.entries, (f) => readFileSync(join(sourceDir, f)));
    if (mo.length) {
      console.error(`upload-supabase: REFUSED: ${mo.length} EXT_meshopt_compression GLB(s) under the manifest name ${MANIFEST_FILE} (e.g. ${mo[0]}); publish them under --manifest-name manifest.v3.json (D42: the live manifest.json is never written)`);
      return 1;
    }
  }
  if (options.expectPlan) {
    const r1 = resolve(options.expectPlan);
    const r1Plan = join(r1, 'publish-plan.json');
    const r1Manifest = join(r1, options.manifestName);
    if (!existsSync(r1Plan) || !existsSync(r1Manifest)) {
      console.error(`upload-supabase: --expect-plan: ${!existsSync(r1Plan) ? r1Plan : r1Manifest} does not exist`);
      return 1;
    }
    const why = comparePlans({ entries: set.entries }, set.manifestBytes, JSON.parse(readFileSync(r1Plan, 'utf8')), readFileSync(r1Manifest));
    if (why.length) {
      console.error(`upload-supabase: REFUSED: the recomputed publish set differs from R1's plan in ${r1}:\n${why.map((w) => `  - ${w}`).join('\n')}`);
      return 1;
    }
    log(`--expect-plan: the publish set equals R1's plan in ${r1} (entries and ${options.manifestName} by sha256)`);
  }
  const assetEntries = set.entries.filter((e) => e.kind !== 'manifest');
  if (assetEntries.length === 0 && options.only !== 'manifest') {
    console.error(`upload-supabase: 0 files to publish from ${sourceDir}; refusing to publish an empty set`);
    return 1;
  }

  const mode = options.live ? 'LIVE' : 'dry run';
  log(`publish set from ${sourceDir} (source manifest ${sourceManifest}) -> bucket ${BUCKET} (${mode})`);
  for (const entry of set.entries) {
    const from = entry.path === entry.logical ? '' : `  <- ${entry.logical}`;
    log(`  [${entry.kind}] ${entry.path} ${kb(entry.bytes)} max-age=${entry.cacheControl}${from}`);
  }
  const totalBytes = set.entries.reduce((sum, e) => sum + e.bytes, 0);
  const counts = set.entries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
  log(`\n${set.entries.length} files (${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}) · ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  if (set.skipped.length > 0) log(`skipped ${set.skipped.length} unreferenced file(s): ${set.skipped.slice(0, 10).join(', ')}${set.skipped.length > 10 ? ', ...' : ''}`);

  if (!options.live) {
    const planDir = options.planDir ? resolve(options.planDir) : join(CACHE_DIR, 'publish');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, options.manifestName), set.manifestBytes);
    writeFileSync(join(planDir, 'publish-plan.json'), `${JSON.stringify({ source: sourceDir, bucket: BUCKET, manifestName: options.manifestName, sourceManifest, entries: set.entries, skipped: set.skipped }, null, 2)}\n`);
    log(`dry run: nothing uploaded. Published manifest and plan written to ${planDir}`);
    log(`a real upload (R2) needs --live --expect-plan ${planDir} and a maintainer's approval (AGENTS.md: no Storage publishing without it)`);
    return 0;
  }
  // TA-B1: the live set must pass publish-verify's plan checks itself (no manifest.json, hashed names, every
  // reference resolves, no meshopt env or logical-name object), not only equal R1's plan.
  const fails = livePlanFails(set, { manifestName: options.manifestName, readSource: (f) => readFileSync(join(sourceDir, f)) });
  if (fails.length) {
    console.error(`upload-supabase: REFUSED: the publish set fails publish-verify (${fails.length}):\n${fails.slice(0, 40).map((f) => `  - ${f}`).join('\n')}`);
    return 1;
  }
  return uploadLive(set.entries, { sourceDir, manifestBytes: set.manifestBytes });
}

/** TA-B1: the logical names of the .glb entries that carry EXT_meshopt_compression. */
export function meshoptUnderLiveName(entries, readSource) {
  const glbs = new Set(entries.filter((e) => e.kind !== 'manifest' && /\.glb$/i.test(e.logical)).map((e) => e.logical));
  return [...glbs].filter((f) => isMeshopt(readSource(f)));
}

/** TA-B1: publish-verify's verifyPlan over the recomputed set (the checks a live run must pass). */
export function livePlanFails(set, { manifestName, readSource }) {
  let manifest = null;
  try { manifest = JSON.parse(Buffer.from(set.manifestBytes ?? '').toString('utf8')); } catch { return ['the published manifest bytes are not JSON']; }
  return verifyPlan({ plan: { entries: set.entries }, manifest, manifestName, readSource }).fails;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`upload-supabase: FAIL ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
