"use client";

import { cn } from "@/lib/luova-utils";

export function FormatButton({
  label,
  active,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        active &&
          "bg-accent text-accent-foreground ring-1 ring-inset ring-primary/40",
        className
      )}
    >
      {children}
    </button>
  );
}
