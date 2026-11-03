'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Forks a library entry into the signed-in player's teams; the only interactive part of the entry page. */
export default function ForkButton({
  teamId,
  label,
  busyLabel,
}: {
  teamId: string;
  label: string;
  busyLabel: string;
}) {
  const router = useRouter();
  const [forking, setForking] = useState(false);

  const handleFork = useCallback(async () => {
    setForking(true);
    try {
      const res = await fetch('/api/teams/library/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTeamId: teamId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fork');
      router.push('/teambuilder');
    } catch {
      // silent — user might not be logged in
    } finally {
      setForking(false);
    }
  }, [teamId, router]);

  return (
    <button
      type="button"
      onClick={handleFork}
      disabled={forking}
      className="px-4 py-2 text-sm font-medium bg-poke-blue text-poke-on-blue rounded-poke-md hover:bg-poke-blue/80 transition-colors disabled:opacity-50"
    >
      {forking ? busyLabel : label}
    </button>
  );
}