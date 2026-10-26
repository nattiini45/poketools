import 'server-only';

/**
 * The formats a league admin can attach: published formats the admin owns, that were shared with league admins or
 * that are in the gallery. One bounded read of the library list; the rows are mapped to the fields the picker
 * shows. No owner id, no draft body and no `players` row reaches the client: the owner is a display name.
 */
import { listFormatDefinitions } from '@/lib/supabase/queries/format-definitions';
import type { LText } from '@/lib/studio-core/ltext';
import type { SessionPlayer } from '@/types/auth';
import { canAttachDefinition, type FormatActor } from './access';
import type { FormatVisibility } from './library-types';

/** Rows the picker lists at most. */
const CANDIDATE_LIMIT = 100;

export interface AttachCandidate {
  id: string;
  slug: string;
  name: LText;
  /** The latest published version. */
  version_no: number;
  content_hash: string;
  visibility: FormatVisibility;
  ownerName: string | null;
  /** The viewer owns it. */
  mine: boolean;
}

export async function loadAttachCandidates(player: SessionPlayer): Promise<{ items: AttachCandidate[]; capped: boolean }> {
  const actor: FormatActor = { playerId: player.playerId, isAdmin: player.isAdmin };
  const { items, total } = await listFormatDefinitions({ actor, scope: 'all', limit: CANDIDATE_LIMIT, offset: 0 });

  const candidates: AttachCandidate[] = [];
  for (const row of items) {
    if (row.current_version === null) continue;
    const access = { kind: row.kind, owner_id: row.owner?.id ?? null, visibility: row.visibility };
    if (!canAttachDefinition(actor, access)) continue;
    candidates.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      version_no: row.current_version.version_no,
      content_hash: row.current_version.content_hash,
      visibility: row.visibility,
      ownerName: row.owner?.name ?? null,
      mine: row.owner?.id === player.playerId,
    });
  }
  return { items: candidates, capped: total > CANDIDATE_LIMIT };
}
