/**
 * Shared pieces for tests that build throwaway git repositories.
 *
 * A `git commit` may trigger auto-gc (`gc --auto`, detached by default) or auto maintenance, which can keep writing into
 * `.git` after the command returned, so the cleanup that follows fails with ENOTEMPTY on whichever test happens to run
 * (issue #80). `QUIET_GIT_CONFIG` switches that off (and commit signing, which a developer's global config may require) for
 * any git call it is prefixed to: every committing git call a test makes must carry it; the scripts under test run only
 * read-only git plumbing. `rmTree` retries long enough to outlast a writer that started anyway (an antivirus or indexer).
 */
import { rmSync } from 'node:fs';

/** `-c` pairs that stop git from leaving background writers behind or asking for a signing key. */
export const QUIET_GIT_CONFIG = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false'];

/**
 * Removes a scratch directory. Node retries with a linearly growing wait (`retryDelay` longer on each try): 10 retries of
 * 200 ms add up to 200 × (1 + … + 10) = 11 s at worst.
 */
export function rmTree(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Removes every directory in `dirs` (emptying it), even when one removal fails; then rethrows the first failure. */
export function rmTrees(dirs) {
  let first = null;
  for (const dir of dirs.splice(0).reverse()) {
    try {
      rmTree(dir);
    } catch (error) {
      first ??= error;
    }
  }
  if (first !== null) throw first;
}
