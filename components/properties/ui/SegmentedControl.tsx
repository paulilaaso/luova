"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/luova-utils";

export interface SegmentOption<T extends string> {
  value: T;
  /** Accessible name and tooltip; the visible text when there is no icon. */
  label: string;
  icon?: LucideIcon;
}

/**
 * Compact exclusive choice: one recessed track, the active segment raised.
 * Selection changes instantly (these are clicked often); a subtle scale on
 * press is the only motion.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T | null | undefined;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex h-7 w-full items-stretch gap-0.5 rounded-md bg-muted p-0.5",
        className
      )}
    >
      {options.map(({ value: optionValue, label, icon: Icon }) => {
        const active = optionValue === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: <button role="radio"> is needed for custom-styled segments
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(optionValue)}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center rounded-[5px] text-muted-foreground outline-none",
              "transition-[color,background-color,box-shadow,transform] duration-150 ease-out",
              "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]",
              active &&
                "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.06)] dark:bg-foreground/12"
            )}
          >
            {Icon ? (
              <Icon className="size-3.5" strokeWidth={1.75} />
            ) : (
              <span className="truncate px-1 text-xs font-medium">{label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
