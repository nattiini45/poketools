#!/usr/bin/env node
/**
 * Step 2d — hero props: Meshy text-to-3D generates the four plaza hero props
 * (LED board cabinet, Haussmann lamp post, statue plinth, gate crest
 * ornament) as raw GLBs under .cache/props/. transform.mjs then optimizes
 * them into out/props/ and bake-manifest.mjs lists them (props[] section).
 *
 * REST only, verified against the public docs (2026-09):
 *   POST /openapi/v2/text-to-3d        mode=preview → { result: taskId }
 *   POST /openapi/v2/text-to-3d        mode=refine  → { result: taskId }
 *   GET  /openapi/v2/text-to-3d/:id    poll → { status, model_urls, consumed_credits }
 *   GET  /openapi/v1/balance           → { balance }
 * Bearer auth from MESHY_API_KEY (.env / .env.local via loadEnvLocal). The
 * key value is never printed, logged, or written anywhere.
 *
 * Usage:
 *   node scripts/world-assets/props.mjs --dry-run   prompts + credit table, zero calls
 *   node scripts/world-assets/props.mjs             probe: ONE prop (lamp post) at the
 *                                                   capable tier, auto-check, then STOP —
 *                                                   inspect it before generating the rest
 *   node scripts/world-assets/props.mjs --all       generate every prop still missing
 *   node scripts/world-assets/props.mjs --prop <name>              one named prop
 *   node scripts/world-assets/props.mjs --prop <name> --tier fallback   cheap re-probe
 *   node scripts/world-assets/props.mjs --force     re-download even if cached
 *
 * Credit discipline: every finished task is logged — prop,
 * phase, task id, ai_model, consumed_credits — to .cache/props/credits.json
 * and stdout. The batch aborts before any call whose estimate would push the
 * projected total past BATCH_CREDIT_STOP. FAILED tasks are refunded by Meshy
 * (consumed_credits 0), and a failed probe at the capable tier retries once
 * at the 5-credit fallback tier.
 */

