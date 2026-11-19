import 'server-only';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { logger } from '@/lib/logger';
import { toPublicPhaseWikiNote } from '@/lib/wiki/phase-public';
import type { PublicPhaseWikiNote } from '@/types/phase-wiki';
import type { WikiEntityType, WikiNote } from '@/types/wiki';
import { supabase } from '../client';
import { getApprovedNotes } from './wiki-notes';

const NOTE_LIMIT = 500;
const LEGACY_SCAN_PAGES = 4;
const OWNER_ID_BATCH = 100;

type RetainedWikiNote = Pick<WikiNote,
  'id' | 'entity_type' | 'entity_name' | 'author_name' | 'content' | 'scope_type' | 'scope_id' | 'created_at' | 'updated_at'
> & { approved: true };

type ApprovedEntityNote = WikiNote | RetainedWikiNote | PublicPhaseWikiNote;

async function readNativeNotes(type: WikiEntityType, name: string) {
  const { data, error } = await supabase.from('phase_wiki_notes')
    .select('id, phase_id, entity_type, entity_name, content, approved, rejected_at, resubmission_blocked_at, created_at, updated_at, players!phase_wiki_notes_author_id_fkey(name)')
    .eq('entity_type', type).eq('entity_name', name)
    .eq('approved', true).is('rejected_at', null).is('resubmission_blocked_at', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(NOTE_LIMIT);
  if (error) throw error;
  return data.flatMap(({ players, ...row }) => {
    const note = toPublicPhaseWikiNote({ ...row, author_name: players?.name });
    return note ? [note] : [];
  });
}

async function readRetainedNotes(type: WikiEntityType, name: string, nativeNoteIds: Set<string>) {
  const retained: RetainedWikiNote[] = [];
  const nativePhaseIds = new Set<string>();
  const standaloneTournamentIds = new Set<string>();
  const checkedScopeIds = new Set<string>();
  for (let page = 0; page < LEGACY_SCAN_PAGES; page++) {
    const offset = page * NOTE_LIMIT;
    const { data, error } = await supabase.from('wiki_notes')
      .select('id, entity_name, scope_type, scope_id, content, created_at, updated_at, players!wiki_notes_author_id_fkey(name)')
      .eq('entity_type', type).eq('entity_name', name)
      .eq('approved', true).is('rejected_at', null).is('resubmission_blocked_at', null)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + NOTE_LIMIT - 1);
    if (error) throw error;
    const scopeIds = [...new Set(data.flatMap(row =>
      row.scope_type === 'tournament' && row.scope_id && !checkedScopeIds.has(row.scope_id) ? [row.scope_id] : [],
    ))];
    for (let from = 0; from < scopeIds.length; from += OWNER_ID_BATCH) {
      const ids = scopeIds.slice(from, from + OWNER_ID_BATCH);
      const [phases, tournaments] = await Promise.all([
        supabase.from('league_phases').select('id').in('id', ids),
        supabase.from('tournaments').select('id').in('id', ids).is('season_id', null),
      ]);
      if (phases.error) throw phases.error;
      if (tournaments.error) throw tournaments.error;
      phases.data.forEach(phase => nativePhaseIds.add(phase.id));
      tournaments.data.forEach(tournament => standaloneTournamentIds.add(tournament.id));
      ids.forEach(id => checkedScopeIds.add(id));
    }
    for (const row of data) {
      if (nativeNoteIds.has(row.id)) continue;
      if (row.scope_type === 'tournament' && row.scope_id
        && (nativePhaseIds.has(row.scope_id) || !standaloneTournamentIds.has(row.scope_id))) continue;
      if (row.scope_type !== 'global' && row.scope_type !== 'league' && row.scope_type !== 'tournament') continue;
      retained.push({
        id: row.id, entity_type: type, entity_name: row.entity_name, content: row.content,
        scope_type: row.scope_type, scope_id: row.scope_id, approved: true, author_name: row.players?.name,
        created_at: row.created_at, updated_at: row.updated_at,
      });
      if (retained.length === NOTE_LIMIT) return retained;
    }
    if (data.length < NOTE_LIMIT) return retained;
  }
  logger.warn('wiki/entity-notes', 'Entity note scan reached the retired-copy bound', { type, name });
  return retained;
}

function compareNewest(a: ApprovedEntityNote, b: ApprovedEntityNote) {
  return Date.parse(b.created_at) - Date.parse(a.created_at)
    || micros(b.created_at) - micros(a.created_at)
    || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
}

function micros(value: string) {
  return Number((/\.(\d+)/.exec(value)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
}

export async function getApprovedEntityNotes(
  type: WikiEntityType,
  name: string,
  selectedMode?: Awaited<ReturnType<typeof getPhaseRouteMode>>,
): Promise<{ notes: ApprovedEntityNote[]; cacheable: boolean }> {
  let cacheable = false;
  try {
    const mode = selectedMode ?? await getPhaseRouteMode();
    cacheable = mode === 'legacy' || mode === 'frozen_legacy';
    if (cacheable) return { notes: await getApprovedNotes(type, name), cacheable };

    const native = await readNativeNotes(type, name);
    const retained = await readRetainedNotes(type, name, new Set(native.map(note => note.id)));
    return { notes: [...native, ...retained].sort(compareNewest).slice(0, NOTE_LIMIT), cacheable };
  } catch (error) {
    logger.warn('wiki/entity-notes', 'Could not load approved entity notes', { type, name, error });
    return { notes: [], cacheable };
  }
}
