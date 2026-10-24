import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import FormatDetail from '@/components/format-studio/FormatDetail';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { PRESETS, resolveLText } from '@/lib/format-kit/client';
import { presetViews } from '@/lib/format-studio/loader';
import { getLocale, getT } from '@/i18n/server';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ presetId: string }>;
}

/**
 * `/admin/formats/example/[presetId]`: one example format, read-only. Any admin may open it; it reads no data
 * (the presets are constants compiled once per process). A preset id that is not one of the kit presets is a 404.
 */
export default async function FormatExamplePage({ params }: PageProps) {
  const { presetId } = await params;
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const preset = PRESETS.find((p) => p.id === presetId);
  const view = presetViews().find((p) => p.id === presetId)?.view;
  if (!preset || !view) notFound();

  const [t, locale] = await Promise.all([getT(formatStudioAdminMessages), getLocale()]);
  const title = resolveLText(preset.definition.identity.name, { viewer: locale })?.value ?? preset.id;

  return (
    <AdminGuard>
      <PageContainer title={title} maxWidth="lg">
        <Link href="/admin/formats" className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0">
          {t('detail.back')}
        </Link>
        <FormatDetail view={view} variant="page" example />
      </PageContainer>
    </AdminGuard>
  );
}
