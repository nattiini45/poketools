/**
 * Writes docs/state-machines.md from the state-machine registry, or with
 * --check exits 1 when the file is stale. Run: npm run docs:state-machines.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderStateMachinesDoc, STATE_MACHINES_DOC_PATH } from '../src/lib/state-machine/docs';
import { STATE_MACHINES } from '../src/lib/state-machine/registry';

const target = path.resolve(__dirname, '..', STATE_MACHINES_DOC_PATH);
const rendered = renderStateMachinesDoc(STATE_MACHINES);

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== rendered) {
    console.error(`${STATE_MACHINES_DOC_PATH} is stale: run npm run docs:state-machines`);
    process.exit(1);
  }
  console.log(`${STATE_MACHINES_DOC_PATH} is up to date`);
} else {
  writeFileSync(target, rendered);
  console.log(`wrote ${STATE_MACHINES_DOC_PATH} (${STATE_MACHINES.length} machines)`);
}
