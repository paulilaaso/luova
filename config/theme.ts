import type { ThemeEditorState } from "../types/editor";
import type { ShadowGroup } from "../types/theme";
import { defaultPresets } from "../utils/theme-presets";
import {
  buildDefaultDarkTheme,
  buildDefaultLightTheme,
  COMMON_TOKEN_KEYS,
} from "./theme-tokens";

export const COMMON_STYLES = [...COMMON_TOKEN_KEYS] as const;

export const DEFAULT_COMPONENT_SHADOWS = {
  "btn-shadow": "var(--shadow-default)",
  "card-shadow": "var(--shadow-default)",
  "input-shadow": "var(--shadow-default)",
  "select-shadow": "var(--shadow-default)",
  "dropdown-shadow": "var(--shadow-default)",
  "popover-shadow": "var(--shadow-default)",
  "table-shadow": "var(--shadow-default)",
  "accordion-shadow": "var(--shadow-default)",
};

export const defaultLightThemeStyles = (() => {
  const baseStyles = buildDefaultLightTheme();
  // Add default shadow groups to match the old behavior
  const defaultShadowGroups: ShadowGroup[] = [
    {
      id: "default",
      name: "Default",
      isDefault: true,
      layers: [
        {
          id: "primary-shadow",
          type: "drop",
          offsetX: "0px",
          offsetY: "1px",
          blur: "3px",
          spread: "0px",
          opacity: "0.1",
          color: "oklch(0 0 0)",
        },
      ],
    },
  ];
  baseStyles["shadow-groups"] = JSON.stringify(defaultShadowGroups);
  return baseStyles;
})();

export const defaultDarkThemeStyles = (() => {
  const baseStyles = buildDefaultDarkTheme();
  // Add default shadow groups to match the old behavior
  const defaultShadowGroups: ShadowGroup[] = [
    {
      id: "default",
      name: "Default",
      isDefault: true,
      layers: [
        {
          id: "primary-shadow",
          type: "drop",
          offsetX: "0px",
          offsetY: "1px",
          blur: "3px",
          spread: "0px",
          opacity: "0.1",
          color: "oklch(0 0 0)",
        },
      ],
    },
  ];
  baseStyles["shadow-groups"] = JSON.stringify(defaultShadowGroups);
  return baseStyles;
})();

export const defaultThemeState: ThemeEditorState = {
  preset: "default",
  styles: {
    // Initialization and New Project must match selecting the Default preset.
    // Keep the raw token maps above as the fallback for other presets.
    light: {
      ...defaultLightThemeStyles,
      ...defaultPresets.default.styles.light,
      ...DEFAULT_COMPONENT_SHADOWS,
    } as ThemeEditorState["styles"]["light"],
    dark: {
      ...defaultDarkThemeStyles,
      ...defaultPresets.default.styles.dark,
      ...DEFAULT_COMPONENT_SHADOWS,
    } as ThemeEditorState["styles"]["dark"],
  },
  currentMode: "light" as const,
};
