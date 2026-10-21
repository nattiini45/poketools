// Dev preload: point `next dev` at the LOCAL Supabase stack (`npx supabase start`, then
// `npx supabase db reset --local`) instead of the project named in .env/.env.local, so manual and
// browser checks never spend the hosted quota. process.env wins over .env files in Next's env loading.
//
// The anon and service-role keys are derived the way the Supabase CLI derives its local defaults:
// HS256 JWTs signed with the local stack's JWT secret (supabase/config.toml [auth] jwt_secret, else the
// CLI's documented default). Nothing secret is stored here, and no CLI process is spawned (some
// launchers run preloads in sandboxed process trees where the CLI cannot start).
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require) */
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Local world/sprite assets too (one --require: some launchers merge repeated --require flags).
require('./local-assets.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

const PORT = process.env.LOCAL_DB_DEV_PORT || '3010';
const CLI_DEFAULT_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
// The CLI's local default keys carry this fixed issuer and expiry.
const LOCAL_ISSUER = 'supabase-demo';
const LOCAL_EXP = 1983812996;

const config = readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
function section(name) {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start === -1) return [];
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}
function setting(lines, key) {
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"#]+?)"?\\s*(#.*)?$`));
    if (match) return match[1].trim();
  }
  return null;
}

const apiPort = setting(section('api'), 'port') || '54321';
const jwtSecret = setting(section('auth'), 'jwt_secret') || CLI_DEFAULT_JWT_SECRET;

const base64url = (value) => Buffer.from(value).toString('base64url');
function localKey(role) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: LOCAL_ISSUER, role, exp: LOCAL_EXP }));
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${apiPort}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = localKey('anon');
process.env.SUPABASE_SERVICE_ROLE_KEY = localKey('service_role');
process.env.NEXTAUTH_URL = `http://localhost:${PORT}`;
process.env.RATE_LIMIT_STORE = 'memory';
