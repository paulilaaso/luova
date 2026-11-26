/**
 * Tailwind ↔ Value Mapping Utility
 *
 * Converts Tailwind utility classes to numeric/color values and vice versa.
 * Used by the CapturedElementPanel to seed slider/picker initial values
 * and to generate classes from slider commits.
 */

import { isGradientValue } from "./color-converter";

export function stripVariantPrefixes(cls: string): string {
  let bracketDepth = 0;
  let lastVariantSeparator = -1;

  for (let index = 0; index < cls.length; index++) {
    const char = cls[index];
    if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === ":" && bracketDepth === 0) lastVariantSeparator = index;
  }

  return lastVariantSeparator >= 0 ? cls.slice(lastVariantSeparator + 1) : cls;
}

/**
 * Read the value out of a Tailwind arbitrary-property class such as
 * `[font-size:23px]` or `[word-spacing:0.2em]`.
 *
 * The rich-text editor serialises runs using this CSS-property form (see
 * `typographyStyleClasses`), so the inverters below must understand it in
 * addition to the named utility form (`text-xl`, `font-bold`, …).
 */
function getArbitraryPropertyValue(
  utility: string,
  cssProperty: string
): string | null {
  const match = utility.match(/^\[([a-z-]+):(.+)\]$/);
  if (!match || match[1] !== cssProperty) return null;
  return match[2].replace(/(?<!\\)_/g, " ").replace(/\\_/g, "_");
}

function _getVariantPrefix(cls: string): string {
  let bracketDepth = 0;
  let lastVariantSeparator = -1;

  for (let index = 0; index < cls.length; index++) {
    const char = cls[index];
    if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === ":" && bracketDepth === 0) lastVariantSeparator = index;
  }

  return lastVariantSeparator >= 0
    ? cls.slice(0, lastVariantSeparator + 1)
    : "";
}

function invertMap<K extends string | number, V extends string | number>(
  map: Record<K, V>
): Record<V, K> {
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [v as V, k as K])
  ) as Record<V, K>;
}

// ─── Spacing scale (Tailwind default, rem → px at 16px base) ─────────────────

const SPACING_SCALE: Record<number, string> = {
  0: "0",
  1: "px",
  4: "1",
  8: "2",
  12: "3",
  16: "4",
  20: "5",
  24: "6",
  28: "7",
  32: "8",
  36: "9",
  40: "10",
  44: "11",
  48: "12",
  56: "14",
  64: "16",
  80: "20",
  96: "24",
  112: "28",
  128: "32",
  144: "36",
  160: "40",
  176: "44",
  192: "48",
  224: "56",
  256: "64",
  320: "80",
  384: "96",
};

/** Nearest Tailwind spacing value (px) for a given pixel amount */
function nearestSpacing(px: number): number {
  const keys = Object.keys(SPACING_SCALE).map(Number);
  return keys.reduce((prev, curr) =>
    Math.abs(curr - px) < Math.abs(prev - px) ? curr : prev
  );
}

/** Snap a pixel value to the nearest Tailwind spacing step (13 → 12). */
export function snapSpacingPx(px: number): number {
  return nearestSpacing(px);
}

/** Exact class suffix for a pixel value: a scale step when there is one
 * ("4" for 16px), otherwise an arbitrary value ("[3px]"). */
export function spacingToken(px: number): string {
  return px in SPACING_SCALE ? SPACING_SCALE[px] : `[${px}px]`;
}

/** Tailwind spacing suffix for a pixel value (e.g. 16 → "4") */
function spacingSuffix(px: number): string {
  const nearest = nearestSpacing(px);
  return SPACING_SCALE[nearest];
}

// ─── Padding ─────────────────────────────────────────────────────────────────

const PADDING_REGEX = /^(p(?:[xytrbl])?)-(\d+(?:\.\d+)?|px)$/;

const PREFIX_TO_PADDING_AXIS: Record<string, PaddingAxis> = {
  p: "all",
  px: "x",
  py: "y",
  pt: "top",
  pr: "right",
  pb: "bottom",
  pl: "left",
};
type PaddingAxis = "all" | "x" | "y" | "top" | "right" | "bottom" | "left";

const _AXIS_PREFIX: Record<PaddingAxis, string> = {
  all: "p",
  x: "px",
  y: "py",
  top: "pt",
  right: "pr",
  bottom: "pb",
  left: "pl",
};

/** Parse a Tailwind padding class like "p-4" → 16 (px) */
function parsePaddingClass(
  cls: string
): { axis: PaddingAxis; px: number } | null {
  const utility = stripVariantPrefixes(cls);
  const match = utility.match(PADDING_REGEX);
  if (!match) return null;

  const prefix = match[1];
  const suffix = match[2];
  const px = suffix === "px" ? 1 : Number(suffix) * 4;
  const axis = PREFIX_TO_PADDING_AXIS[prefix] ?? "all";
  return { axis, px };
}

/** Get padding value in px for a given axis from a list of classes */
export function getPaddingFromClasses(
  classes: string[],
  axis: PaddingAxis
): number {
  let value = 0;
  for (const cls of classes) {
    const parsed = parsePaddingClass(cls);
    if (!parsed) continue;
    if (parsed.axis === "all") value = parsed.px;
    if (parsed.axis === axis) value = parsed.px;
    // x covers left/right, y covers top/bottom
    if (axis === "left" || axis === "right") {
      if (parsed.axis === "x") value = parsed.px;
    }
    if (axis === "top" || axis === "bottom") {
      if (parsed.axis === "y") value = parsed.px;
    }
  }
  return value;
}

// ─── Border radius ────────────────────────────────────────────────────────────

const RADIUS_MAP: Record<string, number> = {
  "rounded-none": 0,
  "rounded-sm": 2,
  rounded: 4,
  "rounded-md": 6,
  "rounded-lg": 8,
  "rounded-xl": 12,
  "rounded-2xl": 16,
  "rounded-3xl": 24,
  "rounded-full": 9999,
};

