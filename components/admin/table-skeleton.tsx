import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-20 bg-white/5" />
          <Skeleton className="h-4 flex-1 bg-white/5" />
          <Skeleton className="h-4 w-16 bg-white/5" />
          <Skeleton className="h-4 w-24 bg-white/5" />
          <Skeleton className="h-6 w-16 rounded-full bg-white/5" />
        </div>
      ))}
    </div>
  );
}
