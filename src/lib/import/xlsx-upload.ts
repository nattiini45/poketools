import 'server-only';

export const MAX_XLSX_BYTES = 8 * 1024 * 1024;

/** PK\x03\x04 — local file header signature for zip/.xlsx containers. */
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Browsers often omit a specific MIME and send octet-stream for .xlsx.
  // Magic-byte check in assertXlsxMagicBytes closes that gap.
  'application/octet-stream',
]);

/**
 * A rejected upload: the English `error` the route returns, plus the
 * `errors/draft-legacy` `code` (and `params`) clients translate it with.
 * Spread it into the response body: `{ success: false, ...uploadErr }`.
 */
export type XlsxUploadError =
  | { error: string; code: 'xlsx_file_missing' }
  | { error: string; code: 'xlsx_extension_invalid' }
  | { error: string; code: 'xlsx_type_invalid' }
  | { error: string; code: 'xlsx_file_empty' }
  | { error: string; code: 'xlsx_file_too_large'; params: { limit: number } }
  | { error: string; code: 'xlsx_zip_header_missing' };

/** Validate an uploaded .xlsx file from multipart form data. */
export function validateXlsxFile(file: File | null): XlsxUploadError | null {
  if (!file) return { error: 'No file uploaded', code: 'xlsx_file_missing' };

  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx')) {
    return { error: 'File must be an .xlsx workbook', code: 'xlsx_extension_invalid' };
  }

  if (file.type && !XLSX_MIME_TYPES.has(file.type)) {
    return { error: 'Invalid file type — expected .xlsx', code: 'xlsx_type_invalid' };
  }

  if (file.size <= 0) return { error: 'Uploaded file is empty', code: 'xlsx_file_empty' };
  if (file.size > MAX_XLSX_BYTES) {
    const limit = MAX_XLSX_BYTES / (1024 * 1024);
    return { error: `File exceeds ${limit} MB limit`, code: 'xlsx_file_too_large', params: { limit } };
  }

  return null;
}

/** Reject buffers that are not zip containers (xlsx is OOXML zip). */
export function assertXlsxMagicBytes(buf: Buffer): XlsxUploadError | null {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_LOCAL_HEADER)) {
    return { error: 'File is not a valid .xlsx workbook (missing ZIP header)', code: 'xlsx_zip_header_missing' };
  }
  return null;
}

export async function fileToBuffer(file: File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
