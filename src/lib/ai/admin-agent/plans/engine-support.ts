/**
 * What the tournament engine runs today, as far as the Plan can ask for it (plan 4.9 "Double round robin", spec
 * §18.13). The classic engine plays ONE round-robin circle: `getRoundRobinTotalRounds(n)` has no leg parameter and
 * `generate-round` refuses a round past the first circle. A Format Studio `legs: 2` is recorded but never run.
 *
 * `__tests__/engine-support.test.ts` checks this constant against the engine function it describes, so the day the
 * engine learns a second circle that test fails and this value (and the `engine_support` reader) flips with it.
 * A caller may override it through `PlanFacts.engine` (the flag-gated LG1b case: "engine PR scheduled").
 */
export interface PlanEngineSupport {
  /** The most circles of a round robin the engine plays. */
  roundRobinLegs: number;
}

export const PLAN_ENGINE_SUPPORT: Readonly<PlanEngineSupport> = Object.freeze({ roundRobinLegs: 1 });
