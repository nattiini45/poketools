export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

export function parseCsv(text: string): CsvParseResult {
  const records: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current.trim());
      current = '';
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((value) => value.length > 0)) records.push(row);

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map(normalizeHeader);
  const rows = records.slice(1).map((values) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = values[index] ?? '';
    }
    return record;
  });

  return { headers, rows };
}

// Cells a spreadsheet would read as a formula (OWASP CSV injection prefix set,
// also after leading whitespace). Quoting is only CSV framing and does not
// stop `"=HYPERLINK(...)"` from evaluating, so such cells get a `'` prefix.
const FORMULA_PREFIX = /^\s*[=+\-@\t\r]/;

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Numbers and booleans are not attacker text; keep e.g. -5 numeric.
  if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'bigint' && FORMULA_PREFIX.test(stringValue)) {
    stringValue = `'${stringValue}`;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function recordsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';

  const headers = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row)) set.add(key);
      return set;
    }, new Set<string>())
  );

  return [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n');
}