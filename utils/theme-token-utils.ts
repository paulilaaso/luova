import type { ThemeEditorState } from "@/types/editor";
import {
  buildGradientString,
  isGradientValue,
  parseGradient,
} from "@/utils/color-converter";
import { getPresetThemeStyles } from "@/utils/theme-preset-helper";
import { isSharedShapeToken } from "@/utils/theme-property-classifier";

export function updateThemeTokenInState(
  state: ThemeEditorState,
  key: string,
  value: string | undefined,
  currentMode: "light" | "dark"
) {
  const latest = state;
  const mode = currentMode;
  const currentValue =
    latest.styles[mode][key as keyof typeof latest.styles.light];
  if (value !== undefined && currentValue === value) return;

  const presetStyles = getPresetThemeStyles(latest.preset || "default");
  const isShared = isSharedShapeToken(key);

  // Synchronized tokens (shared mode-scope) are applied to both light and dark modes.
  if (isShared) {
    if (value === undefined) {
      const pv = presetStyles.light[key];
      if (pv !== undefined) {
        state.styles.light[key] = pv;
        state.styles.dark[key] = pv;
      } else {
        delete state.styles.light[key];
        delete state.styles.dark[key];
      }
    } else {
      state.styles.light[key] = value;
      state.styles.dark[key] = value;
    }
    return;
  }

  if (value === undefined) {
    const pv = presetStyles[mode][key];
    if (pv !== undefined) state.styles[mode][key] = pv;
    else delete state.styles[mode][key];
  } else {
    state.styles[mode][key] = value;

    // GRADIENT CROSS-MODE SYNC
    // Dual-mode synchronization for gradients: synchronize the "skeleton" (angle, stop positions)
    // across both modes while keeping the "skin" (colors) isolated. This ensures that a
    // "top-to-bottom" gradient remains "top-to-bottom" in both themes, but with mode-aware colors.
    if (value !== undefined && isGradientValue(value)) {
      const otherMode = mode === "light" ? "dark" : "light";
      const currentOtherValue = state.styles[otherMode][key];
      const parsedSource = parseGradient(value);

      if (parsedSource) {
        if (
          typeof currentOtherValue !== "string" ||
          !isGradientValue(currentOtherValue)
        ) {
          // Case 1: The opposite mode was solid. Convert it to a gradient using its solid color
          // as the baseline for all stops, but mirroring the source's structure exactly.
          const isSolid = (v: string | undefined): v is string =>
            typeof v === "string" &&
            v.trim() !== "" &&
            !isGradientValue(v) &&
            !v.startsWith("var(");
          const baseColor =
            (isSolid(currentOtherValue) ? currentOtherValue : undefined) ||
            (isSolid(presetStyles[otherMode][key])
              ? presetStyles[otherMode][key]
              : undefined) ||
            presetStyles[otherMode].primary ||
            "oklch(0.5 0 0)";
          const syncedStops = parsedSource.stops.map((s) => ({
            ...s,
            // Preserve CSS variables (e.g., var(--primary)) across modes since they adapt dynamically
            color: s.color.startsWith("var(") ? s.color : baseColor,
          }));
          state.styles[otherMode][key] = buildGradientString(
            syncedStops,
            parsedSource.angle,
            parsedSource.type,
            parsedSource.radialScale,
            parsedSource.radialPositionX,
            parsedSource.radialPositionY
          );
        } else {
          // Case 2: The opposite mode already has a gradient. Sync structural properties
          // (angle, type, positions) but retain the colors already picked for that mode.
          const parsedOther = parseGradient(currentOtherValue);
          if (parsedOther) {
            const syncedStops = parsedSource.stops.map((s, idx) => {
              // Preserve CSS variables (e.g., var(--primary)) across modes since they adapt dynamically
              if (s.color.startsWith("var(")) {
                return { ...s, color: s.color };
              }
              const otherStopColor =
                parsedOther.stops[idx]?.color ||
                parsedOther.stops[parsedOther.stops.length - 1]?.color ||
                presetStyles[otherMode].primary ||
                "oklch(0.5 0 0)";
              return { ...s, color: otherStopColor };
            });

            state.styles[otherMode][key] = buildGradientString(
              syncedStops,
              parsedSource.angle,
              parsedSource.type,
              parsedSource.radialScale,
              parsedSource.radialPositionX,
              parsedSource.radialPositionY
            );
          }
        }
      }
    }
  }
}

export function clearThemeTokensInState(
  state: ThemeEditorState,
  keys: string[],
  currentMode: "light" | "dark"
) {
  const latest = state;
  const mode = currentMode;
  const presetStyles = getPresetThemeStyles(latest.preset || "default");

  keys.forEach((key) => {
    const isShared = isSharedShapeToken(key);

    if (isShared) {
      const pv = presetStyles.light[key];
      if (pv !== undefined) {
        state.styles.light[key] = pv;
        state.styles.dark[key] = pv;
      } else {
        delete state.styles.light[key];
        delete state.styles.dark[key];
      }
    } else {
      const pv = presetStyles[mode][key];
      if (pv !== undefined) {
        state.styles[mode][key] = pv;
      } else {
        delete state.styles[mode][key];
      }
    }
  });
}
