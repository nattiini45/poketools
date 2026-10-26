import Skeleton from '@/components/ui/Skeleton';
import PokeballSpinner from '@/components/shared/PokeballSpinner';
import PageContainer from '@/components/ui/PageContainer';

/** The editor's loading state: the three columns of the editor (outline, inspector, preview) as skeletons. */
export default function AdminFormatEditLoading() {
  return (
    <PageContainer title="" maxWidth="xl">
      <PokeballSpinner className="py-6" />
      <Skeleton width="240px" height="32px" rounded="md" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">
        <Skeleton height="320px" rounded="lg" />
        <Skeleton height="480px" rounded="lg" />
        <div className="lg:col-span-2 xl:col-span-1">
          <Skeleton height="320px" rounded="lg" />
        </div>
      </div>
    </PageContainer>
  );
}