export function getRadiusFromClasses(classes: string[]): number {
  let value = 0;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility in RADIUS_MAP) {
      value = RADIUS_MAP[utility];
    } else if (utility.startsWith("rounded-[") && utility.endsWith("]")) {
      const match = utility.match(/rounded-\[([\d.]+)px\]/);
      if (match) {
        value = parseFloat(match[1]);
      }
    }
  }
  return value;
}

// ─── Border width ─────────────────────────────────────────────────────────────

const BORDER_WIDTH_MAP: Record<string, number> = {
  "border-0": 0,
  border: 1,
  "border-2": 2,
  "border-4": 4,
  "border-8": 8,
};

export function getBorderWidthFromClasses(classes: string[]): number {
  let value = 0;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility in BORDER_WIDTH_MAP) {
      value = BORDER_WIDTH_MAP[utility];
    } else if (utility.startsWith("border-[") && utility.endsWith("px]")) {
      // Parse arbitrary value: border-[3px] → 3
      const match = utility.match(/border-\[(\d+(?:\.\d+)?)px\]/);
      if (match) value = parseFloat(match[1]);
    }
  }
  return value;
}

// ─── Font size ────────────────────────────────────────────────────────────────

export const FONT_SIZE_MAP: Record<string, number> = {
  "text-xs": 12,
  "text-sm": 14,
  "text-base": 16,
  "text-lg": 18,
  "text-xl": 20,
  "text-2xl": 24,
  "text-3xl": 30,
  "text-4xl": 36,
  "text-5xl": 48,
  "text-6xl": 60,
  "text-7xl": 72,
  "text-8xl": 96,
  "text-9xl": 128,
};

const FONT_SIZE_MODIFIERS = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);

const TEXT_ALIGN_MODIFIERS = new Set(["left", "center", "right", "justify"]);

/**
 * Relative line heights (percent of the font size). The fixed `leading-3`…
 * `leading-10` heights are absolute pixels, a different unit: they live in
 * LINE_HEIGHT_FIXED_PX and are only read (converted to a percentage), never
 * offered as presets or written.
 */
export const LINE_HEIGHT_MAP: Record<string, number> = {
  // Tailwind v4's --leading-* values (theme.css).
  none: 100,
  tight: 125,
  snug: 137.5,
  normal: 150,
  relaxed: 162.5,
  loose: 200,
};

const LINE_HEIGHT_REVERSE = invertMap(LINE_HEIGHT_MAP);

/** Fixed `leading-N` heights in px (N × 4px at the default spacing). */
const LINE_HEIGHT_FIXED_PX: Record<string, number> = {
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "9": 36,
  "10": 40,
};

export const TRACKING_MAP: Record<string, number> = {
  tighter: -0.05,
  tight: -0.025,
  normal: 0,
  wide: 0.025,
  wider: 0.05,
  widest: 0.1,
};

const TRACKING_REVERSE = invertMap(TRACKING_MAP);

const FONT_FAMILY_MAP: Record<string, string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
  heading: "font-heading",
};

const FONT_FAMILY_REVERSE = invertMap(FONT_FAMILY_MAP);

/** text-[length:calc(140px*var(--font-scale,1))]: a size past the named scale. */
const SCALED_FONT_SIZE =
  /^text-\[length:calc\((\d+(?:\.\d+)?)px\*var\(--font-scale,1\)\)\]$/;

export function getFontSizeFromClasses(classes: string[]): number {
  let value = 16;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility in FONT_SIZE_MAP) {
      value = FONT_SIZE_MAP[utility];
    } else if (utility.startsWith("text-[") && utility.endsWith("px]")) {
      const match = utility.match(/text-\[(\d+(?:\.\d+)?)px\]/);
      if (match) value = parseFloat(match[1]);
    } else if (SCALED_FONT_SIZE.test(utility)) {
      value = parseFloat(utility.match(SCALED_FONT_SIZE)?.[1] ?? "") || value;
    } else {
      const arbitrary = getArbitraryPropertyValue(utility, "font-size");
      if (arbitrary) value = parseFloat(arbitrary) || value;
    }
  }
  return value;
}

// ─── Opacity ─────────────────────────────────────────────────────────────────

export function getOpacityFromClasses(classes: string[]): number {
  let value = 100;
  for (const cls of classes) {
    const m = stripVariantPrefixes(cls).match(/^opacity-(\d+)$/);
    if (m) value = Number(m[1]);
  }
  return value;
}

// ─── Box Shadow ──────────────────────────────────────────────────────────────

/**
 * Extract shadow value from inline style attribute.
 * Shadow values are stored as inline style attributes (either CSS or React object format)
 * to avoid CSS parsing issues with arbitrary Tailwind classes.
 *
 * Supports both:
 *   - CSS format: `style="box-shadow: var(--shadow-md); ..."`
 *   - React object: `style={{boxShadow: "var(--shadow-md)"}}`
 */
export function getShadowFromStyle(
  styleAttr: string | undefined
): string | undefined {
  if (!styleAttr) return undefined;

  // First try React object format: boxShadow: "value" or boxShadow: 'value'
  const jsMatch = styleAttr.match(/boxShadow:\s*["']([^"']+)["']/i);
  if (jsMatch) {
    return jsMatch[1].trim();
  }

  // Fallback to CSS format: box-shadow: value;
  const cssMatch = styleAttr.match(/box-shadow:\s*([^;]+)/i);
  if (cssMatch) {
    return cssMatch[1].trim();
  }

  return undefined;
}

