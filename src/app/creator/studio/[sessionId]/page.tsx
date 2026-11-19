import { redirect } from 'next/navigation';
import { CastStudioProvider } from '@/components/creator/studio/CastStudioContext';
import CastStudio from '@/components/creator/studio/CastStudio';
import { loadStudioSessionPage } from './session-page-access';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ sessionId: string }>;
}

export default async function CastStudioSessionPage({ params }: Props) {
  const { sessionId } = await params;

  const result = await loadStudioSessionPage(sessionId);
  if (!result.ok) return result.view;
  const { session } = result;
  if (session.mode === 'solo') redirect(`/creator/studio/${sessionId}/solo`);

  return (
    <div>
      <CastStudioProvider session={session}>
        <CastStudio />
      </CastStudioProvider>
    </div>
  );
}
