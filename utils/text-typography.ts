import type { CSSProperties } from "react";
import {
  FONT_SIZE_MAP,
  FONT_WEIGHT_MAP,
  getColorFromClasses,
  getConflictingClasses,
  getFontFamilyFromClasses,
  getFontSizeFromClasses,
  getFontStyleFromClasses,
  getFontWeightFromClasses,
  getLetterSpacingFromClasses,
  getLineHeightFromClasses,
  getTextDecorationFromClasses,
  getWordSpacingFromClasses,
  LINE_HEIGHT_MAP,
  TRACKING_MAP,
} from "./tailwind-mapping";
import { resolveDisplayColor } from "./theme-resolver";

export const typographyCss = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  wordSpacing: "word-spacing",
  textColor: "color",
  fontStyle: "font-style",
  textDecoration: "text-decoration",
} as const;
export type TypographyProperty = keyof typeof typographyCss;
export type TypographyValues = Record<TypographyProperty, string>;
export const typographyPresets = {
  fontSize: FONT_SIZE_MAP,
  fontWeight: FONT_WEIGHT_MAP,
  lineHeight: LINE_HEIGHT_MAP,
  letterSpacing: TRACKING_MAP,
};

export function typographyFromClasses(
  classes: string[],
  mode: "light" | "dark"
): TypographyValues {
  const rawColor = getColorFromClasses(classes, "text", mode) || "";
  const color = rawColor.startsWith("[")
    ? rawColor.slice(1, -1).replace(/_/g, " ")
    : rawColor;
  return {
    fontFamily: getFontFamilyFromClasses(classes),
    fontSize: String(getFontSizeFromClasses(classes)),
    fontWeight: String(getFontWeightFromClasses(classes)),
    lineHeight: String(
      getLineHeightFromClasses(classes, getFontSizeFromClasses(classes))
    ),
    letterSpacing: String(getLetterSpacingFromClasses(classes)),
    wordSpacing: String(getWordSpacingFromClasses(classes)),
    textColor: resolveDisplayColor(color, { textColor: color }) || color,
    fontStyle: getFontStyleFromClasses(classes),
    textDecoration: getTextDecorationFromClasses(classes),
  };
}
/** "140px", "140", or calc(140px * var(--font-scale, 1)) → 140. */
function inlinePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const scaled = value.match(
    /^calc\(\s*(-?[\d.]+)px\s*\*\s*var\(--font-scale[^)]*\)\s*\)$/
  );
  if (scaled) return Number(scaled[1]);
  const plain = value.match(/^(-?[\d.]+)(?:px)?$/);
  return plain ? Number(plain[1]) : undefined;
}

/**
 * Typography an element sets in its inline style (`style={{fontSize: …}}`).
 * Inline styles outrank classes, so these are the values actually rendered.
 * Values the panel can't express (expressions, other units) are left out.
 */
export function inlineTypographyValues(
  style: Record<string, string>,
  classFontSize: number
): Partial<TypographyValues> {
  const values: Partial<TypographyValues> = {};
  const fontSize = inlinePx(style.fontSize);
  if (fontSize !== undefined) values.fontSize = String(fontSize);
  const size = fontSize ?? classFontSize;

  if (style.fontWeight && /^\d+$/.test(style.fontWeight)) {
    values.fontWeight = style.fontWeight;
  }

  const lineHeight = style.lineHeight;
  if (lineHeight) {
    const percent = lineHeight.match(/^([\d.]+)%$/);
    const px = lineHeight.match(/^([\d.]+)px$/);
    if (/^[\d.]+$/.test(lineHeight)) {
      values.lineHeight = String(Math.round(Number(lineHeight) * 100));
    } else if (percent) {
      values.lineHeight = String(Math.round(Number(percent[1])));
    } else if (px && size > 0) {
      values.lineHeight = String(Math.round((Number(px[1]) / size) * 100));
    }
  }

  for (const key of ["letterSpacing", "wordSpacing"] as const) {
    const value = style[key];
    if (!value) continue;
    const em = value.match(/^(-?[\d.]+)em$/);
    const px = inlinePx(value);
    if (em) values[key] = String(Number(em[1]));
    else if (px !== undefined && size > 0) {
      values[key] = String(Number((px / size).toFixed(3)));
    }
  }
  return values;
}

