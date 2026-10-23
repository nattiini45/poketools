#!/usr/bin/env node
/**
 * The stable local dev URL + report-first orphan sweep for the capture
 * harness — the single source for the ONE address sessions and
 * instruments use.
 *
 * Three incidents of one class (maintainer run log):
 * a previous session's dev server holds the pinned port, the new session
 * silently lands elsewhere, and captures photograph the wrong tree. This
 * tool closes the class:
 *
 *   node scripts/board-dev-url.mjs
 *       Print the stable dev URL (the board's pinned :3111 today).
 *       Instruments import the constant from this module — the port
 *       literal lives here and nowhere else.
 *
 *   node scripts/board-dev-url.mjs --sweep
 *       REPORT-FIRST orphan sweep: list every listening dev-server-class
 *       process with port + pid + start time + full command line. With no
 *       flag beyond --sweep it changes nothing.
 *
 *   node scripts/board-dev-url.mjs --kill <port|pid> [--i-own-the-pinned-port]
 *       Kill ONE named target behind an explicit flag: the tool resolves
 *       the listener, prints exactly what it is about to kill (pid, port,
 *       start time, command line) and only then acts. Combine with
 *       --sweep to emit the full report in the same run. The pinned port
 *       is HARD-BLOCKED twice: on the literal port argument
 *       before any probe, AND after target resolution — a pid whose
 *       resolved listener owns the pinned port refuses identically
 *       (exit 2, nothing probed, nothing killed) naming the
 *       `--i-own-the-pinned-port` override; with that override it names
 *       the target and acts — the orchestrator-directed-end path,
 *       nothing else.
 *
 * Ownership rule: the shared
 * :3111 server is live session infrastructure — seats never kill it; the
 * sweep makes ownership visible (ports, start times, command lines),
 * never assumes. Killing a server another live session owns is its own
 * incident. The refusal above is the enforcement, not a warning: a
 * printed caution that falls through to the kill is not
 * protection.
 *
 * Exit: 0 clean (or killed as asked), 1 kill target missing/still
 * listening, 2 usage error — including a pinned-port --kill without
 * --i-own-the-pinned-port, by port literal or by pid resolution.
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Contract constants (the exported single source)
// ---------------------------------------------------------------------------
/** The board's pinned dev port — never 3000 (the Next default). */
export const BOARD_DEV_PORT = 3111;
/**
 * localhost, not 127.0.0.1 — Next 16 dev blocks _next/* resources for
 * hosts outside allowedDevOrigins (default: localhost only), which would
 * 403 every client chunk.
 */
export const BOARD_DEV_HOST = 'localhost';
/** The ONE stable dev URL sessions and instruments use. */
export const BOARD_DEV_URL = `http://${BOARD_DEV_HOST}:${BOARD_DEV_PORT}`;

// A listening process counts as dev-server-class when its image is node,
// its command line matches a dev-server marker, or it holds the pinned
// board port regardless of what booted it (report over-classification is
// cheap — the sweep is read-only and kill is explicit and named).
const DEV_CMD_MARKERS =
  /\bnext\b|next-router-worker|\bserve\b|\bvite\b|turbopack|webpack|\bnpx\b|npm[^\s]*\s+run\s+dev/;

function usage() {
  console.log(`Usage: node scripts/board-dev-url.mjs [--sweep] [--kill <port|pid>] [--i-own-the-pinned-port]

(no flags)               Print the stable dev URL: ${BOARD_DEV_URL}
  --sweep                Report-first orphan sweep: list every listening
                         dev-server-class process (port + pid + start time
                         + command line). Report-only — changes nothing.
  --kill <port|pid>      Kill ONE named listener. The target is resolved
                         and printed (pid, port, start time, command line)
                         BEFORE the kill; port interpretation wins when a
                         number is both a port and a pid (and is labeled).
                         Ports and pids are scoped to the sweep's findings.
                         A target that resolves onto the pinned port — by
                         literal or by pid — refuses unless the override
                         is present.
  --i-own-the-pinned-port
                         Explicit override REQUIRED to --kill anything on
                         the pinned :${BOARD_DEV_PORT} port: the literal
                         :${BOARD_DEV_PORT} or ANY pid that resolves to a listener
                         owning it. Without it the kill REFUSES (exit 2,
                         nothing probed or killed) and names this flag.
                         Orchestrator-directed ends only.
  --help                 Show this help.

The shared pinned :${BOARD_DEV_PORT} dev server is live session infrastructure (PB-299):
the sweep makes ownership visible; only the orchestrator ends it, via
--kill ${BOARD_DEV_PORT} --i-own-the-pinned-port.`);
}

/** True when this module is the process entry (CLI mode), not an import. */
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

/**
 * Every TCP LISTENING endpoint from netstat -ano as { port, pid }.
 * Locale-agnostic: the state column is localized on Windows (LISTENING /
 * ABHÖREN / ...), so listeners are identified by the locale-independent
 * wildcard foreign address <addr>:0 (the capture-route.mjs idiom).
 */
