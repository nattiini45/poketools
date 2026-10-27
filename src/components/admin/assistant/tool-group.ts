/**
 * Which noun a tool's status line names ("Done: leagues"). The transcript shows one compact line per tool call, never the
 * tool's name or its input; the group is read from the name's prefix, and an unknown tool falls back to a plain lookup.
 */
export type ToolGroup = 'league' | 'tournament' | 'ruleset' | 'format' | 'draft' | 'plan' | 'propose' | 'player' | 'dex' | 'clarify' | 'lookup';

const PREFIXES: ReadonlyArray<readonly [prefix: string, group: ToolGroup]> = [
  ['propose_', 'propose'],
  ['plan_', 'plan'],
  ['request_clarification', 'clarify'],
  ['ruleset_', 'ruleset'],
  ['format_', 'format'],
  ['attachable_formats', 'format'],
  ['league_', 'league'],
  ['phase_', 'league'],
  ['round_', 'league'],
  ['tournament_', 'tournament'],
  ['draft_', 'draft'],
  ['pointbuy_', 'draft'],
  ['pool_', 'draft'],
  ['player_', 'player'],
  ['dex_', 'dex'],
];

export function toolGroup(name: string): ToolGroup {
  for (const [prefix, group] of PREFIXES) if (name.startsWith(prefix)) return group;
  return 'lookup';
}
