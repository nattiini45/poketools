// Dev/capture preload (gauntlet D22): resolve world assets from the local mirror
// in public/models/world instead of the Supabase bucket named in .env.local.
// process.env wins over .env files in Next's env loading order.
process.env.NEXT_PUBLIC_WORLD_ASSETS_URL = '/models/world';

// `next start` (prod-local) serves a finished build, and Next inlines NEXT_PUBLIC_*
// into it at build time, so the line above cannot change that build's asset base.
// Refuse to serve a build that baked the world-assets bucket (the path the bucket
// guard in scripts/lib/look-evidence.mjs matches): every load would spend the quota.
if (process.argv[2] === 'start') {
  /* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require) */
  const fs = require('node:fs');
  const path = require('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const BUCKET_PATH = '/storage/v1/object/public/world-assets';
  const scan = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null; // no build: next start reports that itself
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = scan(p);
        if (hit) return hit;
      } else if (e.name.endsWith('.js')) {
        let text;
        try {
          text = fs.readFileSync(p, 'latin1');
        } catch (err) {
          // Fail closed with a diagnosis: skipping an unreadable chunk could hide a bucket URL.
          console.error(`[local-assets] refused: could not scan ${path.relative(process.cwd(), p)} (${err.code ?? err.message}); cannot prove this build is bucket-free. Retry, or rebuild with the local mirror.`);
          process.exit(1);
        }
        if (text.includes(BUCKET_PATH)) return p;
      }
    }
    return null;
  };
  const hit = scan(path.join(process.cwd(), '.next', 'static'));
  if (hit) {
    console.error(
      `[local-assets] refused: this build baked the world-assets bucket as its asset base (${path.relative(process.cwd(), hit)}). ` +
        "Rebuild with the local mirror (PowerShell: $env:NEXT_PUBLIC_WORLD_ASSETS_URL='/models/world'; npm run build), then start again.",
    );
    process.exit(1);
  }
}
