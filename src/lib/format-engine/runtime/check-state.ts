import { defineMachine } from '@/lib/state-machine/machine';

const RUNTIME_SQL = 'supabase/migrations/20261105090000_format_runtime.sql';

/**
 * `format_checks.status`: a rule the engine cannot decide alone, waiting for an admin's verdict. The verdict is recorded
 * only and has no effect on the engine. Written by `format_check_open` (insert, deduplicated by key) and
 * `format_check_resolve` (`WHERE status = 'open'`); `src/lib/format-engine/runtime/__tests__/state-machines-sql.test.ts`
 * holds that guard equal to this definition. Client-safe.
 */
export const formatCheckMachine = defineMachine({
  id: 'format_check',
  title: 'Format check',
  storage: 'format_checks.status',
  summary:
    "A check the format opens for an admin (standings tie, missed deadline, team audit, pairing rule, unresolved outcome). An admin confirms or rejects it once; a match reset or reopen rejects the match's own open checks. A resolved check never reopens, and its dedupe key stays taken.",
  doc: 'docs/format-kit.md',
  states: ['open', 'confirmed', 'rejected'],
  initial: ['open'],
  terminal: ['confirmed', 'rejected'],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'confirm',
      from: ['open'],
      to: 'confirmed',
      actors: ['admin'],
      writers: ['src/lib/format-engine/runtime/checks-server.ts', `${RUNTIME_SQL}#format_check_resolve`],
    },
    {
      event: 'reject',
      from: ['open'],
      to: 'rejected',
      actors: ['admin', 'system'],
      writers: [
        'src/lib/format-engine/runtime/checks-server.ts',
        'src/lib/format-engine/runtime/hooks.ts',
        `${RUNTIME_SQL}#format_check_resolve`,
      ],
      note: "An admin's verdict, or the system closing a match's checks when the match is reset or reopened (note match_reset).",
    },
  ],
});

export type FormatCheckState = (typeof formatCheckMachine.spec.states)[number];
