import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULESET_ERROR_CODES } from '../errors';

/**
 * Static checks of the three Ruleset Studio migrations (no database): the names the application maps (constraints,
 * functions, error strings), the service-role-only grants, the expand/contract split and the keys that keep their names.
 * The behaviour itself is proven on a local stack: `scripts/ruleset-lab/rehearse.sh` plus `ruleset-conversion.local.test.ts`
 * (conversion and replay against the TypeScript oracle).
 */
const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (name: string) => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');

const A = read('20261026100000_ruleset_definitions.sql');
const B1 = read('20261026100100_ruleset_conversion_and_pins.sql');
const B2 = read('20261026100200_ruleset_contract.sql');

describe('20261026100000_ruleset_definitions (tables, immutability, publish)', () => {
  it('creates both tables with RLS on, no policies, and service_role-only privileges', () => {
    for (const table of ['ruleset_definitions', 'ruleset_definition_versions']) {
      expect(A).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(A).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
      expect(A).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO service_role;`);
    }
    expect(A).not.toMatch(/CREATE POLICY/i);
    expect(A).not.toMatch(/\bGRANT\b[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
  });

  it('keeps the constraint names errors.ts maps', () => {
    for (const name of [
      'ruleset_definitions_slug_key',
      'ruleset_definitions_draft_size',
      'ruleset_definition_versions_spec_size',
      'ruleset_definition_versions_resolved_size',
      'ruleset_definition_versions_definition_version_key',
    ]) {
      expect(A).toContain(name);
    }
  });

  it('a version is immutable: the trigger names every frozen column', () => {
    const body = A.slice(A.indexOf('ruleset_definition_versions__immutable() RETURNS trigger'), A.indexOf('CREATE TRIGGER trg_ruleset_definition_versions_immutable'));
    for (const column of ['spec', 'resolved', 'content_hash', 'resolved_hash', 'catalog_version', 'schema_version', 'version_no', 'definition_id', 'name_text', 'gen', 'format_key', 'is_doubles', 'id']) {
      expect(body, column).toContain(`NEW.${column}`);
    }
    // The changelog and the author are not part of the frozen content.
    expect(body).not.toContain('NEW.changelog');
    expect(body).not.toContain('NEW.created_by');
  });

  it('every P0001 message a function raises is a code errors.ts knows (as its lower-case twin)', () => {
    const raised = [...A.matchAll(/RAISE EXCEPTION '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(raised.length).toBeGreaterThan(3);
    const known: Record<string, string> = {
      RULESET_NOT_FOUND: 'ruleset_not_found',
      RULESET_STALE_REVISION: 'ruleset_stale_revision',
      RULESET_NOTHING_TO_PUBLISH: 'ruleset_nothing_to_publish',
      RULESET_QUOTA_EXCEEDED: 'ruleset_version_quota_exceeded',
      RULESET_VERSION_IMMUTABLE: 'ruleset_version_immutable',
    };
    for (const message of raised) {
      expect(known[message], message).toBeDefined();
      expect(RULESET_ERROR_CODES).toContain(known[message]);
    }
  });

  it('the publish function is service_role only and refuses a repeat only when BOTH hashes are equal', () => {
    expect(A).toMatch(/REVOKE ALL ON FUNCTION public\.ruleset_publish_version\(.*\) FROM PUBLIC, anon, authenticated;/);
    expect(A).toMatch(/GRANT EXECUTE ON FUNCTION public\.ruleset_publish_version\(.*\) TO service_role;/);
    expect(A).toContain('v_current_hash = p_content_hash AND v_current_rhash = p_resolved_hash');
  });

  it('migrations run in file order: the studio files sort after the league trash files they extend', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    const index = (f: string) => files.indexOf(f);
    expect(index('20261026100000_ruleset_definitions.sql')).toBeGreaterThan(index('20261026091500_league_trash_index_agent_suggestions.sql'));
    expect(index('20261026100100_ruleset_conversion_and_pins.sql')).toBe(index('20261026100000_ruleset_definitions.sql') + 1);
    expect(index('20261026100200_ruleset_contract.sql')).toBe(index('20261026100100_ruleset_conversion_and_pins.sql') + 1);
  });
});

describe('20261026100100_ruleset_conversion_and_pins (expand)', () => {
  it('leaves public.rulesets and its foreign keys alone, and adds the version keys under other names', () => {
    expect(B1).not.toMatch(/ALTER TABLE public\.rulesets\b/);
    expect(B1).not.toMatch(/DROP TABLE/);
    expect(B1).toContain('ADD CONSTRAINT seasons_ruleset_version_fkey FOREIGN KEY (ruleset_id) REFERENCES public.ruleset_definition_versions(id);');
    expect(B1).toContain('ADD CONSTRAINT tournaments_ruleset_version_fkey FOREIGN KEY (ruleset_id) REFERENCES public.ruleset_definition_versions(id);');
    // NO ACTION (the default): a pinned version cannot be deleted.
    expect(B1).not.toMatch(/ruleset_version_fkey[^;]*ON DELETE/);
  });

  it('converts with the SQL twin of toID, keeps the old id as version 1, and replays the resolver before the keys exist', () => {
    expect(B1).toContain('public.epb_fold_id(x)');
    expect(B1).toContain("VALUES (r.id, v_def, 1, 1,");
    expect(B1.indexOf('SELECT public.ruleset_convert_missing();')).toBeLessThan(B1.indexOf('SELECT public.ruleset_replay_pins();'));
    expect(B1.indexOf('SELECT public.ruleset_replay_pins();')).toBeLessThan(B1.indexOf('ADD CONSTRAINT seasons_ruleset_version_fkey'));
  });

  it('logs every rewritten pin (the revert source) and ends with a self-check', () => {
    expect(B1).toContain('CREATE TABLE public.ruleset_pin_backfill_log');
    expect(B1).toContain('ALTER TABLE public.ruleset_pin_backfill_log ENABLE ROW LEVEL SECURITY;');
    expect(B1).toMatch(/RAISE EXCEPTION 'ruleset conversion incomplete/);
  });

  it('re-points the league recycle bin junction under the SAME constraint name and protects head versions', () => {
    expect(B1).toContain('DROP CONSTRAINT league_trash_rulesets_ruleset_id_fkey;');
    expect(B1).toContain('ADD CONSTRAINT league_trash_rulesets_ruleset_id_fkey');
    expect(B1).toContain("('ruleset_definition_versions','junction', 'league_trash_rulesets',             'ruleset_id')");
    expect(B1).toContain('d.current_version_id');
  });

  it('every function it creates is service_role only', () => {
    const created = [...B1.matchAll(/CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(8);
    for (const fn of created) expect(B1, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace('.', '\\.')}\\(`));
  });
});

