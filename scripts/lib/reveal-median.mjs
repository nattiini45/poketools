#!/usr/bin/env node
/**
 * LOOK r5 SEAT H — V3, the prod-build desktop reveal (median of 3), offline.
 *
 *   node scripts/lib/reveal-median.mjs <a-loader.json> <b-loader.json> <c-loader.json> [--out <file>]
 *   node scripts/lib/reveal-median.mjs --tags <t1,t2,t3> [--viewport 1440] [--out <file>]
 *
 * --tags reads gauntlet/evidence/<tag>-<viewport>-loader.json. Shoot each run
 * as its own capture-route invocation against a lead-started `next start`:
 *   node scripts/capture-route.mjs --tag <t1> --prod-attach --port <p> --tier route
 *     --sections pulse --viewports 1440 --loader-trace --debug on
 * The verdict (revealMedian) is judged only when every run is --prod-attach;
 * dev runs read `indicative`. Exit 1 on fail, 2 on unmeasured, else 0.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { revealMedian } from './look-r5-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, '..', '..', 'gauntlet', 'evidence');

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const out = opt('--out');
const tags = opt('--tags');
const viewport = opt('--viewport') ?? '1440';
const skip = new Set(['--out', '--tags', '--viewport']);
const files = tags
  ? tags.split(',').filter(Boolean).map((t) => resolve(EVIDENCE, `${t}-${viewport}-loader.json`))
  : argv.filter((a, i) => !a.startsWith('--') && !skip.has(argv[i - 1]));

if (!files.length || argv.includes('--help')) {
  console.log('usage: node scripts/lib/reveal-median.mjs <loader.json...> | --tags <t1,t2,t3> [--viewport 1440] [--out <file>]');
  process.exit(files.length ? 0 : 2);
}

const records = [];
for (const file of files) {
  try {
    records.push({ ...JSON.parse(await readFile(file, 'utf8')), file });
  } catch (err) {
    console.error(`reveal-median: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    records.push({ file, analysis: {} });
  }
}
const result = revealMedian(records);
for (const r of result.runs) {
  console.log(`reveal-median: ${r.run} prod=${r.prodAttach} live=${r.routeLiveFromNavMs ?? 'never'}ms from navigation (since anchor ${r.routeLiveSinceAnchorMs ?? 'n/a'}) ballEnd=${r.ballEndFromNavMs ?? 'n/a'} verdict=${r.verdict}`);
}
console.log(`reveal-median: V3 ${result.verdict} median=${result.medianRouteLiveFromNavMs ?? 'n/a'}ms target=${result.targetMs}ms — ${result.reasons.join('; ')}`);
if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.exit(result.verdict === 'fail' ? 1 : result.verdict === 'unmeasured' ? 2 : 0);
