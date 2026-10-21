import { deflateRawSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import { readXlsxBuffer } from '../xlsx';

interface FixtureEntry {
  name: string;
  data: Buffer | string;
  deflate?: boolean;
  /** Point this central-directory record at another entry's local header. */
  aliasOf?: string;
}

/** Build a minimal zip (no CRCs — the reader does not check them). */
function buildZip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  const offsets = new Map<string, { offset: number; method: number; size: number }>();
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    let ref = entry.aliasOf ? offsets.get(entry.aliasOf) : undefined;
    if (!ref) {
      const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
      const method = entry.deflate ? 8 : 0;
      const body = entry.deflate ? deflateRawSync(raw) : raw;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(method, 8);
      header.writeUInt32LE(body.length, 18);
      header.writeUInt32LE(raw.length, 22);
      header.writeUInt16LE(name.length, 26);
      ref = { offset, method, size: body.length };
      offsets.set(entry.name, ref);
      locals.push(header, name, body);
      offset += header.length + name.length + body.length;
    }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(ref.method, 10);
    cd.writeUInt32LE(ref.size, 20);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(ref.offset, 42);
    central.push(cd, name);
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

function workbookEntries(sheetCount = 1): FixtureEntry[] {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) => `<sheet name="S${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('');
  const rels = Array.from(
    { length: sheetCount },
    (_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  return [
    { name: 'xl/workbook.xml', data: `<workbook><sheets>${sheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships>${rels}</Relationships>` },
  ];
}

function sheetXml(rowsXml: string): string {
  return `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function workbookWithSheet(rowsXml: string): Buffer {
  return buildZip([
    ...workbookEntries(),
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rowsXml) },
  ]);
}

function timed<T>(fn: () => T): { result?: T; error?: unknown; ms: number } {
  const start = performance.now();
  try {
    const result = fn();
    return { result, ms: performance.now() - start };
  } catch (error) {
    return { error, ms: performance.now() - start };
  }
}

describe('readXlsxBuffer', () => {
  it('parses a normal small sheet', () => {
    const sheets = readXlsxBuffer(
      workbookWithSheet(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1"><v>42</v></c></row>' +
          '<row r="3"><c r="C3" t="b"><v>1</v></c></row>'
      )
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('S1');
    expect(sheets[0].rows[0]).toEqual(['Name', 42]);
    expect(sheets[0].rows[2][2]).toBe(true);
  });

  describe('sheet grid bounds (CF-04)', () => {
    it.each([
      ['a huge row index', '<row r="1"><c r="A4294967295"><v>1</v></c></row>'],
      ['a column past XFD', '<row r="1"><c r="ZZZZ1"><v>1</v></c></row>'],
      ['row 0', '<row r="1"><c r="A0"><v>1</v></c></row>'],
    ])('rejects %s quickly', (_case, rowsXml) => {
      const { error, ms } = timed(() => readXlsxBuffer(workbookWithSheet(rowsXml)));
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/out of range/);
      expect(ms).toBeLessThan(1000);
    });

    it('accepts the last cell of the Excel grid within the dense budget', () => {
      const sheets = readXlsxBuffer(workbookWithSheet('<row r="1"><c r="XFD1"><v>7</v></c></row>'));
      expect(sheets[0].rows[0][16_383]).toBe(7);
    });

    it('rejects a sheet whose dense area exceeds the cell budget', () => {
      // 400 rows x one cell at XFD = ~6.5M dense cells, over the 5M budget.
      const rowsXml = Array.from(
        { length: 400 },
        (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}"><v>1</v></c></row>`
      ).join('');
      const { error, ms } = timed(() => readXlsxBuffer(workbookWithSheet(rowsXml)));
      expect((error as Error).message).toMatch(/Sheet exceeds 5000000 cells/);
      expect(ms).toBeLessThan(1000);
    });
  });

  describe('archive decompression budget (CF-05)', () => {
    it('rejects aliased central-directory records past the aggregate budget', () => {
      const padded = Buffer.from(sheetXml('') + ' '.repeat(2 * 1024 * 1024), 'utf8');
      const zip = buildZip([
        ...workbookEntries(3),
        { name: 'xl/worksheets/sheet1.xml', data: padded, deflate: true },
        { name: 'xl/worksheets/sheet2.xml', data: '', aliasOf: 'xl/worksheets/sheet1.xml' },
        { name: 'xl/worksheets/sheet3.xml', data: '', aliasOf: 'xl/worksheets/sheet1.xml' },
      ]);
      expect(zip.length).toBeLessThan(64 * 1024);
      // Default budget easily fits 3 x 2 MB.
      expect(readXlsxBuffer(zip)).toHaveLength(3);
      expect(() => readXlsxBuffer(zip, { maxTotalBytes: 5 * 1024 * 1024 })).toThrow(
        /Archive exceeds 5242880 decompressed bytes/
      );
    });

    it('charges every sheet that points at the same part against the budget', () => {
      const sheetCount = 40;
      const sheets = Array.from(
        { length: sheetCount },
        (_, i) => `<sheet name="S${i + 1}" sheetId="${i + 1}" r:id="rId1"/>`
      ).join('');
      const padded = Buffer.from(sheetXml('') + ' '.repeat(1024 * 1024), 'utf8');
      const zip = buildZip([
        { name: 'xl/workbook.xml', data: `<workbook><sheets>${sheets}</sheets></workbook>` },
        {
          name: 'xl/_rels/workbook.xml.rels',
          data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        },
        { name: 'xl/worksheets/sheet1.xml', data: padded, deflate: true },
      ]);
      expect(zip.length).toBeLessThan(64 * 1024);
      // 40 reads of a ~1 MB part fit the default budget...
      expect(readXlsxBuffer(zip)).toHaveLength(sheetCount);
      // ...but not a 10 MB one, although the part is inflated only once.
      const { error, ms } = timed(() =>
        readXlsxBuffer(zip, { maxTotalBytes: 10 * 1024 * 1024 })
      );
      expect((error as Error).message).toMatch(/Archive exceeds 10485760 decompressed bytes/);
      expect(ms).toBeLessThan(1000);
    });

    it('rejects an archive declaring more entries than the cap', () => {
      const zip = workbookWithSheet('');
      zip.writeUInt16LE(10_001, zip.length - 22 + 10);
      expect(() => readXlsxBuffer(zip)).toThrow(/more than 10000 entries/);
    });

    it('rejects a central-directory record pointing past the archive', () => {
      const zip = workbookWithSheet('');
      const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
      zip.writeUInt32LE(zip.length + 100, cdOffset + 42);
      expect(() => readXlsxBuffer(zip)).toThrow(/out-of-range local header/);
    });

    it('never inflates an unreferenced entry', () => {
      // 60 MB inflates past the 50 MB per-entry cap, so touching it would throw.
      const zip = buildZip([
        ...workbookEntries(),
        { name: 'xl/worksheets/sheet1.xml', data: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>') },
        { name: 'xl/media/big.bin', data: Buffer.alloc(60 * 1024 * 1024), deflate: true },
      ]);
      const sheets = readXlsxBuffer(zip);
      expect(sheets[0].rows[0][0]).toBe(1);
    });
  });
});