import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from './meshopt-codec.mjs';
import draco3d from 'draco3dgltf';
import { CACHE_DIR, ensureDir, loadEnvLocal, log, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const force = args.includes('--force');
const propIndex = args.indexOf('--prop');
const propOnly = propIndex !== -1 ? args[propIndex + 1] : null;
const tierIndex = args.indexOf('--tier');
const tierArg = tierIndex !== -1 ? args[tierIndex + 1] : null;

const API_BASE = 'https://api.meshy.ai';
const TEXT_TO_3D = `${API_BASE}/openapi/v2/text-to-3d`;
const BALANCE = `${API_BASE}/openapi/v1/balance`;

/**
 * Raw Meshy downloads land here; transform.mjs reads the same directory
 * (keep the path in sync with transform.mjs and bake-manifest.mjs — lib.mjs
 * stays figure-only, and this file must stay a pure script: nothing imports
 * it because `main()` runs at load).
 */
const PROPS_RAW_DIR = join(CACHE_DIR, 'props');
const CREDITS_FILE = join(PROPS_RAW_DIR, 'credits.json');

/** Probe prop: stations already render procedural lamps, so it has an in-code comparator. */
const PROBE_PROP = 'haussmann-lamp-post';

/** Post-transform bar (spec C-030): ≤ 40 k triangles per prop. */
const PROP_TRI_CEILING = 40000;

/**
 * Credit estimates are guards only — the honest number is `consumed_credits`
 * on each task object. capable = meshy-6-class (~20 preview + ~10 refine);
 * fallback = the cheap 5-credit tier the card prescribes for a second probe.
 */
const TIERS = {
  capable: { key: 'capable', aiModel: 'meshy-6', previewCredits: 20, refineCredits: 10 },
  fallback: { key: 'fallback', aiModel: 'meshy-5', previewCredits: 5, refineCredits: 5 },
};

/** Hard batch trajectory stop (the account held 896 at brief time). */
const BATCH_CREDIT_STOP = 200;

const POLL_INTERVAL_MS = 5000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The four hero props. Prompts must stay ≤ 800 chars (Meshy limit). */
const PROPS = [
  {
    name: 'led-board-cabinet',
    role: 'plaza scoreboard — bezel, vents, stand',
    polycount: 20000,
    prompt:
      'Freestanding LED scoreboard cabinet for an e-sports plaza. Rectangular dark grey ' +
      'powder-coated steel enclosure, wide matte black bezel framing a blank dark LED panel ' +
      'with a faint pixel grid, thin horizontal ventilation slots along both sides, welded ' +
      'mounting brackets, squat pedestal stand with a wide rectangular foot. The screen is ' +
      'dark and unlit: no text, no logos, no images. Realistic industrial product design, ' +
      'clean hard-surface geometry, single object, no floor, no background.',
    texturePrompt:
      'Scratched dark grey powder coat on steel, matte black plastic bezel, dark unlit LED ' +
      'panel with subtle pixel grid, light edge wear on corners, neutral studio lighting.',
  },
  {
    name: 'haussmann-lamp-post',
    role: 'boulevard lighting — base, shaft profile, globe fixture',
    polycount: 20000,
    prompt:
      'Parisian Second Empire street lamp post in dark green painted cast iron. Ornate ' +
      'circular base with leaf mouldings, tapered fluted shaft with a gentle profile, ' +
      'decorative collar rings, single lantern crown: a four-arm frame holding an opal ' +
      'white glass globe topped by a small pointed finial. Classic Haussmann boulevard ' +
      'lighting, elegant silhouette readable at distance. Single object, lamp glass is ' +
      'plain opaque white, no light emission, no background.',
    texturePrompt:
      'Weathered dark green enamel with subtle verdigris at the joints, opal frosted glass ' +
      'globe, fine cast iron texture, neutral studio lighting.',
  },
  {
    name: 'statue-plinth',
    role: 'statue base — cap, chamfer, plate recess',
    polycount: 20000,
    prompt:
      'Classical outdoor statue plinth in weathered grey limestone. Square cap with moulded ' +
      'lip, chamfered waist band, recessed rectangular bronze dedication plate centred on ' +
      'the front face, stepped base course, subtle chisel tool marks and gentle weathering ' +
      'streaks. The top surface is empty, ready to carry a statue. Solid single object, ' +
      'no statue, no background.',
    texturePrompt:
      'Weathered Lutetian limestone, pale grey with fine chisel marks and subtle dirt ' +
      'streaks, aged dark bronze dedication plate, neutral studio lighting.',
  },
  {
    name: 'gate-crest-ornament',
    role: 'gate crown — scrollwork, cartouche, finial',
    polycount: 20000,
    prompt:
      'Ornate wrought iron gate crest ornament in the French Second Empire style. ' +
      'Symmetrical scrolling acanthus scrollwork rising to a central oval cartouche ' +
      'crowned by a small fleur-de-lis finial, flattened profile designed to sit on top of ' +
      'a gate rail. Matte black painted iron with subtle rust patina in the recesses. ' +
      'Clean readable silhouette at distance, single object, no background.',
    texturePrompt:
      'Matte black painted wrought iron, subtle rust in recesses, soft highlights along ' +
      'scroll edges, neutral studio lighting.',
  },
];

function propFile(prop) {
  return join(PROPS_RAW_DIR, `${prop.name}.glb`);
}

function cached(prop) {
  return !force && existsSync(propFile(prop));
}

function getKey() {
  loadEnvLocal();
  const key = process.env.MESHY_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/** Authorized Meshy call; error bodies are truncated and never contain the key. */
async function meshy(key, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`meshy ${url.replace(API_BASE, '')}: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function createPreviewTask(key, prop, tier) {
  const json = await meshy(key, TEXT_TO_3D, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'preview',
      prompt: prop.prompt,
      model_type: 'standard',
      ai_model: tier.aiModel,
      // Remesh to the prop's triangle budget — that is what keeps the mesh
      // under the 40 k ceiling the manifest records.
      should_remesh: true,
      topology: 'triangle',
      target_polycount: prop.polycount,
      target_formats: ['glb'],
    }),
  });
  if (!json.result) throw new Error(`preview ${prop.name}: no task id in response`);
  return json.result;
}

async function createRefineTask(key, previewTaskId, prop, tier) {
  const body = {
    mode: 'refine',
    preview_task_id: previewTaskId,
    ai_model: tier.aiModel,
    texture_prompt: prop.texturePrompt,
    enable_pbr: true,
    texture_resolution: '2k',
    target_formats: ['glb'],
  };
  // remove_lighting is a meshy-6-only flag (docs) — key against baked lighting.
  if (tier.aiModel === 'meshy-6') body.remove_lighting = true;
  const json = await meshy(key, TEXT_TO_3D, { method: 'POST', body: JSON.stringify(body) });
  if (!json.result) throw new Error(`refine ${prop.name}: no task id in response`);
  return json.result;
}

async function pollTask(key, taskId, label) {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  for (;;) {
    const task = await meshy(key, `${TEXT_TO_3D}/${taskId}`, { method: 'GET' });
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`${label} task ${taskId} ${task.status}: ${task.task_error?.message ?? 'no error message'}`);
    }
    if (Date.now() > deadline) throw new Error(`${label} task ${taskId} timed out in ${task.status}`);
    log(`  ${label} ${task.status}${typeof task.progress === 'number' ? ` ${task.progress}%` : ''}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function readLedger() {
  const data = readJson(CREDITS_FILE, null);
  return data && Array.isArray(data.records) ? data : { records: [], spent: 0 };
}

function recordCredits(ledger, propName, phase, taskId, tier, credits) {
  ledger.records.push({
    prop: propName,
    phase,
    taskId,
    aiModel: tier.aiModel,
    credits,
    at: new Date().toISOString(),
  });
  ledger.spent += credits;
  ensureDir(PROPS_RAW_DIR);
  writeFileSync(CREDITS_FILE, JSON.stringify(ledger, null, 2));
  log(`  credits +${credits} — ${propName} ${phase}, task ${taskId}, ${tier.aiModel} (total ${ledger.spent})`);
}

function guardBudget(ledger, tier, phase, propName) {
  const estimate = phase === 'preview' ? tier.previewCredits : tier.refineCredits;
  if (ledger.spent + estimate > BATCH_CREDIT_STOP) {
    throw new Error(
      `credit stop: ${ledger.spent} spent + est. ${estimate} for ${propName} ${phase} would pass ` +
        `${BATCH_CREDIT_STOP} — ledger at ${CREDITS_FILE}; report before spending further`,
    );
  }
}

/** Preview + refine + download for one prop. Every task lands in the ledger. */
async function generateProp(key, prop, tier, ledger) {
  guardBudget(ledger, tier, 'preview', prop.name);
  log(`preview ${prop.name} (${tier.aiModel}, remesh target ${prop.polycount} tris)`);
  const previewId = await createPreviewTask(key, prop, tier);
  const preview = await pollTask(key, previewId, `${prop.name} preview`);
  recordCredits(ledger, prop.name, 'preview', previewId, tier, preview.consumed_credits ?? 0);

  guardBudget(ledger, tier, 'refine', prop.name);
  log(`refine ${prop.name} (${tier.aiModel}, PBR 2k)`);
  const refineId = await createRefineTask(key, previewId, prop, tier);
  const refine = await pollTask(key, refineId, `${prop.name} refine`);
  recordCredits(ledger, prop.name, 'refine', refineId, tier, refine.consumed_credits ?? 0);

  const url = refine.model_urls?.glb ?? preview.model_urls?.glb;
  if (!url) throw new Error(`${prop.name}: no glb url on refine task ${refineId}`);
  const file = propFile(prop);
  await download(url, file);
  log(`  ${prop.name}.glb ${Math.round(statSync(file).size / 1024)} KB → ${file}`);
}

function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : primitive.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

/** Machine half of the probe bar: triangles + size on the raw download. */
async function autoCheck(prop) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder });
  const file = propFile(prop);
  const document = await io.read(file);
  const triangles = countTriangles(document);
  const kb = Math.round(statSync(file).size / 1024);
  log(`  auto-check: ${triangles} tris (bar ≤ ${PROP_TRI_CEILING} post-transform), ${kb} KB raw`);
  if (triangles > PROP_TRI_CEILING) {
    log(`  WARNING: raw mesh above the ${PROP_TRI_CEILING} tri bar — lower polycount and re-run --force`);
  }
}

