import Link from 'next/link';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import TestPlayersConsole from './TestPlayersConsole';

export const dynamic = 'force-dynamic';

export default function AdminTestPlayersPage() {
  return (
    <SiteAdminGuard>
      <PageContainer
        title="Test Players"
        subtitle="14 isolated dummy accounts for development & admin testing (excluded from all public/global data)"
        action={(
          <Link href="/admin">
            <Button variant="secondary" size="sm">Admin</Button>
          </Link>
        )}
        maxWidth="xl"
      >
        <TestPlayersConsole />
      </PageContainer>
    </SiteAdminGuard>
  );
}
