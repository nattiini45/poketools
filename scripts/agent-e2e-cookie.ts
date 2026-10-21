/**
 * E2E helper: forge a dev NextAuth session cookie for a real player.
 * Writes the cookie value to /tmp/agent-e2e-cookie.txt (never prints it).
 * Dev/testing only — requires NEXTAUTH_SECRET from .env.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), file), 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).split('#')[0].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* optional */ }
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: players, error } = await supa
    .from('players')
    .select('id, name, discord_id')
    .eq('status', 'active')
    .limit(1);
  if (error || !players?.length) throw new Error('no active player found: ' + error?.message);
  const player = players[0];

  const { encode } = await import('next-auth/jwt');
  const cookie = await encode({
    token: { id: player.discord_id, sub: player.discord_id },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: 'authjs.session-token',
  });
  writeFileSync('/tmp/agent-e2e-cookie.txt', cookie, { mode: 0o600 });
  console.log(`cookie written for player "${player.name}" (id ${player.id})`);
  writeFileSync('/tmp/agent-e2e-player.txt', player.id, { mode: 0o600 });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