export function getSmoothingFromStyle(styleAttr: string | undefined): number {
  if (!styleAttr) return 0;

  const match = styleAttr.match(
    /["']?--smoothing["']?\s*:\s*["']?([^"';,}]+)["']?/i
  );
  if (!match) return 0;

  const value = Number.parseFloat(match[1].trim());
  return Number.isFinite(value) ? value : 0;
}

/**
 * Read the mode-aware gradient from an inline style attribute.
 * Looks for --luova-bg-light or --luova-bg-dark CSS custom properties.
 */
export function getGradientFromStyle(
  styleAttr: string | undefined,
  mode: "light" | "dark"
): string | undefined {
  if (!styleAttr) return undefined;
  const varName = mode === "dark" ? "--luova-bg-dark" : "--luova-bg-light";

  // Step A: Try React object syntax with quoted values
  const reactRe = new RegExp(
    `["']?${varName.replace(/--/g, "\\-\\-")}["']?\\s*:\\s*["']([^"']+)["']`,
    "i"
  );
  const reactMatch = styleAttr.match(reactRe);
  if (reactMatch) return reactMatch[1].trim();

  // Step B: Fallback to CSS string syntax
  const cssRe = new RegExp(
    `${varName.replace(/--/g, "\\-\\-")}\\s*:\\s*([^;}]+)`,
    "i"
  );
  const cssMatch = styleAttr.match(cssRe);
  if (cssMatch) return cssMatch[1].trim();

  return undefined;
}

/**
 * Read the mode-aware border gradient from an inline style attribute.
 * Looks for --luova-border-light or --luova-border-dark CSS custom properties.
 */
export function getBorderGradientFromStyle(
  styleAttr: string | undefined,
  mode: "light" | "dark"
): string | undefined {
  if (!styleAttr) return undefined;
  const varName =
    mode === "dark" ? "--luova-border-dark" : "--luova-border-light";

  // Step A: Try React object syntax with quoted values
  const reactRe = new RegExp(
    `["']?${varName.replace(/--/g, "\\-\\-")}["']?\\s*:\\s*["']([^"']+)["']`,
    "i"
  );
  const reactMatch = styleAttr.match(reactRe);
  if (reactMatch) return reactMatch[1].trim();

  // Step B: Fallback to CSS string syntax
  const cssRe = new RegExp(
    `${varName.replace(/--/g, "\\-\\-")}\\s*:\\s*([^;}]+)`,
    "i"
  );
  const cssMatch = styleAttr.match(cssRe);
  if (cssMatch) return cssMatch[1].trim();

  return undefined;
}

/**
 * Read the mode-aware shadow from an inline style attribute.
 * Looks for --luova-shadow-light or --luova-shadow-dark CSS custom properties.
 */
export function getModeAwareShadowFromStyle(
  styleAttr: string | undefined,
  mode: "light" | "dark"
): string | undefined {
  if (!styleAttr) return undefined;
  const varName =
    mode === "dark" ? "--luova-shadow-dark" : "--luova-shadow-light";

  // Step A: Try React object syntax with quoted values
  const reactRe = new RegExp(
    `["']?${varName.replace(/--/g, "\\-\\-")}["']?\\s*:\\s*["']([^"']+)["']`,
    "i"
  );
  const reactMatch = styleAttr.match(reactRe);
  if (reactMatch) return reactMatch[1].trim();

  // Step B: Fallback to CSS string syntax
  const cssRe = new RegExp(
    `${varName.replace(/--/g, "\\-\\-")}\\s*:\\s*([^;}]+)`,
    "i"
  );
  const cssMatch = styleAttr.match(cssRe);
  if (cssMatch) return cssMatch[1].trim();

  return undefined;
}

// ─── Margin ──────────────────────────────────────────────────────────────────

const MARGIN_REGEX = /^(m(?:[xytrbl])?)-(\d+(?:\.\d+)?|px|-\d+)$/;

const PREFIX_TO_MARGIN_AXIS: Record<string, MarginAxis> = {
  m: "all",
  mx: "x",
  my: "y",
  mt: "top",
  mr: "right",
  mb: "bottom",
  ml: "left",
};
type MarginAxis = "all" | "x" | "y" | "top" | "right" | "bottom" | "left";

const _MARGIN_AXIS_PREFIX: Record<MarginAxis, string> = {
  all: "m",
  x: "mx",
  y: "my",
  top: "mt",
  right: "mr",
  bottom: "mb",
  left: "ml",
};

/** Parse a Tailwind margin class like "m-4" → 16 (px) */
function parseMarginClass(
  cls: string
): { axis: MarginAxis; px: number } | null {
  const utility = stripVariantPrefixes(cls);
  const match = utility.match(MARGIN_REGEX);
  if (!match) return null;

  const prefix = match[1];
  const suffix = match[2];
  const px = suffix === "px" ? 1 : Number(suffix) * 4;
  const axis = PREFIX_TO_MARGIN_AXIS[prefix] ?? "all";
  return { axis, px };
}

/** Get margin value in px for a given axis from a list of classes */
export function getMarginFromClasses(
  classes: string[],
  axis: MarginAxis
): number {
  let value = 0;
  for (const cls of classes) {
    const parsed = parseMarginClass(cls);
    if (!parsed) continue;
    if (parsed.axis === "all") value = parsed.px;
    if (parsed.axis === axis) value = parsed.px;
    if (axis === "left" || axis === "right") {
      if (parsed.axis === "x") value = parsed.px;
    }
    if (axis === "top" || axis === "bottom") {
      if (parsed.axis === "y") value = parsed.px;
    }
  }
  return value;
}

// ─── Gap ─────────────────────────────────────────────────────────────────────

export function getGapFromClasses(classes: string[]): number {
  let value = 0;
  for (const cls of classes) {
    const m = stripVariantPrefixes(cls).match(/^gap-([\d.]+)$/);
    if (m) {
      const suffix = m[1];
      value = Number(suffix) * 4;
    }
  }
  return value;
}

// ─── Flexbox ─────────────────────────────────────────────────────────────────

export function getFlexDirectionFromClasses(classes: string[]): "row" | "col" {
  let value: "row" | "col" = "row";
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility === "flex-col") value = "col";
    if (utility === "flex-row") value = "row";
  }
  return value;
}

