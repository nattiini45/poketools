/**
 * The format library queries: explicit column lists (no `*`, the draft body only from the one read that wants it),
 * bounded pages with an exact count, the visibility `.or()` built with `postgrestQuoted`, the compare-and-set draft
 * save (one statement with both filters), the version cap and the error mapping of writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];
interface Call {
  table: string;
  steps: Step[];
}
interface Reply {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  rpcCalls: [] as { name: string; args: unknown }[],
  respond: null as null | ((call: { table: string; steps: [string, ...unknown[]][] }) => {
    data?: unknown;
    count?: number | null;
    error?: unknown;
  }),
  rpcReply: null as null | { data?: unknown; error?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, steps: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'or', 'not', 'is', 'order', 'range', 'limit']) {
      chain[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        return chain;
      };
    }
    const reply = (): Reply => state.respond?.(call) ?? { data: [], count: 0, error: null };
    chain.maybeSingle = () => Promise.resolve().then(() => ({ error: null, ...reply() }));
    chain.single = () => Promise.resolve().then(() => ({ error: null, ...reply() }));
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null, ...reply() });
    return chain;
  }
  return {
    supabase: {
      from: builder,
      rpc: (name: string, args: unknown) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve({ error: null, ...(state.rpcReply ?? { data: [] }) });
      },
    },
  };
});

import {
  countFormatVersions,
  countSeasonFormatsOfDefinition,
  createFormatDefinition,
  deleteFormatDefinition,
  getFormatDefinitionDraft,
  getFormatDefinitionMeta,
  getFormatVersion,
  getLatestPublishedVersion,
  listFormatDefinitions,
  listFormatVersions,
  listGalleryDefinitions,
  publishFormatVersion,
  saveFormatDraft,
  setFormatVisibility,
} from '../format-definitions';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { FormatDefinition } from '@/lib/format-kit/client';

const ID = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const OWNER = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const stepsOf = (call: Call, name: string) => call.steps.filter(([step]) => step === name);
const selectOf = (call: Call) => stepsOf(call, 'select')[0][1] as string;

const metaRow = {
  id: ID,
  slug: 'swiss-cup',
  name: { base: 'en', en: { v: 'Swiss Cup', s: 'human' } },
  description: null,
  kind: 'custom',
  owner_id: OWNER,
  visibility: 'private',
  forked_from: null,
  draft_rev: 3,
  current_version_id: null,
  created_at: '2026-10-24T10:00:00Z',
  updated_at: '2026-10-24T10:05:00Z',
};

beforeEach(() => {
  state.calls.length = 0;
  state.rpcCalls.length = 0;
  state.respond = null;
  state.rpcReply = null;
});

describe('column lists', () => {
  it('reads definition metadata without the draft body', async () => {
    state.respond = () => ({ data: metaRow });
    const meta = await getFormatDefinitionMeta(ID);
    expect(meta?.slug).toBe('swiss-cup');
    const select = selectOf(state.calls[0]);
    expect(select).not.toContain('*');
    expect(select).not.toContain('current_draft');
    expect(select.split(', ')).toContain('draft_rev');
  });

  it('reads the draft body only through getFormatDefinitionDraft', async () => {
    state.respond = () => ({ data: { current_draft: { a: 1 }, draft_rev: 4 } });
    expect(await getFormatDefinitionDraft(ID)).toEqual({ document: { a: 1 }, draft_rev: 4 });
    expect(selectOf(state.calls[0])).toBe('current_draft, draft_rev');
  });

  it('answers null for a malformed id without a request', async () => {
    expect(await getFormatDefinitionMeta('not-a-uuid')).toBeNull();
    expect(await getFormatDefinitionDraft('x')).toBeNull();
    expect(await getFormatVersion('x', 1)).toBeNull();
    expect(await getLatestPublishedVersion('x')).toBeNull();
    expect(await listFormatVersions('x')).toEqual([]);
    expect(await countFormatVersions('x')).toBe(0);
    expect(await countSeasonFormatsOfDefinition('x')).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('never selects with a star', async () => {
    state.respond = () => ({ data: [], count: 0 });
    await listFormatDefinitions({ actor: { playerId: OWNER, isAdmin: false }, scope: 'all', limit: 10, offset: 0 });
    await listGalleryDefinitions();
    await listFormatVersions(ID);
    await getFormatVersion(ID, 1);
    for (const call of state.calls) expect(selectOf(call)).not.toMatch(/(^|[ ,(])\*/);
  });
});

