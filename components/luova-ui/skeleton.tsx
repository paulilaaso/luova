import { useMemo } from "react";
import { cn } from "@/lib/luova-utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("cn-skeleton animate-pulse", className)}
      {...props}
    />
  );
}

function SkeletonShape({ className, ...props }: React.ComponentProps<"div">) {
  const style = useMemo(
    () => ({
      width: `${50 + Math.floor(Math.random() * 50)}%`,
      height: `${60 + Math.floor(Math.random() * 40)}%`,
    }),
    []
  );

  return (
    <div
      data-slot="skeleton-shape"
      className={cn("cn-skeleton animate-pulse rounded-md", className)}
      style={style}
      {...props}
    />
  );
}

export { Skeleton, SkeletonShape };
