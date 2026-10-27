/**
 * An in-memory stand-in for the ruleset library API, for the dev-only preview: saving a draft, reading it back and
 * publishing answer from memory, so the editor's save, dirty and conflict states can be exercised on the fixture page
 * without a database. Any other library route answers 403 like an admin without access would. The catalog and preset
 * routes are NOT faked: they read the dex only (no Supabase), so the preview calls the real ones.
 */
import { ltext } from '@/lib/studio-core/ltext';

const LIBRARY = '/api/ruleset-definitions/';

export interface FakeLibraryState {
  definitionId: string;
  rev: number;
  document: unknown;
  /** Version numbers published so far. */
  versions: number;
}

type JsonObject = Record<string, unknown>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fail = (status: number, code: string, params?: Record<string, number>): Response =>
  json(status, { success: false, error: code, code, ...(params === undefined ? {} : { params }) });

function bodyOf(init: RequestInit | undefined): JsonObject {
  try {
    const parsed: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

const CHECK = { ok: true, content_hash: null, resolved_hash: null, diagnostics: [], truncated: false };

/** A `fetch` for the library routes over `state`; `passthrough` handles every other path. */
export function createFakeLibrary(state: FakeLibraryState, passthrough: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const path = url.split('?')[0];
    if (path !== LIBRARY.slice(0, -1) && !path.startsWith(LIBRARY)) return passthrough(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const rest = path.slice(LIBRARY.length).split('/');

    if (rest[0] === state.definitionId && rest[1] === 'draft' && method === 'PUT') {
      const body = bodyOf(init);
      if (body.draft_rev !== state.rev) return fail(409, 'ruleset_stale_revision', { draft_rev: state.rev });
      state.rev += 1;
      state.document = body.document;
      const identity = (body.document as { identity?: { name?: unknown } } | undefined)?.identity;
      return json(200, { success: true, data: { draft_rev: state.rev, updated_at: new Date().toISOString(), name: identity?.name ?? ltext('en', 'Preview'), check: CHECK } });
    }
    if (rest[0] === state.definitionId && rest.length === 1 && method === 'GET') {
      return json(200, { success: true, data: { definition: null, draft: { document: state.document, draft_rev: state.rev }, published: null, versions: [], check: null } });
    }
    if (rest[0] === state.definitionId && rest[1] === 'publish' && method === 'POST') {
      const body = bodyOf(init);
      if (body.draft_rev !== state.rev) return fail(409, 'ruleset_stale_revision', { draft_rev: state.rev });
      state.versions += 1;
      return json(201, { success: true, data: { version: { version_no: state.versions, content_hash: `preview-${state.rev}` }, definition: null } });
    }
    return fail(403, 'forbidden');
  };
}
