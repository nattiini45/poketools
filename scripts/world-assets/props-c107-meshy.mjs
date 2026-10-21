#!/usr/bin/env node
/**
 * Scoped Meshy fallback tool for the wave-2 route-theme props (zero calls made).
 *
 * Disposition (2026-09-19): all nine inventory mesh rows were
 * Blender-built via blender/world-props-c107.py, so NO Meshy call was
 * justified (project rule: build in Blender where possible; the Meshy
 * fallback is capped). This tool exists so a future pass can fall back
 * WITHIN that cap, without touching the hero-prop ledger.
 *
 * LEDGER MECHANICS (round brief item 3):
 *   - CARD-SCOPED ledger: scripts/world-assets/.cache/world-props/credits.json
 *     (NEVER append to .cache/props/credits.json — its BATCH_CREDIT_STOP=200
 *     against recorded spent=120 leaves ~80 headroom, and resetting it would
 *     destroy C-030's audit trail);
 *   - guardBudget-style PRE-CALL stop at this card's cap (1000 credits);
 *   - BALANCE PROBE before any spend (props.mjs pattern);
 *   - per-task records {prop, phase, taskId, aiModel, credits, at}.
 *
 * REST (verified against the public docs, props.mjs precedent):
 *   POST /openapi/v2/text-to-3d   mode=preview|refine → { result: taskId }
 *   GET  /openapi/v2/text-to-3d/:id                    → { status, model_urls, consumed_credits }
 *   GET  /openapi/v1/balance                           → { balance }
 * Bearer auth from MESHY_API_KEY (.env / .env.local via loadEnvLocal); the
 * key value is never printed, logged, or written anywhere.
 *
 * Usage:
 *   node scripts/world-assets/props-c107-meshy.mjs               # dry-run report, ZERO calls
 *   node scripts/world-assets/props-c107-meshy.mjs --prop <slug> # ONE prop (preview+refine+download)
 * Cost anchor: C-030 actuals were 30 credits/prop (20 preview + 10 refine,
 * meshy-6); the inventory's ≈10/prop estimate is ~3x low.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ensureDir, loadEnvLocal, log, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const propIndex = args.indexOf('--prop');
const propOnly = propIndex !== -1 ? args[propIndex + 1] : null;

const API_BASE = 'https://api.meshy.ai';
const TEXT_TO_3D = `${API_BASE}/openapi/v2/text-to-3d`;
const BALANCE = `${API_BASE}/openapi/v1/balance`;

const WORLD_PROPS_CACHE = join(CACHE_DIR, 'world-props');
const CARD_LEDGER = join(WORLD_PROPS_CACHE, 'credits.json');

/** Credit cap for this prop set (project rule): hard pre-call stop. */
const CARD_CREDIT_STOP = 1000;

const TIER = { aiModel: 'meshy-6', previewCredits: 20, refineCredits: 10 };
const POLL_INTERVAL_MS = 5000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The inventory's Meshy-row heroes; the other six rows are Blender-built. */
const MESHY_CANDIDATES = [
  {
    name: 'sakura-torii-hero',
    role: 'sakura C-102 pulse hero mass (inventory ~18k tris)',
    polycount: 18000,
    prompt:
      'Japanese myojin torii gate, vermilion painted wood, two slightly inclined cylindrical ' +
      'pillars with stone bases, curved kasagi top beam with upturned ends, shimaki secondary ' +
      'beam, double nuki tie beams, central gakuzuka plaque with gold sun emblem, hanging suzu ' +
      'bells. Stylized game asset, clean hard-surface geometry, single object, no floor, no background.',
    texturePrompt:
      'Warm vermilion painted wood with subtle grain, weathered grey granite bases, aged gold ' +
      'accents, neutral studio lighting.',
  },
  {
    name: 'mountain-ridge-arch',
    role: 'mountain C-103 pulse crest (inventory ~20k tris)',
    polycount: 20000,
    prompt:
      'Old mountain stone arch bridge segment, semicircular voussoir arch of individual chiselled ' +
      'stones with a prominent keystone, stacked ashlar abutments with protruding bond stones, ' +
      'curved parapet with coping studs, rubble stones and lichen at the flanks. Stylized game ' +
      'asset, clean readable silhouette, single object, no floor, no background.',
    texturePrompt:
      'Weathered grey granite with chisel marks, moss and pale lichen patches, darker stone ' +
      'shadowing in the joints, neutral studio lighting.',
  },
  {
    name: 'clouds-halo-gate',
    role: 'clouds C-104 rules hero (inventory ~20k tris)',
    polycount: 20000,
    prompt:
      'Floating celestial halo gate: a great golden ring with a beaded rim and pale stone lips, ' +
      'a smaller floating inner ring set with round gems, outward spike ornaments, golden emblem ' +
      'core, drifting white cloud pedestal below with hanging golden tassels. Stylized game ' +
      'asset, clean hard-surface geometry, single object, no floor, no background.',
    texturePrompt:
      'Polished warm gold with soft wear, pale marble stone lips, matte white clouds, neutral ' +
      'studio lighting.',
  },
];

