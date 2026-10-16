import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import { DEFAULT_DRAFT_CONFIG, DRAFT_AUDIT_ACTIONS } from '../draft-queue';

/**
 * `DRAFT_AUDIT_ACTIONS` must equal the `draft_action_log.action` CHECK list of
 * migration M2 (`*_draft_queue_engine.sql`, owner B-SCHEMA).
 */
const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const ACTION_CHECK = /\baction\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*action\s+IN\s*\(([^)]*)\)\s*\)/i;

function m2Source(): { file: string; text: string } {
  const migration = fs.readdirSync(MIGRATIONS).find((f) => /_draft_queue_engine\.sql$/.test(f));
  if (!migration) throw new Error('no *_draft_queue_engine.sql migration in supabase/migrations');
  const file = path.join(MIGRATIONS, migration);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function checkList(text: string): string[] {
  const match = ACTION_CHECK.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('draft-queue contract', () => {
  it('DRAFT_AUDIT_ACTIONS equals the draft_action_log.action CHECK list, in order', () => {
    const { file, text } = m2Source();
    const actions = checkList(text);
    expect(actions.length, `no action CHECK list found in ${path.relative(ROOT, file)}`).toBeGreaterThan(0);
    expect([...DRAFT_AUDIT_ACTIONS]).toEqual(actions);
  });

  it('has no duplicate audit actions', () => {
    expect(new Set(DRAFT_AUDIT_ACTIONS).size).toBe(DRAFT_AUDIT_ACTIONS.length);
  });

  it('DEFAULT_DRAFT_CONFIG matches §7.1', () => {
    expect(DEFAULT_DRAFT_CONFIG).toEqual({
      mode: 'live',
      pick_seconds: 300,
      makeup_seconds: 150,
      slow_ladder_seconds: [43200, 21600, 10800, 5400],
      extension_seconds: [120, 60],
      extensions_enabled: true,
      redraft_max_lines: epbPack.defaults.redraftMaxLines,
      redraft_lock_no_redraft_lines: true,
    });
    expect(Object.isFrozen(DEFAULT_DRAFT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_DRAFT_CONFIG.slow_ladder_seconds)).toBe(true);
    expect(Object.isFrozen(DEFAULT_DRAFT_CONFIG.extension_seconds)).toBe(true);
  });
});
