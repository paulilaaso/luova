import type { ContentAlignment } from "@/types/builder";

/** Classes that place a component inside its frame for each content alignment. */
export const ALIGNMENT_CLASSES: Record<ContentAlignment, string> = {
  "top-left": "justify-start items-start text-left",
  "top-center": "justify-center items-start text-center",
  "top-right": "justify-end items-start text-right",
  "center-left": "justify-start items-center text-left",
  center: "justify-center items-center text-center",
  "center-right": "justify-end items-center text-right",
  "bottom-left": "justify-start items-end text-left",
  "bottom-center": "justify-center items-end text-center",
  "bottom-right": "justify-end items-end text-right",
};
