/**
 * Domains (the lists players pick from): the entries of each domain after the admin's amendments, and whether it is
 * unlocked. A domain is unlocked by the flag `domain:<key>` (`"unlocked"` / `"locked"`), else by its `initially`.
 * Pure and client-safe.
 */
import type { Json } from '@/types/database';
import type { DomainDef, DomainEntry, FormatDefinition } from '@/lib/format-kit/types';
import { own, type DomainAmendment } from './types';

export interface DomainView {
  key: string;
  visibility: DomainDef['visibility'];
  unlocked: boolean;
  entries: DomainEntry[];
  listedSpeciesOnly?: boolean;
}

/** Canonical dex ids admitted by an entry, including any explicitly listed alternate formes. */
export function entrySpecies(entry: DomainEntry): readonly string[] {
  return [entry.id, ...(entry.aliases ?? [])];
}

/** Compare the typed value in both the picker and submission validator. An absent attribute does not conflict. */
export function distinctAttrKey(entry: Pick<DomainEntry, 'attrs'>, attr: string): string | undefined {
  return JSON.stringify(entry.attrs.find(({ key }) => key === attr)?.value);
}

export function selectedDistinctAttrKeys(
  entries: readonly Pick<DomainEntry, 'id' | 'attrs'>[],
  attr: string | null,
  selected: readonly string[],
): string[] {
  if (attr === null || selected.length === 0) return [];
  const ids = new Set(selected);
  return entries.flatMap((entry) => {
    const key = ids.has(entry.id) ? distinctAttrKey(entry, attr) : undefined;
    return key === undefined ? [] : [key];
  });
}

/** The flag key of a domain's lock state. */
export const domainFlagKey = (domain: string): string => `domain:${domain}`;

/**
 * The entries after the amendments, applied in order: `add` appends an entry (an entry with the same id is replaced in
 * place), `remove` drops the ids. Amendments of other domains are ignored.
 */
export function amendEntries(entries: readonly DomainEntry[], domain: string, amendments: readonly DomainAmendment[]): DomainEntry[] {
  let out = [...entries];
  for (const amendment of amendments) {
    if (amendment.domain !== domain) continue;
    for (const entry of amendment.add ?? []) {
      const at = out.findIndex((e) => e.id === entry.id);
      if (at >= 0) out[at] = entry;
      else out.push(entry);
    }
    if (amendment.remove !== undefined && amendment.remove.length > 0) {
      const gone = new Set(amendment.remove);
      out = out.filter((e) => !gone.has(e.id));
    }
  }
  return out;
}

export function isDomainUnlocked(def: Pick<DomainDef, 'key' | 'initially'>, flags: Readonly<Record<string, Json>>): boolean {
  const flag = own(flags, domainFlagKey(def.key));
  if (flag === 'unlocked') return true;
  if (flag === 'locked') return false;
  return def.initially === 'unlocked';
}

/** Every domain of the format with its current entries and lock state, in document order. */
export function domainView(
  def: Pick<FormatDefinition, 'domains'>,
  flags: Readonly<Record<string, Json>>,
  amendments: readonly DomainAmendment[],
): DomainView[] {
  return (def.domains ?? []).map((domain) => ({
    key: domain.key,
    visibility: domain.visibility,
    unlocked: isDomainUnlocked(domain, flags),
    entries: amendEntries(domain.entries, domain.key, amendments),
    ...(domain.listed_species_only && { listedSpeciesOnly: true }),
  }));
}

/** The entries a viewer may see: a `when_unlocked` domain shows them once unlocked, an `admins` domain only to admins. */
export function visibleEntries(view: DomainView, admin: boolean): DomainEntry[] {
  if (admin || view.visibility === 'public') return view.entries;
  return view.visibility === 'when_unlocked' && view.unlocked ? view.entries : [];
}

/** One domain's view, or null for an unknown key (the first declaration of a key wins). */
export function findDomainView(
  def: Pick<FormatDefinition, 'domains'>,
  key: string,
  flags: Readonly<Record<string, Json>>,
  amendments: readonly DomainAmendment[],
): DomainView | null {
  return domainView(def, flags, amendments).find((view) => view.key === key) ?? null;
}
