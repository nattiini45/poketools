#!/usr/bin/env node
// scripts/pkmn-i18n/fetch-csv.mjs: downloads the pinned PokeAPI CSVs (and LICENSE.md) into the gitignored cache
// scripts/pkmn-i18n/.cache/ and verifies each file's sha256 against source.json (design pkmn-l10n.md §1.1–§1.2).
// No dependencies (Node 18+ global fetch). Never run at build time, in CI or at runtime.
//
//   node scripts/pkmn-i18n/fetch-csv.mjs                    # download what is missing or stale, verify every hash
//   node scripts/pkmn-i18n/fetch-csv.mjs --from <dir>       # seed the cache from local copies instead (still verified)
//   node scripts/pkmn-i18n/fetch-csv.mjs --update-hashes    # RE-PIN only: record the downloaded hashes in source.json
//
// Re-pinning: set "commit" in source.json, run with --update-hashes, then regenerate and review the diff.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(SCRIPT_DIR, 'source.json');

function parseArgs(argv) {
  const out = { cacheDir: join(SCRIPT_DIR, '.cache'), from: null, updateHashes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache-dir') out.cacheDir = resolve(argv[++i]);
    else if (a === '--from') out.from = resolve(argv[++i]);
    else if (a === '--update-hashes') out.updateHashes = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  const base = `https://raw.githubusercontent.com/${source.repo}/${source.commit}`;
  const csvDir = join(args.cacheDir, 'csv');
  mkdirSync(csvDir, { recursive: true });

  const targets = [
    ...Object.keys(source.csvSha256).map((name) => ({
      key: name,
      file: join(csvDir, `${name}.csv`),
      url: `${base}/${source.csvPath}/${name}.csv`,
      local: args.from ? join(args.from, `${name}.csv`) : null,
      expected: source.csvSha256[name],
    })),
    {
      key: 'LICENSE.md',
      file: join(args.cacheDir, 'LICENSE.md'),
      url: `${base}/LICENSE.md`,
      local: args.from ? join(args.from, 'LICENSE.md') : null,
      expected: source.licenseSha256,
    },
  ];

  let failures = 0;
  for (const t of targets) {
    if (!args.updateHashes && t.expected && existsSync(t.file) && sha256(readFileSync(t.file)) === t.expected) {
      console.log(`ok      ${t.key}`);
      continue;
    }
    const buf = t.local && existsSync(t.local) ? readFileSync(t.local) : await download(t.url);
    const got = sha256(buf);
    if (args.updateHashes) {
      if (t.key === 'LICENSE.md') source.licenseSha256 = got;
      else source.csvSha256[t.key] = got;
    } else if (got !== t.expected) {
      console.error(`MISMATCH ${t.key}: expected ${t.expected || '(none recorded)'}, got ${got}`);
      failures++;
      continue;
    }
    writeFileSync(t.file, buf);
    console.log(`fetched ${t.key} (${buf.length} bytes)`);
  }

  if (args.updateHashes) {
    writeFileSync(SOURCE_PATH, JSON.stringify(source, null, 2) + '\n');
    console.log(`recorded ${targets.length} hashes in ${SOURCE_PATH}`);
  }
  if (failures) {
    console.error(`${failures} file(s) did not match source.json; nothing was written for them.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