function dryRunReport(hasKey) {
  const tier = TIERS.capable;
  log(`MESHY_API_KEY ${hasKey ? 'set' : 'NOT set — generation is blocked until the user adds it to .env'} (value never printed)`);
  log('');
  log(`${PROPS.length} hero props · tier ${tier.aiModel} (est. ${tier.previewCredits} preview + ${tier.refineCredits} refine per prop)`);
  log('');
  log(`${'prop'.padEnd(22)}${'tier'.padEnd(10)}${'preview'.padStart(8)}${'refine'.padStart(8)}${'total'.padStart(7)}${'tris'.padStart(8)}  role`);
  for (const prop of PROPS) {
    const mark = prop.name === PROBE_PROP ? '  ← probe' : '';
    log(
      `${prop.name.padEnd(22)}${tier.aiModel.padEnd(10)}${String(tier.previewCredits).padStart(8)}` +
        `${String(tier.refineCredits).padStart(8)}${String(tier.previewCredits + tier.refineCredits).padStart(7)}` +
        `${String(prop.polycount).padStart(8)}  ${prop.role}${mark}`,
    );
  }
  const batch = PROPS.length * (tier.previewCredits + tier.refineCredits);
  const failedProbe = tier.previewCredits + tier.refineCredits + TIERS.fallback.previewCredits + TIERS.fallback.refineCredits;
  log('');
  log(`probe first: ${PROBE_PROP} (${tier.previewCredits + tier.refineCredits} cr) — only on a clean probe generate the rest`);
  log(`batch estimate ${batch} cr · worst case with one failed probe ${batch + failedProbe} cr · stop at ${BATCH_CREDIT_STOP}`);
  log(`account held 896 credits at card time; the ledger lives at ${CREDITS_FILE}`);
  for (const prop of PROPS) {
    log('');
    log(`prompt — ${prop.name} (preview)`);
    log(`  ${prop.prompt}`);
    log(`prompt — ${prop.name} (refine texture)`);
    log(`  ${prop.texturePrompt}`);
  }
  log('');
  log('dry-run makes no API calls');
}

