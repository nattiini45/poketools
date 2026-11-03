import { describe, expect, it } from 'vitest';
import { CSP_REPORT_LOG_MAX_CHARS, cspReportLogLines, redactReportUrl } from '../csp-report';

const legacy = {
  'csp-report': {
    'document-uri': 'https://poketools.test/leagues/abc?token=SECRET#frag',
    'violated-directive': "script-src-elem 'nonce-abc' 'strict-dynamic'",
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js?k=SECRET',
    'source-file': 'https://poketools.test/_next/static/chunks/app.js',
    'line-number': 12,
    disposition: 'report',
    'original-policy': "default-src 'self'; script-src 'nonce-LEAK'",
  },
};

const reportingApi = [
  {
    type: 'csp-violation',
    age: 3,
    url: 'https://poketools.test/auth/signin',
    user_agent: 'Mozilla/5.0 (secret agent)',
    body: {
      documentURL: 'https://poketools.test/auth/signin',
      effectiveDirective: 'script-src-elem',
      blockedURL: 'inline',
      sourceFile: null,
      lineNumber: 4,
      disposition: 'report',
      sample: 'var secret = "SAMPLE"',
    },
  },
  { type: 'deprecation', body: { id: 'x' } },
];

describe('cspReportLogLines (#37)', () => {
  it('summarises a legacy application/csp-report body without query strings, hashes or the policy', () => {
    const [line, ...rest] = cspReportLogLines(legacy);
    expect(rest).toEqual([]);
    expect(line).toContain('script-src-elem');
    expect(line).toContain('https://poketools.test/leagues/abc');
    expect(line).toContain('https://evil.example/x.js');
    expect(line).not.toMatch(/SECRET|frag|LEAK|original-policy/);
  });

  it('summarises a Reporting API body, keeps only csp-violation reports and drops the sample and user agent', () => {
    const lines = cspReportLogLines(reportingApi);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"blocked":"inline"');
    expect(lines[0]).toContain('/auth/signin');
    expect(lines[0]).not.toMatch(/SAMPLE|secret agent/);
  });

  it('caps every line, the number of reports and the length of every value', () => {
    const long = 'x'.repeat(5000);
    const flood = Array.from({ length: 50 }, () => ({
      type: 'csp-violation',
      body: { documentURL: `https://poketools.test/${long}`, effectiveDirective: long, blockedURL: long },
    }));
    const lines = cspReportLogLines(flood);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(CSP_REPORT_LOG_MAX_CHARS);
  });

  it('returns nothing for a body that is not a CSP report', () => {
    for (const body of [null, 1, 'text', {}, [], [{ type: 'deprecation' }], { 'csp-report': 'x' }]) {
      expect(cspReportLogLines(body), JSON.stringify(body)).toEqual([]);
    }
  });
});

describe('redactReportUrl', () => {
  it('keeps the origin and the path but drops query and hash', () => {
    expect(redactReportUrl('https://poketools.test/a/b?x=1#y')).toBe('https://poketools.test/a/b');
  });

  it('replaces path segments that look like tokens or ids', () => {
    expect(redactReportUrl('https://poketools.test/teams/shared/AbCdEfGhIjKlMnOpQrStUvWx')).toBe('https://poketools.test/teams/shared/:id');
    expect(redactReportUrl('https://poketools.test/dashboard/confirm/3f2b8c1e-9a4d-4e55-8b7a-1c2d3e4f5a6b')).toBe(
      'https://poketools.test/dashboard/confirm/:id',
    );
  });

  it('passes the keywords browsers use for a blocked source, and refuses anything else that is not a URL', () => {
    for (const keyword of ['inline', 'eval', 'data', 'blob', 'wasm-eval', 'trusted-types-policy']) {
      expect(redactReportUrl(keyword)).toBe(keyword);
    }
    expect(redactReportUrl('not a url with spaces')).toBe('[unparsable]');
    expect(redactReportUrl(undefined)).toBe('');
    expect(redactReportUrl(12)).toBe('');
  });

  it('keeps only the scheme of a data: or blob: URL, which can carry a payload', () => {
    expect(redactReportUrl('data:text/javascript;base64,AAAA')).toBe('data:');
    expect(redactReportUrl('blob:https://poketools.test/uuid')).toBe('blob:');
  });
});
