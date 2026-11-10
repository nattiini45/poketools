import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderStateMachinesDoc, STATE_MACHINES_DOC_PATH } from '../docs';
import { STATE_MACHINES } from '../registry';

describe(STATE_MACHINES_DOC_PATH, () => {
  it('matches the registry (run npm run docs:state-machines after changing a machine)', () => {
    const file = readFileSync(path.resolve(__dirname, '../../../..', STATE_MACHINES_DOC_PATH), 'utf8');
    expect(file).toBe(renderStateMachinesDoc(STATE_MACHINES));
  });
});
