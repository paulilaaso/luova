import { cn } from "@/lib/luova-utils";

/** Recessed track holding one toolbar group (like SegmentedControl). */
export const TOOLBAR_TRACK =
  "flex h-7 min-w-0 flex-[3] items-stretch gap-0.5 rounded-md bg-muted p-0.5";

/** Toolbar buttons styled like SegmentedControl segments: flat in a recessed
 * track, the active one raised. */
export const TOOLBAR_BUTTON = cn(
  "h-auto w-auto min-w-0 flex-1 rounded-[5px] transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.96]",
  // Cancel FormatButton's own active look (accent fill + ring).
  "bg-transparent ring-0 hover:bg-transparent hover:text-foreground",
  "aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.06)] dark:aria-pressed:bg-foreground/12"
);
