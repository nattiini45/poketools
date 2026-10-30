/**
 * Shared pieces for tests that build throwaway git repositories.
 *
 * A `git commit` may start auto-maintenance (`gc --auto`, `maintenance run --auto`) as a DETACHED child that keeps writing into
 * `.git` after the command returned, so the cleanup that follows fails with ENOTEMPTY on whichever test happens to run (issue
 * #80). `QUIET_GIT_CONFIG` switches that off for every git call a test makes, and `rmTree` retries long enough to outlast a
 * writer that started anyway (an antivirus or indexer on a developer machine).
 */
import { rmSync } from 'node:fs';

/** `-c` pairs that stop git from leaving background writers behind. */
export const QUIET_GIT_CONFIG = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false'];

/** Removes a scratch directory, retrying for up to about five seconds. */
export function rmTree(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
