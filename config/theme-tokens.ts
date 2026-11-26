import type { ThemeStyleProps } from "@/types/theme";

export type TokenCategory =
  | "color"
  | "typography"
  | "shape"
  | "shadow"
  | "component";

export const DEFAULT_FONT_SANS =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";

export const DEFAULT_FONT_SERIF =
  'Lora, ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

export const DEFAULT_FONT_MONO =
  '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const DEFAULT_FONT_HEADING = "";

export interface ThemeTokenDefinition {
  light: string;
  dark?: string;
  description?: string;
  category: TokenCategory;
  common?: boolean;
  optional?: boolean;
}

const THEME_TOKEN_DEFINITIONS = {
  background: {
    light: "oklch(1 0 0)",
    dark: "oklch(0.145 0 0)",
    description: "The default background color, paired with `foreground`.",
    category: "color",
  },
  foreground: {
    light: "oklch(0.145 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `background`.",
    category: "color",
  },
  card: {
    light: "oklch(1 0 0)",
    dark: "oklch(0.205 0 0)",
    description:
      "The background color for cards, paired with `card-foreground`.",
    category: "color",
  },
  "card-foreground": {
    light: "oklch(0.145 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `card`.",
    category: "color",
  },
  popover: {
    light: "oklch(1 0 0)",
    dark: "oklch(0.269 0 0)",
    description:
      "The background color for popovers, paired with `popover-foreground`.",
    category: "color",
  },
  "popover-foreground": {
    light: "oklch(0.145 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `popover`.",
    category: "color",
  },
  primary: {
    light: "oklch(0.205 0 0)",
    dark: "oklch(0.922 0 0)",
    description: "The main color, paired with `primary-foreground`.",
    category: "color",
  },
  "primary-foreground": {
    light: "oklch(0.985 0 0)",
    dark: "oklch(0.205 0 0)",
    description: "Paired with `primary`.",
    category: "color",
  },
  secondary: {
    light: "oklch(0.97 0 0)",
    dark: "oklch(0.269 0 0)",
    description: "A secondary color, paired with `secondary-foreground`.",
    category: "color",
  },
  "secondary-foreground": {
    light: "oklch(0.205 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `secondary`.",
    category: "color",
  },
  muted: {
    light: "oklch(0.97 0 0)",
    dark: "oklch(0.269 0 0)",
    description: "A muted background color, paired with `muted-foreground`.",
    category: "color",
  },
  "muted-foreground": {
    light: "oklch(0.556 0 0)",
    dark: "oklch(0.708 0 0)",
    description: "Paired with `muted`.",
    category: "color",
  },
  accent: {
    light: "oklch(0.97 0 0)",
    dark: "oklch(0.269 0 0)",
    description:
      "Subtle color for hover or highlight, paired with `accent-foreground`.",
    category: "color",
  },
  "accent-foreground": {
    light: "oklch(0.205 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `accent`.",
    category: "color",
  },
  destructive: {
    light: "oklch(0.577 0.245 27.325)",
    dark: "oklch(0.396 0.141 25.723)",
    description:
      "Color for destructive actions, paired with `destructive-foreground`.",
    category: "color",
  },
  "destructive-foreground": {
    light: "oklch(0.97 0.01 17)",
    dark: "oklch(0.637 0.237 25.331)",
    description: "Paired with `destructive`.",
    category: "color",
  },
  border: {
    light: "oklch(0.922 0 0)",
    dark: "oklch(0.269 0 0)",
    description: "The color for borders.",
    category: "color",
  },
  input: {
    light: "oklch(0.922 0 0)",
    dark: "oklch(0.269 0 0)",
    description:
      "The fill of form fields (inputs, selects, textareas): a quiet surface close to `card`.",
    category: "color",
  },
  ring: {
    light: "oklch(0.708 0 0)",
    dark: "oklch(0.439 0 0)",
    description: "The color for focus rings.",
    category: "color",
  },
  sidebar: {
    light: "oklch(0.985 0 0)",
    dark: "oklch(0.205 0 0)",
    description:
      "The background color for the sidebar, paired with `sidebar-foreground`.",
    category: "color",
  },
  "sidebar-foreground": {
    light: "oklch(0.145 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `sidebar`.",
    category: "color",
  },
  "sidebar-primary": {
    light: "oklch(0.205 0 0)",
    dark: "oklch(0.488 0.243 264.376)",
    description:
      "The primary color for sidebar elements, paired with `sidebar-primary-foreground`.",
    category: "color",
  },
  "sidebar-primary-foreground": {
    light: "oklch(0.985 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `sidebar-primary`.",
    category: "color",
  },
  "sidebar-accent": {
    light: "oklch(0.97 0 0)",
    dark: "oklch(0.269 0 0)",
    description:
      "An accent color for the sidebar, paired with `sidebar-accent-foreground`.",
    category: "color",
  },
  "sidebar-accent-foreground": {
    light: "oklch(0.205 0 0)",
    dark: "oklch(0.985 0 0)",
    description: "Paired with `sidebar-accent`.",
    category: "color",
  },
  "sidebar-border": {
    light: "oklch(0.922 0 0)",
    dark: "oklch(0.269 0 0)",
    description: "The color for borders within the sidebar.",
    category: "color",
  },
  "sidebar-ring": {
    light: "oklch(0.708 0 0)",
    dark: "oklch(0.439 0 0)",
    description: "The color for focus rings within the sidebar.",
    category: "color",
  },
  "chart-1": {
    light: "oklch(0.646 0.222 41.116)",
    dark: "oklch(0.488 0.243 264.376)",
    category: "color",
  },
  "chart-2": {
    light: "oklch(0.6 0.118 184.704)",
    dark: "oklch(0.696 0.17 162.48)",
    category: "color",
  },
  "chart-3": {
    light: "oklch(0.398 0.07 227.392)",
    dark: "oklch(0.769 0.188 70.08)",
    category: "color",
  },
  "chart-4": {
    light: "oklch(0.828 0.189 84.429)",
    dark: "oklch(0.627 0.265 303.9)",
    category: "color",
  },
  "chart-5": {
    light: "oklch(0.769 0.188 70.08)",
    dark: "oklch(0.645 0.246 16.439)",
    category: "color",
  },

  "font-sans": {
    light: DEFAULT_FONT_SANS,
    description:
      "Primary UI font. May be serif, sans, monospace, or display depending on the theme vibe.",
    category: "typography",
    common: true,
  },
  "font-serif": {
    light: DEFAULT_FONT_SERIF,
    description: "The preferred serif font family.",
    category: "typography",
    common: true,
  },
  "font-mono": {
    light: DEFAULT_FONT_MONO,
    description: "The preferred monospace font family. Used for code blocks.",
    category: "typography",
    common: true,
  },
  "font-heading": {
    light: DEFAULT_FONT_HEADING,
    description:
      "Custom font for headings. Falls back to font-sans when empty.",
    category: "typography",
    common: true,
    optional: true,
  },
  "font-scale": {
    light: "1",
    description:
      "Master font scale multiplier for all text sizes. 1 = 100%, 1.1 = 110%.",
    category: "typography",
    common: true,
  },
  "letter-spacing": {
    light: "0em",
    description: "The global letter spacing for text.",
    category: "typography",
    common: true,
  },
  "global-line-height": {
    light: "1",
    description:
      "Global baseline line height multiplier. 1 = 100%, 1.5 = 150%.",
    category: "typography",
    common: true,
  },
  spacing: {
    light: "0.25rem",
    description: "The global spacing unit.",
    category: "shape",
    common: true,
    optional: true,
  },
  radius: {
    light: "0.625rem",
    description:
      "The global border-radius for components. Use 0rem for sharp corners.",
    category: "shape",
    common: true,
  },
  smoothing: {
    light: "0",
    description:
      "Corner smoothing (squircle) for the global radius. 0 = standard circular radius, higher values = smoother squircles.",
    category: "shape",
    common: true,
    optional: true,
  },
  "border-width": {
    light: "1px",
    description:
      "The global border width for components (e.g., '1px', '2px', '0px').",
    category: "shape",
    common: true,
  },

  "shadow-groups": {
    light: "[]",
    description:
      "Serialized JSON array of shadow groups for grouped shadow management",
    category: "shadow",
    common: true,
  },

  // Component shadow tokens — consumed by public/theme-tokens-compiled.css
  "btn-shadow": {
    light: "var(--shadow-default)",
    description: "Button box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "btn-outline-shadow": {
    light: "",
    description: "Outline button box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "btn-ghost-shadow": {
    light: "",
    description: "Ghost button box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "btn-secondary-shadow": {
    light: "var(--shadow-default)",
    description: "Secondary button box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "btn-destructive-shadow": {
    light: "var(--shadow-default)",
    description: "Destructive button box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "card-shadow": {
    light: "",
    description: "Card box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "input-shadow": {
    light: "",
    description: "Input box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "select-shadow": {
    light: "",
    description: "Select trigger box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "dropdown-shadow": {
    light: "var(--shadow-default)",
    description: "Dropdown/popover box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "popover-shadow": {
    light: "var(--shadow-default)",
    description: "Popover box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "badge-shadow": {
    light: "",
    description: "Badge box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "table-shadow": {
    light: "",
    description: "Table box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
  "accordion-shadow": {
    light: "",
    description: "Accordion box shadow.",
    category: "component",
    common: true,
    optional: true,
  },
} satisfies Record<string, ThemeTokenDefinition>;

export type TokenKey = keyof typeof THEME_TOKEN_DEFINITIONS & string;

export const THEME_TOKENS: Record<TokenKey, ThemeTokenDefinition> =
  THEME_TOKEN_DEFINITIONS;

export function getTokenDefinition(
  key: string
): ThemeTokenDefinition | undefined {
  return (THEME_TOKENS as Record<string, ThemeTokenDefinition | undefined>)[
    key
  ];
}

export const TOKEN_KEYS = Object.keys(
  THEME_TOKENS
) as (keyof typeof THEME_TOKENS)[];

export const COMMON_TOKEN_KEYS = TOKEN_KEYS.filter(
  (key) => THEME_TOKENS[key].common === true
);

export const COLOR_TOKEN_KEYS = TOKEN_KEYS.filter(
  (key) => THEME_TOKENS[key].category === "color"
);

export const OPTIONAL_TOKEN_KEYS = TOKEN_KEYS.filter(
  (key) => THEME_TOKENS[key].optional === true
);

export function buildDefaultLightTheme(): ThemeStyleProps {
  const result = {} as ThemeStyleProps;
  for (const [key, def] of Object.entries(THEME_TOKENS)) {
    if (def.light !== "") {
      (result as Record<string, string>)[key] = def.light;
    }
  }
  return result;
}

export function buildDefaultDarkTheme(): ThemeStyleProps {
  const result = {} as ThemeStyleProps;
  for (const [key, def] of Object.entries(THEME_TOKENS)) {
    if (def.common) {
      if (def.light !== "") {
        (result as Record<string, string>)[key] = def.light;
      }
    } else {
      const darkValue = def.dark ?? def.light;
      if (darkValue !== "") {
        (result as Record<string, string>)[key] = darkValue;
      }
    }
  }
  return result;
}