export function typographyCssValue(
  property: TypographyProperty,
  value: string | number
): string {
  if (property === "fontFamily")
    return ["sans", "serif", "mono", "heading"].includes(String(value))
      ? `var(--font-${value})`
      : `"${String(value).replace(/["\\]/g, "\\$&")}"`;
  if (property === "fontSize") return `${value}px`;
  if (property === "lineHeight") return String(Number(value) / 100);
  if (property === "letterSpacing" || property === "wordSpacing")
    return `${value}em`;
  return String(value);
}

/** Match Tailwind's fixed spacing and unitless leading utilities in the editor. */
function lineHeightCssFromClass(cls: string): string | null {
  const utility = cls.match(/(?:^|:)(leading-[^:]+)$/)?.[1];
  if (!utility) return null;
  const suffix = utility.slice("leading-".length);
  if (/^(?:[3-9]|10)$/.test(suffix)) return `calc(var(--spacing) * ${suffix})`;
  if (suffix in LINE_HEIGHT_MAP) return String(LINE_HEIGHT_MAP[suffix] / 100);
  const arbitrary = suffix.match(/^\[([\d.]+)\]$/);
  return arbitrary ? arbitrary[1] : null;
}

// Only typography declarations are allowed to cross the HTML/JSX boundary.
export function typographyStyleClasses(style: CSSStyleDeclaration): string[] {
  return Object.values(typographyCss).flatMap((property) => {
    const value = style.getPropertyValue(property).trim();
    return value && !/[;{}<>[\]]/.test(value)
      ? [`[${property}:${value.replace(/_/g, "\\_").replace(/\s/g, "_")}]`]
      : [];
  });
}

export function importTypographyClasses(el: HTMLElement): void {
  const classes = Array.from(el.classList);
  for (const cls of classes) {
    const alignment = cls.match(/^text-(left|center|right|justify)$/)?.[1];
    if (alignment) el.style.textAlign = alignment;
    const arbitrary = cls.match(/^\[([a-z-]+):(.+)\]$/);
    if (
      arbitrary &&
      Object.values(typographyCss).includes(arbitrary[1] as never)
    ) {
      el.style.setProperty(
        arbitrary[1],
        arbitrary[2].replace(/(?<!\\)_/g, " ").replace(/\\_/g, "_")
      );
      continue;
    }
    if (cls in FONT_SIZE_MAP) el.style.fontSize = `${FONT_SIZE_MAP[cls]}px`;
    if (cls in FONT_WEIGHT_MAP)
      el.style.fontWeight = String(FONT_WEIGHT_MAP[cls]);
    const leading = lineHeightCssFromClass(cls);
    if (leading) el.style.lineHeight = leading;
    if (cls.startsWith("tracking-") && cls.slice(9) in TRACKING_MAP)
      el.style.letterSpacing = `${TRACKING_MAP[cls.slice(9)]}em`;
    const size = cls.match(/^text-\[([\d.]+px)\]$/);
    const weight = cls.match(/^font-\[(\d+)\]$/);
    if (size) el.style.fontSize = size[1];
    if (weight) el.style.fontWeight = weight[1];
    if (/^font-(sans|serif|mono|heading)$/.test(cls) || /^font-\['/.test(cls))
      el.style.fontFamily = typographyCssValue(
        "fontFamily",
        getFontFamilyFromClasses([cls])
      );
  }
}

// Runtime-generated Tailwind classes may not have compiled while the normal
// renderer is unmounted. Apply explicit block typography directly in the editor.
export function typographyRootStyle(
  classes: string[],
  mode: "light" | "dark"
): CSSProperties {
  const active = classes.filter((cls) =>
    mode === "dark" ? !cls.startsWith("light:") : !cls.startsWith("dark:")
  );
  const values = typographyFromClasses(active, mode);
  const style: Record<string, string> = {};
  for (const property of Object.keys(typographyCss) as TypographyProperty[]) {
    const conflicts = getConflictingClasses(property, active);
    if (conflicts.length) {
      style[property === "textColor" ? "color" : property] =
        property === "lineHeight"
          ? (lineHeightCssFromClass(conflicts.at(-1)!) ??
            typographyCssValue(property, values[property]))
          : typographyCssValue(property, values[property]);
    }
  }
  return style as CSSProperties;
}
