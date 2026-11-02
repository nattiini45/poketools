/**
 * Whether this server runs on a Vercel deployment (production or preview). Vercel sets `VERCEL=1` itself; a local
 * `next dev` / `next start`, CI and the e2e suite do not.
 *
 * Vercel-only features gate on it: the Analytics script is served by Vercel at `/_vercel/insights/script.js`, so
 * anywhere else that URL is a 404 and every page logs a console error.
 */
export function isVercelDeployment(source: Record<string, string | undefined> = process.env): boolean {
  return source.VERCEL === '1';
}
