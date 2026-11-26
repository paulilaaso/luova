/**
 * Semantic surface tokens that legitimately belong on a root canvas surface
 * or as text colors. Anything else in a bg-/text- utility on the ROOT element
 * is a literal/authored color (black, white, hex, palette shade, arbitrary
 * value) and maps to the theme canvas tokens. This allowlist is stable —
 * it never names palette shades (zinc, gray, …), so it generalizes across
 * all model outputs.
 */
const SEMANTIC_BG_PREFIXES = [
  "bg-background",
  "bg-foreground",
  "bg-card",
  "bg-popover",
  "bg-muted",
  "bg-primary",
  "bg-secondary",
  "bg-accent",
  "bg-destructive",
  "bg-border",
  "bg-input",
  "bg-ring",
  "bg-chart-",
  "bg-sidebar",
  "bg-selection",
  "bg-surface",
  "bg-transparent",
  "bg-current",
  "bg-inherit",
];

const SEMANTIC_TEXT_VALUES = new Set([
  // sizes — never colors
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

const SEMANTIC_TEXT_PREFIXES = [
  "text-foreground",
  "text-background",
  "text-card",
  "text-popover",
  "text-muted",
  "text-primary",
  "text-secondary",
  "text-accent",
  "text-destructive",
  "text-border",
  "text-input",
  "text-ring",
  "text-chart-",
  "text-sidebar",
  "text-selection",
  "text-surface",
  "text-transparent",
  "text-current",
  "text-inherit",
];

function isSemanticBg(token: string): boolean {
  // Exact bg-background stays; opacity modifiers (bg-card/50) also stay.
  return SEMANTIC_BG_PREFIXES.some(
    (p) => token === p || token.startsWith(`${p}/`) || token.startsWith(`${p}-`)
  );
}

function isSemanticText(token: string): boolean {
  const base = token.split("/")[0];
  const value = base.slice("text-".length);
  if (SEMANTIC_TEXT_VALUES.has(value)) return true;
  return SEMANTIC_TEXT_PREFIXES.some(
    (p) => token === p || token.startsWith(`${p}/`) || token.startsWith(`${p}-`)
  );
}

/**
 * Normalizes ONLY the root container's surface structurally:
 * - any non-semantic bg-* → bg-background
 * - any non-semantic text-* color → text-foreground (sizes preserved)
 * - orphaned gradient stops (from-/via-/to- utilities) removed on root
 *   only, since the root no longer hosts a literal gradient
 * Roots without authored backgrounds are left alone (transparent layout
 * helpers and semantic surfaces like bg-primary buttons pass through),
 * and inner elements are never touched, so cards, pills, badges, and
 * multi-stop gradients keep their authored colors intact.
 */
function normalizeRootSurface(classList: string): string {
  const tokens = classList.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let replacedBg = false;

  for (const token of tokens) {
    // Strip variant prefixes for classification (hover:bg-… counts as bg).
    const core = token.includes(":")
      ? token.slice(token.lastIndexOf(":") + 1)
      : token;
    const prefix = token.slice(0, token.length - core.length);

    if (core.startsWith("bg-")) {
      if (isSemanticBg(core)) {
        out.push(token);
      } else {
        // Non-semantic authored background → theme canvas token,
        // preserving any variant prefix (e.g. dark:bg-black).
        out.push(`${prefix}bg-background`);
        replacedBg = true;
      }
      continue;
    }
    if (core.startsWith("text-")) {
      const bare = core.split("/")[0].slice("text-".length);
      // text sizes are not colors — always keep.
      if (SEMANTIC_TEXT_VALUES.has(bare)) {
        out.push(token);
        continue;
      }
      if (isSemanticText(core)) {
        out.push(token);
      } else {
        out.push(`${prefix}text-foreground`);
      }
      continue;
    }
    // Orphaned gradient stops on the root are only meaningful with a
    // literal gradient background — drop them once the root maps to
    // bg-background to avoid `from-… to-…` with no gradient host.
    if (
      (core.startsWith("from-") ||
        core.startsWith("via-") ||
        core.startsWith("to-") ||
        core.startsWith("bg-gradient-")) &&
      replacedBg
    ) {
      continue;
    }
    // Lazily drop stops when we later discover the bg was replaced:
    // handled in the second pass below.
    out.push(token);
  }

  let classes = out.join(" ");

  // If bg was replaced, purge any gradient stops that preceded it.
  if (replacedBg) {
    classes = classes
      .split(/\s+/)
      .filter((t) => {
        const core = t.includes(":") ? t.slice(t.lastIndexOf(":") + 1) : t;
        return !(
          core.startsWith("from-") ||
          core.startsWith("via-") ||
          core.startsWith("to-") ||
          core.startsWith("bg-gradient-")
        );
      })
      .join(" ");
  }

  // Dedupe repeated canvas tokens introduced by multiple replacements.
  classes = dedupeToken(classes, "bg-background");
  classes = dedupeToken(classes, "text-foreground");

  return classes.replace(/\s+/g, " ").trim();
}

function dedupeToken(classList: string, token: string): string {
  let seen = false;
  return classList
    .split(/\s+/)
    .filter((t) => {
      const core = t.includes(":") ? t.slice(t.lastIndexOf(":") + 1) : t;
      if (core === token || core === `${token}/`) {
        if (seen) return false;
        seen = true;
      }
      // Collapse variant-prefixed duplicates too (dark:bg-background x2).
      if (t.endsWith(`:${token}`)) {
        if (seen) return false;
        seen = true;
      }
      return true;
    })
    .join(" ");
}

// Matches the first className attribute (quoted or JSX-expression wrapped).
// The first className in a component file belongs to the root element.
const FIRST_CLASSNAME_RE =
  /className=\s*(?:\{\s*)?(["'`])((?:(?!\1).)*?)\1(?:\s*\})?/s;

/**
 * Matches arbitrary pixel/rem font-size classes like text-[10px], text-[1.2rem], text-[0.75em].
 * These bypass the global font-size scale and should be replaced with the nearest named step.
 */
const _ARBITRARY_FONT_SIZE_RE = /\btext-\[\d+(\.\d+)?(px|rem|em)\]/g;

const FONT_SIZE_REPLACEMENTS: [RegExp, string][] = [
  // ≤ 10px → text-xs (0.75rem / 12px)
  [/\btext-\[([0-9](\.[0-9]+)?px|0\.[0-6]\d*rem|0\.[0-6]\d*em)\]/g, "text-xs"],
  // 11–12px → text-xs
  [/\btext-\[(1[01](\.\d+)?px|0\.6[5-9]\d*rem|0\.7[0-4]\d*rem)\]/g, "text-xs"],
  // 13–14px → text-sm (0.875rem / 14px)
  [/\btext-\[(1[234](\.\d+)?px|0\.7[5-9]\d*rem|0\.8[0-7]\d*rem)\]/g, "text-sm"],
  // 15–16px → text-base (1rem / 16px)
  [
    /\btext-\[(1[56](\.\d+)?px|0\.8[89]\d*rem|0\.9\d*rem|1(\.0+)?rem)\]/g,
    "text-base",
  ],
  // 17–20px → text-lg (1.125rem / 18px)
  [/\btext-\[(1[789](\.\d+)?px|20px|1\.[01]\d*rem)\]/g, "text-lg"],
  // 21–24px → text-xl (1.25rem / 20px)
  [/\btext-\[(2[0-4](\.\d+)?px|1\.[2-4]\d*rem)\]/g, "text-xl"],
  // 25–30px → text-2xl (1.5rem / 24px)
  [/\btext-\[(2[5-9](\.\d+)?px|30px|1\.[5-9]\d*rem)\]/g, "text-2xl"],
  // 31–36px → text-3xl (1.875rem / 30px)
  [/\btext-\[(3[0-6](\.\d+)?px|[12]\.\d*rem)\]/g, "text-3xl"],
  // REMOVED: Catch-all for arbitrary font sizes was here
  // Preserving arbitrary font sizes like text-[109px] to maintain visual fidelity during Bake/Edit operations
];

/**
 * Replaces sized shadow variants (shadow-sm, shadow-md, shadow-lg, shadow-xl, shadow-2xl, etc.)
 * with plain `shadow`, which directly references var(--shadow-default) and responds to the
 * global shadow adjustment. shadow-none and shadow-inner are preserved.
 */
const SIZED_SHADOW_RE = /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b/g;

/**
 * Normalizes component code structurally without deleting color utilities.
 * Never punches holes in class lists by erasing palette/hex/arbitrary
 * colors — Tailwind v4 compiles the full spectrum, and deletion only
 * produces transparent cards, unreadable subtitles, and orphaned gradient
 * stops. The single structural rule: the outermost container represents
 * the canvas surface, so its background/text map to theme tokens.
 */
export function cleanComponentCode(code: string): string {
  let result = code;

  // 1. Structural rule: root element background & text use theme canvas tokens.
  // Only the FIRST className (the root container) is normalized; all inner
  // elements — cards, pills, badges, gradients — are preserved verbatim.
  // Only full component files (with a return/rendered root) are rewritten;
  // bare snippets without a return statement pass through untouched so
  // isolated utilities (e.g. bg-transparent layout helpers) are preserved.
  const hasRootComponent =
    /\breturn\b[\s\S]*?<\w+[^>]*className=/.test(result) ||
    /export\s+default\b[\s\S]*?<\w+[^>]*className=/.test(result);
  if (hasRootComponent) {
    result = result.replace(
      FIRST_CLASSNAME_RE,
      (match, quote: string, classList: string) => {
        const normalized = normalizeRootSurface(classList);
        // Preserve the original JSX wrapping ({'…'} vs "…").
        if (match.includes("{")) {
          return match.replace(
            `${quote}${classList}${quote}`,
            `${quote}${normalized}${quote}`
          );
        }
        return `className=${quote}${normalized}${quote}`;
      }
    );
  }

  // 2. Normalize font sizes to named scale
  for (const [pattern, replacement] of FONT_SIZE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  // 3. Normalize shadow sizes to standard theme shadow token
  result = result.replace(SIZED_SHADOW_RE, "shadow");

  // 4. Collapse duplicate whitespace inside every className attribute
  // (covers "...", '...', `...`, and {"..."} forms) without touching code.
  result = result.replace(
    /className=\s*(?:\{\s*)?(["'`])((?:(?!\1).)*?)\1(?:\s*\})?/gs,
    (match, quote: string, classes: string) => {
      const collapsed = classes.replace(/\s+/g, " ").trim();
      if (match.includes("{")) {
        return match.replace(
          `${quote}${classes}${quote}`,
          `${quote}${collapsed}${quote}`
        );
      }
      return `className=${quote}${collapsed}${quote}`;
    }
  );

  return result;
}
