'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitFork } from 'lucide-react';
import Button from '@/components/ui/Button';

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
    <Button type="button" variant="primary" onClick={handleFork} disabled={forking} className="max-sm:h-11">
      <GitFork className="h-4 w-4" aria-hidden="true" />
      {forking ? busyLabel : label}
    </Button>
  );
}