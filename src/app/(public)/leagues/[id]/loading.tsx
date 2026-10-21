import Skeleton from "@/components/ui/Skeleton";
import PageContainer from "@/components/ui/PageContainer";

export default function LeagueDetailLoading() {
  return (
    <PageContainer title="" maxWidth="lg">
      <Skeleton width="220px" height="32px" rounded="md" />
      <div className="mt-2 flex gap-2">
        <Skeleton width="80px" height="24px" rounded="full" />
        <Skeleton width="120px" height="24px" rounded="full" />
      </div>
      <div className="mt-6 space-y-4">
        <Skeleton height="180px" rounded="lg" />
        <Skeleton height="250px" rounded="lg" />
      </div>
    </PageContainer>
  );
}