describe('listFormatDefinitions', () => {
  const actor = { playerId: OWNER, isAdmin: false };

  it('pages with an exact count, newest change first, and embeds only names and the version summary', async () => {
    state.respond = () => ({
      data: [
        {
          ...metaRow,
          owner: { id: OWNER, name: 'Ash' },
          current_version: { id: 'v1', version_no: 2, content_hash: 'h', created_at: '2026-10-24T10:06:00Z' },
        },
      ],
      count: 41,
    });
    const result = await listFormatDefinitions({ actor, scope: 'mine', limit: 20, offset: 40 });
    const call = state.calls[0];
    expect(stepsOf(call, 'select')[0][2]).toEqual({ count: 'exact', head: false });
    expect(selectOf(call)).toContain('owner:players!owner_id ( id, name )');
    expect(selectOf(call)).toContain('current_version:format_definition_versions!current_version_id ( id, version_no, content_hash, created_at )');
    expect(stepsOf(call, 'range')[0].slice(1)).toEqual([40, 59]);
    expect(stepsOf(call, 'order').map((step) => step.slice(1))).toEqual([['updated_at', { ascending: false }], ['id']]);
    expect(result.total).toBe(41);
    expect(result.items[0]).toMatchObject({ slug: 'swiss-cup', owner: { id: OWNER, name: 'Ash' } });
    expect(result.items[0].current_version).toEqual({ id: 'v1', version_no: 2, content_hash: 'h', created_at: '2026-10-24T10:06:00Z' });
    // The summary carries no owner id column and no version pointer, only the mapped embeds.
    expect(result.items[0]).not.toHaveProperty('owner_id');
    expect(result.items[0]).not.toHaveProperty('current_version_id');
  });

  it('clamps the page size to 100 and a negative offset to 0', async () => {
    await listFormatDefinitions({ actor, scope: 'mine', limit: 5000, offset: -3 });
    expect(stepsOf(state.calls[0], 'range')[0].slice(1)).toEqual([0, 99]);
  });

  it('mine filters by the owner', async () => {
    await listFormatDefinitions({ actor, scope: 'mine', limit: 10, offset: 0 });
    expect(stepsOf(state.calls[0], 'eq')).toContainEqual(['eq', 'owner_id', OWNER]);
    expect(stepsOf(state.calls[0], 'or')).toHaveLength(0);
  });

  it('shared lists visible rows of others, rows without an owner included', async () => {
    await listFormatDefinitions({ actor, scope: 'shared', limit: 10, offset: 0 });
    const call = state.calls[0];
    expect(stepsOf(call, 'in')[0].slice(1)).toEqual(['visibility', ['league', 'gallery']]);
    expect(stepsOf(call, 'or')[0][1]).toBe(`owner_id.is.null,owner_id.neq."${OWNER}"`);
  });

  it('all, for a non-admin, is own rows plus shared rows, with the player id quoted', async () => {
    await listFormatDefinitions({ actor, scope: 'all', limit: 10, offset: 0 });
    expect(stepsOf(state.calls[0], 'or')[0][1]).toBe(`owner_id.eq."${OWNER}",visibility.in.(league,gallery)`);
  });

  it('quotes a hostile player id instead of concatenating it', async () => {
    const evil = 'x",visibility.eq.private,owner_id.eq."y';
    await listFormatDefinitions({ actor: { playerId: evil, isAdmin: false }, scope: 'all', limit: 10, offset: 0 });
    const filter = stepsOf(state.calls[0], 'or')[0][1] as string;
    expect(filter).toBe(`owner_id.eq."x\\",visibility.eq.private,owner_id.eq.\\"y",visibility.in.(league,gallery)`);
    expect(filter).not.toContain(`owner_id.eq.${evil}`);
  });

  it('all, for a site admin, has no visibility filter', async () => {
    await listFormatDefinitions({ actor: { playerId: OWNER, isAdmin: true }, scope: 'all', limit: 10, offset: 0 });
    expect(stepsOf(state.calls[0], 'or')).toHaveLength(0);
    expect(stepsOf(state.calls[0], 'eq')).toHaveLength(0);
  });

  it('applies the visibility and kind filters as plain equality filters', async () => {
    await listFormatDefinitions({
      actor: { playerId: OWNER, isAdmin: true },
      scope: 'all',
      visibility: 'league',
      kind: 'preset',
      limit: 10,
      offset: 0,
    });
    expect(stepsOf(state.calls[0], 'eq').map((step) => step.slice(1))).toEqual([
      ['visibility', 'league'],
      ['kind', 'preset'],
    ]);
  });

  it('rethrows a database error', async () => {
    const boom = { message: 'boom' };
    state.respond = () => ({ error: boom });
    await expect(listFormatDefinitions({ actor, scope: 'all', limit: 10, offset: 0 })).rejects.toBe(boom);
  });

  it('answers an empty page with the real total when the offset is past the last row', async () => {
    state.respond = (call) =>
      stepsOf(call, 'range').length > 0
        ? { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
        : { count: 12, data: null };
    const result = await listFormatDefinitions({ actor, scope: 'mine', visibility: 'private', limit: 10, offset: 5000 });
    expect(result).toEqual({ items: [], total: 12 });
    // The recount repeats the filters as a head count, without paging.
    expect(state.calls).toHaveLength(2);
    const recount = state.calls[1];
    expect(stepsOf(recount, 'select')[0][2]).toEqual({ count: 'exact', head: true });
    expect(stepsOf(recount, 'range')).toHaveLength(0);
    expect(stepsOf(recount, 'eq').map((step) => step.slice(1))).toEqual([
      ['owner_id', OWNER],
      ['visibility', 'private'],
    ]);
  });

  it('rethrows an error from the recount', async () => {
    const boom = { message: 'count failed' };
    state.respond = (call) =>
      stepsOf(call, 'range').length > 0 ? { error: { code: 'PGRST103', message: 'range' } } : { error: boom };
    await expect(listFormatDefinitions({ actor, scope: 'all', limit: 10, offset: 5000 })).rejects.toBe(boom);
  });
});

describe('listGalleryDefinitions', () => {
  it('reads published gallery rows, newest first, at most 100, and drops rows without a version', async () => {
    state.respond = () => ({
      data: [
        { id: 'a', slug: 'a', name: {}, description: null, kind: 'custom', updated_at: 't1', current_version: { version_no: 2, content_hash: 'h' } },
        { id: 'b', slug: 'b', name: {}, description: null, kind: 'custom', updated_at: 't0', current_version: null },
      ],
    });
    const items = await listGalleryDefinitions(500);
    const call = state.calls[0];
    expect(stepsOf(call, 'eq')[0].slice(1)).toEqual(['visibility', 'gallery']);
    expect(stepsOf(call, 'not')[0].slice(1)).toEqual(['current_version_id', 'is', null]);
    expect(stepsOf(call, 'limit')[0][1]).toBe(100);
    expect(items.map((item) => item.id)).toEqual(['a']);
    expect(items[0]).toEqual({
      id: 'a',
      slug: 'a',
      name: {},
      description: null,
      kind: 'custom',
      version_no: 2,
      content_hash: 'h',
      updated_at: 't1',
    });
    // Nothing private: no owner id, no draft.
    expect(selectOf(call)).not.toMatch(/owner|draft/);
  });
});

describe('writes', () => {
  it('creates a private custom definition at revision 1 and returns its metadata', async () => {
    state.respond = () => ({ data: metaRow });
    const meta = await createFormatDefinition({
      slug: 'swiss-cup',
      name: metaRow.name as never,
      description: null,
      ownerId: OWNER,
      forkedFrom: null,
      document: { schema_version: 1 },
    });
    expect(meta.id).toBe(ID);
    const insert = stepsOf(state.calls[0], 'insert')[0][1] as Record<string, unknown>;
    expect(insert).toMatchObject({
      slug: 'swiss-cup',
      kind: 'custom',
      owner_id: OWNER,
      visibility: 'private',
      forked_from: null,
      draft_rev: 1,
      current_draft: { schema_version: 1 },
    });
  });

  it('maps a taken slug to format_slug_taken', async () => {
    state.respond = () => ({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "format_definitions_slug_key"' },
    });
    await expect(
      createFormatDefinition({ slug: 's', name: {} as never, description: null, ownerId: OWNER, forkedFrom: null, document: {} }),
    ).rejects.toMatchObject({ code: 'format_slug_taken', statusCode: 409 });
  });

  it('maps an oversized draft to format_document_too_large_to_store', async () => {
    state.respond = () => ({
      error: { code: '23514', message: 'new row for relation "format_definitions" violates check constraint "format_definitions_draft_size"' },
    });
    await expect(
      createFormatDefinition({ slug: 's', name: {} as never, description: null, ownerId: OWNER, forkedFrom: null, document: {} }),
    ).rejects.toMatchObject({ code: 'format_document_too_large_to_store', statusCode: 413 });
  });

  it('rethrows an unrelated error unchanged', async () => {
    const boom = { code: '57014', message: 'canceling statement due to statement timeout' };
    state.respond = () => ({ error: boom });
    await expect(
      createFormatDefinition({ slug: 's', name: {} as never, description: null, ownerId: OWNER, forkedFrom: null, document: {} }),
    ).rejects.toBe(boom);
  });
});

describe('saveFormatDraft', () => {
  it('is one compare-and-set update filtered by id AND the revision the caller saw', async () => {
    state.respond = () => ({ data: { draft_rev: 5, updated_at: 't' } });
    const result = await saveFormatDraft({ id: ID, expectedRev: 4, document: { a: 1 } });
    expect(result).toEqual({ draft_rev: 5, updated_at: 't' });
    expect(state.calls).toHaveLength(1);
    const call = state.calls[0];
    expect(stepsOf(call, 'update')[0][1]).toEqual({ current_draft: { a: 1 }, draft_rev: 5 });
    expect(stepsOf(call, 'eq').map((step) => step.slice(1))).toEqual([
      ['id', ID],
      ['draft_rev', 4],
    ]);
    expect(selectOf(call)).toBe('draft_rev, updated_at');
  });

  it('writes name and description with the draft when given, and only then', async () => {
    state.respond = () => ({ data: { draft_rev: 2, updated_at: 't' } });
    const name = { base: 'en', en: { v: 'N', s: 'human' } } as never;
    await saveFormatDraft({ id: ID, expectedRev: 1, document: {}, name, description: null });
    expect(stepsOf(state.calls[0], 'update')[0][1]).toEqual({ current_draft: {}, draft_rev: 2, name, description: null });
    await saveFormatDraft({ id: ID, expectedRev: 1, document: {} });
    expect(Object.keys(stepsOf(state.calls[1], 'update')[0][1] as object)).toEqual(['current_draft', 'draft_rev']);
  });

  it('answers null when no row matched (stale revision or missing definition)', async () => {
    state.respond = () => ({ data: null });
    expect(await saveFormatDraft({ id: ID, expectedRev: 1, document: {} })).toBeNull();
  });

  it('answers null for a malformed id without a request', async () => {
    expect(await saveFormatDraft({ id: 'nope', expectedRev: 1, document: {} })).toBeNull();
    expect(state.calls).toHaveLength(0);
  });

  it('maps an oversized document to a typed error', async () => {
    state.respond = () => ({
      error: { code: '23514', message: 'new row for relation "format_definitions" violates check constraint "format_definitions_draft_size"' },
    });
    await expect(saveFormatDraft({ id: ID, expectedRev: 1, document: {} })).rejects.toBeInstanceOf(FormatStudioError);
  });
});

describe('setFormatVisibility, deleteFormatDefinition and counts', () => {
  it('updates the visibility by id and returns the metadata', async () => {
    state.respond = () => ({ data: { ...metaRow, visibility: 'league' } });
    const meta = await setFormatVisibility(ID, 'league');
    expect(meta.visibility).toBe('league');
    expect(stepsOf(state.calls[0], 'update')[0][1]).toEqual({ visibility: 'league' });
    expect(stepsOf(state.calls[0], 'eq')[0].slice(1)).toEqual(['id', ID]);
  });

  it('answers format_not_found when the definition is gone', async () => {
    state.respond = () => ({ data: null });
    await expect(setFormatVisibility(ID, 'league')).rejects.toMatchObject({ code: 'format_not_found', statusCode: 404 });
  });

  it('deletes by id', async () => {
    await deleteFormatDefinition(ID);
    expect(state.calls[0].table).toBe('format_definitions');
    expect(stepsOf(state.calls[0], 'delete')).toHaveLength(1);
    expect(stepsOf(state.calls[0], 'eq')[0].slice(1)).toEqual(['id', ID]);
  });

  it('counts attached leagues and versions with head counts', async () => {
    state.respond = () => ({ count: 3, data: null });
    expect(await countSeasonFormatsOfDefinition(ID)).toBe(3);
    expect(await countFormatVersions(ID)).toBe(3);
    expect(state.calls.map((call) => call.table)).toEqual(['season_formats', 'format_definition_versions']);
    for (const call of state.calls) expect(stepsOf(call, 'select')[0][2]).toEqual({ count: 'exact', head: true });
    expect(stepsOf(state.calls[0], 'eq')[0].slice(1)).toEqual(['definition_id', ID]);
  });
});

describe('versions', () => {
  it('lists versions newest first, never more than 100, without the spec', async () => {
    state.respond = () => ({ data: [] });
    await listFormatVersions(ID, 100000);
    const call = state.calls[0];
    expect(stepsOf(call, 'limit')[0][1]).toBe(100);
    expect(stepsOf(call, 'order')[0].slice(1)).toEqual(['version_no', { ascending: false }]);
    expect(selectOf(call)).not.toContain('spec');
  });

  it('reads one version by definition and number, spec included', async () => {
    state.respond = () => ({
      data: {
        id: 'v',
        version_no: 2,
        schema_version: 1,
        content_hash: 'h',
        changelog: null,
        created_by: null,
        created_at: 't',
        definition_id: ID,
        spec: { schema_version: 1 },
        status: 'published',
      },
    });
    const version = await getFormatVersion(ID, 2);
    expect(version).toMatchObject({ version_no: 2, status: 'published', spec: { schema_version: 1 } });
    expect(stepsOf(state.calls[0], 'eq').map((step) => step.slice(1))).toEqual([
      ['definition_id', ID],
      ['version_no', 2],
    ]);
  });

  it('latest published version follows current_version_id', async () => {
    const version = {
      id: 'v9',
      version_no: 9,
      schema_version: 1,
      content_hash: 'h',
      changelog: null,
      created_by: null,
      created_at: 't',
      definition_id: ID,
      spec: {},
      status: 'published',
    };
    state.respond = (call) => (call.table === 'format_definitions' ? { data: { current_version_id: 'v9' } } : { data: version });
    expect((await getLatestPublishedVersion(ID))?.version_no).toBe(9);
    expect(state.calls).toHaveLength(2);
    expect(stepsOf(state.calls[1], 'eq')[0].slice(1)).toEqual(['id', 'v9']);
  });

  it('falls back to the highest published number when the pointer is empty', async () => {
    state.respond = (call) => (call.table === 'format_definitions' ? { data: { current_version_id: null } } : { data: null });
    expect(await getLatestPublishedVersion(ID)).toBeNull();
    const fallback = state.calls[1];
    expect(stepsOf(fallback, 'eq').map((step) => step.slice(1))).toEqual([
      ['definition_id', ID],
      ['status', 'published'],
    ]);
    expect(stepsOf(fallback, 'order')[0].slice(1)).toEqual(['version_no', { ascending: false }]);
    expect(stepsOf(fallback, 'limit')[0][1]).toBe(1);
  });

  it('answers null for a definition that does not exist', async () => {
    state.respond = () => ({ data: null });
    expect(await getLatestPublishedVersion(ID)).toBeNull();
    expect(state.calls).toHaveLength(1);
  });
});

describe('publishFormatVersion', () => {
  const spec = { schema_version: 1 } as unknown as FormatDefinition;
  const input = { definitionId: ID, expectedRev: 4, specJson: spec, contentHash: 'a'.repeat(64), changelog: null, actorId: OWNER };

  it('calls the publish function with the parsed spec and the canonical hash', async () => {
    state.rpcReply = { data: [{ out_version_id: 'v1', out_version_no: 3 }] };
    expect(await publishFormatVersion(input)).toEqual({ versionId: 'v1', versionNo: 3 });
    expect(state.rpcCalls).toEqual([
      {
        name: 'format_publish_version',
        args: {
          p_definition_id: ID,
          p_expected_rev: 4,
          p_schema_version: 1,
          p_spec: spec,
          p_content_hash: 'a'.repeat(64),
          p_changelog: null,
          p_actor: OWNER,
        },
      },
    ]);
  });

  it('maps a stale revision with the current revision as a parameter', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'FORMAT_STALE_REVISION', details: '{"draft_rev":7}' } };
    await expect(publishFormatVersion(input)).rejects.toMatchObject({
      code: 'format_stale_revision',
      statusCode: 409,
      params: { draft_rev: 7 },
    });
  });

  it('maps nothing-to-publish', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'FORMAT_NOTHING_TO_PUBLISH' } };
    await expect(publishFormatVersion(input)).rejects.toMatchObject({ code: 'format_nothing_to_publish' });
  });
});
