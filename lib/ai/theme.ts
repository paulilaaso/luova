import type { AiThemePatch } from "@/types/ai";
import type { ThemeEditorState } from "@/types/editor";
import { isNonColorProperty } from "@/utils/theme-property-classifier";

function applyModePatch<T extends object>(
  base: T,
  patch?: Record<string, string>
): T {
  if (!patch) {
    return base;
  }

  const next = { ...(base as Record<string, string | undefined>) };

  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim().length > 0) {
      (next as Record<string, string>)[key] = value.trim();
    }
  }

  return next as T;
}

/**
 * Synchronize non-color properties between light and dark mode patches.
 * Non-color properties should be identical in both modes.
 * Light mode values take precedence when there's a conflict.
 */
function synchronizeNonColorProperties(patch: AiThemePatch): AiThemePatch {
  const light = { ...patch.light };
  const dark = { ...patch.dark };

  const allKeys = new Set([...Object.keys(light), ...Object.keys(dark)]);

  for (const key of allKeys) {
    if (!isNonColorProperty(key)) continue;

    const lightValue = light[key];
    const darkValue = dark[key];

    const hasLight =
      typeof lightValue === "string" && lightValue.trim().length > 0;
    const hasDark =
      typeof darkValue === "string" && darkValue.trim().length > 0;

    // If only one mode has the property, sync it to the other.
    // If both have it, keep them as specified (allowing explicit overrides).
    if (hasLight && !hasDark) {
      dark[key] = lightValue.trim();
    } else if (!hasLight && hasDark) {
      light[key] = darkValue.trim();
    }
  }

  return {
    light,
    dark,
  };
}

export function applyThemePatch(
  state: ThemeEditorState,
  patch: AiThemePatch
): ThemeEditorState {
  const synchronizedPatch = synchronizeNonColorProperties(patch);

  return {
    ...state,
    styles: {
      light: applyModePatch(state.styles.light, synchronizedPatch.light),
      dark: applyModePatch(state.styles.dark, synchronizedPatch.dark),
    },
  };
}

export function mergeThemePatches(
  base: AiThemePatch | null,
  patch: AiThemePatch
): AiThemePatch {
  const merged: AiThemePatch = {
    light: {
      ...(base?.light ?? {}),
      ...(patch.light ?? {}),
    },
    dark: {
      ...(base?.dark ?? {}),
      ...(patch.dark ?? {}),
    },
  };

  return synchronizeNonColorProperties(merged);
}
