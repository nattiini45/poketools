import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import wikiErrors from '@/i18n/messages/errors/stats/en';
import type { WikiNoteReportStatus } from '@/types/wiki';
import { supabase } from '../client';
import { listLegacyWikiReportsForMerge, listNoteReports, listNotesForModeration } from './wiki-notes';
import { listNativeWikiReportsForMerge, phaseWikiStorage } from './phase-wiki-notes';

const QUEUE_CHUNK = 200;
const QUEUE_SCAN_LIMIT = 2_000;
const OWNER_BATCH = 100;
type Page = { limit: number; offset: number };
type Ordered = { id: string; created_at: string };
type LegacyScope = { scope_type?: string; scope_id?: string | null };

function micros(value: string) {
  return Number((/\.(\d+)/.exec(value)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
}

function newestFirst(a: Ordered, b: Ordered) {
  return Date.parse(b.created_at) - Date.parse(a.created_at)
    || micros(b.created_at) - micros(a.created_at)
    || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
}

function retainLegacyScopes() {
  const standalone = new Map<string, boolean>();
  return async <T extends LegacyScope>(rows: T[]) => {
    const unchecked = [...new Set(rows.flatMap(row => row.scope_type === 'tournament'
      && row.scope_id && !standalone.has(row.scope_id) ? [row.scope_id] : []))];
    for (let start = 0; start < unchecked.length; start += OWNER_BATCH) {
      const ids = unchecked.slice(start, start + OWNER_BATCH);
      const [phases, tournaments] = await Promise.all([
        supabase.from('league_phases').select('id').in('id', ids),
        supabase.from('tournaments').select('id').in('id', ids).is('season_id', null),
      ]);
      if (phases.error) throw phases.error;
      if (tournaments.error) throw tournaments.error;
      const native = new Set(phases.data.map(row => row.id));
      const retained = new Set(tournaments.data.map(row => row.id));
      ids.forEach(id => standalone.set(id, retained.has(id) && !native.has(id)));
    }
    return rows.filter(row => row.scope_type === 'global' || row.scope_type === 'league'
      || (row.scope_type === 'tournament' && row.scope_id && standalone.get(row.scope_id)));
  };
}

async function* queueRows<T>(
  chunk: number,
  fetchPage: (page: Page) => Promise<T[]>,
  retain?: (rows: T[]) => Promise<T[]>,
) {
  for (let offset = 0; offset < QUEUE_SCAN_LIMIT; offset += chunk) {
    const limit = Math.min(chunk, QUEUE_SCAN_LIMIT - offset);
    const rows = await fetchPage({ offset, limit });
    yield* (retain ? await retain(rows) : rows);
    if (rows.length < limit) return;
  }
  throw new UserFacingError(wikiErrors.wiki_queue_scan_limit, { code: 'wiki_queue_scan_limit', status: 503 });
}

async function mergeQueue<L extends Ordered & LegacyScope, N extends Ordered>(
  page: Page, legacy: (page: Page) => Promise<L[]>, native: (page: Page) => Promise<N[]>,
) {
  const chunk = Math.min(Math.max(page.offset + page.limit, 50), QUEUE_CHUNK);
  const legacyRows = queueRows(chunk, legacy, retainLegacyScopes());
  const nativeRows = queueRows(chunk, native);
  let [old, phase] = await Promise.all([legacyRows.next(), nativeRows.next()]);
  const result: (L | N)[] = [];
  const seen = new Set<string>();
  for (let index = 0; !old.done || !phase.done; index++) {
    const takeNative = !phase.done && (old.done || newestFirst(phase.value, old.value) <= 0);
    const row = takeNative ? phase.value as N : old.value as L;
    if (seen.has(row.id)) {
      throw new UserFacingError(wikiErrors.wiki_queue_id_conflict, { code: 'wiki_queue_id_conflict', status: 409 });
    }
    seen.add(row.id);
    if (index >= page.offset) result.push(row);
    if (result.length === page.limit) return result;
    if (takeNative) phase = await nativeRows.next();
    else old = await legacyRows.next();
  }
  return result;
}

export async function readGlobalWikiNoteQueue(filters: Page & { status: 'pending' | 'approved' | 'rejected' | 'all' }) {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy' || mode === 'frozen_legacy') {
    return { notes: await listNotesForModeration(filters), mixed: false };
  }
  const notes = await mergeQueue(filters,
    page => listNotesForModeration({ ...filters, ...page }, true),
    page => phaseWikiStorage.listNotes(undefined, false, undefined, { ...filters, ...page }));
  return { notes, mixed: true };
}

export async function readGlobalWikiReportQueue(filters: Page & { status?: WikiNoteReportStatus }) {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy' || mode === 'frozen_legacy') {
    return { reports: await listNoteReports(filters), mixed: false };
  }
  const rows = await mergeQueue(filters,
    page => listLegacyWikiReportsForMerge({ ...filters, ...page }),
    page => listNativeWikiReportsForMerge({ ...filters, ...page }));
  const reports = rows.map(row => {
    if (!('scope_type' in row)) return row;
    const { scope_type: _scopeType, scope_id: _scopeId, ...report } = row;
    return report;
  });
  return { reports, mixed: true };
}
