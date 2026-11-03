import { UserFacingError } from '@/lib/api/user-facing-error';

/**
 * What `POST /api/csp-report` keeps of a Content-Security-Policy violation report (issue #37): one short JSON line per
 * report in the server log, nothing stored. Both wire formats are read: the legacy `application/csp-report` body
 * (`{ "csp-report": { ... } }`) and the Reporting API's `application/reports+json` (an array of `{ type, body }`).
 *
 * A report is client-controlled text, so only a fixed set of fields survives, each shortened. URLs lose their query and
 * hash (they can carry tokens), segments that look like a token or id are masked (share links put one in the path),
 * and `data:` / `blob:` sources keep only the scheme. The violation `sample`, the user agent and the original policy
 * are dropped.
 */

/** Largest request body the endpoint reads. A real report is well under 2 KB. */
export const CSP_REPORT_MAX_BYTES = 8192;
/** Longest log line, in characters. */
export const CSP_REPORT_LOG_MAX_CHARS = 600;
/** Most reports one request may log (the Reporting API batches). */
const MAX_REPORTS_PER_REQUEST = 5;
const ACCEPTED_CONTENT_TYPE = /^application\/(?:csp-report|reports\+json|json)\s*(?:;|$)/i;
const MAX_VALUE_CHARS = 120;

const BLOCKED_KEYWORDS = new Set(['inline', 'eval', 'data', 'blob', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'self']);
const OPAQUE_SCHEME = /^(?:data|blob|filesystem|about|javascript):/i;
const TOKEN_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{20,})$/i;

/**
 * Whether a path segment is, or decodes to, a token or id. A share link still resolves with some of its characters
 * percent-encoded, so the raw segment is not enough; a segment that is not valid percent-encoding is masked too.
 */
function isTokenSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return decoded.split('/').some((part) => TOKEN_SEGMENT.test(part));
}

function clip(value: string, max = MAX_VALUE_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** A URL from a report as `origin/path` with no query or hash and with token-like segments masked. */
export function redactReportUrl(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  if (BLOCKED_KEYWORDS.has(value)) return value;
  const opaque = OPAQUE_SCHEME.exec(value);
  if (opaque) return opaque[0].toLowerCase();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '[unparsable]';
  }
  if (!/^(?:https?|wss?):$/.test(url.protocol)) return '[unparsable]';
  const path = url.pathname
    .split('/')
    .map((segment) => (isTokenSegment(segment) ? ':id' : segment))
    .join('/');
  return clip(`${url.origin}${path}`);
}

function text(value: unknown): string {
  return typeof value === 'string' ? clip(value, 60) : '';
}

function line(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 10_000_000 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarize(fields: {
  document: unknown;
  directive: unknown;
  blocked: unknown;
  source: unknown;
  line: unknown;
  disposition: unknown;
}): string {
  const summary = {
    document: redactReportUrl(fields.document),
    directive: text(fields.directive),
    blocked: redactReportUrl(fields.blocked),
    source: redactReportUrl(fields.source),
    line: line(fields.line),
    disposition: text(fields.disposition),
  };
  return clip(JSON.stringify(summary), CSP_REPORT_LOG_MAX_CHARS);
}

/**
 * The JSON of a report request. The content type must be one browsers send for a report; the body is read as a stream and
 * abandoned the moment it passes {@link CSP_REPORT_MAX_BYTES}, so a client cannot make the server buffer a large body
 * (a lying or missing `content-length` is no help to it). Distinct causes keep distinct statuses: 415 wrong type,
 * 413 too large, 400 not JSON.
 */
export async function readReportJson(request: Request): Promise<unknown> {
  if (!ACCEPTED_CONTENT_TYPE.test(request.headers.get('content-type') ?? '')) {
    throw new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 415 });
  }
  const tooLarge = () => {
    const issues = `body larger than ${CSP_REPORT_MAX_BYTES} bytes`;
    return new UserFacingError(`Validation failed: ${issues}`, { code: 'validation_failed', params: { issues }, status: 413 });
  };
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > CSP_REPORT_MAX_BYTES) throw tooLarge();

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CSP_REPORT_MAX_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as unknown;
  } catch {
    throw new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 400 });
  }
}

/** The log lines (JSON) for a parsed report body; empty when it is not a CSP report in either format. */
export function cspReportLogLines(payload: unknown): string[] {
  const lines: string[] = [];
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (lines.length >= MAX_REPORTS_PER_REQUEST) break;
      if (!isRecord(entry) || entry.type !== 'csp-violation' || !isRecord(entry.body)) continue;
      const body = entry.body;
      lines.push(
        summarize({
          document: body.documentURL ?? entry.url,
          directive: body.effectiveDirective,
          blocked: body.blockedURL,
          source: body.sourceFile,
          line: body.lineNumber,
          disposition: body.disposition,
        }),
      );
    }
    return lines;
  }
  if (isRecord(payload) && isRecord(payload['csp-report'])) {
    const report = payload['csp-report'];
    lines.push(
      summarize({
        document: report['document-uri'],
        directive: report['effective-directive'] ?? report['violated-directive'],
        blocked: report['blocked-uri'],
        source: report['source-file'],
        line: report['line-number'],
        disposition: report.disposition,
      }),
    );
  }
  return lines;
}
