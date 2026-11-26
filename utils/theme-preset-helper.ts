import {
  DEFAULT_COMPONENT_SHADOWS,
  defaultDarkThemeStyles,
  defaultLightThemeStyles,
} from "../config/theme";
import { useThemePresetStore } from "../stores/theme-preset-store";
import type { ThemeStyles } from "../types/theme";
import { isNonColorProperty } from "./theme-property-classifier";

function withComponentShadowDefaults(
  modeStyles: ThemeStyles["light"]
): ThemeStyles["light"] {
  return {
    ...modeStyles,
    ...DEFAULT_COMPONENT_SHADOWS,
  } as ThemeStyles["light"];
}

function applyComponentShadowDefaults(styles: ThemeStyles): ThemeStyles {
  return {
    light: withComponentShadowDefaults(styles.light),
    dark: withComponentShadowDefaults(styles.dark),
  };
}

function normalizeShapeValues(
  light: ThemeStyles["light"],
  dark: ThemeStyles["dark"]
): { light: ThemeStyles["light"]; dark: ThemeStyles["dark"] } {
  const allKeys = new Set([...Object.keys(light), ...Object.keys(dark)]);
  const newDark = { ...dark };
  let changed = false;

  for (const key of allKeys) {
    if (key === "shadow-groups") continue;

    if (isNonColorProperty(key) && key in light) {
      if (newDark[key] !== light[key]) {
        newDark[key] = light[key];
        changed = true;
      }
    }
  }

  return changed ? { light, dark: newDark } : { light, dark };
}

function mergePresetWithDefaults(presetStyles: {
  light?: Partial<ThemeStyles["light"]>;
  dark?: Partial<ThemeStyles["dark"]>;
}): ThemeStyles {
  const mergedLight = {
    ...defaultLightThemeStyles,
    ...presetStyles.light,
  } as ThemeStyles["light"];

  const mergedDark = {
    ...defaultDarkThemeStyles,
    ...presetStyles.dark,
  } as ThemeStyles["dark"];

  const normalized = normalizeShapeValues(mergedLight, mergedDark);

  return applyComponentShadowDefaults(normalized);
}

export function getPresetThemeStyles(name: string): ThemeStyles {
  const store = useThemePresetStore.getState();
  const preset = store.getPreset(name);
  if (!preset) {
    return mergePresetWithDefaults({});
  }

  return mergePresetWithDefaults(preset.styles);
}
