import { idbGetAsset } from "@/lib/asset-idb";
import type { FontCategory, FontInfo } from "@/types/fonts";
import type { CustomFont } from "@/types/theme";
import { resolveAssetToBlobUrl } from "@/utils/asset-manager";

// Track custom font family names to skip Google Fonts API lookup
const registeredCustomFonts = new Set<string>();

const FONT_LINK_ID = "luova-google-fonts";

// Font families in the consolidated theme link
const activeGoogleFonts = new Set<string>();
// All fonts loaded by either mechanism (prevents duplicates)
const loadedGoogleFonts = new Set<string>();

let lastUrl: string | null = null;

function buildGoogleFontsUrl(): string | null {
  if (activeGoogleFonts.size === 0) return null;
  const entries: string[] = [];
  for (const family of activeGoogleFonts) {
    const encoded = encodeURIComponent(family).replace(/%20/g, "+");
    entries.push(`family=${encoded}:wght@400;600;700`);
  }
  return `https://fonts.googleapis.com/css2?${entries.join("&")}&display=swap`;
}

/**
 * Update the consolidated theme-fonts `<link>` element. Rewriting this
 * link's `href` triggers a browser stylesheet reload for ALL fonts in
 * it, so this is only used for theme-driven batch updates.
 */
function updateGoogleFontsLink(): void {
  if (typeof document === "undefined") return;
  const url = buildGoogleFontsUrl();
  const existing = document.getElementById(
    FONT_LINK_ID
  ) as HTMLLinkElement | null;

  if (!url) {
    if (existing) existing.remove();
    lastUrl = null;
    return;
  }

  if (existing && existing.href === url) return;
  if (!existing && lastUrl === url) return;
  lastUrl = url;

  if (existing) {
    existing.href = url;
  } else {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = FONT_LINK_ID;
    link.href = url;
    document.head.appendChild(link);
  }
}

/**
 * Register custom fonts so they're not fetched from Google Fonts.
 */
/**
 * @internal — only exported for testing. Resets the consolidated font link
 * so the next call to loadGoogleFont / loadGoogleFonts will create a fresh
 * `<link>` element. Custom-font registrations are NOT cleared.
 */
export function __resetGoogleFontsCache(): void {
  activeGoogleFonts.clear();
  loadedGoogleFonts.clear();
  lastUrl = null;
  const existing =
    typeof document !== "undefined"
      ? (document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null)
      : null;
  if (existing) existing.remove();
  // Remove individually injected link elements too
  if (typeof document !== "undefined") {
    document
      .querySelectorAll(`link[href*="fonts.googleapis.com"]`)
      .forEach((el) => {
        if (el.id !== FONT_LINK_ID) el.remove();
      });
  }
}

/**
 * Register custom fonts so they're not fetched from Google Fonts.
 */
export function registerCustomFont(family: string): void {
  registeredCustomFonts.add(family.toLowerCase());
}

// Fallback fonts if the JSON file doesn't exist
// Must be in Sync with the Built-in Fonts
export const FALLBACK_FONTS: FontInfo[] = [
  // Sans Serif fonts
  {
    family: "Inter",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Roboto",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Open Sans",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Poppins",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Montserrat",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Outfit",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Plus Jakarta Sans",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "DM Sans",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Geist",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Oxanium",
    category: "sans-serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Architects Daughter",
    category: "handwriting",
    variants: ["400", "600", "700"],
    variable: false,
  },
  // Serif fonts
  {
    family: "Merriweather",
    category: "serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Playfair Display",
    category: "serif",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Lora",
    category: "serif",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Source Serif Pro",
    category: "serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Libre Baskerville",
    category: "serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Space Grotesk",
    category: "serif",
    variants: ["400", "600", "700"],
    variable: false,
  },
  // Monospace fonts
  {
    family: "JetBrains Mono",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Fira Code",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: true,
  },
  {
    family: "Source Code Pro",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "IBM Plex Mono",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Roboto Mono",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Space Mono",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: false,
  },
  {
    family: "Geist Mono",
    category: "monospace",
    variants: ["400", "600", "700"],
    variable: true,
  },
];

// Build font-family value for CSS
// e.g., font: "Inter", category: "sans-serif" -> "Inter, ui-sans-serif, system-ui, sans-serif"
export function buildFontFamily(
  fontFamily: string,
  category: FontCategory
): string {
  const safeFamily = fontFamily.includes(" ") ? `"${fontFamily}"` : fontFamily;
  return `${safeFamily}, ${SYSTEM_FONTS_FALLBACKS[category]}`;
}