export function getAlignItemsFromClasses(classes: string[]): string {
  let value = "stretch";
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility.startsWith("items-")) {
      value = utility.replace("items-", "");
    }
  }
  return value;
}

export function getJustifyContentFromClasses(classes: string[]): string {
  let value = "start";
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility.startsWith("justify-")) {
      value = utility.replace("justify-", "");
    }
  }
  return value;
}

// ─── Typography ──────────────────────────────────────────────────────────────

export const FONT_WEIGHT_MAP: Record<string, number> = {
  "font-thin": 100,
  "font-extralight": 200,
  "font-light": 300,
  "font-normal": 400,
  "font-medium": 500,
  "font-semibold": 600,
  "font-bold": 700,
  "font-extrabold": 800,
  "font-black": 900,
};

const FONT_WEIGHT_REVERSE = invertMap(FONT_WEIGHT_MAP);

export function getFontWeightFromClasses(classes: string[]): number {
  let value = 400;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility in FONT_WEIGHT_MAP) {
      value = FONT_WEIGHT_MAP[utility];
    } else if (utility.startsWith("font-[") && utility.endsWith("]")) {
      const match = utility.match(/font-\[(\d+)\]/);
      if (match) value = parseInt(match[1], 10);
    } else {
      const arbitrary = getArbitraryPropertyValue(utility, "font-weight");
      if (arbitrary)
        value =
          arbitrary === "bold"
            ? 700
            : arbitrary === "normal"
              ? 400
              : parseInt(arbitrary, 10) || value;
    }
  }
  return value;
}

export function getTextAlignFromClasses(classes: string[]): string {
  let value = "left";
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility.startsWith("text-")) {
      const candidate = utility.replace("text-", "");
      if (["left", "center", "right", "justify"].includes(candidate)) {
        value = candidate;
      }
    }
  }
  return value;
}

/**
 * Line height as a percentage of the font size. A fixed `leading-N` class
 * (pixels) is converted using `fontSizePx`, so leading-6 at 16px reads 150.
 */
export function getLineHeightFromClasses(
  classes: string[],
  fontSizePx = 16
): number {
  let value = 150;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility.startsWith("leading-")) {
      const suffix = utility.replace("leading-", "");
      // Check for arbitrary bracketed decimal value first (e.g. leading-[1.5])
      if (suffix.startsWith("[") && suffix.endsWith("]")) {
        const match = suffix.match(/\[([\d.]+)\]/);
        if (match) {
          value = Math.round(parseFloat(match[1]) * 100);
        }
      } else if (suffix in LINE_HEIGHT_MAP) {
        // Named tokens (leading-tight, leading-relaxed, …)
        value = LINE_HEIGHT_MAP[suffix];
      } else if (suffix in LINE_HEIGHT_FIXED_PX && fontSizePx > 0) {
        value = Math.round((LINE_HEIGHT_FIXED_PX[suffix] / fontSizePx) * 100);
      }
    } else {
      const arbitrary = getArbitraryPropertyValue(utility, "line-height");
      if (arbitrary && !/[a-z%]/i.test(arbitrary))
        value = Math.round(parseFloat(arbitrary) * 100);
    }
  }
  return value;
}

export function getLetterSpacingFromClasses(classes: string[]): number {
  let value = 0;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility.startsWith("tracking-")) {
      const suffix = utility.replace("tracking-", "");
      if (suffix in TRACKING_MAP) value = TRACKING_MAP[suffix];
      const arbitrary = suffix.match(/^\[(-?[\d.]+)em\]$/);
      if (arbitrary) value = Number(arbitrary[1]);
    } else {
      const arbitrary = getArbitraryPropertyValue(utility, "letter-spacing");
      if (arbitrary) value = parseFloat(arbitrary);
    }
  }
  return value;
}

export function getWordSpacingFromClasses(classes: string[]): number {
  let value = 0;
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    // Parse arbitrary word spacing: [word-spacing:<value>em] (may be negative)
    const arbitrary = getArbitraryPropertyValue(utility, "word-spacing");
    if (arbitrary) value = parseFloat(arbitrary);
  }
  return value;
}

export function getFontStyleFromClasses(
  classes: string[]
): "italic" | "normal" {
  let value: "italic" | "normal" = "normal";
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility === "italic") value = "italic";
    if (utility === "not-italic") value = "normal";
    const arbitrary = getArbitraryPropertyValue(utility, "font-style");
    if (arbitrary) value = arbitrary === "normal" ? "normal" : "italic";
  }
  return value;
}

export function getTextDecorationFromClasses(
  classes: string[]
): "underline" | "line-through" | "none" {
  let value: "underline" | "line-through" | "none" = "none";
  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);
    if (utility === "underline") value = "underline";
    if (utility === "line-through") value = "line-through";
    if (utility === "no-underline") value = "none";
    const arbitrary = getArbitraryPropertyValue(utility, "text-decoration");
    if (arbitrary) {
      if (arbitrary.includes("line-through")) value = "line-through";
      else if (arbitrary.includes("underline")) value = "underline";
      else if (arbitrary === "none") value = "none";
    }
  }
  return value;
}