async function main() {
  const key = getKey();
  if (dryRun) {
    dryRunReport(Boolean(key));
    return;
  }
  if (!key) {
    log('MESHY_API_KEY is not set — add it to .env (see scripts/world-assets/README.md), then re-run.');
    log('Keyless state: --dry-run works, generation does not. Never commit the key.');
    process.exit(1);
  }

  const tierOverride = tierArg ? TIERS[tierArg] : null;
  if (tierArg && !tierOverride) throw new Error(`unknown --tier ${tierArg} (use: ${Object.keys(TIERS).join(', ')})`);
  if (propOnly && !PROPS.some((prop) => prop.name === propOnly)) {
    throw new Error(`unknown prop ${propOnly} (use: ${PROPS.map((prop) => prop.name).join(', ')})`);
  }

  const balance = await meshy(key, BALANCE, { method: 'GET' });
  log(`balance ${balance.balance} credits · batch stop ${BATCH_CREDIT_STOP} · ledger ${CREDITS_FILE}`);
  if (typeof balance.balance === 'number' && balance.balance < TIERS.capable.previewCredits + TIERS.capable.refineCredits) {
    throw new Error(`balance ${balance.balance} cannot cover a single prop — stopping before any spend`);
  }
  const ledger = readLedger();

  if (!all && !propOnly) {
    const prop = PROPS.find((candidate) => candidate.name === PROBE_PROP);
    const tier = tierOverride ?? TIERS.capable;
    if (cached(prop)) {
      log(`${prop.name} already cached at ${propFile(prop)} — inspect it, or re-run with --force`);
      return;
    }
    try {
      await generateProp(key, prop, tier, ledger);
    } catch (err) {
      if (tier.key !== 'capable' || tierOverride) throw err;
      log(`probe failed at ${tier.aiModel} — retrying at ${TIERS.fallback.aiModel} (5-credit tier): ${err instanceof Error ? err.message : err}`);
      await generateProp(key, prop, TIERS.fallback, ledger);
    }
    await autoCheck(prop);
    log('');
    log('probe downloaded. Inspect against the bar — floating parts, inverted normals, baked lighting —');
    log('then run: node scripts/world-assets/transform.mjs, and generate the rest with: node scripts/world-assets/props.mjs --all');
    return;
  }

  const targets = propOnly ? PROPS.filter((prop) => prop.name === propOnly) : PROPS;
  const tier = tierOverride ?? TIERS.capable;
  for (const prop of targets) {
    if (cached(prop)) {
      log(`skip ${prop.name} (cached at ${propFile(prop)})`);
      continue;
    }
    await generateProp(key, prop, tier, ledger);
    await autoCheck(prop);
  }
  log('props ready → run transform.mjs, then bake-manifest.mjs --mirror');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
