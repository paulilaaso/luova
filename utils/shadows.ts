import { defaultThemeState } from "../config/theme";
import type { ThemeEditorState } from "../types/editor";
import type { ShadowGroup, ShadowLayer } from "../types/theme";
import {
  colorFormatter,
  isGradientValue,
  parseGradient,
} from "./color-converter";

type ThemeMode = "light" | "dark";

/**
 * Safely extracts a solid color from a token value for shadow color usage.
 * If the value is a gradient, extracts the first color stop (darkest fallback).
 * If the value can't be parsed, returns a safe default.
 */
export function resolveShadowColor(
  value: string,
  fallback: string = "oklch(0 0 0)"
): string {
  if (!value) return fallback;
  if (isGradientValue(value)) {
    const parsed = parseGradient(value);
    return parsed?.stops[0]?.color ?? fallback;
  }
  return value;
}

/**
 * Generate a CSS shadow string for an individual layer.
 */
export function generateShadowString(layer: ShadowLayer): string {
  const resolvedColor = resolveShadowColor(layer.color);
  const hslColor = colorFormatter(resolvedColor, "hsl", "3");
  const opacityValue = parseFloat(layer.opacity);
  const colorWithOpacity = `hsl(${hslColor} / ${opacityValue.toFixed(2)})`;

  return `${layer.type === "inset" ? "inset " : ""}${layer.offsetX} ${layer.offsetY} ${layer.blur} ${layer.spread} ${colorWithOpacity}`;
}

/**
 * Build CSS shadow strings for a single shadow group.
 * Returns combined, drop-only, and inset-only shadow strings.
 */
export function buildShadowGroupCss(group: ShadowGroup): {
  combined: string;
  drop: string;
  inset: string;
} {
  if (group.visible === false) {
    return { combined: "none", drop: "none", inset: "none" };
  }

  const visibleLayers = group.layers.filter((l) => l.visible !== false);
  const dropLayers = visibleLayers.filter((l) => l.type === "drop");
  const insetLayers = visibleLayers.filter((l) => l.type === "inset");

  const combinedShadowString =
    visibleLayers.length > 0
      ? visibleLayers.map(generateShadowString).filter(Boolean).join(", ") ||
        "none"
      : "none";

  const dropShadowString =
    dropLayers.length > 0
      ? dropLayers.map(generateShadowString).filter(Boolean).join(", ") ||
        "none"
      : "none";

  const insetShadowString =
    insetLayers.length > 0
      ? insetLayers.map(generateShadowString).filter(Boolean).join(", ") ||
        "none"
      : "none";

  return {
    combined: combinedShadowString,
    drop: dropShadowString,
    inset: insetShadowString,
  };
}

export interface NormalizedShadowTokenValue {
  shadow: string;
  drop: string;
  inset: string;
}

function extractShadowGroupId(value: string): string | null {
  const match = value.match(/var\(--shadow-([^)]+)\)/);
  if (!match?.[1]) return null;
  return match[1].replace(/^shadow-/, "");
}

export function normalizeShadowTokenValue(
  value: string,
  shadowMap: Record<string, string>
): NormalizedShadowTokenValue | null {
  if (value === "none") {
    return {
      shadow: "none",
      drop: "none",
      inset: "none",
    };
  }

  if (!value.startsWith("var(--shadow-")) return null;

  let groupId = extractShadowGroupId(value);
  if (!groupId) return null;

  if (!shadowMap[`shadow-${groupId}`]) {
    if (shadowMap["shadow-default"]) {
      groupId = "default";
    } else {
      return null;
    }
  }

  return {
    shadow: `var(--shadow-${groupId})`,
    drop: `var(--shadow-${groupId}-drop)`,
    inset: `var(--shadow-${groupId}-inset)`,
  };
}

export const getShadowMap = (
  themeEditorState: ThemeEditorState,
  modeOverride?: ThemeMode
) => {
  const mode = modeOverride ?? themeEditorState.currentMode;
  const styles = {
    ...defaultThemeState.styles[mode],
    ...themeEditorState.styles[mode],
  };

  const parseShadowGroups = (raw: string | undefined): ShadowGroup[] | null => {
    if (!raw || raw.trim() === "") return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ShadowGroup[]) : null;
    } catch (e) {
      console.error("Failed to parse shadow-groups JSON:", e);
      return null;
    }
  };

  const shadowGroups =
    parseShadowGroups(styles["shadow-groups"]) ??
    parseShadowGroups(defaultThemeState.styles[mode]["shadow-groups"]) ??
    [];

  const shadowMap: { [key: string]: string } = {};
  for (const group of shadowGroups) {
    const cleanId = group.id.replace(/^shadow-/, "");
    const { combined, drop, inset } = buildShadowGroupCss(group);

    shadowMap[`shadow-${cleanId}`] = combined;
    shadowMap[`shadow-${cleanId}-drop`] = drop;
    shadowMap[`shadow-${cleanId}-inset`] = inset;

    if (cleanId === "default") {
      const standardSizes = ["", "sm", "md", "lg", "xl", "2xl", "xs", "2xs"];
      for (const size of standardSizes) {
        const key = size === "" ? "shadow" : `shadow-${size}`;
        shadowMap[key] = combined;
      }
    }
  }

  return shadowMap;
};
