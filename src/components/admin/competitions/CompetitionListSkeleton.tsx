import Skeleton from '@/components/ui/Skeleton';
import PageContainer from '@/components/ui/PageContainer';

/**
 * The loading state of the competition list pages (`loading.tsx` of /admin/leagues and /admin/tournaments): the
 * shape of the page while its rows are read, so nothing jumps when they arrive. Decorative only (`aria-hidden`
 * skeletons), like the other admin loading states.
 */
export default function CompetitionListSkeleton() {
  return (
    <PageContainer maxWidth="xl" action={<Skeleton width="8rem" height="1.75rem" rounded="md" />}>
      <div className="space-y-4" aria-busy="true">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex gap-2">
            <Skeleton width="8rem" height="2.25rem" rounded="sm" />
            <Skeleton width="9rem" height="2.25rem" rounded="sm" />
          </div>
          <div className="flex gap-1">
            <Skeleton width="4.5rem" height="2rem" rounded="md" />
            <Skeleton width="5.5rem" height="2rem" rounded="md" />
          </div>
          <Skeleton className="w-full sm:ml-auto sm:w-72" height="2.25rem" rounded="md" />
        </div>
        <div className="space-y-px overflow-hidden rounded-poke-lg border border-hairline bg-surface">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} height="4.5rem" rounded="sm" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
