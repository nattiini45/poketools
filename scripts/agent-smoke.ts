/**
 * AI Agent provider smoke test.
 *
 * Pings every model in AGENT_MODELS (PRD §2) with a trivial prompt and reports
 * OK / FAIL / SKIPPED per model. Configured models that respond are OK,
 * configured models that error are FAIL, unconfigured models are SKIPPED.
 *
 * Usage: npx tsx scripts/agent-smoke.ts
 *
 * Loads env from .env.local automatically. Never prints API keys. Always
 * exits 0 — this is a report, not a gate.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local manually (no dotenv dependency needed) — same approach as
// the other scripts in scripts/ (see wipe-league-data.ts).
function loadEnvLocal() {
  // First-set-wins: .env.local takes precedence over .env, and the
  // if-not-already-set guard preserves anything already in process.env.
  for (const file of ['.env.local', '.env']) {
    try {
      const envPath = resolve(process.cwd(), file);
      const content = readFileSync(envPath, 'utf-8');
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
      // file might not exist if env vars are set another way
    }
  }
}
loadEnvLocal();

import { generateText } from 'ai';
import {
  AGENT_MODELS,
  createCompatibleModel,
  getAgentProviderOptions,
  isModelConfigured,
  type AgentModelEntry,
} from '../src/lib/ai/agent/provider';

const TIMEOUT_MS = 10_000;
const PROMPT = 'Reply with exactly: ok';

async function pingModel(entry: AgentModelEntry): Promise<void> {
  if (!isModelConfigured(entry)) {
    console.log(`${entry.id}: SKIPPED (missing env)`);
    return;
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const model = createCompatibleModel(entry);
    await generateText({
      model,
      prompt: PROMPT,
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: abort.signal,
      providerOptions: getAgentProviderOptions(entry),
    });
    const ms = Date.now() - start;
    console.log(`${entry.id}: OK (${ms}ms)`);
  } catch (err) {
    const cls = err instanceof Error ? err.constructor.name : typeof err;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${entry.id}: FAIL ${cls}: ${msg.slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Agent provider smoke test — ${AGENT_MODELS.length} models\n`);
  // Sequential so the output reads top-to-bottom in registry/tier order.
  for (const entry of AGENT_MODELS) {
    await pingModel(entry);
  }
  process.exit(0);
}

void main();
