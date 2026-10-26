import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Static pins for the three Format Studio migrations (no database). The application depends on details that a
// refactor of the SQL could silently drop: the enum value lives alone in its own committed file, every new table and
// function is service-role only, and the constraint names are what `mapFormatDbError` matches on
// (src/lib/format-studio/errors.ts). The replay in migration-api-grants.test.ts proves the API-role closure for the
// whole directory; this file pins what is specific to these three files.

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const FILE_ENUM = '20261024100000_season_format_type_custom.sql';
const FILE_DEFINITIONS = '20261024100100_format_definitions.sql';
const FILE_SEASON_FORMATS = '20261024100200_season_formats_and_stage_columns.sql';

const raw = (name: string) => readFileSync(path.join(DIR, name), 'utf8');

/** The file without `--` comment text (the headers mention BEGIN, 'custom' and the like). */
function code(name: string): string {
  return raw(name)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const enumSql = code(FILE_ENUM);
const definitionsSql = code(FILE_DEFINITIONS);
const seasonFormatsSql = code(FILE_SEASON_FORMATS);

const NEW_TABLES = {
  [FILE_DEFINITIONS]: ['format_definitions', 'format_definition_versions'],
  [FILE_SEASON_FORMATS]: ['season_formats'],
} as const;

/** Function name -> argument types exactly as written in its REVOKE / GRANT. */
const NEW_FUNCTIONS: Record<string, Record<string, string>> = {
  [FILE_DEFINITIONS]: {
    format_definition_versions__immutable: '',
    format_publish_version: 'uuid, integer, integer, jsonb, text, jsonb, uuid',
  },
  [FILE_SEASON_FORMATS]: {
    format_season_started: 'uuid',
    format_attach_season: 'uuid, uuid, integer, jsonb, text, text, jsonb',
    format_detach_season: 'uuid',
    seasons__require_attached_format: '',
  },
};

const sqlOf = (file: string) => (file === FILE_DEFINITIONS ? definitionsSql : seasonFormatsSql);

describe('file order', () => {
  it('sorts the three files after the previous newest migration, contiguously and in order', () => {
    const files = readdirSync(DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const mine = [FILE_ENUM, FILE_DEFINITIONS, FILE_SEASON_FORMATS];
    const first = files.indexOf(FILE_ENUM);
    expect(first).toBeGreaterThan(-1);
    expect(files.slice(first, first + 3)).toEqual(mine);
    // Everything before the first file is older than it (the previous newest is 20261023145151).
    expect(files[first - 1] < FILE_ENUM).toBe(true);
    expect(files).toContain('20261023145151_rounds_bye_player_ids.sql');
    expect(files.indexOf('20261023145151_rounds_bye_player_ids.sql')).toBeLessThan(first);
  });
});

describe('20261024100000 enum value', () => {
  it('is one ADD VALUE statement and nothing else', () => {
    const statements = enumSql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toEqual(["ALTER TYPE public.season_format_type ADD VALUE IF NOT EXISTS 'custom'"]);
  });

  it('has no transaction block (a new enum value must commit on its own)', () => {
    expect(enumSql).not.toMatch(/\bBEGIN\b/i);
    expect(enumSql).not.toMatch(/\bCOMMIT\b/i);
  });
});

describe('20261024100100 format definitions', () => {
  it('does not touch the league type enum (the new value is not committed yet when it runs)', () => {
    expect(definitionsSql).not.toMatch(/season_format_type/);
    expect(definitionsSql).not.toMatch(/ADD VALUE/i);
  });

  it('runs in one transaction', () => {
    expect(definitionsSql).toMatch(/^\s*BEGIN;/m);
    expect(definitionsSql).toMatch(/^\s*COMMIT;/m);
  });

  it('names the constraints the error mapper and the size contract depend on', () => {
    for (const name of [
      'format_definitions_slug_key',
      'format_definitions_slug_format',
      'format_definitions_kind_check',
      'format_definitions_visibility_check',
      'format_definitions_draft_size',
      'format_definitions_draft_rev_check',
      'format_definitions_current_version_fkey',
      'format_definition_versions_definition_version_key',
      'format_definition_versions_spec_size',
      'format_definition_versions_hash_check',
    ]) {
      expect(definitionsSql, name).toContain(`CONSTRAINT ${name}`);
    }
    expect(definitionsSql).toMatch(/CONSTRAINT format_definitions_draft_size\s+CHECK \(octet_length\(current_draft::text\) <= 262144\)/);
    expect(definitionsSql).toMatch(/CONSTRAINT format_definition_versions_spec_size\s+CHECK \(octet_length\(spec::text\) <= 262144\)/);
  });

  it('makes a published version immutable with an UPDATE trigger and raises the code the mapper reads', () => {
    expect(definitionsSql).toContain('CREATE TRIGGER trg_format_definition_versions_immutable BEFORE UPDATE ON public.format_definition_versions');
    expect(definitionsSql).toContain("RAISE EXCEPTION 'FORMAT_VERSION_IMMUTABLE' USING ERRCODE = 'P0001'");
    // DELETE stays possible, so ON DELETE CASCADE from the definition works.
    expect(definitionsSql).not.toMatch(/BEFORE (UPDATE OR DELETE|DELETE)/);
  });

  it('sets the list columns from the published spec identity in the same UPDATE that points at the version', () => {
    const publish = definitionsSql.slice(definitionsSql.indexOf('CREATE OR REPLACE FUNCTION public.format_publish_version'));
    expect(publish).toContain("p_spec #> '{identity,name}'");
    expect(publish).toContain("p_spec #> '{identity,summary}'");
    const update = publish.match(/UPDATE public\.format_definitions d[\s\S]*?WHERE d\.id = p_definition_id;/);
    expect(update).not.toBeNull();
    expect(update![0]).toContain('current_version_id = v_id');
    expect(update![0]).toMatch(/name\s+= CASE WHEN jsonb_typeof\(v_name\) = 'object' THEN v_name ELSE d\.name END/);
    expect(update![0]).toMatch(/description\s+= CASE WHEN jsonb_typeof\(v_description\) = 'object' THEN v_description ELSE NULL END/);
    // Still invoker rights with a pinned search path (service-role EXECUTE only, see the grants test).
    expect(publish.slice(0, publish.indexOf('END $$;'))).not.toMatch(/SECURITY DEFINER/);
    expect(publish).toContain('SET search_path = public');
  });

  it('raises the publish signals with SQLSTATE P0001', () => {
    for (const signal of ['FORMAT_NOT_FOUND', 'FORMAT_STALE_REVISION', 'FORMAT_NOTHING_TO_PUBLISH']) {
      expect(definitionsSql).toContain(`RAISE EXCEPTION '${signal}' USING ERRCODE = 'P0001'`);
    }
  });
});

describe('20261024100200 season formats and stage columns', () => {
  it('uses the new enum value', () => {
    expect(seasonFormatsSql).toContain("'custom'");
    expect(seasonFormatsSql).toContain('public.season_format_type');
  });

  it('runs in one transaction', () => {
    expect(seasonFormatsSql).toMatch(/^\s*BEGIN;/m);
    expect(seasonFormatsSql).toMatch(/^\s*COMMIT;/m);
  });

  it('adds the two tournaments columns and the partial unique index per league and stage key', () => {
    expect(seasonFormatsSql).toMatch(/ALTER TABLE public\.tournaments\s+ADD COLUMN format_stage_key text,\s+ADD COLUMN stage_spec jsonb/);
    expect(seasonFormatsSql).toMatch(
      /CREATE UNIQUE INDEX uq_tournaments_season_format_stage ON public\.tournaments \(season_id, format_stage_key\)\s+WHERE format_stage_key IS NOT NULL/,
    );
    expect(seasonFormatsSql).toContain('tournaments_format_stage_key_check');
    expect(seasonFormatsSql).toContain('tournaments_stage_spec_check');
  });

  it('names the season_formats constraints the error mapper and the size contract depend on', () => {
    expect(seasonFormatsSql).toMatch(/CONSTRAINT season_formats_spec_size\s+CHECK \(octet_length\(spec::text\) <= 262144\)/);
    expect(seasonFormatsSql).toContain('REFERENCES public.format_definitions(id) ON DELETE SET NULL');
    expect(seasonFormatsSql).toContain('REFERENCES public.seasons(id) ON DELETE CASCADE');
  });

  it('keeps a custom league without an attached format from becoming active', () => {
    expect(seasonFormatsSql).toMatch(
      /CREATE TRIGGER trg_seasons_require_attached_format BEFORE UPDATE OF status, format_type ON public\.seasons/,
    );
    expect(seasonFormatsSql).toContain("WHEN (NEW.format_type = 'custom' AND NEW.status = 'active'");
    expect(seasonFormatsSql).toContain("RAISE EXCEPTION 'FORMAT_NOT_ATTACHED' USING ERRCODE = 'P0001'");
  });

  it('raises the attach and detach signals with SQLSTATE P0001', () => {
    for (const signal of [
      'FORMAT_SEASON_NOT_FOUND',
      'FORMAT_SEASON_NOT_CUSTOM',
      'FORMAT_SEASON_STARTED',
      'FORMAT_SEASON_HAS_MANUAL_PHASES',
      'FORMAT_NOTHING_ATTACHED',
    ]) {
      expect(seasonFormatsSql).toContain(`RAISE EXCEPTION '${signal}' USING ERRCODE = 'P0001'`);
    }
  });
});

describe('service-role only', () => {
  for (const [file, tables] of Object.entries(NEW_TABLES)) {
    for (const table of tables) {
      it(`${table}: RLS on, revoked from the API roles, granted to service_role`, () => {
        const sql = sqlOf(file);
        expect(sql).toContain(`CREATE TABLE public.${table} (`);
        expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
        expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
        expect(sql).toMatch(new RegExp(`GRANT [A-Z, ]+ ON TABLE public\\.${table} TO service_role;`));
      });
    }
  }

  for (const [file, functions] of Object.entries(NEW_FUNCTIONS)) {
    it(`${path.basename(file)}: creates exactly the expected functions`, () => {
      const created = [...sqlOf(file).matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
      expect(created.sort()).toEqual(Object.keys(functions).sort());
    });

    for (const [name, args] of Object.entries(functions)) {
      it(`${name}(${args}): EXECUTE revoked from the API roles, granted to service_role`, () => {
        const sql = sqlOf(file);
        expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`);
        expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
      });
    }
  }

  it('creates no RLS policy (the tables are reached through the service role only)', () => {
    for (const sql of [enumSql, definitionsSql, seasonFormatsSql]) {
      expect(sql).not.toMatch(/CREATE POLICY/i);
    }
  });

  it('creates exactly the three expected tables', () => {
    const created = [...definitionsSql.matchAll(/CREATE TABLE public\.(\w+)/g), ...seasonFormatsSql.matchAll(/CREATE TABLE public\.(\w+)/g)]
      .map((m) => m[1])
      .sort();
    expect(created).toEqual(['format_definition_versions', 'format_definitions', 'season_formats']);
  });
});
