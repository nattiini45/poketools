import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors } from '@/lib/validation';
import { supabase } from '@/lib/supabase/client';
import {
  listGalleryItemsForThumbs,
  listPlayersNeedingAvatarThumb,
  swapPlayerAvatarUrl,
} from '@/lib/supabase/queries/avatar-gallery';
import {
  AVATAR_BUCKET,
  avatarOriginalPath,
  avatarStoragePathFromUrl,
  avatarThumbPath,
  isAvatarOriginalPath,
  supabasePublicOrigin,
} from '@/lib/avatar/thumbnail-path';
import {
  AvatarThumbnailError,
  avatarThumbnailExists,
  ensureAvatarThumbnail,
  type AvatarBucket,
} from '@/lib/avatar/thumbnail';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/admin/avatars/thumbnails — one-off backfill of avatar thumbnails
 * (DATA-PLAN fix 8, design decision D37). Site admins only.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless the body says `"dryRun": false`
 * (a JSON boolean). A maintainer confirms the live run at execution time.
 *
 * Body (all optional):
 *   scope   "players" (default): players whose avatar_url is an `avatars` bucket
 *           original. Live: create the thumbnail if missing, then point
 *           avatar_url at it (only if avatar_url is unchanged).
 *           "gallery": ai_avatar_gallery rows. Live: create missing thumbnails
 *           next to the originals (no DB writes; image_url keeps the original).
 *   dryRun  boolean, default true. A dry run reads rows and HEAD-checks
 *           thumbnails only: no downloads, uploads or row updates.
 *   limit   rows per call, 1-25, default 10. Rows are processed one at a time.
 *   cursor  the previous response's `nextCursor` (rows are paged by id).
 *
 * Idempotent: players already on a thumbnail are filtered out by the query,
 * gallery rows whose thumbnail exists are skipped, and existing thumbnails are
 * never re-uploaded. Re-running a batch is safe.
 *
 * Path safety: a row's URL reaches Storage only if its origin is the project's
 * (`NEXT_PUBLIC_SUPABASE_URL`) and its object path is on the strict whitelist
 * (`isAvatarOriginalPath`). Anything else is skipped as `unsafe_path` without a
 * single Storage call.
 */

export const maxDuration = 300;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const backfillBodySchema = z.strictObject({
  scope: z.enum(['players', 'gallery']).default('players'),
  dryRun: z.boolean().default(true),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().uuid().optional(),
});

type BackfillScope = z.infer<typeof backfillBodySchema>['scope'];

type BackfillAction =
  | 'would_create'
  | 'would_link'
  | 'created'
  | 'linked'
  | 'skipped'
  | 'failed';

interface BackfillItem {
  /** Player id (scope "players") or gallery item id (scope "gallery"). */
  id: string;
  action: BackfillAction;
  originalPath?: string;
  thumbPath?: string;
  /** Thumbnail size in bytes, when one was created. */
  bytes?: number;
  /** Why an item was skipped or failed (a stable code). */
  reason?: string;
}

interface BackfillReport {
  scope: BackfillScope;
  dryRun: boolean;
  limit: number;
  cursor: string | null;
  scanned: number;
  /** Pass as `cursor` to continue; null when this page was the last one. */
  nextCursor: string | null;
  counts: Record<BackfillAction, number>;
  items: BackfillItem[];
}

interface BatchOptions {
  dryRun: boolean;
  limit: number;
  cursor: string | null;
  /** The project's Supabase origin; stored URLs must match it exactly. */
  origin: string;
}

/** Body is optional: an empty body means "all defaults" (a dry run). */
async function readJsonBody(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    console.error('[admin/avatars/thumbnails] Request body is not valid JSON:', err);
    return { ok: false };
  }
}

function failureReason(err: unknown, fallbackStage: string): string {
  return `${err instanceof AvatarThumbnailError ? err.stage : fallbackStage}_failed`;
}

/**
 * Classify a stored URL. Returns the whitelisted original path, or a skip
 * reason: `already_thumbnail` for a thumbnail of a whitelisted original, and
 * `unsafe_path` for everything else (another origin, another bucket, a path
 * that could leave the bucket, or any name off the whitelist).
 */
function originalPathFor(url: string, origin: string): { path: string } | { reason: 'unsafe_path' | 'already_thumbnail' } {
  const path = avatarStoragePathFromUrl(url, origin);
  if (path && avatarOriginalPath(path)) return { reason: 'already_thumbnail' };
  if (!path || !isAvatarOriginalPath(path)) return { reason: 'unsafe_path' };
  return { path };
}

