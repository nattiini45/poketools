import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function CspDebug() {
  const h = await headers();
  const rows: string[] = [];
  h.forEach((value, key) => {
    if (/csp|content-security|nonce|middleware|x-vercel|x-poketools|x-matched|x-forwarded-host/i.test(key)) {
      rows.push(`${key}: ${value.slice(0, 260)}`);
    }
  });
  return <pre id="csp-debug">{rows.sort().join('\n')}</pre>;
}
