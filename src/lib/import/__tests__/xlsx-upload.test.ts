import { describe, expect, it } from 'vitest';
import errorsDraftLegacyEn from '@/i18n/messages/errors/draft-legacy/en';
import { assertXlsxMagicBytes, MAX_XLSX_BYTES, validateXlsxFile } from '../xlsx-upload';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function file(name: string, bytes: number, type = XLSX_MIME): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A File whose reported size is `size` without allocating it. */
function sizedFile(size: number): File {
  const f = file('big.xlsx', 1);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateXlsxFile', () => {
  it('accepts an .xlsx workbook', () => {
    expect(validateXlsxFile(file('list.xlsx', 10))).toBeNull();
    expect(validateXlsxFile(file('LIST.XLSX', 10, 'application/octet-stream'))).toBeNull();
    expect(validateXlsxFile(file('list.xlsx', 10, ''))).toBeNull();
  });

  it.each([
    ['no file', null, 'No file uploaded', 'xlsx_file_missing'],
    ['a wrong extension', file('list.csv', 10), 'File must be an .xlsx workbook', 'xlsx_extension_invalid'],
    ['a wrong MIME type', file('list.xlsx', 10, 'text/plain'), 'Invalid file type — expected .xlsx', 'xlsx_type_invalid'],
    ['an empty file', file('list.xlsx', 0), 'Uploaded file is empty', 'xlsx_file_empty'],
  ])('rejects %s with its English text and code', (_case, input, error, code) => {
    expect(validateXlsxFile(input)).toEqual({ error, code });
  });

  it('rejects an oversized file with the limit as a param', () => {
    expect(validateXlsxFile(sizedFile(MAX_XLSX_BYTES + 1))).toEqual({
      error: 'File exceeds 8 MB limit',
      code: 'xlsx_file_too_large',
      params: { limit: 8 },
    });
  });
});

describe('assertXlsxMagicBytes', () => {
  it('accepts a ZIP container', () => {
    expect(assertXlsxMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBeNull();
  });

  it('rejects anything else with a code', () => {
    expect(assertXlsxMagicBytes(Buffer.from('nope'))).toEqual({
      error: 'File is not a valid .xlsx workbook (missing ZIP header)',
      code: 'xlsx_zip_header_missing',
    });
    expect(assertXlsxMagicBytes(Buffer.alloc(2))?.code).toBe('xlsx_zip_header_missing');
  });
});

describe('xlsx upload codes and the errors/draft-legacy catalog', () => {
  it('every code carries the catalog English text (placeholders filled)', () => {
    const results = [
      validateXlsxFile(null),
      validateXlsxFile(file('list.csv', 10)),
      validateXlsxFile(file('list.xlsx', 10, 'text/plain')),
      validateXlsxFile(file('list.xlsx', 0)),
      validateXlsxFile(sizedFile(MAX_XLSX_BYTES + 1)),
      assertXlsxMagicBytes(Buffer.from('nope')),
    ];
    for (const result of results) {
      expect(result).not.toBeNull();
      if (!result) continue;
      const params: Record<string, string | number> = 'params' in result ? result.params : {};
      const english = errorsDraftLegacyEn[result.code].replace(/\{(\w+)\}/g, (_m, name: string) =>
        String(params[name])
      );
      expect(result.error).toBe(english);
    }
  });
});
