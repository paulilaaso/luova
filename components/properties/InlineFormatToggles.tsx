"use client";

import { Bold, Italic, type LucideIcon, Underline } from "lucide-react";
import type {
  TypographyProperty,
  TypographyValues,
} from "@/utils/text-typography";
import { FormatButton } from "./FormatButton";

const INLINE_TOGGLES: Array<{
  key: "fontWeight" | "fontStyle" | "textDecoration";
  label: string;
  on: string;
  off: string;
  Icon: LucideIcon;
}> = [
  { key: "fontWeight", label: "Bold", on: "700", off: "400", Icon: Bold },
  {
    key: "fontStyle",
    label: "Italic",
    on: "italic",
    off: "normal",
    Icon: Italic,
  },
  {
    key: "textDecoration",
    label: "Underline",
    on: "underline",
    off: "none",
    Icon: Underline,
  },
];

/** Bold / italic / underline toggles. Renders bare buttons; the caller wraps
 * them in the segmented container of its choosing. */
export function InlineFormatToggles({
  values,
  onChange,
  buttonClassName,
}: {
  values: TypographyValues;
  onChange: (property: TypographyProperty, value: string | number) => void;
  buttonClassName?: string;
}) {
  const isPressed = (
    key: (typeof INLINE_TOGGLES)[number]["key"],
    on: string
  ) =>
    key === "fontWeight"
      ? Number(values.fontWeight) >= 700
      : values[key].includes(on);

  return (
    <>
      {INLINE_TOGGLES.map(({ key, label, on, off, Icon }) => {
        const pressed = isPressed(key, on);
        return (
          <FormatButton
            key={key}
            label={label}
            active={pressed}
            disabled={false}
            className={buttonClassName}
            onClick={() => onChange(key, pressed ? off : on)}
          >
            <Icon className="size-3.5" />
          </FormatButton>
        );
      })}
    </>
  );
}
