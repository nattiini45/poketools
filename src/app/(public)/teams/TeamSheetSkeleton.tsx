import Skeleton from '@/components/ui/Skeleton';

/** The loading shape of the team sheet: title, roster band and six member panels. */
export default function TeamSheetSkeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto flex max-w-[1152px] flex-col gap-[27px]" role="status" aria-label={label}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-[74px] w-full sm:h-[98px]" rounded="lg" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-52 w-full" rounded="lg" />
        ))}
      </div>
    </div>
  );
}
