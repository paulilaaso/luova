import {
  buildDefaultLightTheme,
  COLOR_TOKEN_KEYS,
  COMMON_TOKEN_KEYS,
  DEFAULT_FONT_MONO,
  DEFAULT_FONT_SANS,
  DEFAULT_FONT_SERIF,
  getTokenDefinition,
} from "@/config/theme-tokens";
import type { ColorFormat } from "@/types";
import type { ThemeEditorState } from "@/types/editor";
import type { CustomFont, ThemeStyleProps, ThemeStyles } from "@/types/theme";
import {
  colorFormatter,
  easeGradientCSS,
  isGradientValue,
} from "./color-converter";
import { FALLBACK_FONTS } from "./fonts";
import { getShadowMap } from "./shadows";

export interface ThemeFilter {
  usedComponents?: string[];
  modifiedTokens?: {
    light: Partial<ThemeStyleProps>;
    dark: Partial<ThemeStyleProps>;
  };
}

type ThemeMode = "light" | "dark";

const STRUCTURAL_KEYS = new Set([
  "radius",
  "spacing",
  "smoothing",
  "border-width",
  "font-scale",
  "letter-spacing",
  "font-sans",
  "font-serif",
  "font-mono",
  "font-heading",
  "shadow-groups",
  "global-line-height",
]);

const NON_COLOR_PATTERNS = [
  "-weight",
  "-transform",
  "-tracking",
  "-px",
  "-py",
  "-duration",
  "-timing",
  "-backdrop",
  "-opacity",
  "-filter",
  "-clip",
  "-fill",
  "-stroke",
  "-origin",
  "-width",
  "-style",
  "-radius",
  "-scale",
  "-blur",
  "-spread",
  "-offset",
  "-gap",
  "-padding",
  "-margin",
  "-size",
  "-height",
  "-delay",
  "-smoothing",
];

const NON_COLOR_VALUES = [
  "false",
  "true",
  "none",
  "solid",
  "dashed",
  "dotted",
  "transparent",
];

const SHADOW_NON_COLOR_PROPS = new Set([
  "shadow-inset-enabled",
  "shadow-inset-opacity",
  "shadow-inset-blur",
  "shadow-inset-spread",
  "shadow-inset-offset-x",
  "shadow-inset-offset-y",
]);

function formatColor(value: string, key: string): string {
  if (isGradientValue(value)) return value;
  if (value === "transparent" || value === "none" || value.startsWith("var"))
    return value;

  if (
    SHADOW_NON_COLOR_PROPS.has(key) ||
    NON_COLOR_PATTERNS.some((p) => key.includes(p)) ||
    NON_COLOR_VALUES.includes(value)
  ) {
    return value;
  }

  const token = getTokenDefinition(key);
  const isColor = token?.category === "color" || key.includes("-foreground");

  if (isColor) {
    try {
      return colorFormatter(value, "oklch", "4");
    } catch {
      return value;
    }
  }
  return value;
}

function _toBackgroundLayer(value: string): string {
  // Transparent or none values don't need a gradient layer
  if (value === "transparent" || value === "none") return "none";
  if (isGradientValue(value)) return easeGradientCSS(value);
  return `linear-gradient(${value}, ${value})`;
}

function getFontFormat(extension: string): string {
  const formats: Record<string, string> = {
    woff2: "woff2",
    woff: "woff",
    ttf: "truetype",
    otf: "opentype",
  };
  return formats[extension.toLowerCase()] || "woff2";
}

function generateFontFaceRulesSync(
  customFonts: CustomFont[],
  isExport: boolean = false
): string {
  if (!customFonts || customFonts.length === 0) return "";

  if (!isExport) {
    return "";
  }

  const rules: string[] = [];

  for (const font of customFonts) {
    const fileName = `${font.assetId.replace("asset:", "")}.${font.extension}`;
    const format = getFontFormat(font.extension);
    const src = `url('/fonts/${fileName}') format('${format}')`;

    rules.push(`@font-face {
  font-family: '${font.family}';
  src: ${src};
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}`);
  }

  return rules.join("\n\n");
}

