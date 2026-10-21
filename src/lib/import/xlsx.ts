/**
 * Zero-dependency XLSX reader (Office Open XML).
 * Supports shared strings, inline strings, numbers, and boolean cells.
 * Does not evaluate formulas — returns cached values when present.
 *
 * Shared by admin API routes and CLI import scripts (no Next-only deps).
 */
import { readFileSync } from 'fs';
import { inflateRawSync } from 'zlib';

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxSheet {
  name: string;
  /** 0-indexed rows; each row is a sparse array keyed by 0-indexed column. */
  rows: XlsxCellValue[][];
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Cap decompressed zip entry size to mitigate zip bombs. */
const MAX_DECOMPRESSED_ENTRY_BYTES = 50 * 1024 * 1024;
/**
 * Cap total decompressed bytes per archive. Entries are inflated lazily, only
 * when read, so many central-directory records aliasing one stream (or several
 * sheets pointing at one part) all draw from this single budget.
 * At least 2x MAX_XML_PART_BYTES so a near-cap sheet plus sharedStrings parses.
 */
const MAX_DECOMPRESSED_TOTAL_BYTES = 128 * 1024 * 1024;
/** Cap zip entries indexed per archive. */
const MAX_ZIP_ENTRIES = 10_000;
/** Cap XML parts before regex parsing (ReDoS / memory bound). */
const MAX_XML_PART_BYTES = 40 * 1024 * 1024;
/** Excel's grid: cell references outside it are rejected. */
const MAX_SHEET_ROWS = 1_048_576;
const MAX_SHEET_COLS = 16_384;
/**
 * Budget for rows.length plus the sum of row lengths per sheet — the dense
 * area that downstream `Array.from` and length-proportional loops walk.
 */
const MAX_SHEET_DENSE_CELLS = 5_000_000;

export interface ReadXlsxOptions {
  /** Override the per-archive decompressed-bytes budget (tests). */
  maxTotalBytes?: number;
}

interface ZipEntryRef {
  method: number;
  dataStart: number;
  compSize: number;
}

/** Thrown when an entry inflates past the limit it was decoded under. */
class DecodeLimitError extends Error {}

function inflateZipEntry(compressed: Buffer, name: string, limit: number): Buffer {
  try {
    return inflateRawSync(compressed, { maxOutputLength: limit });
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new DecodeLimitError(name);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to decompress zip entry ${name}: ${message}`);
  }
}

function decodeZipEntry(
  method: number,
  compressed: Buffer,
  name: string,
  limit: number
): Buffer {
  let content: Buffer;
  if (method === 0) {
    content = compressed;
  } else if (method === 8) {
    content = inflateZipEntry(compressed, name, limit);
  } else {
    throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
  }
  if (content.length > limit) {
    throw new DecodeLimitError(name);
  }
  return content;
}

function assertEntryInBounds(buf: Buffer, ref: ZipEntryRef, name: string): void {
  if (ref.dataStart + ref.compSize > buf.length) {
    throw new Error(`Invalid xlsx: zip entry ${name} extends past end of archive`);
  }
}

function addZipEntry(
  files: Map<string, ZipEntryRef>,
  name: string,
  ref: ZipEntryRef
): void {
  if (files.size >= MAX_ZIP_ENTRIES) {
    throw new Error(`Invalid xlsx: archive has more than ${MAX_ZIP_ENTRIES} entries`);
  }
  files.set(name, ref);
}

function xmlPartToString(buf: Buffer, partName: string): string {
  if (buf.length > MAX_XML_PART_BYTES) {
    throw new Error(
      `XML part ${partName} exceeds ${MAX_XML_PART_BYTES} bytes`
    );
  }
  return buf.toString('utf8');
}

function readLocalZipEntries(buf: Buffer): Map<string, ZipEntryRef> {
  const files = new Map<string, ZipEntryRef>();
  let i = 0;
  while (i < buf.length - 30) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const flags = buf.readUInt16LE(i + 6);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
      const dataStart = i + 30 + nameLen + extraLen;
      // Data descriptor (bit 3): sizes come after the compressed data
      if ((flags & 0x8) !== 0 && compSize === 0) {
        // Scan forward for data descriptor signature after we don't know size —
        // fall back to central directory for these entries.
        // Prefer central-directory path below; skip local for now.
        i = dataStart;
        continue;
      }
      const ref = { method, dataStart, compSize };
      assertEntryInBounds(buf, ref, name);
      addZipEntry(files, name, ref);
      i = dataStart + compSize;
      // Optional data descriptor
      if ((flags & 0x8) !== 0) {
        if (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x08074b50) i += 16;
        else i += 12;
      }
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
      break;
    } else {
      i += 1;
    }
  }
  return files;
}

/** Prefer central directory — handles data-descriptor local headers reliably. */
function readZipViaCentralDirectory(buf: Buffer): Map<string, ZipEntryRef> {
  const files = new Map<string, ZipEntryRef>();
  // Find end of central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0x10000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return readLocalZipEntries(buf);
  }
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdEntries = buf.readUInt16LE(eocd + 10);
  if (cdEntries > MAX_ZIP_ENTRIES) {
    throw new Error(`Invalid xlsx: archive has more than ${MAX_ZIP_ENTRIES} entries`);
  }
  let i = cdOffset;
  for (let n = 0; n < cdEntries; n++) {
    if (i + 46 > buf.length || buf.readUInt32LE(i) !== 0x02014b50) break;
    const method = buf.readUInt16LE(i + 10);
    const compSize = buf.readUInt32LE(i + 20);
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const localHeaderOffset = buf.readUInt32LE(i + 42);
    const name = buf.slice(i + 46, i + 46 + nameLen).toString('utf8');
    i += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > buf.length) {
      throw new Error(`Invalid xlsx: zip entry ${name} has an out-of-range local header`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const ref = { method, dataStart, compSize };
    assertEntryInBounds(buf, ref, name);
    addZipEntry(files, name, ref);
  }
  return files;
}

/**
 * Inflates indexed entries on first read under one per-archive budget, so
 * unreferenced parts (media, aliased duplicates) are never decompressed.
 */
function createZipReader(buf: Buffer, maxTotalBytes: number) {
  const index = readZipViaCentralDirectory(buf);
  const cache = new Map<string, Buffer>();
  let remaining = maxTotalBytes;
  const budgetError = () =>
    new Error(`Archive exceeds ${maxTotalBytes} decompressed bytes`);
  return {
    /**
     * Every read is charged against the budget, cache hits included: callers
     * parse what they get, so several workbook sheets pointing at one part
     * cost one budget share per read, not one per archive.
     */
    get(name: string): Buffer | undefined {
      const cached = cache.get(name);
      if (cached) {
        if (cached.length > remaining) throw budgetError();
        remaining -= cached.length;
        return cached;
      }
      const ref = index.get(name);
      if (!ref) return undefined;
      const budgetBound = remaining < MAX_DECOMPRESSED_ENTRY_BYTES;
      const limit = Math.min(MAX_DECOMPRESSED_ENTRY_BYTES, remaining);
      let content: Buffer;
      try {
        content = decodeZipEntry(
          ref.method,
          buf.subarray(ref.dataStart, ref.dataStart + ref.compSize),
          name,
          limit
        );
      } catch (err) {
        if (err instanceof DecodeLimitError) {
          throw new Error(
            budgetBound
              ? budgetError().message
              : `Decompressed entry ${name} exceeds ${MAX_DECOMPRESSED_ENTRY_BYTES} bytes`
          );
        }
        throw err;
      }
      remaining -= content.length;
      cache.set(name, content);
      return content;
    },
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function colLettersToIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  // <si>…</si> blocks; text may be split across <t> runs
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const parts: string[] = [];
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(m[1])) !== null) {
      parts.push(decodeXmlEntities(tm[1]));
    }
    strings.push(parts.join(''));
  }
  return strings;
}

function cellRefParts(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { col: 0, row: 0 };
  return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

function parseSheetXml(xml: string, sharedStrings: string[]): XlsxCellValue[][] {
  const rows: XlsxCellValue[][] = [];
  let dense = 0;
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[1];
    // Self-closing cells MUST be matched first — otherwise `<c r="A1" s="1"/>`
    // is treated as an open tag whose body swallows the next cell through `</c>`.
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1] ?? cm[2] ?? '';
      const body = cm[3] ?? '';
      const refM = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!refM) continue;
      const { col, row } = cellRefParts(refM[1]);
      if (row < 0 || row >= MAX_SHEET_ROWS || col < 0 || col >= MAX_SHEET_COLS) {
        throw new Error(`Cell reference ${refM[1]} out of range`);
      }
      const typeM = /\bt="([^"]+)"/.exec(attrs);
      const type = typeM?.[1] ?? null;
      const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
      const isM = /<is>([\s\S]*?)<\/is>/.exec(body);
      let value: XlsxCellValue = null;
      if (type === 's' && vM) {
        const idx = parseInt(vM[1], 10);
        value = sharedStrings[idx] ?? null;
      } else if (type === 'inlineStr' && isM) {
        const tM = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(isM[1]);
        value = tM ? decodeXmlEntities(tM[1]) : '';
      } else if (type === 'b' && vM) {
        value = vM[1] === '1';
      } else if (type === 'str' && vM) {
        value = decodeXmlEntities(vM[1]);
      } else if (vM) {
        const num = Number(vM[1]);
        value = Number.isFinite(num) ? num : decodeXmlEntities(vM[1]);
      }
      dense +=
        Math.max(0, row + 1 - rows.length) +
        Math.max(0, col + 1 - (rows[row]?.length ?? 0));
      if (dense > MAX_SHEET_DENSE_CELLS) {
        throw new Error(`Sheet exceeds ${MAX_SHEET_DENSE_CELLS} cells`);
      }
      if (!rows[row]) rows[row] = [];
      rows[row][col] = value;
    }
  }
  return rows;
}

function parseWorkbookSheets(
  workbookXml: string,
  relsXml: string
): Array<{ name: string; path: string }> {
  const idToTarget = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(relsXml)) !== null) {
    const attrs = rm[1];
    const idM = /\bId="([^"]+)"/.exec(attrs);
    const targetM = /\bTarget="([^"]+)"/.exec(attrs);
    if (idM && targetM) {
      const target = targetM[1].replace(/^\//, '');
      idToTarget.set(idM[1], target.startsWith('xl/') ? target : `xl/${target}`);
    }
  }

  const sheets: Array<{ name: string; path: string }> = [];
  const sheetRe = /<sheet\b([^>]*)\/>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(workbookXml)) !== null) {
    const attrs = sm[1];
    const nameM = /\bname="([^"]+)"/.exec(attrs);
    const ridM = /\br:id="([^"]+)"/.exec(attrs);
    if (!nameM || !ridM) continue;
    const path = idToTarget.get(ridM[1]);
    if (!path) continue;
    sheets.push({ name: decodeXmlEntities(nameM[1]), path });
  }
  return sheets;
}

/** Read an .xlsx workbook from a file path. */
export function readXlsx(filePath: string): XlsxSheet[] {
  const buf = readFileSync(filePath);
  return readXlsxBuffer(buf);
}

/** Read an .xlsx workbook from a buffer. */
export function readXlsxBuffer(
  buf: Buffer,
  options: ReadXlsxOptions = {}
): XlsxSheet[] {
  const files = createZipReader(
    buf,
    options.maxTotalBytes ?? MAX_DECOMPRESSED_TOTAL_BYTES
  );
  const workbook = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) {
    throw new Error('Invalid xlsx: missing workbook.xml or workbook relationships');
  }
  const sharedXml = files.get('xl/sharedStrings.xml');
  const sharedStrings = sharedXml
    ? parseSharedStrings(xmlPartToString(sharedXml, 'xl/sharedStrings.xml'))
    : [];
  const sheetMetas = parseWorkbookSheets(
    xmlPartToString(workbook, 'xl/workbook.xml'),
    xmlPartToString(rels, 'xl/_rels/workbook.xml.rels')
  );
  return sheetMetas.map((meta) => {
    const sheetBuf = files.get(meta.path);
    if (!sheetBuf) {
      throw new Error(`Missing sheet part: ${meta.path}`);
    }
    return {
      name: meta.name,
      rows: parseSheetXml(xmlPartToString(sheetBuf, meta.path), sharedStrings),
    };
  });
}

/** Find a sheet by exact name (case-sensitive). */
export function getSheet(sheets: XlsxSheet[], name: string): XlsxSheet | undefined {
  return sheets.find((s) => s.name === name);
}

/** Coerce a cell to a trimmed string (empty → ''). */
export function cellString(value: XlsxCellValue | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim();
}

/** Coerce a cell to a number, or null if empty/invalid. */
export function cellNumber(value: XlsxCellValue | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Unused helper kept for type export completeness in zip walkers. */
export type { ZipEntry };
