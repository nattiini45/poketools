/**
 * The viewer's own lines in the redraft submission panel (draft-frontend
 * §6.1). Pure and client-safe.
 *
 * `realKills` is the self-earned KO count the server reports (`real_kills`):
 * the only number that transfers to the replacement line (SPEC:757-765).
 * A line is locked when the list flags it as the participation line (stored
 * `cosmog` flag) or no-redraft, or when the server says it is not droppable.
 */
import type { LineId, RedraftSubmissionDTO } from '@/types/draft-queue';

/** The catalog fields this module reads (DF1's `DraftLineCatalog` satisfies it). */
export interface CatalogFlagsLike {
  readonly lines: readonly { readonly lineId: LineId; readonly flags: { readonly cosmog: boolean; readonly noRedraft: boolean } }[];
}

export type OwnLineLock = null | 'cosmog' | 'no_redraft';

export interface OwnLineVM {
  lineId: LineId;
  price: number;
  realKills: number;
  locked: OwnLineLock;
}

export function toOwnLineVMs(submission: RedraftSubmissionDTO, catalog: CatalogFlagsLike): OwnLineVM[] {
  const flags = new Map(catalog.lines.map((l) => [l.lineId, l.flags]));
  return submission.own_lines.map((own) => {
    const f = flags.get(own.line_id);
    const locked: OwnLineLock = f?.cosmog ? 'cosmog' : f?.noRedraft || !own.droppable ? 'no_redraft' : null;
    return { lineId: own.line_id, price: own.price, realKills: Math.max(0, own.real_kills), locked };
  });
}

/** Σ price of the chosen lines that are still on the list of own lines. */
export function refundOf(lines: readonly OwnLineVM[], chosen: ReadonlySet<LineId>): number {
  let sum = 0;
  for (const l of lines) if (chosen.has(l.lineId)) sum += l.price;
  return sum;
}

/** Same members, order ignored. */
export function sameLineSet(a: readonly LineId[], b: ReadonlySet<LineId>): boolean {
  if (a.length !== b.size) return false;
  return a.every((id) => b.has(id));
}
