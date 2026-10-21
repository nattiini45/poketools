import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  adminPlayerImportPlayersSchema,
  adminPlayerImportSchema,
  formatZodErrors,
  type AdminPlayerImportPlayersInput,
} from '@/lib/validation';
import { createPlayersBatch, getPlayersByDiscordIds, upsertPlayersByDiscordId } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import { parseCsv } from '@/lib/utils/csv';
import type { ZodError } from 'zod';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ApiResult } from '@/types/api';

type ImportMode = 'insert' | 'upsert';

interface ImportResult {
  name: string;
  discord_id: string;
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  /** English reason for a skipped row (shown as-is by older clients). */
  error?: string;
  /** `errors/admin` code for `error`, so the admin UI can translate the row. */
  code?: ApiErrorCode;
}

type RegisteredPlayerImport = AdminPlayerImportPlayersInput['players'][number];

function playersFromCsv(csv: string): RegisteredPlayerImport[] {
  const parsed = parseCsv(csv);
  return parsed.rows.map((row) => ({
    name: row.name ?? '',
    discord_id: row.discord_id ?? row.discord ?? '',
    ps_username: row.ps_username || undefined,
    champions_username: row.champions_username || undefined,
  }));
}

function validationFailed(error: ZodError): NextResponse<ApiResult<never>> {
  const issues = formatZodErrors(error);
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: issues, code: 'validation_failed', params: { issues } },
    { status: 400 }
  );
}

async function parseImportRequest(request: NextRequest): Promise<
  | { success: true; players: RegisteredPlayerImport[]; mode: ImportMode }
  | { success: false; response: NextResponse<ApiResult<never>> }
> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv')) {
    const csv = await request.text();
    const mode = request.nextUrl.searchParams.get('mode') ?? 'insert';
    const zodResult = adminPlayerImportPlayersSchema.safeParse({
      players: playersFromCsv(csv),
      mode,
    });
    if (!zodResult.success) {
      return { success: false, response: validationFailed(zodResult.error) };
    }
    return { success: true, players: zodResult.data.players, mode: zodResult.data.mode };
  }

  const body = await request.json().catch(() => null);
  const zodResult = adminPlayerImportSchema.safeParse(body);
  if (!zodResult.success) {
    return { success: false, response: validationFailed(zodResult.error) };
  }

  if ('csv' in zodResult.data) {
    const parsedCsv = adminPlayerImportPlayersSchema.safeParse({
      players: playersFromCsv(zodResult.data.csv),
      mode: zodResult.data.mode,
    });
    if (!parsedCsv.success) {
      return { success: false, response: validationFailed(parsedCsv.error) };
    }
    return { success: true, players: parsedCsv.data.players, mode: parsedCsv.data.mode };
  }

  return { success: true, players: zodResult.data.players, mode: zodResult.data.mode };
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const parsed = await parseImportRequest(request);
    if (!parsed.success) {
      return parsed.response;
    }

    const { players, mode } = parsed;

    const results: ImportResult[] = [];
    const uniquePlayers = new Map<string, RegisteredPlayerImport>();
    for (const player of players) {
      if (uniquePlayers.has(player.discord_id)) {
        results.push({
          name: player.name,
          discord_id: player.discord_id,
          success: false,
          action: 'skipped',
          error: 'Duplicate discord_id in import payload',
          code: 'player_import_duplicate_discord_id',
        });
        continue;
      }
      uniquePlayers.set(player.discord_id, player);
    }

    const dedupedPlayers = Array.from(uniquePlayers.values());
    const existingPlayers = await getPlayersByDiscordIds(dedupedPlayers.map((player) => player.discord_id));

    if (mode === 'insert') {
      const toCreate = dedupedPlayers.filter((player) => {
        const exists = existingPlayers.has(player.discord_id);
        if (exists) {
          results.push({
            name: player.name,
            discord_id: player.discord_id,
            success: false,
            action: 'skipped',
            error: 'Player with discord_id already exists',
            code: 'player_import_discord_id_exists',
          });
        }
        return !exists;
      });

      const created = await createPlayersBatch(toCreate);
      for (const player of created) {
        // Import path always supplies a discord_id (schema-enforced)
        results.push({ name: player.name, discord_id: player.discord_id ?? '', success: true, action: 'created' });
      }
    } else {
      await upsertPlayersByDiscordId(dedupedPlayers);
      for (const player of dedupedPlayers) {
        results.push({
          name: player.name,
          discord_id: player.discord_id,
          success: true,
          action: existingPlayers.has(player.discord_id) ? 'updated' : 'created',
        });
      }
    }

    const imported = results.filter(r => r.success).length;
    const updated = results.filter(r => r.action === 'updated').length;
    const skipped = results.filter(r => !r.success).length;

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'admin.import',
      resource_type: 'player',
      resource_id: null,
      metadata: { count: imported, updated, skipped, total: players.length, mode },
    });

    return NextResponse.json<ApiResult<{
      total: number;
      imported: number;
      updated: number;
      skipped: number;
      results: typeof results;
      errors: string[];
    }>>({
      success: true,
      data: { total: players.length, imported, updated, skipped, results, errors: results.filter((result) => result.error).map((result) => result.error ?? '') },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import players');
  }
}