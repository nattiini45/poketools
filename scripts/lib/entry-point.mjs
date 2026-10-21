/**
 * entry-point.mjs: "was this module started directly by node?" for scripts that also export
 * functions to tests.
 *
 * Both sides are compared as real paths (a junction or symlink in the invocation still matches),
 * case-insensitively on Windows. `argv1` can name a path that does not exist (an eval or a loader
 * entry); only ENOENT means "not this module". Any other realpath failure throws, so a script never
 * turns a broken invocation into a silent no-op that exits 0.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} moduleUrl the caller's import.meta.url
 * @param {string | undefined} argv1 process.argv[1]
 * @param {{ realpath?: (p: string) => string, platform?: string }} [deps] test seams
 * @returns {boolean}
 */
export function isEntryPoint(moduleUrl, argv1, deps = {}) {
  const realpath = deps.realpath ?? realpathSync.native;
  const platform = deps.platform ?? process.platform;
  if (!argv1) return false;
  const self = realpath(fileURLToPath(moduleUrl));
  let invoked;
  try {
    invoked = realpath(resolve(argv1));
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return false;
    throw err;
  }
  return platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}
