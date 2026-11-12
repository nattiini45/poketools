import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import ItemIcon from '@/components/ui/ItemIcon';
import PageContainer from '@/components/ui/PageContainer';
import AdminDataTools from './AdminDataTools';
import FormatDriftReport from './FormatDriftReport';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

/** The task cards of the page, in page order: the anchor of each card, its item icon and the message key of its title. */
const TASKS = [
  { id: 'data-jobs', icon: 'metronome', labelKey: 'data.jobs.title' },
  { id: 'data-reconcile', icon: 'scope-lens', labelKey: 'data.reconcile.title' },
  { id: 'data-import', icon: 'lucky-egg', labelKey: 'data.import.title' },
  { id: 'data-export', icon: 'exp-share', labelKey: 'data.export.title' },
  { id: 'data-drift', icon: 'up-grade', labelKey: 'data.formatDrift.title' },
] as const;

export default async function AdminDataPage() {
  const t = await getT(adminToolsMessages);
  return (
    <SiteAdminGuard>
      <PageContainer title={t('data.title')} icon="rocky-helmet" subtitle={t('data.subtitle')} maxWidth="xl">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <AdminDataTools />
            <FormatDriftReport />
          </div>
          <nav aria-label={t('data.tasks')} className="hidden xl:sticky xl:top-[4.5rem] xl:block">
            <p className="px-2 text-caption font-[550] text-fg-muted">{t('data.tasks')}</p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {TASKS.map((task) => (
                <li key={task.id}>
                  <a
                    href={`#${task.id}`}
                    className="flex items-center gap-2.5 rounded-poke-md px-2 py-1.5 text-body text-fg-muted transition-[background-color,color] duration-80 ease-out hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    <ItemIcon item={task.icon} />
                    <span className="min-w-0 break-words">{t(task.labelKey)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </PageContainer>
    </SiteAdminGuard>
  );
}
