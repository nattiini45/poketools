#!/usr/bin/env node
/**
 * TOOLS-12 (D42 ENGINE-ASSET-PLAN §4 SEAT TOOLS, §5 A2, §7 R1 / R2): offline verification of a publish plan
 * (the dry-run output of upload-supabase.mjs: <plan dir>/publish-plan.json plus the published manifest), so the
 * ONE republish can never break the live site. Nothing here touches the network or the bucket.
 *
 * Checks (each FAIL is listed; exit 1 on any):
 *  1. hashes: every hashed object's name is <stem>.<sha256[:12]><ext> of its source bytes (the plan's source dir);
 *     every entry's recorded sha256 (when the plan carries one) matches the source bytes;
 *  2. every reference resolves: each file the published manifest names (figures[].file, props[].file, the files
 *     map's values, and environment[].file when env compat copies are on) is an object of the plan;
 *  3. no EXT_meshopt_compression in an env object (hashed or compat): world-env.ts loads them by logical name
 *     on every deployment, the decoder-less ones included;
 *  4. meshopt only under the published manifest: a meshopt-encoded object is always a hashed figure / prop object
 *     (never a logical-name copy);
 *  5. no object named manifest.json (D42: the live v2 manifest is never written);
 *  6. every non-env object path is hashed (docs such as ATTRIBUTION.md are listed, never a manifest asset), so
 *     nothing a v2 manifest references is overwritten; with --v2-manifest <published v2 manifest.json>, any plan
 *     object at a path the v2 manifest references must be a hashed name (same name = same bytes) or an env compat
 *     copy (check 3), else FAIL (the v2 collision case); an env compat copy at a v2 path must carry the bytes v2
 *     published (v2.files[logical] is the hashed name of the plan bytes), else FAIL (TA-M7). --v2-manifest is
 *     REQUIRED with a --manifest-name other than manifest.json (R1); --no-v2-check runs without it and prints a
 *     verdict marked "WITHOUT the v2 check" (not valid for R1). The env section and the doc kind are derived from
 *     the published manifest's environment list and the DOC_PATHS allow-list, never trusted from the plan labels;
 *  7. the compat-object list and 8. bytes per section / kind are printed;
 *  9. --expect-plan <R1 plan dir>: the entry sha256 list and the manifest bytes equal R1's (planDigest).
 *
 * Usage:
 *   node scripts/world-assets/publish-verify.mjs --plan-dir <dir> [--manifest-name manifest.v3.json] [--source <dir>]
 *        [--expect-plan <R1 plan dir>] [--v2-manifest <file> | --no-v2-check] [--json]
 * Exit: 0 PASS, 1 FAIL, 2 usage.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HASH_LENGTH, MANIFEST_FILE, contentHash, hashedPath } from './publish-set.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MESHOPT = 'EXT_meshopt_compression';
/** TA-M7: the only paths a doc object may have (publish-set.mjs extraLogical). */
export const DOC_PATHS = ['ATTRIBUTION.md'];

/** The JSON chunk of a GLB (or null when the bytes are not a GLB). */
export function glbJson(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) return null;
  const len = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a || 20 + len > b.length) return null;
  try { return JSON.parse(b.subarray(20, 20 + len).toString('utf8')); } catch { return null; }
}
/** Whether a GLB declares EXT_meshopt_compression (used or required). */
export function isMeshopt(bytes) {
  const j = glbJson(bytes);
  return Boolean(j && [...(j.extensionsUsed ?? []), ...(j.extensionsRequired ?? [])].includes(MESHOPT));
}

/**
 * The digest R2 is bound to (§7): the sorted entry list (kind, path, logical, sha256, bytes, cacheControl,
 * contentType) and the published manifest bytes, each by sha256.
 */
