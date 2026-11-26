import type * as React from "react";

import { cn } from "@/lib/luova-utils";

function Textarea({
  className,
  onKeyDown,
  onKeyUp,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "cn-textarea flex field-sizing-content min-h-16 w-full outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      onKeyDown={(e) => {
        // Stop native bubbling so keystrokes never reach window listeners
        // attached by user-authored canvas components.
        e.nativeEvent.stopPropagation();
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        e.nativeEvent.stopPropagation();
        onKeyUp?.(e);
      }}
      {...props}
    />
  );
}

export { Textarea };
