/**
 * The one parser for format ids (`gen9ou`, `gen9vgc2025`, `gen91v1`, `gen96v6doublesdraft`, `gen9`). Pure and
 * client-safe: no imports.
 *
 * A format id is `gen`, ONE generation digit (1 to 9) and the tier key: lower-case letters and digits, possibly
 * empty (`gen9` is the point-buy base, which names a generation and no tier). The generation is exactly one digit,
 * so a key may start with a digit: `gen91v1` is generation 9 with key `1v1`, `gen96v6doublesdraft` generation 9
 * with key `6v6doublesdraft`. Greedy digit patterns (`/^gen(\d+)/`, `.replace(/\D/g, '')`) read those as
 * generation 91 and 96 and every dex lookup behind them fails; nothing in the app parses a format id any other way.
 *
 * The parser is strict about case. A caller holding user-typed or model-supplied text lower-cases it first; `blank`
 * and every other non-id answer `null`, and the caller picks its own default (almost always generation 9).
 */

/** A format id taken apart. */
export interface ParsedFormatId {
  /** 1 to 9. */
  gen: number;
  /** The tier key (`ou`, `doublesou`, `1v1`, `vgc2025`); empty for a bare `gen9`. */
  key: string;
}

const FORMAT_ID = /^gen([1-9])([a-z0-9]*)$/;

/** The generation and tier key of a format id, or `null` when `id` is not one (`blank`, `gen0ou`, `GEN9OU`). */
export function parseFormatId(id: unknown): ParsedFormatId | null {
  if (typeof id !== 'string') return null;
  const match = FORMAT_ID.exec(id);
  return match === null ? null : { gen: Number(match[1]), key: match[2] };
}

/** The generation (1 to 9) of a format id, or `null` when `id` is not one. */
export function generationOf(id: unknown): number | null {
  return parseFormatId(id)?.gen ?? null;
}

/** The generation of a format id, or `fallback` (generation 9 unless told otherwise) when `id` is not one. */
export function generationOrDefault(id: unknown, fallback = 9): number {
  return generationOf(id) ?? fallback;
}
