import { describe, expect, it } from 'vitest';
import { buildStaticPolicy } from '../csp-policy.mjs';

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function headerRules(): Promise<HeaderRule[]> {
  const { default: nextConfig } = await import('../../../../next.config.mjs');
  return (await nextConfig.headers?.()) as HeaderRule[];
}

const value = (rule: HeaderRule, key: string) => rule.headers.find((header) => header.key === key)?.value;

describe('next.config.mjs security headers (#37)', () => {
  it('sends the static policy on pages and on the API, with the directives #37 asks for', async () => {
    const rules = await headerRules();
    for (const source of ['/:path*', '/api/:path*']) {
      const rule = rules.find((candidate) => candidate.source === source);
      expect(rule, source).toBeDefined();
      const policy = value(rule!, 'Content-Security-Policy');
      expect(policy).toBe(buildStaticPolicy({ dev: process.env.NODE_ENV !== 'production' }));
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain('report-uri /api/csp-report');
    }
  });

  it('names the report endpoint that report-to refers to', async () => {
    const rule = (await headerRules()).find((candidate) => candidate.source === '/:path*');
    expect(value(rule!, 'Reporting-Endpoints')).toBe('csp="/api/csp-report"');
  });

  it('keeps the worker policy on the service worker files', async () => {
    const rules = await headerRules();
    const worker = rules.find((candidate) => candidate.source === '/sw.js');
    expect(value(worker!, 'Content-Security-Policy')).toContain("worker-src 'self' blob:");
  });
});