describe('20261026100200_ruleset_contract', () => {
  it('drops the old keys and gives the version keys their names back', () => {
    expect(B2).toContain('DROP CONSTRAINT seasons_ruleset_id_fkey;');
    expect(B2).toContain('RENAME CONSTRAINT seasons_ruleset_version_fkey TO seasons_ruleset_id_fkey;');
    expect(B2).toContain('DROP CONSTRAINT tournaments_ruleset_id_fkey;');
    expect(B2).toContain('RENAME CONSTRAINT tournaments_ruleset_version_fkey TO tournaments_ruleset_id_fkey;');
  });

  it('renames the legacy table, closes it to the API roles and keeps it for one release', () => {
    expect(B2).toContain('ALTER TABLE public.rulesets RENAME TO rulesets_legacy;');
    expect(B2).toContain('REVOKE ALL ON TABLE public.rulesets_legacy FROM PUBLIC, anon, authenticated;');
    expect(B2).toContain('DROP POLICY IF EXISTS "Public read rulesets" ON public.rulesets;');
    expect(B2).not.toMatch(/DROP TABLE/);
  });

  it('catches up rulesets created in the window and aborts on one that was edited, then drops the one-time helpers', () => {
    expect(B2).toContain('SELECT public.ruleset_convert_missing();');
    expect(B2).toContain('rulesets edited after the conversion');
    for (const helper of ['ruleset_replay_pins()', 'ruleset_replay_preview()', 'ruleset_convert_missing()', 'ruleset_js_blank(text)']) {
      expect(B2).toContain(`DROP FUNCTION public.${helper};`);
    }
    // ruleset_fold_ids stays: it is not a one-time helper.
    expect(B2).not.toContain('DROP FUNCTION public.ruleset_fold_ids');
  });

  it('the league trash classification no longer lists the legacy table', () => {
    const fn = B2.slice(B2.indexOf('league_trash__external_parents()'), B2.indexOf('REVOKE ALL ON FUNCTION public.league_trash__external_parents()'));
    expect(fn).toContain("'ruleset_definition_versions'");
    expect(fn).not.toContain("'rulesets'");
  });
});
