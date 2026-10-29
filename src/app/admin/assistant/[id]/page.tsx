import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import AssistantWorkspace from '@/components/admin/assistant/AssistantWorkspace';
import Button from '@/components/ui/Button';
import PageContainer from '@/components/ui/PageContainer';
import { getT } from '@/i18n/server';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { isValidUuid } from '@/lib/utils/uuid';
import { assistantPageGate } from '../gate';

export const dynamic = 'force-dynamic';

/**
 * `/admin/assistant/[id]`: one conversation, the transcript beside the Plan panel. The page checks only the live gate and
 * the shape of the id; the conversation itself is read through the owner-scoped route, so another admin's id is a 404 there.
 */
export default async function AdminAssistantConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await assistantPageGate();
  if (gate === 'denied') return <AdminGuard>{null}</AdminGuard>;
  if (gate === 'unavailable') notFound();

  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const t = await getT(adminAssistantMessages);
  return (
    <AdminGuard>
      <PageContainer
        title={t('page.title')}
        maxWidth="xl"
        action={
          <Link href="/admin/assistant">
            <Button variant="secondary" size="sm">
              {t('page.back')}
            </Button>
          </Link>
        }
      >
        <AssistantWorkspace conversationId={id.toLowerCase()} variant="page" />
      </PageContainer>
    </AdminGuard>
  );
}