export interface ThemeVariables {
  common: Record<string, string>;
  colors: Record<string, string>;
  shadows: Record<string, string>;
}

const BASE_COLOR_KEYS = COLOR_TOKEN_KEYS;

export function buildThemeVariables(
  themeState: ThemeEditorState,
  mode: ThemeMode,
  options?: {
    formatColor?: (color: string) => string;
    filter?: ThemeFilter;
  }
): ThemeVariables {
  const styles = themeState.styles[mode];
  const colorFormatterFn = options?.formatColor ?? ((c: string) => c);

  const common: Record<string, string> = {};
  const colors: Record<string, string> = {};
  const shadows: Record<string, string> = {};

  // Build shadow map first so we can validate shadow references below
  const shadowMap = getShadowMap(themeState, mode);
  Object.entries(shadowMap).forEach(([name, value]) => {
    shadows[name] = value;
  });

  Object.entries(styles).forEach(([key, value]) => {
    if (typeof value !== "string" || value.trim() === "") return;

    if (key === "shadow-groups") return;

    const normalizedKey = key.startsWith("--") ? key.slice(2) : key;

    if (normalizedKey === "radius-smoothing") return;

    if (STRUCTURAL_KEYS.has(normalizedKey)) {
      return;
    }

    if (
      COMMON_TOKEN_KEYS.includes(
        normalizedKey as (typeof COMMON_TOKEN_KEYS)[number]
      )
    ) {
      common[normalizedKey] = value;
      return;
    }

    if (
      BASE_COLOR_KEYS.includes(
        normalizedKey as (typeof BASE_COLOR_KEYS)[number]
      )
    ) {
      colors[normalizedKey] = colorFormatterFn(value);
      return;
    }

    const formatted = formatColor(value, normalizedKey);
    common[normalizedKey] = formatted;
  });

  return { common, colors, shadows };
}

function _variablesToCSS(
  vars: Record<string, string>,
  indent: string = "  "
): string {
  return Object.entries(vars)
    .map(([key, value]) => `${indent}--${key}: ${value};`)
    .join("\n");
}

type CSSDeclaration = Record<string, string | number | undefined>;

interface CSSRule {
  selector: string;
  declarations: CSSDeclaration;
}