// Extract font family name from CSS font-family value
// e.g., "Inter, ui-sans-serif, system-ui, sans-serif" -> "Inter"
export function extractFontFamily(fontFamilyValue: string): string | null {
  if (!fontFamilyValue) return null;

  // Split by comma and get the first font
  const firstFont = fontFamilyValue.split(",")[0].trim();

  // Strip all single and double quotes aggressively. This fixes issues
  // where the AI accidentally surrounds the font name in extra quotes.
  const cleanFont = firstFont.replace(/['"]/g, "").trim();

  // Skip system fonts, empty strings, and CSS variables
  if (
    !cleanFont ||
    cleanFont.startsWith("var(") ||
    SYSTEM_FONTS.includes(cleanFont.toLowerCase())
  ) {
    return null;
  }

  return cleanFont;
}

// The weights the font links request by default.
const DEFAULT_LOADED_WEIGHTS = [400, 600, 700];

function isGoogleFontCandidate(family: string | undefined): family is string {
  if (!family) return false;
  const key = family.toLowerCase();
  return !SYSTEM_FONTS.includes(key) && !registeredCustomFonts.has(key);
}

const fontWeightsCache = new Map<string, Promise<number[] | null>>();

/**
 * The weights a Google font family ships (e.g. Lobster → [400],
 * Oswald → [200…700]). Resolves to null when the family isn't a Google font
 * or the lookup failed — callers then fall back to the full weight scale.
 */
export function fetchGoogleFontWeights(
  family: string | undefined
): Promise<number[] | null> {
  if (!isGoogleFontCandidate(family)) return Promise.resolve(null);
  const key = family.toLowerCase();
  const cached = fontWeightsCache.get(key);
  if (cached) return cached;

  const request = fetch(
    `/api/google-fonts?family=${encodeURIComponent(family)}&limit=1`
  )
    .then((res) => {
      if (!res.ok) throw new Error(`Font lookup failed: ${res.status}`);
      return res.json() as Promise<{ fonts?: FontInfo[] }>;
    })
    .then((data) => {
      const font = data.fonts?.[0];
      if (!font) return null;
      const weights = [...new Set(font.variants.map(Number))]
        .filter((w) => Number.isFinite(w))
        .sort((a, b) => a - b);
      return weights.length > 0 ? weights : null;
    })
    .catch(() => {
      // Don't remember a network failure; try again next time.
      fontWeightsCache.delete(key);
      return null;
    });
  fontWeightsCache.set(key, request);
  return request;
}

// Families whose full weight range has been requested
const allWeightsRequested = new Set<string>();

/**
 * The font links only request 400/600/700. Look up which weights the family
 * really has and, if it has others (Light 300, Black 900…), add a link that
 * loads all of them so every weight the panel offers actually renders.
 */
function loadAllGoogleFontWeights(family: string): void {
  if (allWeightsRequested.has(family)) return;
  allWeightsRequested.add(family);
  fetchGoogleFontWeights(family).then((weights) => {
    if (!weights) {
      allWeightsRequested.delete(family);
      return;
    }
    if (weights.every((w) => DEFAULT_LOADED_WEIGHTS.includes(w))) return;
    const encoded = encodeURIComponent(family).replace(/%20/g, "+");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weights.join(";")}&display=swap`;
    document.head.appendChild(link);
  });
}

/**
 * Add a single font family by injecting an individual `<link>` element.
 * This is used for ad-hoc loading (FontPicker preview, etc.) — adding a
 * new font does NOT rewrite the consolidated theme link, so existing
 * fonts remain uninterrupted.
 *
 * `allWeights` also loads every weight the family has, for fonts that are
 * actually used on the canvas (not for picker previews).
 */
export function loadGoogleFont(
  family: string,
  options?: { allWeights?: boolean }
): void {
  if (typeof document === "undefined") return;
  if (!isGoogleFontCandidate(family)) return;
  if (options?.allWeights) loadAllGoogleFontWeights(family);
  // Already loaded via individual or consolidated link
  if (loadedGoogleFonts.has(family)) return;
  loadedGoogleFonts.add(family);

  const encoded = encodeURIComponent(family).replace(/%20/g, "+");
  const url = `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;600;700&display=swap`;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/**
 * Add multiple font families via the consolidated theme link.
 * Used by `ensureFontsLoaded` when theme styles change — all active
 * theme fonts are batched into a single URL to keep the DOM lean.
 */
export function loadGoogleFonts(families: string[]): void {
  if (typeof document === "undefined") return;
  let added = false;
  for (const family of families) {
    if (!family) continue;
    if (SYSTEM_FONTS.includes(family.toLowerCase())) continue;
    if (registeredCustomFonts.has(family.toLowerCase())) continue;
    loadedGoogleFonts.add(family);
    activeGoogleFonts.add(family);
    loadAllGoogleFontWeights(family);
    added = true;
  }
  if (added) updateGoogleFontsLink();
}

// Track loaded custom fonts to avoid duplicate style tags
const loadedCustomFonts = new Set<string>();

function getFontFormat(extension: string): string {
  const formats: Record<string, string> = {
    woff2: "woff2",
    woff: "woff",
    ttf: "truetype",
    otf: "opentype",
  };
  return formats[extension.toLowerCase()] || "woff2";
}

/**
 * Load custom fonts by injecting @font-face rules into the document.
 * Uses the asset manager to resolve Base64 data to Blob URLs.
 */
export async function loadCustomFont(customFonts: CustomFont[]): Promise<void> {
  if (typeof document === "undefined") return;
  if (!customFonts || customFonts.length === 0) return;

  for (const font of customFonts) {
    if (loadedCustomFonts.has(font.id)) continue;

    // Fetch base64 data from IndexedDB
    const base64Data = await idbGetAsset(font.assetId);
    if (
      !base64Data ||
      typeof base64Data !== "string" ||
      !base64Data.startsWith("data:")
    ) {
      console.warn(`Custom font asset not found or invalid: ${font.assetId}`);
      continue;
    }

    try {
      const blobUrl = await resolveAssetToBlobUrl(font.assetId);
      const format = getFontFormat(font.extension);
      const fontFaceRule = `
        @font-face {
          font-family: '${font.family}';
          src: url('${blobUrl}') format('${format}');
          font-weight: 100 900;
          font-style: normal;
          font-display: swap;
        }
      `.trim();

      // Check if style tag already exists to prevent duplicates
      const existingStyle = document.getElementById(`font-${font.id}`);
      if (existingStyle) {
        existingStyle.remove();
      }

      const style = document.createElement("style");
      style.id = `font-${font.id}`;
      style.textContent = fontFaceRule;
      document.head.appendChild(style);

      loadedCustomFonts.add(font.id);

      // Register custom font to prevent Google Fonts API lookup
      registerCustomFont(font.family);
    } catch (err) {
      console.error(`Failed to load custom font ${font.family}:`, err);
    }
  }
}

export function ensureFontsLoaded(variables: Record<string, string>): void {
  const fontKeys = ["font-sans", "font-serif", "font-mono", "font-heading"];
  const families: string[] = [];
  for (const key of fontKeys) {
    const value = variables[key];
    if (!value) continue;
    const family = extractFontFamily(value);
    if (family) families.push(family);
  }
  if (families.length > 0) loadGoogleFonts(families);
}

export const SYSTEM_FONTS = [
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "system-ui",
  "arial",
  "helvetica",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "times",
  "times new roman",
  "georgia",
  "courier",
  "courier new",
];

// CSS generic families resolve to whatever the OS provides (San Francisco,
// Segoe UI, …) and the browser doesn't expose which one it picked, so show a
// readable label instead of the raw keyword.
const GENERIC_FONT_LABELS: Record<string, string> = {
  "ui-sans-serif": "System Sans",
  "system-ui": "System Sans",
  "sans-serif": "System Sans",
  "ui-serif": "System Serif",
  serif: "System Serif",
  "ui-monospace": "System Mono",
  monospace: "System Mono",
  cursive: "System Cursive",
};

export function getFontDisplayName(family: string): string {
  return GENERIC_FONT_LABELS[family.trim().toLowerCase()] ?? family;
}

export const SYSTEM_FONTS_FALLBACKS = {
  "sans-serif": "ui-sans-serif, sans-serif, system-ui",
  serif: "ui-serif, serif",
  monospace: "ui-monospace, monospace",
  display: "ui-serif, serif",
  handwriting: "cursive",
};