export function getFontFamilyFromClasses(classes: string[]): string {
  let value = "sans";
  let hasArbitraryFont = false;

  for (const cls of classes) {
    const utility = stripVariantPrefixes(cls);

    // Check for arbitrary font first (takes precedence over theme tokens)
    if (utility.startsWith("font-[") && utility.endsWith("]")) {
      // Extract content between font-[ and ]
      const match = utility.match(/font-\[(.+)\]/);
      if (match) {
        let extracted = match[1];
        // Strip all single and double quotes
        extracted = extracted.replace(/['"]/g, "");
        // Replace underscores with spaces (Tailwind convention for spaces in arbitrary values)
        extracted = extracted.replace(/_/g, " ");
        // Final trim
        extracted = extracted.trim();

        // Skip if the extracted value is purely numeric (font weight, not font family)
        if (extracted && !/^\d+$/.test(extracted)) {
          value = extracted;
          hasArbitraryFont = true;
        }
      }
    }
    // Only use theme tokens if we haven't found an arbitrary font yet
    else if (!hasArbitraryFont && utility in FONT_FAMILY_REVERSE) {
      value = FONT_FAMILY_REVERSE[utility];
    } else {
      // Arbitrary CSS-property form emitted by the rich-text editor.
      const arbitrary = getArbitraryPropertyValue(utility, "font-family");
      if (arbitrary) {
        const themeToken = arbitrary.match(
          /^var\(--font-(sans|serif|mono|heading)\)$/
        );
        if (themeToken) {
          value = themeToken[1];
        } else {
          const first = arbitrary
            .split(",")[0]
            .trim()
            .replace(/^["']|["']$/g, "");
          if (first && !first.startsWith("var(") && !/^\d+$/.test(first)) {
            value = first;
            hasArbitraryFont = true;
          }
        }
      }
    }
  }
  return value;
}

// ─── Color ───────────────────────────────────────────────────────────────────

const COLOR_PROPS = ["bg", "text", "border"] as const;
type ColorProp = (typeof COLOR_PROPS)[number];

/** Extract a Tailwind color class value like "bg-blue-500" → "blue-500" */
export function getColorFromClasses(
  classes: string[],
  property: ColorProp,
  mode: "light" | "dark" = "light"
): string | undefined {
  let value: string | undefined;
  for (const cls of classes) {
    // Check if this class matches the mode
    const isDarkClass = cls.startsWith("dark:");
    if (mode === "dark" && !isDarkClass) continue; // Skip light classes in dark mode
    if (mode === "light" && isDarkClass) continue; // Skip dark classes in light mode

    // Arbitrary CSS-property colour form emitted by the rich-text editor.
    if (property === "text") {
      const colorValue = getArbitraryPropertyValue(
        stripVariantPrefixes(cls),
        "color"
      );
      if (colorValue) {
        value = colorValue;
        continue;
      }
    }

    const m = stripVariantPrefixes(cls).match(new RegExp(`^${property}-(.+)$`));
    if (m) {
      const candidate = m[1];
      // For border property, skip width utilities (0, 2, 4, 8) and arbitrary px measurements
      if (property === "border") {
        if (/^\d+$/.test(candidate) || /^\[[\d.]+px\]$/.test(candidate))
          continue;
      }
      // For text property, skip size and alignment modifiers
      if (property === "text") {
        if (FONT_SIZE_MODIFIERS.has(candidate)) continue;
        if (TEXT_ALIGN_MODIFIERS.has(candidate)) continue;
        if (/^\[[\d.]+px\]$/.test(candidate)) continue; // arbitrary pixel sizes
        if (candidate.startsWith("[length:")) continue; // scaled sizes
      }
      value = candidate;
    }
  }
  return value;
}

// ─── Class generation ─────────────────────────────────────────────────────────

export type StyleProperty =
  | "paddingAll"
  | "paddingX"
  | "paddingY"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "borderRadius"
  | "borderWidth"
  | "fontSize"
  | "opacity"
  | "bgColor"
  | "textColor"
  | "borderColor"
  | "marginAll"
  | "marginX"
  | "marginY"
  | "marginTop"
  | "marginRight"
  | "marginBottom"
  | "marginLeft"
  | "gap"
  | "display"
  | "flexDirection"
  | "alignItems"
  | "justifyContent"
  | "fontWeight"
  | "textAlign"
  | "lineHeight"
  | "letterSpacing"
  | "wordSpacing"
  | "fontStyle"
  | "textDecoration"
  | "fontFamily"
  | "smoothing"
  | "boxShadow";

const _RADIUS_REVERSE = invertMap(RADIUS_MAP);

const _FONT_SIZE_REVERSE = invertMap(FONT_SIZE_MAP);

/**
 * Generate a Tailwind class for a given property and value.
 * Returns null if no mapping exists.
 */
export function generateTailwindClass(
  property: StyleProperty,
  value: number | string,
  mode: "light" | "dark" = "light"
): string | null {
  switch (property) {
    case "paddingAll":
      return `p-${spacingSuffix(Number(value))}`;
    case "paddingX":
      return `px-${spacingSuffix(Number(value))}`;
    case "paddingY":
      return `py-${spacingSuffix(Number(value))}`;
    case "paddingTop":
      return `pt-${spacingSuffix(Number(value))}`;
    case "paddingRight":
      return `pr-${spacingSuffix(Number(value))}`;
    case "paddingBottom":
      return `pb-${spacingSuffix(Number(value))}`;
    case "paddingLeft":
      return `pl-${spacingSuffix(Number(value))}`;
    case "marginAll":
      return `m-${spacingSuffix(Number(value))}`;
    case "marginX":
      return `mx-${spacingSuffix(Number(value))}`;
    case "marginY":
      return `my-${spacingSuffix(Number(value))}`;
    case "marginTop":
      return `mt-${spacingSuffix(Number(value))}`;
    case "marginRight":
      return `mr-${spacingSuffix(Number(value))}`;
    case "marginBottom":
      return `mb-${spacingSuffix(Number(value))}`;
    case "marginLeft":
      return `ml-${spacingSuffix(Number(value))}`;
    case "gap":
      return `gap-${spacingSuffix(Number(value))}`;
    case "display":
      // Value is the utility itself: block, inline-block, flex, inline-flex…
      return String(value);
    case "flexDirection":
      return value === "col" ? "flex-col" : "flex-row";
    case "alignItems":
      return `items-${value}`;
    case "justifyContent":
      return `justify-${value}`;
    case "borderRadius": {
      const px = Number(value);
      if (px === 0) return "rounded-none";
      if (px >= 9999) return "rounded-full";
      return `rounded-[${px}px]`;
    }
    case "borderWidth": {
      const px = Number(value);
      if (px === 0) return "border-0";
      if (px === 1) return "border";
      if (px === 2) return "border-2";
      if (px === 4) return "border-4";
      if (px === 8) return "border-8";
      return `border-[${px}px]`;
    }
    case "fontSize": {
      const px = Number(value);
      // Check if it matches a standard tailwind class
      const standard = Object.entries(FONT_SIZE_MAP).find(([, v]) => v === px);
      if (standard) return standard[0];
      // Past the named scale (text-9xl = 128px), keep following the global
      // font scale like the named sizes do.
      if (px > 128) return `text-[length:calc(${px}px*var(--font-scale,1))]`;

      return `text-[${px}px]`;
    }
    case "fontWeight": {
      const numValue = Number(value);
      // If value is 400 (default), return null
      if (numValue === 400) {
        return null;
      }
      // Check if it matches a standard key exactly
      if (numValue in FONT_WEIGHT_REVERSE) {
        return FONT_WEIGHT_REVERSE[numValue];
      }
      // Otherwise, return arbitrary value
      return `font-[${numValue}]`;
    }
    case "textAlign":
      return `text-${value}`;
    case "lineHeight": {
      const numValue = Number(value);
      // Check if it matches a standard tailwind named class
      if (numValue in LINE_HEIGHT_REVERSE) {
        const key = LINE_HEIGHT_REVERSE[numValue];
        return `leading-${key}`;
      }
      // Fall back to arbitrary decimal value
      const decimalValue = (numValue / 100).toFixed(2).replace(/\.?0+$/, "");
      return `leading-[${decimalValue}]`;
    }
    case "letterSpacing": {
      const numValue = Number(value);
      // Check if it matches a standard tailwind named class
      if (numValue in TRACKING_REVERSE) {
        return `tracking-${TRACKING_REVERSE[numValue]}`;
      }
      return `tracking-[${numValue}em]`;
    }
    case "wordSpacing":
      return `[word-spacing:${value}em]`;
    case "fontStyle":
      return value === "italic" ? "italic" : null;
    case "textDecoration":
      if (value === "underline") return "underline";
      if (value === "line-through") return "line-through";
      return null;
    case "fontFamily": {
      // Check if it's a theme token (sans, serif, mono, heading)
      if (value in FONT_FAMILY_MAP) return FONT_FAMILY_MAP[value as string];
      // For arbitrary font names: replace spaces with underscores (Tailwind convention)
      // then wrap in brackets with quotes. Tailwind parses font-['Brand_Font'] explicitly as font-family.
      const sanitizedValue = String(value).replace(/\s+/g, "_");
      return `font-['${sanitizedValue}']`;
    }
    case "opacity":
      return `opacity-${Math.round(Number(value))}`;
    case "bgColor": {
      const strValue = String(value);
      // Check if value needs arbitrary value brackets:
      // oklch, hex colors, gradients, CSS variables, rgb, hsl
      const isArbitrary =
        strValue.includes("oklch") ||
        strValue.includes("#") ||
        strValue.includes("gradient") ||
        strValue.includes("var(") ||
        strValue.includes("rgb") ||
        strValue.includes("hsl");
      const baseClass = isArbitrary
        ? `bg-[${strValue.replace(/\s/g, "_")}]`
        : `bg-${strValue}`;
      // Use light: custom variant for light mode, dark: for dark mode
      return mode === "dark" ? `dark:${baseClass}` : `light:${baseClass}`;
    }
    case "textColor": {
      const strValue = String(value);
      // Check if value needs arbitrary value brackets
      const isArbitrary =
        strValue.includes("oklch") ||
        strValue.includes("#") ||
        strValue.includes("gradient") ||
        strValue.includes("var(") ||
        strValue.includes("rgb") ||
        strValue.includes("hsl");
      const baseClass = isArbitrary
        ? `text-[${strValue.replace(/\s/g, "_")}]`
        : `text-${strValue}`;
      return mode === "dark" ? `dark:${baseClass}` : `light:${baseClass}`;
    }
    case "borderColor": {
      const strValue = String(value);
      // Check if value needs arbitrary value brackets
      const isArbitrary =
        strValue.includes("oklch") ||
        strValue.includes("#") ||
        strValue.includes("gradient") ||
        strValue.includes("var(") ||
        strValue.includes("rgb") ||
        strValue.includes("hsl");
      const baseClass = isArbitrary
        ? `border-[${strValue.replace(/\s/g, "_")}]`
        : `border-${strValue}`;
      return mode === "dark" ? `dark:${baseClass}` : `light:${baseClass}`;
    }
    case "boxShadow":
      // boxShadow is NOT stored as a Tailwind class to avoid CSS parsing issues.
      // It's managed via inline styles only. Return null to skip class generation.
      return null;
    default:
      return null;
  }
}

/**
 * Check if a class conflicts with a given property AND belongs to the specified mode.
 * This prevents accidentally deleting the opposite mode's color classes.
 *
 * LOGIC:
 * If we are editing DARK mode, only conflict with existing dark: classes.
 * If we are editing LIGHT mode:
 *   Conflict with 'light:', unprefixed, and arbitrary [oklch/color] classes
 *   Do NOT conflict with dark: classes
 */
export function isConflictingColorClass(
  cls: string,
  property: StyleProperty,
  mode: "light" | "dark" = "light"
): boolean {
  // Only applies to color properties
  if (!["bgColor", "textColor", "borderColor"].includes(property)) {
    return false;
  }

  const isDarkClass = cls.startsWith("dark:");

  // LOGIC:
  // If we are editing DARK mode, only conflict with existing dark: classes.
  if (mode === "dark") {
    if (!isDarkClass) return false;
  }

  // If we are editing LIGHT mode:
  // Conflict with 'light:', arbitrary [:root…] selectors and unprefixed
  // classes (plain bg-white).
  if (mode === "light") {
    if (isDarkClass) return false;
  }

  // Use the exact-match form with a single-element array
  return getConflictingClasses(property, [cls]).length > 0;
}

/** Classes that conflict with a given property (to remove before adding new one) */
const DISPLAY_CLASSES = new Set([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "flow-root",
  "contents",
  "table",
]);

export function getConflictingClasses(
  property: StyleProperty,
  existingClasses: string[]
): string[] {
  // For each property we know exactly which classes are valid for it.
  // We match by exact utility (after stripping variant prefixes) against a
  // known-good set, eliminating regex false-positives on custom utilities.
  switch (property) {
    case "paddingAll":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^p-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "paddingX":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^px-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "paddingY":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^py-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "paddingTop":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^pt-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "paddingRight":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^pr-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "paddingBottom":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^pb-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "paddingLeft":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^pl-(\d+(?:\.\d+)?|px)$/.test(u);
      });
    case "marginAll":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^m-(\d+(?:\.\d+)?|px|-\d+)$/.test(u);
      });
    case "marginX":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^mx-(\d+(?:\.\d+)?|px|-\d+)$/.test(u);
      });
    case "marginY":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^my-(\d+(?:\.\d+)?|px|-\d+)$/.test(u);
      });
    case "marginTop":
    case "marginRight":
    case "marginBottom":
    case "marginLeft": {
      const side = {
        marginTop: "t",
        marginRight: "r",
        marginBottom: "b",
        marginLeft: "l",
      }[property];
      const re = new RegExp(`^m${side}-(\\d+(?:\\.\\d+)?|px)$`);
      return existingClasses.filter((c) => re.test(stripVariantPrefixes(c)));
    }
    case "gap":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^gap-(\d+(?:\.\d+)?)$/.test(u);
      });
    case "display":
      // Only unprefixed classes: responsive/state variants such as
      // `hidden md:flex` describe other breakpoints and must survive.
      return existingClasses.filter((c) => DISPLAY_CLASSES.has(c));
    case "flexDirection":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return u === "flex-row" || u === "flex-col";
      });
    case "alignItems":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^items-(start|end|center|baseline|stretch)$/.test(u);
      });
    case "justifyContent":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^justify-(start|end|center|between|around|evenly|stretch|normal)$/.test(
          u
        );
      });
    case "borderRadius":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          u === "rounded" ||
          u === "rounded-none" ||
          u === "rounded-sm" ||
          u === "rounded-md" ||
          u === "rounded-lg" ||
          u === "rounded-xl" ||
          u === "rounded-2xl" ||
          u === "rounded-3xl" ||
          u === "rounded-full" ||
          /^rounded-\[[\d.]+(?:px|rem|em|%)\]$/.test(u)
        );
      });
    case "borderWidth":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          u === "border" ||
          u === "border-0" ||
          u === "border-2" ||
          u === "border-4" ||
          u === "border-8" ||
          /^border-\[[\d.]+px\]$/.test(u)
        );
      });
    case "fontSize":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/.test(u) ||
          /^text-\[[\d.]+px\]$/.test(u) ||
          SCALED_FONT_SIZE.test(u) ||
          /^\[font-size:.+\]$/.test(u)
        );
      });
    case "fontWeight":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(
            u
          ) ||
          /^font-\[\d+\]$/.test(u) ||
          /^\[font-weight:.+\]$/.test(u)
        );
      });
    case "textAlign":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^text-(left|center|right|justify)$/.test(u);
      });
    case "lineHeight":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          /^leading-(3|4|5|6|7|8|9|10|none|tight|snug|normal|relaxed|loose)$/.test(
            u
          ) ||
          /^leading-\[[\d.]+\]$/.test(u) ||
          /^\[line-height:.+\]$/.test(u)
        );
      });
    case "letterSpacing":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          /^tracking-(tighter|tight|normal|wide|wider|widest)$/.test(u) ||
          /^tracking-\[-?[\d.]+em\]$/.test(u) ||
          /^\[letter-spacing:.+\]$/.test(u)
        );
      });
    case "wordSpacing":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^\[word-spacing:.+\]$/.test(u);
      });
    case "fontStyle":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          u === "italic" || u === "not-italic" || /^\[font-style:.+\]$/.test(u)
        );
      });
    case "textDecoration":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          u === "underline" ||
          u === "line-through" ||
          u === "no-underline" ||
          /^\[text-decoration:.+\]$/.test(u)
        );
      });
    case "fontFamily":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return (
          u === "font-sans" ||
          u === "font-serif" ||
          u === "font-mono" ||
          u === "font-heading" ||
          // Arbitrary font: font-['Brand_Name'] or font-[Brand_Name]
          (/^font-\[(?:'[^']*'|[^\]]*)\]$/.test(u) &&
            !/^font-\[\d+\]$/.test(u)) ||
          /^\[font-family:.+\]$/.test(u)
        );
      });
    case "opacity":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        return /^opacity-\d+$/.test(u);
      });
    case "bgColor":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        // Match bg-* but NOT bg-gradient-* (those are handled separately)
        return /^bg-(?!gradient-)/.test(u);
      });
    case "textColor":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        // Arbitrary CSS-property colour form emitted by the rich-text editor.
        if (/^\[color:.+\]$/.test(u)) return true;
        // text-* but NOT size or alignment modifiers
        if (!/^text-/.test(u)) return false;
        const suffix = u.slice(5);
        if (
          suffix === "xs" ||
          suffix === "sm" ||
          suffix === "base" ||
          suffix === "lg" ||
          suffix === "xl" ||
          suffix === "2xl" ||
          suffix === "3xl" ||
          suffix === "4xl" ||
          suffix === "5xl" ||
          suffix === "6xl" ||
          suffix === "7xl" ||
          suffix === "8xl" ||
          suffix === "9xl" ||
          suffix === "left" ||
          suffix === "center" ||
          suffix === "right" ||
          suffix === "justify"
        )
          return false;
        if (/^\[[\d.]+px\]$/.test(suffix)) return false; // arbitrary size
        if (suffix.startsWith("[length:")) return false; // scaled size
        return true;
      });
    case "borderColor":
      return existingClasses.filter((c) => {
        const u = stripVariantPrefixes(c);
        if (!/^border-/.test(u)) return false;
        const suffix = u.slice(7);
        // Exclude width utilities: border-0, border-2, border-4, border-8, border-[Npx]
        if (/^\d+$/.test(suffix) || /^\[[\d.]+px\]$/.test(suffix)) return false;
        return true;
      });
    case "boxShadow":
      // boxShadow is not stored as a Tailwind class, so no conflicts to check
      return [];
    default:
      return [];
  }
}

