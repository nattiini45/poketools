/**
 * Class escalation (plan 3.5 rule 1): a tool's class is a CEILING that live state can only raise (B to G), never lower. The
 * proposal is stored with the class this returns, and the approve route requires the acknowledgements and the flag of that
 * class. In P1 no tool has a live-state raise yet, so staging passes an empty `raisedBy` and the stored class is the tool's
 * declared class; the hook is for the settings tools of a later phase.
 */
export type ProposalClass = 'B' | 'G';

export function escalateClass(declared: ProposalClass, raisedBy: readonly ProposalClass[]): ProposalClass {
  return declared === 'G' || raisedBy.includes('G') ? 'G' : 'B';
}