export function planDigest(plan, manifestBytes) {
  const rows = (plan.entries ?? []).map((e) => [e.kind, e.path, e.logical, e.sha256 ?? null, e.bytes, e.cacheControl, e.contentType].join('\u0000')).sort();
  return { entries: sha256(rows.join('\n')), manifest: sha256(manifestBytes), n: rows.length, missingSha: (plan.entries ?? []).filter((e) => !e.sha256).length };
}

/** Every object path a published manifest makes a client load (figures / props file, files map, env logical). */
export function referencedPaths(manifest) {
  const out = new Set();
  for (const e of manifest?.figures ?? []) if (typeof e?.file === 'string') out.add(e.file);
  for (const e of manifest?.props ?? []) if (typeof e?.file === 'string') out.add(e.file);
  for (const v of Object.values(manifest?.files ?? {})) if (typeof v === 'string') out.add(v);
  for (const e of manifest?.environment ?? []) if (typeof e?.file === 'string') out.add(e.file);
  return out;
}

/**
 * Verify one plan. readSource(logical) returns the source bytes (or throws); v2 (optional) is a published v2
 * manifest. Returns { fails: string[], compat: string[], docs: string[], bytes: {...}, meshopt: n }.
 */
export function verifyPlan({ plan, manifest, manifestName = MANIFEST_FILE, readSource, v2 = null }) {
  const fails = [];
  const entries = plan.entries ?? [];
  const paths = new Set(entries.map((e) => e.path));
  const bytes = {};
  const compat = [];
  const docs = [];
  let meshopt = 0;
  // TA-M7: the env section and the doc kind are derived, never taken on trust from the plan's labels.
  const envLogical = new Set((manifest?.environment ?? []).map((x) => x?.file).filter((f) => typeof f === 'string'));
  for (const e of entries) {
    if (e.kind === 'manifest') continue;
    const isEnv = envLogical.has(e.logical);
    if ((e.section === 'environment') !== isEnv) fails.push(`${e.path}: labelled section ${e.section ?? '-'}, but ${manifestName}'s environment list ${isEnv ? 'names' : 'does not name'} ${e.logical}`);
    if (e.kind === 'doc' && (!DOC_PATHS.includes(e.path) || e.path !== e.logical)) fails.push(`${e.path}: a doc object outside the doc allow-list (${DOC_PATHS.join(', ')})`);
    if (e.kind === 'compat' && (!isEnv || e.path !== e.logical)) fails.push(`${e.path}: a compat object that is not an env file under its logical name`);
    if (!['hashed', 'compat', 'doc'].includes(e.kind)) fails.push(`${e.path}: unknown kind ${e.kind}`);
  }
  for (const e of entries) {
    const key = `${e.section ?? '-'}/${e.kind}`;
    bytes[key] = (bytes[key] ?? 0) + (e.bytes ?? 0);
    if (e.path === MANIFEST_FILE) fails.push('an object named manifest.json would be written (the live v2 manifest is never written)');
    if (e.kind === 'manifest') {
      if (e.path !== manifestName) fails.push(`the manifest object is ${e.path}, expected ${manifestName}`);
      continue;
    }
    let src = null;
    try { src = readSource(e.logical); } catch (err) { fails.push(`${e.path}: source ${e.logical} unreadable (${err.message})`); continue; }
    if (e.sha256 && e.sha256 !== sha256(src)) fails.push(`${e.path}: recorded sha256 ${e.sha256.slice(0, 12)} != source ${sha256(src).slice(0, 12)}`);
    if (e.bytes !== undefined && e.bytes !== src.length) fails.push(`${e.path}: ${e.bytes} bytes recorded, source has ${src.length}`);
    if (e.kind === 'hashed') {
      const want = hashedPath(e.logical, contentHash(src, HASH_LENGTH));
      if (e.path !== want) fails.push(`${e.path}: not the sha256[:${HASH_LENGTH}] name of its bytes (${want})`);
    }
    const mo = /\.glb$/i.test(e.logical) && isMeshopt(src);
    if (mo) meshopt += 1;
    if (e.section === 'environment' && mo) fails.push(`${e.path}: an env object carries ${MESHOPT} (env/kit must stay uncompressed)`);
    if (mo && e.kind !== 'hashed') fails.push(`${e.path}: a meshopt object under a logical name (only hashed names, referenced by ${manifestName} alone)`);
    if (e.kind === 'compat') compat.push(e.path);
    if (e.kind === 'doc') docs.push(e.path);
    if (e.section !== 'environment' && e.kind !== 'hashed' && e.kind !== 'doc') fails.push(`${e.path}: a non-env object at an unhashed path (${e.kind})`);
  }
  for (const ref of referencedPaths({ ...manifest, environment: manifest?.publish?.envCompat === false ? [] : manifest?.environment })) {
    if (!paths.has(ref)) fails.push(`${manifestName} references ${ref}, which the plan does not publish`);
  }
  if (!entries.some((e) => e.kind === 'manifest')) fails.push(`the plan publishes no manifest (${manifestName})`);
  if (v2) {
    const v2paths = referencedPaths(v2);
    v2paths.add(MANIFEST_FILE);
    for (const e of entries) {
      if (!v2paths.has(e.path)) continue;
      if (e.kind === 'hashed') continue;
      if (e.kind === 'compat') {
        // TA-M7: an env logical-name copy overwrites what every live v2 deployment loads by name; it must carry
        // the very bytes v2 published (v2's files map names the hashed object of those bytes).
        let src = null;
        try { src = readSource(e.logical); } catch { continue; } // already failed above
        const want = hashedPath(e.logical, contentHash(src, HASH_LENGTH));
        const live = v2.files?.[e.logical];
        if (live !== want) fails.push(`${e.path}: would overwrite the v2 env object with other bytes (v2 files[${e.logical}] = ${live ?? 'absent'}, the plan's bytes are ${want})`);
        continue;
      }
      fails.push(`${e.path}: would overwrite an object the v2 manifest references (${e.kind})`);
    }
  }
  return { fails, compat, docs, bytes, meshopt };
}