/** Convert a StyleProperty to a CSS property string for live injection */
export function stylePropertyToCss(
  property: StyleProperty,
  value: number | string
): string {
  switch (property) {
    case "paddingAll":
      return `padding: ${value}px !important;`;
    case "paddingX":
      return `padding-left: ${value}px !important; padding-right: ${value}px !important;`;
    case "paddingY":
      return `padding-top: ${value}px !important; padding-bottom: ${value}px !important;`;
    case "paddingTop":
      return `padding-top: ${value}px !important;`;
    case "paddingRight":
      return `padding-right: ${value}px !important;`;
    case "paddingBottom":
      return `padding-bottom: ${value}px !important;`;
    case "paddingLeft":
      return `padding-left: ${value}px !important;`;
    case "marginAll":
      return `margin: ${value}px !important;`;
    case "marginX":
      return `margin-left: ${value}px !important; margin-right: ${value}px !important;`;
    case "marginY":
      return `margin-top: ${value}px !important; margin-bottom: ${value}px !important;`;
    case "marginTop":
      return `margin-top: ${value}px !important;`;
    case "marginRight":
      return `margin-right: ${value}px !important;`;
    case "marginBottom":
      return `margin-bottom: ${value}px !important;`;
    case "marginLeft":
      return `margin-left: ${value}px !important;`;
    case "gap":
      return `gap: ${value}px !important;`;
    case "display":
      return `display: ${value} !important;`;
    // The panel only shows these on flex/grid containers, so the preview must
    // not force `display: flex` (that would turn a grid into a flexbox).
    case "flexDirection":
      return `flex-direction: ${value === "col" ? "column" : "row"} !important;`;
    case "alignItems":
      return `align-items: ${value} !important;`;
    case "justifyContent": {
      // Tailwind's justify-between etc. map to CSS space-between etc.
      const css = ["between", "around", "evenly"].includes(String(value))
        ? `space-${value}`
        : value;
      return `justify-content: ${css} !important;`;
    }
    case "borderRadius":
      return `border-radius: ${value}px !important;`;
    case "smoothing":
      return `--smoothing: ${value} !important; corner-shape: superellipse(calc(1 + ${value} / 100)) !important;`;
    case "borderWidth":
      return `border-width: ${value}px !important;`;
    case "fontSize":
      return `font-size: ${value}px !important;`;
    case "fontWeight":
      return `font-weight: ${value} !important;`;
    case "textAlign":
      return `text-align: ${value} !important;`;
    case "lineHeight":
      return `line-height: ${Number(value) / 100} !important;`;
    case "letterSpacing":
      return `letter-spacing: ${value}em !important;`;
    case "wordSpacing":
      return `word-spacing: ${value}em !important;`;
    case "fontStyle":
      return `font-style: ${value} !important;`;
    case "textDecoration":
      return `text-decoration: ${value === "none" ? "none" : value} !important;`;
    case "fontFamily": {
      if (value === "sans") return `font-family: var(--font-sans) !important;`;
      if (value === "serif")
        return `font-family: var(--font-serif) !important;`;
      if (value === "mono") return `font-family: var(--font-mono) !important;`;
      if (value === "heading")
        return `font-family: var(--font-heading) !important;`;
      return `font-family: '${value}' !important;`;
    }
    case "opacity":
      return `opacity: ${Number(value) / 100} !important;`;
    case "bgColor": {
      const strValue = String(value);
      if (isGradientValue(strValue)) {
        // Gradient background: apply proper origin, clip, and repeat to prevent tiling
        return `background-image: ${strValue} !important; background-origin: border-box !important; background-clip: border-box !important; background-repeat: no-repeat !important;`;
      }
      // Solid color background
      return `background: ${strValue} !important;`;
    }
    case "textColor":
      return `color: ${value} !important;`;
    case "borderColor": {
      const strValue = String(value);
      if (isGradientValue(strValue)) {
        // The component uses a ::after pseudo-element with --luova-border-light/dark
        // CSS vars (via the luova-border-themed utility class). During live drag we
        // update those same vars so the existing pseudo-element updates in place —
        // no second border, border-radius preserved.
        // We return a sentinel that buildCss in use-captured-styles handles specially.
        return `--luova-border-live: ${strValue};`;
      }
      return `border-color: ${value} !important;`;
    }
    case "boxShadow":
      return `box-shadow: ${value} !important;`;
    default:
      return "";
  }
}
