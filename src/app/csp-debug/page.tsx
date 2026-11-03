import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function CspDebug() {
  const h = await headers();
  const rows: string[] = [];
  h.forEach((value, key) => {
    if (/^(content-security|x-nonce)/i.test(key)) rows.push(`${key}: ${value.slice(0, 120)}`);
  });
  return (
    <>
      <pre id="csp-debug">{rows.sort().join('\n')}</pre>
      <div dangerouslySetInnerHTML={{ __html: '<button id="attr-btn" onclick="window.__attrOk=1">attr</button>' }} />
    </>
  );
}