/** Compare a recomputed plan with R1's (planDigest of both). Returns the reasons they differ ([] = equal). */
export function comparePlans(a, aManifest, b, bManifest) {
  const da = planDigest(a, aManifest);
  const db = planDigest(b, bManifest);
  const why = [];
  if (db.missingSha) why.push(`the R1 plan has ${db.missingSha} entr(y/ies) without sha256 (re-run R1 with this upload-supabase.mjs)`);
  if (da.entries !== db.entries) {
    const key = (e) => `${e.kind} ${e.path} ${e.sha256 ?? '-'}`;
    const sa = new Set((a.entries ?? []).map(key));
    const sb = new Set((b.entries ?? []).map(key));
    const only = (x, y) => [...x].filter((k) => !y.has(k));
    why.push(`the entry list differs (${da.n} vs R1 ${db.n}; new: ${only(sa, sb).slice(0, 3).join(', ') || '-'}; gone: ${only(sb, sa).slice(0, 3).join(', ') || '-'})`);
  }
  if (da.manifest !== db.manifest) why.push(`the manifest bytes differ (sha256 ${da.manifest.slice(0, 12)} vs R1 ${db.manifest.slice(0, 12)})`);
  return why;
}

export function parseArgs(argv) {
  const o = { planDir: null, manifestName: MANIFEST_FILE, source: null, expectPlan: null, v2: null, noV2: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => { const x = argv[i + 1]; if (x === undefined || x.startsWith('--')) throw new Error(`${a} needs a value`); i += 1; return x; };
    if (a === '--plan-dir') o.planDir = v();
    else if (a === '--manifest-name') o.manifestName = v();
    else if (a === '--source') o.source = v();
    else if (a === '--expect-plan') o.expectPlan = v();
    else if (a === '--v2-manifest') o.v2 = v();
    else if (a === '--no-v2-check') o.noV2 = true;
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.planDir) throw new Error('--plan-dir <dir> is required');
  if (o.v2 && o.noV2) throw new Error('--v2-manifest and --no-v2-check are mutually exclusive');
  // TA-M7: a new manifest name is the R1 case: the published v2 manifest.json (fetched by a maintainer) is required,
  // unless --no-v2-check, which marks the verdict as not valid for R1.
  if (o.manifestName !== MANIFEST_FILE && !o.v2 && !o.noV2) throw new Error(`--manifest-name ${o.manifestName} needs --v2-manifest <the published v2 manifest.json> (or --no-v2-check, never valid for R1)`);
  return o;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(`publish-verify: ${e.message}\nusage: publish-verify.mjs --plan-dir <dir> [--manifest-name manifest.v3.json] [--source <dir>] [--expect-plan <R1 dir>] [--v2-manifest <file> | --no-v2-check] [--json]`);
    process.exit(2);
  }
  const planPath = join(o.planDir, 'publish-plan.json');
  const manPath = join(o.planDir, o.manifestName);
  if (!existsSync(planPath) || !existsSync(manPath)) {
    console.error(`publish-verify: ${!existsSync(planPath) ? planPath : manPath} does not exist (run upload-supabase.mjs --plan-dir ${o.planDir}${o.manifestName !== MANIFEST_FILE ? ` --manifest-name ${o.manifestName}` : ''} first)`);
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const manBytes = readFileSync(manPath);
  const source = resolve(o.source ?? plan.source ?? '.');
  const r = verifyPlan({ plan, manifest: JSON.parse(manBytes.toString('utf8')), manifestName: o.manifestName, readSource: (f) => readFileSync(join(source, f)), v2: o.v2 ? JSON.parse(readFileSync(o.v2, 'utf8')) : null });
  if (o.expectPlan) {
    const r1Plan = join(o.expectPlan, 'publish-plan.json');
    const r1Man = join(o.expectPlan, o.manifestName);
    if (!existsSync(r1Plan) || !existsSync(r1Man)) r.fails.push(`--expect-plan: ${!existsSync(r1Plan) ? r1Plan : r1Man} does not exist`);
    else r.fails.push(...comparePlans(plan, manBytes, JSON.parse(readFileSync(r1Plan, 'utf8')), readFileSync(r1Man)).map((x) => `--expect-plan: ${x}`));
  }
  const d = planDigest(plan, manBytes);
  if (o.json) console.log(JSON.stringify({ ...r, digest: d, v2Checked: Boolean(o.v2), pass: !r.fails.length }, null, 1));
  else {
    console.log(`publish-verify ${o.planDir} (source ${source}, manifest ${o.manifestName}): ${plan.entries?.length ?? 0} objects, ${r.meshopt} meshopt`);
    for (const [k, b] of Object.entries(r.bytes).sort()) console.log(`  bytes ${k.padEnd(24)} ${(b / 1e6).toFixed(2)} MB`);
    console.log(`  compat objects (${r.compat.length}): ${r.compat.join(', ') || '-'}`);
    console.log(`  doc objects (${r.docs.length}): ${r.docs.join(', ') || '-'}`);
    console.log(`  digest entries ${d.entries.slice(0, 16)} manifest ${d.manifest.slice(0, 16)}${d.missingSha ? ` (${d.missingSha} entries without sha256)` : ''}`);
    if (o.noV2) console.log('  v2 check: NOT RUN (--no-v2-check): this verdict is not valid for R1');
    console.log(r.fails.length ? `PUBLISH-VERIFY FAIL (${r.fails.length}):\n${r.fails.slice(0, 40).map((f) => `  - ${f}`).join('\n')}` : (o.noV2 ? 'PUBLISH-VERIFY PASS (WITHOUT the v2 check)' : 'PUBLISH-VERIFY PASS'));
  }
  process.exitCode = r.fails.length ? 1 : 0;
}
