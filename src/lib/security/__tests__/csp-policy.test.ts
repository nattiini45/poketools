import { describe, expect, it } from 'vitest';
import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';
import {
  CSP_REPORT_PATH,
  buildNoncePolicy,
  buildStaticPolicy,
  cspEnforced,
  newNonce,
} from '../csp-policy.mjs';

/** Directive values by name: `script-src 'self' 'nonce-x'` becomes `{ 'script-src': ["'self'", "'nonce-x'"] }`. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
}

const NONCE = 'dGVzdC1ub25jZS0xMjM0NQ==';

describe('buildStaticPolicy (the enforced default, #37)', () => {
  const prod = directives(buildStaticPolicy({ dev: false }));

  it('hardens object-src, framing and mixed content', () => {
    expect(prod['object-src']).toEqual(["'none'"]);
    expect(prod['frame-ancestors']).toEqual(["'none'"]);
    expect(prod['base-uri']).toEqual(["'self'"]);
    expect(prod['form-action']).toEqual(["'self'"]);
    expect(prod).toHaveProperty('upgrade-insecure-requests');
  });

  it('keeps the blob: entries three.js needs', () => {
    expect(prod['worker-src']).toEqual(["'self'", 'blob:']);
    expect(prod['connect-src']).toContain('blob:');
  });

  it('reports violations to the report endpoint', () => {
    expect(prod['report-uri']).toEqual([CSP_REPORT_PATH]);
    expect(prod['report-to']).toEqual(['csp']);
  });

  it('keeps the existing script policy by default, so enforcing nothing new cannot blank a page', () => {
    expect(prod['script-src']).toEqual(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'blob:', 'https://va.vercel-scripts.com']);
  });

  it('does not upgrade requests in development and allows eval there', () => {
    const dev = directives(buildStaticPolicy({ dev: true }));
    expect(dev).not.toHaveProperty('upgrade-insecure-requests');
    expect(dev['script-src']).toContain("'unsafe-eval'");
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
  });
});

describe('buildStaticPolicy with a nonce (the enforced default as the render reads it)', () => {
  const withNonce = buildStaticPolicy({ dev: false, nonce: NONCE });
  const plain = directives(buildStaticPolicy({ dev: false }));
  /** The directives the way a browser reads them: names are case-insensitive. */
  const asBrowser = Object.fromEntries(Object.entries(directives(withNonce)).map(([name, values]) => [name.toLowerCase(), values]));

  it('lets the render find the nonce: Next.js reads the first lowercase script-src, else default-src', () => {
    expect(getScriptNonceFromHeader(withNonce)).toBe(NONCE);
    expect(withNonce.split(';')[0]?.trim()).toBe(`default-src 'self' 'nonce-${NONCE}'`);
    expect(withNonce.split(';').some((part) => part.trim().startsWith('script-src'))).toBe(false);
  });

  it('is, to a browser, the plain static policy: script-src keeps unsafe-inline and has no nonce', () => {
    expect(asBrowser['script-src']).toEqual(plain['script-src']);
    expect(asBrowser['script-src']).toContain("'unsafe-inline'");
    expect(asBrowser['script-src']).not.toContain(`'nonce-${NONCE}'`);
    const { 'default-src': nonced, ...rest } = asBrowser;
    const { 'default-src': plainDefault, ...plainRest } = plain;
    expect(rest).toEqual(plainRest);
    expect(nonced).toEqual([...plainDefault!, `'nonce-${NONCE}'`]);
  });

  it('puts the nonce nowhere else, and every directive that falls back to default-src is a kind a nonce never matches', () => {
    for (const [name, values] of Object.entries(asBrowser)) {
      if (name !== 'default-src') expect(values.join(' '), name).not.toContain('nonce-');
    }
    // A nonce-source only matches script and style requests; both have a directive of their own.
    for (const name of ['script-src', 'style-src', 'worker-src', 'connect-src', 'img-src', 'font-src', 'object-src']) {
      expect(asBrowser, name).toHaveProperty(name);
    }
  });

  it('refuses a nonce that could break out of the directive', () => {
    expect(() => buildStaticPolicy({ dev: false, nonce: "a'; script-src *" })).toThrow(/nonce/);
  });

  it('is the plain static policy without a nonce', () => {
    expect(buildStaticPolicy({ dev: false })).toContain("script-src 'self' 'unsafe-inline'");
    expect(buildStaticPolicy({ dev: false })).not.toContain('nonce-');
  });
});
describe('buildNoncePolicy', () => {
  const prod = directives(buildNoncePolicy({ nonce: NONCE, dev: false }));

  it('allows scripts by nonce and strict-dynamic, never unsafe-inline', () => {
    expect(prod['script-src']).toContain(`'nonce-${NONCE}'`);
    expect(prod['script-src']).toContain("'strict-dynamic'");
    expect(prod['script-src']).toContain("'wasm-unsafe-eval'");
    expect(prod['script-src']).not.toContain("'unsafe-inline'");
    expect(prod['script-src']).not.toContain('blob:');
  });

  it('keeps every other directive of the static policy', () => {
    const base = directives(buildStaticPolicy({ dev: false }));
    const enforced = directives(buildNoncePolicy({ nonce: NONCE, dev: false, enforce: true }));
    for (const name of Object.keys(base)) {
      if (name === 'script-src') continue;
      expect(enforced[name], name).toEqual(base[name]);
      if (name !== 'upgrade-insecure-requests') expect(prod[name], name).toEqual(base[name]);
    }
  });

  it('leaves upgrade-insecure-requests out of the report-only policy, where browsers reject it, and puts it in the enforced one', () => {
    expect(prod).not.toHaveProperty('upgrade-insecure-requests');
    expect(directives(buildNoncePolicy({ nonce: NONCE, dev: false, enforce: true }))).toHaveProperty('upgrade-insecure-requests');
    expect(directives(buildNoncePolicy({ nonce: NONCE, dev: true, enforce: true }))).not.toHaveProperty('upgrade-insecure-requests');
  });

  it('adds unsafe-eval only in development', () => {
    expect(directives(buildNoncePolicy({ nonce: NONCE, dev: true }))['script-src']).toContain("'unsafe-eval'");
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
  });

  it('refuses a nonce that could break out of the directive', () => {
    for (const bad of ['', "a'; script-src *", 'a b', 'a;b', 'é']) {
      expect(() => buildNoncePolicy({ nonce: bad, dev: false }), JSON.stringify(bad)).toThrow(/nonce/);
    }
  });
});

describe('newNonce', () => {
  it('is base64, long enough to guess never, and different every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(Buffer.from(nonce, 'base64').length).toBeGreaterThanOrEqual(16);
    }
  });
});

describe('cspEnforced', () => {
  it('is off unless CSP_ENFORCE is set to a truthy value', () => {
    for (const value of [undefined, '', ' ', '0', 'false', 'FALSE', 'off', 'no']) {
      expect(cspEnforced({ CSP_ENFORCE: value }), String(value)).toBe(false);
    }
    for (const value of ['1', 'true', 'TRUE', 'on', 'yes', ' 1 ']) {
      expect(cspEnforced({ CSP_ENFORCE: value }), value).toBe(true);
    }
  });
});