function serializeRules(rules: CSSRule[], indent: string = "  "): string {
  return rules
    .map((r) => {
      const decls = Object.entries(r.declarations)
        .filter(([, v]) => v !== undefined && v !== "" && v !== null)
        .map(([k, v]) => `${indent}${k}: ${v};`)
        .join("\n");
      if (!decls) return "";
      return `${r.selector} {\n${decls}\n}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function toVariables(vars: Record<string, string>): CSSDeclaration {
  const decls: CSSDeclaration = {};
  for (const [k, v] of Object.entries(vars)) {
    decls[`--${k}`] = v;
  }
  return decls;
}

function getSharedDeclarations(themeState: ThemeEditorState): CSSDeclaration {
  const light = themeState.styles.light;
  const radius = light.radius || "0.625rem";
  const spacing = light.spacing || "0.25rem";
  const borderWidth = light["border-width"] || "1px";
  const smoothing = light.smoothing || "0";
  const fontScale = light["font-scale"] || "1";
  const letterSpacing = light["letter-spacing"] || "0em";
  return {
    "--radius": radius,
    "--radius-sm": "calc(var(--radius) * 0.6)",
    "--radius-md": "calc(var(--radius) * 0.8)",
    "--radius-lg": "var(--radius)",
    "--radius-xl": "calc(var(--radius) * 1.4)",
    "--radius-2xl": "calc(var(--radius) * 1.8)",
    "--radius-3xl": "calc(var(--radius) * 2.2)",
    "--radius-4xl": "calc(var(--radius) * 2.6)",
    "--spacing": spacing,
    "--border-width": borderWidth,
    "--smoothing": smoothing,
    "--font-scale": fontScale,
    "--letter-spacing": letterSpacing,
    "--font-sans": light["font-sans"] || DEFAULT_FONT_SANS,
    "--font-serif": light["font-serif"] || DEFAULT_FONT_SERIF,
    "--font-mono": light["font-mono"] || DEFAULT_FONT_MONO,
    "--font-heading": light["font-heading"] || "var(--font-sans)",
    "--shadow-2xs": "var(--shadow-extra-small, var(--shadow-default))",
    "--shadow-xs": "var(--shadow-extra_small, var(--shadow-default))",
    "--shadow-sm": "var(--shadow-small, var(--shadow-default))",
    "--shadow": "var(--shadow-default)",
    "--shadow-md": "var(--shadow-medium, var(--shadow-default))",
    "--shadow-lg": "var(--shadow-large, var(--shadow-default))",
    "--shadow-xl": "var(--shadow-extra_large, var(--shadow-default))",
    "--shadow-2xl": "var(--shadow-extra_large, var(--shadow-default))",
  };
}

function getTypographyDeclarations(
  fontScale: string | number,
  letterSpacing: string
): CSSDeclaration {
  return {
    "--text-xs": `calc(0.75rem * ${fontScale})`,
    "--text-sm": `calc(0.875rem * ${fontScale})`,
    "--text-base": `calc(1rem * ${fontScale})`,
    "--text-lg": `calc(1.125rem * ${fontScale})`,
    "--text-xl": `calc(1.25rem * ${fontScale})`,
    "--text-2xl": `calc(1.5rem * ${fontScale})`,
    "--text-3xl": `calc(1.875rem * ${fontScale})`,
    "--text-4xl": `calc(2.25rem * ${fontScale})`,
    "--text-5xl": `calc(3rem * ${fontScale})`,
    "--text-6xl": `calc(3.75rem * ${fontScale})`,
    "--text-7xl": `calc(4.5rem * ${fontScale})`,
    "--text-8xl": `calc(6rem * ${fontScale})`,
    "--text-9xl": `calc(8rem * ${fontScale})`,
    "--tracking-tighter": `calc(${letterSpacing} - 0.05em)`,
    "--tracking-tight": `calc(${letterSpacing} - 0.025em)`,
    "--tracking-normal": letterSpacing,
    "--tracking-wide": `calc(${letterSpacing} + 0.025em)`,
    "--tracking-wider": `calc(${letterSpacing} + 0.05em)`,
    "--tracking-widest": `calc(${letterSpacing} + 0.1em)`,
  };
}

export function generateThemeCSS(themeState: ThemeEditorState): string {
  const { styles } = themeState;

  const lightVars = buildThemeVariables(
    { ...themeState, currentMode: "light" },
    "light"
  );
  const darkVars = buildThemeVariables(
    { ...themeState, currentMode: "dark" },
    "dark"
  );

  const sharedDecls = getSharedDeclarations(themeState);
  const fs = styles.light["font-scale"] || "1";
  const ls = styles.light["letter-spacing"] || "0em";
  const globalLineHeight = styles.light["global-line-height"] || "1";

  const rules: CSSRule[] = [
    {
      selector: ":root",
      declarations: sharedDecls,
    },
    {
      selector: ":root:not(.dark)",
      declarations: {
        ...toVariables(lightVars.common),
        ...toVariables(lightVars.colors),
        ...toVariables(lightVars.shadows),
      },
    },
    {
      selector: ".dark",
      declarations: {
        ...toVariables(darkVars.common),
        ...toVariables(darkVars.colors),
        ...toVariables(darkVars.shadows),
      },
    },
    {
      selector: '[data-canvas="true"], [data-canvas-container="true"]',
      declarations: {
        "--font-scale": fs,
        "--letter-spacing": ls,
        ...getTypographyDeclarations(
          `var(--font-scale, ${fs})`,
          `var(--letter-spacing, ${ls})`
        ),
      },
    },
  ];

  const css = serializeRules(rules);

  return `${css}

body {
  letter-spacing: var(--letter-spacing, 0em);
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  line-height: var(--global-line-height, ${globalLineHeight});
}

[data-canvas="true"], [data-canvas-container="true"] {
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  line-height: var(--global-line-height, ${globalLineHeight});
}`;
}

const TAILWIND_COLOR_BRIDGE_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "surface",
  "surface-foreground",
  "code",
  "code-foreground",
  "code-highlight",
  "code-number",
  "selection",
  "selection-foreground",
] as const;

export function generateThemeCSSScoped(
  themeState: ThemeEditorState,
  selector: string
): string {
  const { styles } = themeState;

  const lightVars = buildThemeVariables(
    { ...themeState, currentMode: "light" },
    "light"
  );
  const darkVars = buildThemeVariables(
    { ...themeState, currentMode: "dark" },
    "dark"
  );

  const sharedDecls = getSharedDeclarations(themeState);
  const fs = styles.light["font-scale"] || "1";
  const ls = styles.light["letter-spacing"] || "0em";

  const bridgeDecls: CSSDeclaration = {};
  TAILWIND_COLOR_BRIDGE_KEYS.forEach((k) => {
    bridgeDecls[`--color-${k}`] = `var(--${k})`;
  });

  const rules: CSSRule[] = [
    {
      selector,
      declarations: {
        ...sharedDecls,
      },
    },
    {
      selector: `${selector}:not(.dark)`,
      declarations: {
        ...toVariables(lightVars.common),
        ...toVariables(lightVars.colors),
        ...toVariables(lightVars.shadows),
        ...bridgeDecls,
      },
    },
    {
      selector: `.dark ${selector}`,
      declarations: {
        ...toVariables(darkVars.common),
        ...toVariables(darkVars.colors),
        ...toVariables(darkVars.shadows),
        ...bridgeDecls,
      },
    },
    {
      selector,
      declarations: {
        ...getTypographyDeclarations(
          `var(--font-scale, ${fs})`,
          `var(--letter-spacing, ${ls})`
        ),
      },
    },
  ];

  // Inherited text properties go in the base layer so utility classes on
  // the same element (`font-mono`, `tracking-wide`) still win.
  const textRules = serializeRules([
    {
      selector,
      declarations: {
        "letter-spacing": ls,
        "font-family": "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      },
    },
  ]);

  return `${serializeRules(rules)}\n\n@layer base {\n${textRules}\n}`;
}

export const APP_CHROME_SELECTOR = '[data-app-chrome="true"]';
export const APP_BACKDROP_SELECTOR = '[data-app-backdrop="true"]';

/**
 * Full theme CSS while the UI theme is locked: the live theme stays on :root
 * (so the canvas and body portals inherit it) and the frozen theme is scoped
 * to app chrome.
 *
 * The app backdrop — the layout root that shows through translucent chrome
 * (dark-mode borders like `oklch(1 0 0 / 10%)`, the `bg-sidebar/95` header) —
 * can't be chrome itself because the canvas inherits from it, so only its
 * background color is pinned to the frozen theme.
 */
export function generateLockedThemeCSS(
  themeState: ThemeEditorState,
  lockedThemeState: ThemeEditorState
): string {
  const lightBg = lockedThemeState.styles.light.background;
  const lineHeight = lockedThemeState.styles.light["global-line-height"] || "1";
  const darkBg = lockedThemeState.styles.dark.background;
  // Inherited text color (e.g. inputs) and line height would otherwise keep
  // the values <body> computed from the live theme. In the base layer, so
  // utility classes on the same element (`text-background`, `leading-*`) win.
  const chromeTextRules = `@layer base {\n${serializeRules([
    {
      selector: APP_CHROME_SELECTOR,
      declarations: { color: "var(--foreground)", "line-height": lineHeight },
    },
  ])}\n}`;
  const backdropRules = serializeRules([
    {
      selector: `:root:not(.dark) ${APP_BACKDROP_SELECTOR}`,
      declarations: { "background-color": lightBg },
    },
    {
      selector: `.dark ${APP_BACKDROP_SELECTOR}`,
      declarations: { "background-color": darkBg },
    },
  ]);

  return [
    generateThemeCSS(themeState),
    `/* === Theme Lock: App UI uses frozen theme === */`,
    generateThemeCSSScoped(lockedThemeState, APP_CHROME_SELECTOR),
    chromeTextRules,
    backdropRules,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const TAILWIND_COLOR_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
];

const generateTailwindV4Theme = (
  themeStyles: ThemeStyles,
  inline: boolean = true
): string => {
  const decls: CSSDeclaration = {};

  TAILWIND_COLOR_KEYS.forEach((key) => {
    decls[`--color-${key}`] = `var(--${key})`;
  });

  decls["--font-sans"] = themeStyles.light["font-sans"] || DEFAULT_FONT_SANS;
  decls["--font-mono"] = themeStyles.light["font-mono"] || DEFAULT_FONT_MONO;
  decls["--font-serif"] = themeStyles.light["font-serif"] || DEFAULT_FONT_SERIF;
  decls["--font-heading"] =
    themeStyles.light["font-heading"] ||
    themeStyles.light["font-sans"] ||
    DEFAULT_FONT_SANS;
  decls["--spacing"] = themeStyles.light.spacing || "0.25rem";

  decls["--radius-sm"] = "calc(var(--radius) * 0.6)";
  decls["--radius-md"] = "calc(var(--radius) * 0.8)";
  decls["--radius-lg"] = "var(--radius)";
  decls["--radius-xl"] = "calc(var(--radius) * 1.4)";
  decls["--radius-2xl"] = "calc(var(--radius) * 1.8)";
  decls["--radius-3xl"] = "calc(var(--radius) * 2.2)";
  decls["--radius-4xl"] = "calc(var(--radius) * 2.6)";

  decls["--font-weight-thin"] = "100";
  decls["--font-weight-extralight"] = "200";
  decls["--font-weight-light"] = "300";
  decls["--font-weight-normal"] = "400";
  decls["--font-weight-medium"] = "500";
  decls["--font-weight-semibold"] = "600";
  decls["--font-weight-bold"] = "700";
  decls["--font-weight-extrabold"] = "800";
  decls["--font-weight-black"] = "900";

  // Map standard tailwind shadow utilities to our specific custom tokens
  decls["--shadow"] = "var(--shadow-default)";
  decls["--shadow-sm"] = "var(--shadow-small, var(--shadow-default))";
  decls["--shadow-md"] = "var(--shadow-medium, var(--shadow-default))";
  decls["--shadow-lg"] = "var(--shadow-large, var(--shadow-default))";
  decls["--shadow-xl"] = "var(--shadow-extra-large, var(--shadow-default))";

  ["2xs", "xs", "2xl"].forEach((s) => {
    decls[`--shadow-${s}`] = `var(--shadow-${s}, var(--shadow-default))`;
  });

  const typography = getTypographyDeclarations(
    "var(--font-scale, 1)",
    "var(--letter-spacing, 0em)"
  );
  delete typography["--font-scale"];
  delete typography["--letter-spacing"];
  Object.assign(decls, typography);

  const block = Object.entries(decls)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return `@theme ${inline ? "inline " : ""}{\n${block}\n}`;
};

function getGoogleFontsImport(
  themeStyles: ThemeStyles,
  extraGoogleFonts: string[] = []
): string {
  const families = new Set<string>();
  const allFonts = [
    themeStyles.light["font-sans"],
    themeStyles.light["font-serif"],
    themeStyles.light["font-mono"],
    themeStyles.light["font-heading"],
    themeStyles.dark["font-sans"],
    themeStyles.dark["font-serif"],
    themeStyles.dark["font-mono"],
    themeStyles.dark["font-heading"],
  ];

  const customFontFamilies = new Set(
    (themeStyles.light.customFonts || []).map((f: CustomFont) =>
      f.family.toLowerCase()
    )
  );

  const genericFonts = new Set([
    "sans-serif",
    "serif",
    "monospace",
    "cursive",
    "fantasy",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "system-ui",
  ]);

  allFonts.forEach((f) => {
    if (f) {
      const firstFont = f.split(",")[0].replace(/['"]/g, "").trim();
      if (
        firstFont &&
        !genericFonts.has(firstFont.toLowerCase()) &&
        !customFontFamilies.has(firstFont.toLowerCase())
      ) {
        families.add(firstFont.replace(/\s+/g, "+"));
      }
    }
  });

  extraGoogleFonts.forEach((font) => {
    if (
      font &&
      !genericFonts.has(font.toLowerCase()) &&
      !customFontFamilies.has(font.toLowerCase())
    ) {
      families.add(font.replace(/\s+/g, "+"));
    }
  });

  if (families.size === 0) return "";

  const familyParam = Array.from(families)
    .map((f) => {
      const cleanName = f.replace(/\+/g, " ");
      const fontInfo = FALLBACK_FONTS.find(
        (font) => font.family.toLowerCase() === cleanName.toLowerCase()
      );

      if (fontInfo?.variants && fontInfo.variants.length > 0) {
        const weights = [...fontInfo.variants]
          .sort((a, b) => Number(a) - Number(b))
          .join(";");
        return `family=${f}:wght@${weights}`;
      }
      return `family=${f}`;
    })
    .join("&");
  return `@import url("https://fonts.googleapis.com/css2?${familyParam}&display=swap");\n\n`;
}

const formatColorWithOptions = (
  color: string,
  colorFormat: ColorFormat,
  tailwindVersion: "3" | "4"
) => {
  return colorFormatter(color, colorFormat, tailwindVersion);
};

export const generateThemeCode = (
  themeEditorState: ThemeEditorState,
  colorFormat: ColorFormat = "hsl",
  tailwindVersion: "3" | "4" = "3",
  options?: {
    isExport?: boolean;
    filter?: ThemeFilter;
    assets?: Record<string, string>;
    extraGoogleFonts?: string[];
  }
): string => {
  if (
    !themeEditorState ||
    !("light" in themeEditorState.styles) ||
    !("dark" in themeEditorState.styles)
  ) {
    throw new Error("Invalid theme styles: missing light or dark mode");
  }

  const themeStyles = themeEditorState.styles as ThemeStyles;
  const formatColor = (color: string) =>
    formatColorWithOptions(color, colorFormat, tailwindVersion);

  const lightVars = buildThemeVariables(themeEditorState, "light", {
    formatColor,
    filter: options?.filter,
  });
  const darkVars = buildThemeVariables(themeEditorState, "dark", {
    formatColor,
    filter: options?.filter,
  });

  const defaultLight = buildDefaultLightTheme();

  const customFonts = (themeStyles.light.customFonts || []) as CustomFont[];
  const fontFaceRules = generateFontFaceRulesSync(
    customFonts,
    options?.isExport
  );

  const STRUCTURAL_KEYS = new Set([
    "radius",
    "spacing",
    "smoothing",
    "border-width",
    "font-scale",
    "letter-spacing",
    "font-sans",
    "font-serif",
    "font-mono",
    "font-heading",
    "shadow-groups",
  ]);

  const filterStructural = (vars: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(vars).filter(([k]) => !STRUCTURAL_KEYS.has(k))
    );

  const ls = themeStyles.light["letter-spacing"] ?? "0em";
  const fs = themeStyles.light["font-scale"] ?? "1";
  const fontSans = themeStyles.light["font-sans"] ?? "";
  const fontSerif = themeStyles.light["font-serif"] ?? "";
  const fontMono = themeStyles.light["font-mono"] ?? "";
  const fontHeading = themeStyles.light["font-heading"] ?? "";
  const smoothing = themeStyles.light.smoothing ?? "0";
  const borderWidth = themeStyles.light["border-width"] ?? "1px";

  const sharedDecls: CSSDeclaration = {
    "--radius": themeStyles.light.radius,
    "--spacing": themeStyles.light.spacing ?? defaultLight.spacing,
    "--smoothing": smoothing,
    "--border-width": borderWidth,
    "--font-scale": fs,
    "--letter-spacing": ls,
    "--font-sans": fontSans || DEFAULT_FONT_SANS,
    "--font-serif": fontSerif || DEFAULT_FONT_SERIF,
    "--font-mono": fontMono || DEFAULT_FONT_MONO,
    "--font-heading": fontHeading || "var(--font-sans)",
    "--shadow-2xs": "var(--shadow-extra-small, var(--shadow-default))",
    "--shadow-xs": "var(--shadow-extra_small, var(--shadow-default))",
    "--shadow-sm": "var(--shadow-small, var(--shadow-default))",
    "--shadow": "var(--shadow-default)",
    "--shadow-md": "var(--shadow-medium, var(--shadow-default))",
    "--shadow-lg": "var(--shadow-large, var(--shadow-default))",
    "--shadow-xl": "var(--shadow-extra_large, var(--shadow-default))",
    "--shadow-2xl": "var(--shadow-extra_large, var(--shadow-default))",
  };

  const rules: CSSRule[] = [
    { selector: ":root", declarations: sharedDecls },
    {
      selector: ":root:not(.dark)",
      declarations: {
        ...toVariables(filterStructural(lightVars.common)),
        ...toVariables(lightVars.colors),
        ...toVariables(lightVars.shadows),
      },
    },
    {
      selector: ".dark",
      declarations: {
        ...toVariables(filterStructural(darkVars.common)),
        ...toVariables(darkVars.colors),
        ...toVariables(darkVars.shadows),
      },
    },
  ];

  const tailwindV4Theme =
    tailwindVersion === "4"
      ? `\n\n${generateTailwindV4Theme(themeStyles, !options?.isExport)}`
      : "";

  if (options?.isExport) {
    const globalRules: CSSRule[] = [
      { selector: ":root", declarations: sharedDecls },
      {
        selector: ":root:not(.dark)",
        declarations: {
          ...toVariables(filterStructural(lightVars.common)),
          ...toVariables(lightVars.colors),
          ...toVariables(lightVars.shadows),
        },
      },
      {
        selector: ".dark",
        declarations: {
          ...toVariables(filterStructural(darkVars.common)),
          ...toVariables(darkVars.colors),
          ...toVariables(darkVars.shadows),
        },
      },
    ];

    const fontImport = getGoogleFontsImport(
      themeStyles,
      options?.extraGoogleFonts
    );

    const globalBlock = serializeRules(globalRules);

    return `${fontImport}${fontFaceRules}
    @layer theme {
    /* Global Theme Variables */
    ${globalBlock}
    }
    

    ${tailwindV4Theme}

    body {
    letter-spacing: var(--letter-spacing, 0em);
    font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
    }`.trim();
  }

  const fontImport = getGoogleFontsImport(
    themeStyles,
    options?.extraGoogleFonts
  );
  return `${fontImport}${fontFaceRules}
  ${serializeRules(rules)}
  ${tailwindV4Theme}

  body {
    letter-spacing: var(--letter-spacing, 0em);
  }

  [data-canvas-container="true"] {
    font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  }`;
};
