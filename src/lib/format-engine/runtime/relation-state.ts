import { defineMachine } from '@/lib/state-machine/machine';

const RUNTIME_SQL = 'supabase/migrations/20261105090000_format_runtime.sql';

/**
 * `format_relation_links.revealed_at` of one relation: a monotone flag. Links are drawn hidden (set_relation, only while
 * the relation has none) and revealed once (reveal_relation, `WHERE revealed_at IS NULL`); nothing hides them again.
 * `src/lib/format-engine/runtime/__tests__/state-machines-sql.test.ts` holds the SQL guard equal to this definition.
 * Client-safe.
 */
export const relationRevealMachine = defineMachine({
  id: 'format_relation_reveal',
  title: 'Format relation reveal',
  storage: 'format_relation_links.revealed_at',
  summary:
    'Whether the links of a relation (a secret-santa draw) are visible to the players. A reveal on a relation without links changes no row, so a draw after the reveal event stays hidden; the planners only reveal links that exist.',
  doc: 'docs/format-kit.md',
  states: ['hidden', 'revealed'],
  initial: ['hidden'],
  terminal: ['revealed'],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'reveal',
      from: ['hidden'],
      to: 'revealed',
      actors: ['admin', 'system'],
      writers: [
        'src/lib/format-engine/runtime/adjust.ts',
        'src/lib/format-engine/runtime/effects.ts',
        `${RUNTIME_SQL}#format__apply_ops`,
      ],
      note: "A relation adjustment with reveal, or the event the relation's reveal_on matches.",
    },
  ],
});
