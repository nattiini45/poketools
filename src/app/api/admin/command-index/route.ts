import { NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { listCommandIndex } from '@/lib/supabase/queries/admin-command-index';
import type { CommandIndexEntry } from '@/lib/admin/command-index';
import type { ApiResult } from '@/types/api';

export type { CommandIndexEntry } from '@/lib/admin/command-index';

/**
 * GET /api/admin/command-index — the competitions the admin command menu (⌘K) jumps to, fetched on its first open.
 * `data` is an array of `{ id, name, kind, archived }`, newest first and at most 500: leagues and standalone
 * tournaments, archived ones flagged (a league's phases are reached through the league). A site admin gets every
 * one; a resource admin only the leagues they are assigned to and the standalone tournaments they may manage, and
 * none when their assignments were all removed. Ids and names only: no player rows and no other columns.
 */
export async function GET() {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const entries = await listCommandIndex({ seasonIds: scope.seasonIds, tournamentIds: scope.tournamentIds });

    return NextResponse.json<ApiResult<CommandIndexEntry[]>>({ success: true, data: entries });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the command index');
  }
}
