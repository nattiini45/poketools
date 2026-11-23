// Prunes the generated route validators before `npm run typecheck` (issue #145): deleting a route
// file leaves its `.next/types` entry behind, and tsc then fails on a path that no longer exists
// until the next build regenerates the directory. The validators are build output — a fresh
// checkout typechecks without them — so dropping both trees is safe; `next dev`/`next build`
// recreate them on the next compile.
import { rmSync } from 'node:fs';

for (const dir of ['.next/types', '.next/dev/types']) {
  rmSync(dir, { recursive: true, force: true });
}
