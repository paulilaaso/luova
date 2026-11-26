"use client";

import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/luova-utils";

interface ColorPickerHandleProps {
  percent: number;
  color: string;
  isActive?: boolean;
  positioned?: boolean;
  /** Optional ref to the inner pill div for direct backgroundColor updates during drag. */
  pillRef?: React.RefObject<HTMLDivElement | null>;
}

export const ColorPickerHandle = forwardRef<
  HTMLDivElement,
  ColorPickerHandleProps
>(function ColorPickerHandle(
  { percent, color, isActive = true, positioned = false, pillRef },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-none z-20 flex items-center justify-center",
        positioned ? "absolute inset-0" : "absolute inset-y-0"
      )}
      style={
        positioned
          ? undefined
          : {
              left: `clamp(5px, ${percent}%, calc(100% - 5px))`,
              transform: "translateX(-50%)",
            }
      }
    >
      <div
        ref={pillRef}
        className={cn(
          "h-5/6 w-2.5 rounded-full border-2 border-white transition-all",
          isActive
            ? "shadow-[0_0_0_1.5px_rgba(0,0,0,0.4),0_2px_4px_rgba(0,0,0,0.3)] scale-110"
            : "shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.2)]"
        )}
        style={{ backgroundColor: color }}
      />
    </div>
  );
});
