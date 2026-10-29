/**
 * Class escalation (plan 3.5 rule 1): a tool's class is a CEILING that live state can only raise (B to G), never lower. The
 * proposal is stored with the class this returns, and the approve route requires the acknowledgements and the flag of that
 * class.
 */
export type ProposalClass = 'B' | 'G';

export function escalateClass(declared: ProposalClass, raisedBy: readonly ProposalClass[]): ProposalClass {
  return declared === 'G' || raisedBy.includes('G') ? 'G' : 'B';
}
