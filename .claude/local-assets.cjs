// Dev/capture preload (gauntlet D22): resolve world assets from the local mirror
// in public/models/world instead of the Supabase bucket named in .env.local.
// process.env wins over .env files in Next's env loading order.
process.env.NEXT_PUBLIC_WORLD_ASSETS_URL = '/models/world';
// Same for the broadcast sprite renders (docs/pkmn.md, "Sprite styles"): the local
// mirror public/sprites (scripts/sprites/mirror-broadcast.mjs) instead of the
// `sprites` bucket. Without a local mirror the renders 404 and every sprite falls
// back to HOME, which costs no quota.
process.env.NEXT_PUBLIC_SPRITES_URL = '/sprites';

// `next start` (prod-local) serves a finished build, and Next inlines NEXT_PUBLIC_*
// into it at build time, so the lines above cannot change that build's asset bases.
// Refuse to serve a build that baked the world-assets bucket (the path the bucket
// guard in scripts/lib/look-evidence.mjs matches) or the sprites bucket: every load
// would spend the quota.
if (process.argv[2] === 'start') {
  /* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require) */
  const fs = require('node:fs');
  const path = require('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  // A bucket's public path not followed by another name character, so a bucket
  // whose name merely starts with "sprites" does not match.
  const BUCKETS = [
    {
      name: 'world-assets',
      re: /\/storage\/v1\/object\/public\/world-assets/,
      env: "$env:NEXT_PUBLIC_WORLD_ASSETS_URL='/models/world'",
    },
    {
      name: 'sprites',
      re: /\/storage\/v1\/object\/public\/sprites(?![A-Za-z0-9_.-])/,
      env: "$env:NEXT_PUBLIC_SPRITES_URL='/sprites'",
    },
  ];
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
        const bucket = BUCKETS.find((b) => b.re.test(text));
        if (bucket) return { file: p, bucket };
      }
    }
    return null;
  };
  const hit = scan(path.join(process.cwd(), '.next', 'static'));
  if (hit) {
    console.error(
      `[local-assets] refused: this build baked the ${hit.bucket.name} bucket as its asset base (${path.relative(process.cwd(), hit.file)}). ` +
        `Rebuild with the local mirror (PowerShell: ${hit.bucket.env}; npm run build), then start again.`,
    );
    process.exit(1);
  }
}