async function backfillPlayers(bucket: AvatarBucket, options: BatchOptions): Promise<BackfillItem[]> {
  const rows = await listPlayersNeedingAvatarThumb({ limit: options.limit, afterId: options.cursor });
  const items: BackfillItem[] = [];

  for (const row of rows) {
    const classified = originalPathFor(row.avatar_url, options.origin);
    if ('reason' in classified) {
      if (classified.reason === 'unsafe_path') {
        console.warn(`[admin/avatars/thumbnails] player ${row.id}: unsafe_path, skipped without touching Storage`);
      }
      items.push({ id: row.id, action: 'skipped', reason: classified.reason });
      continue;
    }

    const originalPath = classified.path;
    const thumbPath = avatarThumbPath(originalPath);
    const base = { id: row.id, originalPath, thumbPath };

    try {
      if (options.dryRun) {
        const exists = await avatarThumbnailExists(bucket, originalPath);
        items.push({ ...base, action: exists ? 'would_link' : 'would_create' });
        continue;
      }

      const thumb = await ensureAvatarThumbnail(bucket, originalPath);
      const thumbUrl = bucket.getPublicUrl(thumbPath).data.publicUrl;

      let swapped: boolean;
      try {
        swapped = await swapPlayerAvatarUrl(row.id, row.avatar_url, thumbUrl);
      } catch (err) {
        console.error(`[admin/avatars/thumbnails] player ${row.id}: avatar_url update failed:`, err);
        items.push({ ...base, action: 'failed', reason: 'update_failed' });
        continue;
      }

      if (!swapped) {
        items.push({ ...base, action: 'skipped', reason: 'avatar_changed' });
        continue;
      }
      items.push({
        ...base,
        action: thumb.created ? 'created' : 'linked',
        ...(thumb.created ? { bytes: thumb.bytes } : {}),
      });
    } catch (err) {
      const reason = failureReason(err, 'thumbnail');
      console.error(`[admin/avatars/thumbnails] player ${row.id}: ${reason}:`, err);
      items.push({ ...base, action: 'failed', reason });
    }
  }

  return items;
}

async function backfillGallery(bucket: AvatarBucket, options: BatchOptions): Promise<BackfillItem[]> {
  const rows = await listGalleryItemsForThumbs({ limit: options.limit, afterId: options.cursor });
  const items: BackfillItem[] = [];

  for (const row of rows) {
    const classified = originalPathFor(row.image_url, options.origin);
    if ('reason' in classified) {
      if (classified.reason === 'unsafe_path') {
        console.warn(`[admin/avatars/thumbnails] gallery ${row.id}: unsafe_path, skipped without touching Storage`);
      }
      items.push({ id: row.id, action: 'skipped', reason: classified.reason });
      continue;
    }

    const originalPath = classified.path;
    const base = { id: row.id, originalPath, thumbPath: avatarThumbPath(originalPath) };

    try {
      if (options.dryRun) {
        const exists = await avatarThumbnailExists(bucket, originalPath);
        items.push(exists
          ? { ...base, action: 'skipped', reason: 'thumbnail_exists' }
          : { ...base, action: 'would_create' });
        continue;
      }

      const thumb = await ensureAvatarThumbnail(bucket, originalPath);
      items.push(thumb.created
        ? { ...base, action: 'created', bytes: thumb.bytes }
        : { ...base, action: 'skipped', reason: 'thumbnail_exists' });
    } catch (err) {
      const reason = failureReason(err, 'thumbnail');
      console.error(`[admin/avatars/thumbnails] gallery ${row.id}: ${reason}:`, err);
      items.push({ ...base, action: 'failed', reason });
    }
  }

  return items;
}

function countActions(items: BackfillItem[]): Record<BackfillAction, number> {
  const counts: Record<BackfillAction, number> = {
    would_create: 0,
    would_link: 0,
    created: 0,
    linked: 0,
    skipped: 0,
    failed: 0,
  };
  for (const item of items) counts[item.action] += 1;
  return counts;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    const body = await readJsonBody(request);
    if (!body.ok) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Request body must be valid JSON', code: 'invalid_json' },
        { status: 400 }
      );
    }

    const parsed = backfillBodySchema.safeParse(body.value);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const origin = supabasePublicOrigin();
    if (!origin) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing or not an http(s) URL');
    }

    const { scope, dryRun, limit } = parsed.data;
    const cursor = parsed.data.cursor ?? null;
    const bucket = supabase.storage.from(AVATAR_BUCKET);
    const options: BatchOptions = { dryRun, limit, cursor, origin };

    const items = scope === 'players'
      ? await backfillPlayers(bucket, options)
      : await backfillGallery(bucket, options);

    const counts = countActions(items);

    // avatar_url changed for some players: refresh the ISR pages that show avatars,
    // and expire the public read-cache entries that embed them.
    if (!dryRun && scope === 'players' && counts.created + counts.linked > 0) {
      revalidatePath('/');
      revalidatePath('/tournaments');
      revalidatePath('/leagues');
      expirePublicTags([publicTags.players]);

      // One audit entry per live batch: which players' avatar_url it rewrote.
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'admin.backfill',
        resource_type: 'player',
        resource_id: null,
        resource_name: 'avatar thumbnails',
        metadata: {
          scope,
          cursor,
          limit,
          counts,
          player_ids: items
            .filter((item) => item.action === 'created' || item.action === 'linked')
            .map((item) => item.id),
        },
      });
    }

    const report: BackfillReport = {
      scope,
      dryRun,
      limit,
      cursor,
      scanned: items.length,
      nextCursor: items.length === limit ? items[items.length - 1].id : null,
      counts,
      items,
    };

    return NextResponse.json<ApiResult<BackfillReport>>({ success: true, data: report });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to backfill avatar thumbnails');
  }
}