function getKey() {
  loadEnvLocal();
  const key = process.env.MESHY_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

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

function readCardLedger() {
  const data = readJson(CARD_LEDGER, null);
  return data && Array.isArray(data.records) ? data : { records: [], spent: 0, cap: CARD_CREDIT_STOP };
}

function recordCredits(ledger, propName, phase, taskId, credits) {
  ledger.records.push({ prop: propName, phase, taskId, aiModel: TIER.aiModel, credits, at: new Date().toISOString() });
  ledger.spent += credits;
  ledger.cap = CARD_CREDIT_STOP;
  ensureDir(WORLD_PROPS_CACHE);
  writeFileSync(CARD_LEDGER, JSON.stringify(ledger, null, 2));
  log(`  credits +${credits} — ${propName} ${phase}, task ${taskId}, ${TIER.aiModel} (card total ${ledger.spent}/${CARD_CREDIT_STOP})`);
}

function guardBudget(ledger, phase, propName) {
  const estimate = phase === 'preview' ? TIER.previewCredits : TIER.refineCredits;
  if (ledger.spent + estimate > CARD_CREDIT_STOP) {
    throw new Error(
      `card credit stop: ${ledger.spent} spent + est. ${estimate} for ${propName} ${phase} would pass ` +
        `${CARD_CREDIT_STOP} — card ledger at ${CARD_LEDGER}; report before spending further`,
    );
  }
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

function dryRunReport() {
  const hasKey = Boolean(getKey());
  log(`MESHY_API_KEY ${hasKey ? 'set' : 'NOT set'} (value never printed) — dry run makes NO API calls`);
  log(`card cap ${CARD_CREDIT_STOP} credits · card-scoped ledger ${CARD_LEDGER}`);
  log('C-030 ledger at .cache/props/credits.json is READ-ONLY for this card (audit trail, spent 120/stop 200)');
  log('');
  log(`DISPOSITION: zero Meshy calls on C-107 — all nine inventory mesh rows were Blender-built`);
  log(`(scripts/world-assets/blender/world-props-c107.py, headless Blender 5.2.1, 0 credits).`);
  log(`This fallback exists for a future seat; the pre-call guard below enforces the cap.`);
  log('');
  log(`${'prop'.padEnd(24)}${'tier'.padEnd(10)}${'preview'.padStart(8)}${'refine'.padStart(8)}${'total'.padStart(7)}  role`);
  for (const prop of MESHY_CANDIDATES) {
    log(
      `${prop.name.padEnd(24)}${TIER.aiModel.padEnd(10)}${String(TIER.previewCredits).padStart(8)}` +
        `${String(TIER.refineCredits).padStart(8)}${String(TIER.previewCredits + TIER.refineCredits).padStart(7)}  ${prop.role}`,
    );
  }
  log('');
  log(`worst case all three: ${(MESHY_CANDIDATES.length * (TIER.previewCredits + TIER.refineCredits))} cr (cap ${CARD_CREDIT_STOP})`);
  const ledger = readCardLedger();
  log(`card ledger: spent ${ledger.spent}/${CARD_CREDIT_STOP}, ${ledger.records.length} records`);
}

async function main() {
  const ledger = readCardLedger();
  if (propOnly === null) {
    dryRunReport();
    return;
  }
  const prop = MESHY_CANDIDATES.find((candidate) => candidate.name === propOnly);
  if (!prop) throw new Error(`unknown prop ${propOnly} (use: ${MESHY_CANDIDATES.map((p) => p.name).join(', ')})`);
  const key = getKey();
  if (!key) {
    log('MESHY_API_KEY is not set — add it to .env (see scripts/world-assets/README.md), then re-run.');
    process.exit(1);
  }
  // BALANCE PROBE before any spend (props.mjs pattern).
  const balance = await meshy(key, BALANCE, { method: 'GET' });
  log(`balance ${balance.balance} credits · card stop ${CARD_CREDIT_STOP} · card ledger ${CARD_LEDGER}`);
  if (typeof balance.balance === 'number' && balance.balance < TIER.previewCredits + TIER.refineCredits) {
    throw new Error(`balance ${balance.balance} cannot cover a single prop — stopping before any spend`);
  }
  guardBudget(ledger, 'preview', prop.name);
  log(`preview ${prop.name} (${TIER.aiModel}, remesh target ${prop.polycount} tris)`);
  const previewRes = await meshy(key, TEXT_TO_3D, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'preview',
      prompt: prop.prompt,
      model_type: 'standard',
      ai_model: TIER.aiModel,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: prop.polycount,
      target_formats: ['glb'],
    }),
  });
  const preview = await pollTask(key, previewRes.result, `${prop.name} preview`);
  recordCredits(ledger, prop.name, 'preview', previewRes.result, preview.consumed_credits ?? 0);

  guardBudget(ledger, 'refine', prop.name);
  log(`refine ${prop.name} (${TIER.aiModel}, PBR 2k, remove_lighting)`);
  const refineRes = await meshy(key, TEXT_TO_3D, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'refine',
      preview_task_id: previewRes.result,
      ai_model: TIER.aiModel,
      texture_prompt: prop.texturePrompt,
      enable_pbr: true,
      texture_resolution: '2k',
      remove_lighting: true,
      target_formats: ['glb'],
    }),
  });
  const refine = await pollTask(key, refineRes.result, `${prop.name} refine`);
  recordCredits(ledger, prop.name, 'refine', refineRes.result, refine.consumed_credits ?? 0);

  const url = refine.model_urls?.glb ?? preview.model_urls?.glb;
  if (!url) throw new Error(`${prop.name}: no glb url on refine task`);
  const { statSync } = await import('node:fs');
  const file = join(WORLD_PROPS_CACHE, `${prop.name}.glb`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  log(`  ${prop.name}.glb ${Math.round(statSync(file).size / 1024)} KB → ${file}`);
  log('raw landed in .cache/world-props/ — move to .cache/props and run transform.mjs --only, then props-merge-c107.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
