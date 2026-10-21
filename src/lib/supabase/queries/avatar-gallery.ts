import { supabase } from '../client';
import {
  AVATAR_THUMB_SUFFIX,
  avatarOriginalUrl,
  avatarPublicUrlPrefix,
  supabasePublicOrigin,
} from '@/lib/avatar/thumbnail-path';
import type { AiGalleryItem, AvatarGalleryChoices } from '@/types/avatar';
import type { Database, Json } from '@/types/database';

type GalleryRow = Database['public']['Tables']['ai_avatar_gallery']['Row'];
type GalleryInsertRow = Database['public']['Tables']['ai_avatar_gallery']['Insert'];

interface GalleryInsert {
  player_id: string;
  image_url: string;
  choices: AvatarGalleryChoices;
  style: string;
}

function toGalleryItem(
  row: GalleryRow,
  playerName?: string,
): AiGalleryItem {
  return {
    id: row.id,
    player_id: row.player_id,
    image_url: row.image_url,
    choices: toGalleryChoices(row.choices as unknown as Record<string, unknown>),
    style: row.style,
    created_at: row.created_at,
    ...(playerName !== undefined ? { player_name: playerName } : {}),
  };
}

/** Insert a new gallery item after AI generation. */
export async function insertGalleryItem(item: GalleryInsert): Promise<AiGalleryItem> {
  const payload: GalleryInsertRow = {
    player_id: item.player_id,
    image_url: item.image_url,
    choices: item.choices as unknown as Json,
    style: item.style,
  };

  const { data, error } = await supabase
    .from('ai_avatar_gallery')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return toGalleryItem(data);
}

/** Get a player's own gallery items, newest first. */
export async function getPlayerGallery(
  playerId: string,
  limit = 50,
): Promise<AiGalleryItem[]> {
  const { data, error } = await supabase
    .from('ai_avatar_gallery')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => toGalleryItem(row));
}

/** Get a single gallery item by ID. */
export async function getGalleryItem(id: string): Promise<AiGalleryItem | null> {
  const { data, error } = await supabase
    .from('ai_avatar_gallery')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toGalleryItem(data) : null;
}

/** Delete one of a player's own gallery items. */
export async function deleteGalleryItem(id: string, playerId: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('ai_avatar_gallery')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('player_id', playerId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Get community AI avatars — other players' gallery items that are
 * currently set as their active avatar. Excludes the requesting player.
 */
export async function getCommunityAvatars(
  excludePlayerId: string,
  limit = 20,
): Promise<AiGalleryItem[]> {
  // We can't easily join in Supabase client, so we:
  // 1. Get players whose avatar is a gallery image (AI avatars live in the
  //    gallery/ subfolder of the avatars bucket)
  // 2. Match their avatar_urls to gallery items
  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, name, avatar_url')
    .like('avatar_url', '%/gallery/%')
    .neq('id', excludePlayerId);

  if (pErr) throw pErr;
  if (!players || players.length === 0) return [];

  const aiPlayers = players.filter(
    (p) => p.avatar_url && p.avatar_url.includes('/gallery/'),
  );

  if (aiPlayers.length === 0) return [];

  // avatar_url points at the thumbnail (`<original>.thumb.webp`) since the
  // thumbnail wave; the gallery row keeps the original's URL.
  const urlToName = new Map<string, string>();
  for (const p of aiPlayers) {
    if (p.avatar_url) urlToName.set(avatarOriginalUrl(p.avatar_url), p.name);
  }

  const { data: galleryRows, error: gErr } = await supabase
    .from('ai_avatar_gallery')
    .select('*')
    .in('image_url', Array.from(urlToName.keys()))
    .order('created_at', { ascending: false })
    .limit(limit);

  if (gErr) throw gErr;

  return (galleryRows ?? []).map((row) =>
    toGalleryItem(row, urlToName.get(row.image_url as string)),
  );
}

// ─── Thumbnail backfill (admin-only route) ───────────────────────────

export interface PlayerAvatarThumbCandidate {
  id: string;
  avatar_url: string;
}

export interface GalleryThumbCandidate {
  id: string;
  player_id: string;
  image_url: string;
}

/** Escape LIKE wildcards (`%`, `_`) and the escape character itself. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Players whose avatar_url is an object in THIS project's `avatars` bucket
 * (`<NEXT_PUBLIC_SUPABASE_URL origin>/storage/v1/object/public/avatars/…`)
 * that is not yet a thumbnail, ordered by id. The filter is anchored at the
 * start of the URL, so a foreign URL that merely contains the bucket path
 * never matches. Rows the backfill has already pointed at a thumbnail drop out
 * of this filter, which keeps the backfill idempotent. The route still
 * validates every URL (origin + path whitelist) before touching Storage.
 */
export async function listPlayersNeedingAvatarThumb(options: {
  limit: number;
  afterId?: string | null;
}): Promise<PlayerAvatarThumbCandidate[]> {
  const origin = supabasePublicOrigin();
  if (!origin) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing or not an http(s) URL');
  }

  let query = supabase
    .from('players')
    .select('id, avatar_url')
    .like('avatar_url', `${escapeLike(avatarPublicUrlPrefix(origin))}%`)
    .not('avatar_url', 'like', `%${AVATAR_THUMB_SUFFIX}`);
  if (options.afterId) query = query.gt('id', options.afterId);

  const { data, error } = await query
    .order('id', { ascending: true })
    .limit(options.limit);

  if (error) throw error;
  return (data ?? []).flatMap((row) =>
    typeof row.avatar_url === 'string' ? [{ id: row.id, avatar_url: row.avatar_url }] : [],
  );
}

/** One page of gallery rows, ordered by id, for the thumbnail backfill. */
export async function listGalleryItemsForThumbs(options: {
  limit: number;
  afterId?: string | null;
}): Promise<GalleryThumbCandidate[]> {
  let query = supabase
    .from('ai_avatar_gallery')
    .select('id, player_id, image_url');
  if (options.afterId) query = query.gt('id', options.afterId);

  const { data, error } = await query
    .order('id', { ascending: true })
    .limit(options.limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Point a player's avatar at its thumbnail, but only if avatar_url still holds
 * `fromUrl` (a player who changed avatar meanwhile is left alone).
 * Returns true when the row was updated.
 */
export async function swapPlayerAvatarUrl(
  playerId: string,
  fromUrl: string,
  toUrl: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('players')
    .update({ avatar_url: toUrl })
    .eq('id', playerId)
    .eq('avatar_url', fromUrl)
    .select('id');

  if (error) throw error;
  return (data ?? []).length > 0;
}

function toGalleryChoices(choices: Record<string, unknown>): AvatarGalleryChoices {
  if (choices.type === 'photo_transform') {
    return { type: 'photo_transform' };
  }

  return choices as unknown as AvatarGalleryChoices;
}
