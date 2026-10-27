import 'server-only';
import type { RunnableTool } from '../registry/define';
import { CONTEXT_READERS } from './context';
import { DRAFT_READERS } from './drafts';
import { FORMAT_READERS } from './formats';
import { LEAGUE_READERS } from './leagues';
import { MISC_READERS } from './misc';
import { RULESET_READERS } from './rulesets';
import { TOURNAMENT_READERS } from './tournaments';

/** Every R tool (plan 3.6.1 and 3.6.2), in no particular order: the registry sorts by name. */
export const ALL_READERS: readonly RunnableTool[] = [
  ...CONTEXT_READERS,
  ...LEAGUE_READERS,
  ...TOURNAMENT_READERS,
  ...RULESET_READERS,
  ...FORMAT_READERS,
  ...DRAFT_READERS,
  ...MISC_READERS,
];