async function listeningEndpoints() {
  const { stdout } = await execFileAsync('netstat', ['-ano']);
  const seen = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TCP')) continue;
    const cols = trimmed.split(/\s+/); // Proto Local Foreign State PID
    const local = cols[1] ?? '';
    const foreign = cols[2] ?? '';
    const pid = Number(cols[4]);
    const portMatch = /:(\d+)$/.exec(local);
    if (!portMatch || !foreign.endsWith(':0') || !Number.isInteger(pid) || pid <= 0) continue;
    const key = `${pid}:${portMatch[1]}`;
    if (!seen.has(key)) seen.set(key, { port: Number(portMatch[1]), pid });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/**
 * Resolve { pid, name, started, cmd } for the given PIDs via PowerShell
 * (Get-CimInstance; wmic is gone on current Windows). started is ISO with
 * local offset. PIDs that vanish mid-query simply contribute no row.
 */
async function processDetails(pids) {
  const rows = [];
  for (let i = 0; i < pids.length; i += 40) {
    const chunk = pids.slice(i, i + 40);
    const filter = chunk.map((p) => `ProcessId=${p}`).join(' OR ');
    const script =
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
      `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { ` +
      '[pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; ' +
      'started = $(if ($_.CreationDate) { $_.CreationDate.ToString("yyyy-MM-dd\'T\'HH:mm:sszzz") } else { "" }); ' +
      'cmd = $_.CommandLine } } | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    if (!stdout.trim()) continue;
    const parsed = JSON.parse(stdout);
    rows.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  return rows;
}

/** One sweep table row. Matches are tagged so ownership stays judgeable. */
function classify(row, port) {
  const tags = [];
  if (port === BOARD_DEV_PORT) tags.push('pinned');
  if (String(row.name ?? '').toLowerCase() === 'node.exe') tags.push('node');
  if (typeof row.cmd === 'string' && DEV_CMD_MARKERS.test(row.cmd)) tags.push('cmd');
  return tags.join('+');
}

function printSweep(rows) {
  console.log(`board-dev-url: stable dev URL: ${BOARD_DEV_URL}`);
  console.log(
    'board-dev-url: sweep — listening dev-server-class processes (report-only; nothing is killed without --kill <port|pid>)',
  );
  console.log('port    pid     started (local)            command');
  for (const row of rows) {
    const tag = row.tags ? ` [${row.tags}]` : '';
    console.log(
      `:${String(row.port).padEnd(6)} ${String(row.pid).padEnd(7)} ${String(row.started ?? '').padEnd(26)} ${row.cmd ?? '(command line unavailable)'}${tag}`,
    );
  }
  if (rows.length === 0) {
    console.log('board-dev-url: no listening dev-server-class processes found');
  } else {
    console.log(
      `board-dev-url: ${rows.length} listener(s) found — pinned :${BOARD_DEV_PORT} = ${BOARD_DEV_URL}`,
    );
  }
}

/** Full report-only sweep. */
async function cmdSweep() {
  const endpoints = await listeningEndpoints();
  if (endpoints.length === 0) {
    printSweep([]);
    return;
  }
  const details = await processDetails([...new Set(endpoints.map((e) => e.pid))]);
  const byPid = new Map(details.map((d) => [Number(d.pid), d]));
  const rows = [];
  for (const { port, pid } of endpoints) {
    const detail = byPid.get(pid);
    const cmd = typeof detail?.cmd === 'string' ? detail.cmd : '';
    const tags = classify(detail ?? {}, port);
    // The sweep's subject is the dev-server class; everything else would
    // be noise in every browser/IDE session. The pinned port is ALWAYS
    // reported so the board's address ownership is never invisible.
    if (!tags) continue;
    rows.push({ port, pid, started: detail?.started ?? '', cmd, tags });
  }
  printSweep(rows);
}

/**
 * Resolve a --kill target (port wins over pid when both interpretations
 * exist; the interpretation used is stated, never implied). Returns the
 * matched sweep rows.
 */
function resolveKillTarget(targetRaw, rows) {
  const target = Number(String(targetRaw).replace(/^:/, ''));
  if (!Number.isInteger(target) || target <= 0) return { note: 'invalid', matches: [] };
  const byPort = rows.filter((r) => r.port === target);
  if (byPort.length > 0) return { note: `port :${target}`, matches: byPort };
  const byPid = rows.filter((r) => r.pid === target);
  if (byPid.length > 0) return { note: `pid ${target}`, matches: byPid };
  return { note: `no listening process matched port or pid ${target}`, matches: [] };
}

async function killTree(pid) {
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']);
    return true;
  } catch (err) {
    console.error(`board-dev-url: taskkill /PID ${pid} failed: ${err.message?.split('\n')[0] ?? err}`);
    return false;
  }
}

/** Named-target kill. Returns true when every target is gone afterwards. */
async function cmdKill(targetRaw, pinnedOverride) {
  const endpoints = await listeningEndpoints();
  const details = endpoints.length > 0 ? await processDetails([...new Set(endpoints.map((e) => e.pid))]) : [];
  const byPid = new Map(details.map((d) => [Number(d.pid), d]));
  const rows = endpoints.map(({ port, pid }) => {
    const detail = byPid.get(pid);
    return { port, pid, started: detail?.started ?? '', cmd: detail?.cmd ?? '', tags: classify(detail ?? {}, port) };
  });
  const { note, matches } = resolveKillTarget(targetRaw, rows);
  if (matches.length === 0) {
    console.error(`board-dev-url: --kill ${targetRaw}: ${note} — nothing killed`);
    return false;
  }
  // The argument may be a PID whose resolved listener owns the
  // pinned port — the pre-probe literal guard in main() never sees it.
  // The pid→listener mapping is the same netstat data the sweep uses, so
  // the guard runs again HERE, on the resolved target: refuse when ANY
  // resolved listener owns the pinned port unless the override is present.
  const pinnedHits = matches.filter((m) => m.port === BOARD_DEV_PORT);
  if (pinnedHits.length > 0 && !pinnedOverride) {
    console.error(
      `board-dev-url: REFUSED: --kill ${targetRaw} resolves to pid(s) ${pinnedHits.map((m) => m.pid).join(', ')} listening on the pinned shared board dev port :${BOARD_DEV_PORT} (${BOARD_DEV_URL}) — live session infrastructure (PB-299); seats never end it. If you are the orchestrator ending it deliberately, re-run with --i-own-the-pinned-port.`,
    );
    process.exit(2);
  }
  console.log(`board-dev-url: kill target resolved as ${note} — ${matches.length} process(es):`);
  for (const match of matches) {
    console.log(
      `board-dev-url:   target pid ${match.pid} port :${match.port} started ${match.started || '(unknown)'} cmd ${match.cmd || '(unavailable)'}`,
    );
    if (match.port === BOARD_DEV_PORT) {
      // Reachable only with --i-own-the-pinned-port: the refusal above
      // exits first when the override is absent.
      console.log(
        `board-dev-url:   OVERRIDE ACTIVE (--i-own-the-pinned-port): :${match.port} is the pinned shared board dev port — orchestrator-directed kill proceeding (PB-299)`,
      );
    }
  }
  let allGone = true;
  for (const match of matches) {
    const killed = await killTree(match.pid);
    if (!killed) allGone = false;
  }
  // Post-kill verification against a fresh netstat, never an assumption.
  const after = await listeningEndpoints();
  for (const match of matches) {
    const still = after.some((e) => e.port === match.port && e.pid === match.pid);
    if (still) {
      console.error(`board-dev-url: POST-KILL pid ${match.pid} still listening on :${match.port}`);
      allGone = false;
    } else {
      console.log(`board-dev-url: confirmed gone: pid ${match.pid} on :${match.port}`);
    }
  }
  return allGone;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  const killIdx = argv.indexOf('--kill');
  // Any token that is not a known flag and not the --kill value is junk.
  const unexpected = argv.filter(
    (a, i) => a !== '--sweep' && a !== '--kill' && a !== '--i-own-the-pinned-port' && i !== killIdx + 1,
  );
  if (unexpected.length > 0) {
    console.error(`board-dev-url: unexpected argument(s): ${unexpected.join(' ')} (see --help)`);
    process.exit(2);
  }
  const sweep = argv.includes('--sweep');
  const pinnedOverride = argv.includes('--i-own-the-pinned-port');
  let killTarget = null;
  if (killIdx !== -1) {
    killTarget = argv[killIdx + 1];
    if (!killTarget || killTarget.startsWith('--')) {
      console.error('board-dev-url: --kill requires an explicit target: a port or pid (e.g. --kill 3999)');
      process.exit(2);
    }
  }
  // Hard block: the pinned port refuses --kill outright unless the
  // explicit override is present. This fires on the ARGUMENT before any
  // probe — a refusal touches nothing on the system. (This is the
  // FIRST of two guards — cmdKill repeats it on the RESOLVED target, so a
  // pid that maps onto the pinned port refuses identically.)
  if (killTarget !== null && !pinnedOverride && Number(String(killTarget).replace(/^:/, '')) === BOARD_DEV_PORT) {
    console.error(
      `board-dev-url: REFUSED: --kill ${killTarget} targets the pinned shared board dev port :${BOARD_DEV_PORT} (${BOARD_DEV_URL}) — live session infrastructure (PB-299); seats never end it. If you are the orchestrator ending it deliberately, re-run with --i-own-the-pinned-port.`,
    );
    process.exit(2);
  }
  if (!sweep && killTarget === null) {
    console.log(BOARD_DEV_URL);
    return;
  }
  if (sweep) await cmdSweep();
  if (killTarget !== null) {
    const ok = await cmdKill(killTarget, pinnedOverride);
    process.exitCode = ok ? 0 : 1;
  }
}

if (isMainModule()) {
  await main();
}
