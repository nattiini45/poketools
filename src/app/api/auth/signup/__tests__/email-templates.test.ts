import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The bilingual Supabase Auth email templates (i18n-core §6.6). Sign-up
 * stores `user_metadata.locale`; each template branches on `.Data.locale`
 * (en / de / anything else = German then English), and `supabase/config.toml`
 * points the local stack at the same files with a bilingual subject.
 */

const ROOT = path.resolve(__dirname, '../../../../../..');
const TEMPLATES = path.join(ROOT, 'supabase', 'templates');
const NAMES = ['confirmation', 'recovery', 'email_change', 'magic_link', 'invite'] as const;

function read(name: string): string {
  return fs.readFileSync(path.join(TEMPLATES, `${name}.html`), 'utf8');
}

/** The body of each branch: [en, de, fallback]. */
function branches(text: string): [string, string, string] {
  const body = text.replace(/\{\{\/\*[\s\S]*?\*\/\}\}/g, '');
  const m = /\{\{ if eq \.Data\.locale "en" \}\}([\s\S]*)\{\{ else if eq \.Data\.locale "de" \}\}([\s\S]*)\{\{ else \}\}([\s\S]*)\{\{ end \}\}\s*$/.exec(
    body,
  );
  if (!m) throw new Error('template does not have the en / de / fallback shape');
  return [m[1], m[2], m[3]];
}

describe('Supabase auth email templates', () => {
  it.each(NAMES)('%s branches on .Data.locale into en, de and a German-then-English fallback', (name) => {
    const [en, de, fallback] = branches(read(name));
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de.trim().length).toBeGreaterThan(0);
    // Accounts created before the language switch have no locale: German first, then English.
    expect(fallback).toContain(de.trim());
    expect(fallback).toContain(en.trim());
    expect(fallback.indexOf(de.trim())).toBeLessThan(fallback.indexOf(en.trim()));
  });

  it.each(NAMES)('%s keeps only the leading template comment (nothing leaks into the email)', (name) => {
    const text = read(name);
    expect(text.startsWith('{{/*')).toBe(true);
    expect(text).not.toContain('<!--');
  });

  it.each([
    ['confirmation', '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email'],
    ['recovery', '{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery'],
  ] as const)('%s links every branch through the app page that verifies token_hash', (name, link) => {
    for (const branch of branches(read(name))) expect(branch).toContain(`href="${link}"`);
  });

  it('config.toml points every template at its file with a bilingual subject', () => {
    const toml = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
    for (const name of NAMES) {
      const section = new RegExp(
        `\\[auth\\.email\\.template\\.${name}\\]\\r?\\nsubject = "([^"\\r\\n]+ / [^"\\r\\n]+)"\\r?\\ncontent_path = "\\./supabase/templates/${name}\\.html"`,
      );
      expect(toml).toMatch(section);
    }
  });
});
