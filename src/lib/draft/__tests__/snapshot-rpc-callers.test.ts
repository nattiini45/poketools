/**
 * The raw `draft_snapshot` RPC output carries data the mapper filters per viewer (after publish, `redraft.all_slots`
 * lists every trainer's slots with ids). Only the allowlist mapper in `src/lib/draft/snapshot.ts` may call the RPC.
 * A refused automatic publish is not in the RPC output any more (20261018180000) and the mapper never maps a stray
 * `publish_refused_at`: admins read it through `src/lib/supabase/queries/draft-publish-refusals.ts`.
 * This walk keeps it that way: a second caller that returned the raw payload would publish it. No DB: reads the
 * source tree.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');
const ALLOWED = new Set([
  path.join('lib', 'draft', 'snapshot.ts'),
  // The RPC name registry (the type union and the name map), no call.
  path.join('lib', 'draft', 'rpc-errors.ts'),
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('draft_snapshot RPC callers', () => {
  it('only the allowlist mapper (snapshot.ts) names the RPC', () => {
    const callers = sourceFiles(SRC)
      .filter((file) => /['"]draft_snapshot['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));
    expect(callers.filter((file) => !ALLOWED.has(file))).toEqual([]);
    expect(callers).toContain(path.join('lib', 'draft', 'snapshot.ts'));
  });

  // A source check only: the behaviour (no viewer gets the refusal instant from the snapshot) is pinned in
  // snapshot.test.ts, "publish_refused_at (never mapped ...)".
  it('the mapper never reads the refusal instant', () => {
    const mapper = readFileSync(path.join(SRC, 'lib', 'draft', 'snapshot.ts'), 'utf8');
    expect(mapper).not.toMatch(/v\.publish_refused_at|admin_publish_refused_at\s*=/);
  });
});
