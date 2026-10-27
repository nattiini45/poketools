/**
 * An in-memory stand-in for the routes the surfaces preview can call, so its buttons can be clicked without a database or a
 * session: the pin impact count, the pin move, and the league trash restore and rebuild. Every other `/api/` path answers 403
 * like a signed-out visitor would, instead of reaching a route that reads Supabase; the page's own assets and the dex-only
 * catalog routes the editor uses are outside `/api/` or not needed here.
 *
 * The shell's own session check answers "signed out". Two fixtures show a refusal: the trash row `trash-fail` cannot be restored, and a pin move to version 99 is refused.
 */
import { FAKE_IMPACT } from './fixtures';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** What the routes send: an English `error` (what an English page prints) and the catalogue `code` (what a German page looks up). */
const MESSAGES: Record<string, string> = {
  forbidden: 'You do not have permission to do this.',
  ruleset_pin_started: 'This league or phase has already started. Move it to another ruleset version with the ruleset pin tool, which asks you to confirm.',
};
const fail = (status: number, code: string): Response => json(status, { success: false, error: MESSAGES[code] ?? code, code });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createFakeSurfacesApi(passthrough: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const path = url.split('?')[0];
    if (!path.startsWith('/api/')) return passthrough(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = bodyOf(init);

    // The app shell asks for the session: nobody is signed in.
    if (path === '/api/auth/session') return json(200, null);

    const impact = /^\/api\/ruleset-definitions\/[^/]+\/pins\/impact$/.exec(path);
    if (impact && method === 'POST') {
      await wait(900);
      return json(200, { success: true, data: FAKE_IMPACT(Number(body.to_version_no)) });
    }

    const pins = /^\/api\/ruleset-definitions\/[^/]+\/pins$/.exec(path);
    if (pins && method === 'POST') {
      await wait(500);
      if (body.to_version_no === 99) return fail(409, 'ruleset_pin_started');
      const targets = Array.isArray(body.targets) ? (body.targets as { kind: string; id: string }[]) : [];
      return json(200, {
        success: true,
        data: {
          version_id: 'preview-version',
          version_no: body.to_version_no,
          moved: targets.map((target) => ({ ...target, name: 'Preview', from_version_id: null, started: false, difference: null })),
        },
      });
    }

    const trash = /^\/api\/admin\/league-trash\/([^/]+)\/(restore|rebuild)$/.exec(path);
    if (trash && method === 'POST') {
      await wait(700);
      const [, trashId, action] = trash;
      if (trashId === 'trash-fail') return fail(403, 'forbidden');
      if (action === 'rebuild') return json(200, { success: true, data: { kind: trashId === 'trash-old' ? 'restore' : 'delete' } });
      return json(200, {
        success: true,
        data: {
          season_id: '00000000-0000-4000-8000-000000000401',
          season_name: trashId === 'trash-warn' ? 'Autumn Point Buy League' : 'Spring League 2026',
          paused_pools: trashId === 'trash-warn' ? 2 : 0,
          warnings:
            trashId === 'trash-warn'
              ? [
                  { code: 'parent_missing_nulled', rel: 'matches', column: 'replay_id', count: 3 },
                  { code: 'replay_hash_released', count: 1 },
                  { code: 'columns_ignored', rel: 'season_participants', columns: ['legacy_note', 'legacy_flag'] },
                ]
              : [],
        },
      });
    }

    return fail(403, 'forbidden');
  };
}
