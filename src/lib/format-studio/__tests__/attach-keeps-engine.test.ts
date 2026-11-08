import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A replace keeps the engine the admin chose (a pre-release legacy or shadow league must not flip to kit): the ON CONFLICT
// clause of the attach RPC's season_formats upsert must never assign it. 20261026090000 had `engine = 'kit'` there.
describe('format_attach_season keeps the admin\'s engine on a replace', () => {
  const text = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20261105120000_format_foreach_group.sql'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  it('does not assign engine in the ON CONFLICT (season_id) update', () => {
    const start = text.indexOf('ON CONFLICT (season_id) DO UPDATE');
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf(';', start);
    const clause = text.slice(start, end);
    expect(clause).toMatch(/spec_hash = EXCLUDED\.spec_hash/);
    expect(clause).not.toMatch(/\bengine\b/);
  });
});
