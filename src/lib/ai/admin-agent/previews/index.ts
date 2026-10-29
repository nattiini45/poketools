import 'server-only';
import type { RunnableTool } from '../registry/define';
import { LEAGUE_PREVIEWS } from './leagues';
import { planValidate } from './plan';
import { RULESET_PREVIEWS } from './rulesets';

/** Every P tool built so far (plan 3.6.3). The ones still waiting on a prerequisite are in `registry/deferred.ts`. */
export const ALL_PREVIEWS: readonly RunnableTool[] = [...RULESET_PREVIEWS, ...LEAGUE_PREVIEWS, planValidate];
