import { CastStudioProvider } from '@/components/creator/studio/CastStudioContext';
import SoloLayout from '@/components/creator/studio/solo/SoloLayout';
import { loadStudioSessionPage } from '../session-page-access';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ sessionId: string }>;
}

export default async function SoloStreamerPage({ params }: Props) {
  const { sessionId } = await params;

  const result = await loadStudioSessionPage(sessionId);
  if (!result.ok) return result.view;
  const { session } = result;

  return (
    <div>
      <CastStudioProvider session={session}>
        <SoloLayout />
      </CastStudioProvider>
    </div>
  );
}
