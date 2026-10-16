import { DEFAULT_BRACKET_LABELS, type BracketLabels } from './labels';

interface BracketSkeletonCardProps {
  label1: string;
  label2: string;
  matchNumber?: number;
  /** Words for the accessible name; English by default. */
  labels?: BracketLabels;
}

export default function BracketSkeletonCard({
  label1,
  label2,
  matchNumber,
  labels = DEFAULT_BRACKET_LABELS,
}: BracketSkeletonCardProps) {
  return (
    <div
      className="rounded-poke-lg border border-dashed border-poke-border bg-poke-elevated/50 p-2 text-sm"
      aria-label={matchNumber ? `${labels.match} ${matchNumber} ${labels.tbd}` : labels.tbdMatch}
    >
      {matchNumber !== undefined && (
        <p className="text-[10px] text-poke-text-muted mb-1">M{matchNumber}</p>
      )}
      <p className="text-poke-text-muted truncate">{label1}</p>
      <p className="text-poke-text-muted truncate">{label2}</p>
    </div>
  );
}
