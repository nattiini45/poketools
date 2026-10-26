/**
 * Wiki note resubmission block (20261025090000_wiki_note_resubmission_block.sql). No DB: reads the migration text.
 * The behaviour was proven on the local stack inside BEGIN ... ROLLBACK (the columns, the CHECK refusing an approve
 * while blocked, the approve that clears the block); this guard keeps the house rules of the file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = path.resolve(
  __dirname,
  '../../../../../supabase/migrations/20261025090000_wiki_note_resubmission_block.sql',
);
const raw = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const sql = raw
  .split('\n')
  .map((line) => (line.includes('--') ? line.slice(0, line.indexOf('--')) : line))
  .join('\n');

describe('20261025090000_wiki_note_resubmission_block.sql', () => {
  it('runs in one transaction', () => {
    expect(sql.trim().startsWith('BEGIN;')).toBe(true);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('adds the two nullable columns to wiki_notes, the blocker referencing players with ON DELETE SET NULL', () => {
    expect(sql).toMatch(/ALTER TABLE public\.wiki_notes[\s\S]*ADD COLUMN resubmission_blocked_at timestamptz,/);
    expect(sql).toMatch(
      /ADD COLUMN resubmission_blocked_by uuid REFERENCES public\.players\(id\) ON DELETE SET NULL;/,
    );
    expect(sql).not.toMatch(/ADD COLUMN resubmission_blocked_(at|by)[^,;]*NOT NULL/);
  });

  it('only a rejected, not-approved note can carry a block', () => {
    expect(sql).toMatch(
      /CHECK \(resubmission_blocked_at IS NULL OR \(approved = false AND rejected_at IS NOT NULL\)\)/,
    );
  });

  it('indexes the new foreign key', () => {
    expect(sql).toMatch(/CREATE INDEX idx_wiki_notes_resubmission_blocked_by\s+ON public\.wiki_notes \(resubmission_blocked_by\)/);
  });

  it('creates no table, grant, policy or RLS change', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
    expect(sql).not.toMatch(/POLICY|ROW LEVEL SECURITY/i);
  });

  it('documents the deploy order', () => {
    expect(raw).toContain('DEPLOY ORDER: apply this migration BEFORE deploying the application code');
  });
});
