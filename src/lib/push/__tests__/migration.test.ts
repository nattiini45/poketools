/**
 * Static contract of 20261028120000_push_subscriptions.sql (no database): the table the push query module and the
 * sender rely on. The generic grant guard (`migration-api-grants.test.ts`) also replays this file; the assertions
 * here pin the columns, constraints and the service-role-only shape that module reads.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = '20261028120000_push_subscriptions.sql';
const SQL = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', FILE), 'utf8').replace(/\r\n/g, '\n');
const code = SQL.split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe(FILE, () => {
  it('creates push_subscriptions with every column the query module reads and writes', () => {
    for (const column of [
      /\bid\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/,
      /\bplayer_id\s+uuid\s+NOT NULL REFERENCES public\.players\(id\) ON DELETE CASCADE/,
      /\bendpoint\s+text\s+NOT NULL/,
      /\bp256dh\s+text\s+NOT NULL/,
      /\bauth\s+text\s+NOT NULL/,
      /\blocale\s+text\s+NOT NULL DEFAULT 'en'/,
      /\buser_agent_label\s+text/,
      /\bcreated_at\s+timestamptz\s+NOT NULL DEFAULT now\(\)/,
      /\blast_success_at\s+timestamptz/,
      /\bfailure_count\s+integer\s+NOT NULL DEFAULT 0/,
    ]) {
      expect(code).toMatch(column);
    }
  });

  it('makes the endpoint unique, https only and length-capped; locale is en or de', () => {
    expect(code).toMatch(/UNIQUE \(endpoint\)/);
    expect(code).toMatch(/CHECK \(endpoint ~ '\^https:\/\/'\)/);
    expect(code).toMatch(/CHECK \(char_length\(endpoint\) <= 1024\)/);
    expect(code).toMatch(/CHECK \(locale IN \('en', 'de'\)\)/);
    expect(code).toMatch(/CHECK \(failure_count >= 0\)/);
  });

  it('indexes the per-player read (devices list and cap)', () => {
    expect(code).toMatch(/CREATE INDEX idx_push_subscriptions_player ON public\.push_subscriptions \(player_id, created_at\)/);
  });

  it('is service-role only: RLS on, no policies, nothing for the API roles', () => {
    expect(code).toMatch(/ALTER TABLE public\.push_subscriptions ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.push_subscriptions FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.push_subscriptions TO service_role/);
    expect(code).not.toMatch(/CREATE POLICY/i);
    const grants = code.match(/\bGRANT\b[^;]*;/g) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/\bTO service_role;$/);
  });

  it('runs in one transaction', () => {
    expect(code.trim().startsWith('BEGIN;')).toBe(true);
    expect(code.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('keeps deployment facts out of the file (public repo)', () => {
    expect(SQL).not.toMatch(/vercel|supabase\.co|production|live instance/i);
  });
});
