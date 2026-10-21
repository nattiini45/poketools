interface PhaseGateProps {
  /** Whether the section is currently active/relevant */
  active: boolean;
  /** Explanation shown when the section is not yet active */
  pendingMessage: string;
  /** The actual section content (rendered when active) */
  children: React.ReactNode;
}

/**
 * Phase-gating wrapper for admin sections that are only relevant
 * during certain league lifecycle phases.
 *
 * When inactive, shows a muted explanation instead of an empty box.
 * When active, renders the children normally.
 */
export default function PhaseGate({ active, pendingMessage, children }: PhaseGateProps) {
  if (active) {
    return <>{children}</>;
  }

  return (
    <div className="rounded-poke-lg border border-dashed border-poke-border bg-poke-surface/50 p-4 text-center">
      <p className="text-sm text-poke-text-muted">{pendingMessage}</p>
    </div>
  );
}
