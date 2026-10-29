import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import AssistantHome from '@/components/admin/assistant/AssistantHome';
import PageContainer from '@/components/ui/PageContainer';
import { getT } from '@/i18n/server';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { assistantPageGate } from './gate';

export const dynamic = 'force-dynamic';

/** `/admin/assistant`: the admin's conversations and the button for a new one. */
export default async function AdminAssistantPage() {
  const gate = await assistantPageGate();
  if (gate === 'denied') return <AdminGuard>{null}</AdminGuard>;
  if (gate === 'unavailable') notFound();

  const t = await getT(adminAssistantMessages);
  return (
    <AdminGuard>
      <PageContainer title={t('page.title')} subtitle={t('page.intro')} maxWidth="lg">
        <AssistantHome />
      </PageContainer>
    </AdminGuard>
  );
}
