import AuthGuard from '@/components/shared/AuthGuard';
import TeambuilderClient from '@/components/teambuilder/TeambuilderClient';

export default function TeambuilderPage() {
  return (
    <AuthGuard>
      <TeambuilderClient tournamentId={null} />
    </AuthGuard>
  );
}
