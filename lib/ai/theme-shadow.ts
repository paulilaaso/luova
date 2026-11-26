import type { ShadowGroup } from "@/types/theme";

/** One shadow layer as the theme tool receives it (numbers in px). */
export interface ThemeShadowLayerInput {
  type: "drop" | "inset";
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  opacity: number;
  color: string;
}

/**
 * The theme's single default shadow, serialized as the `shadow-groups`
 * token. Every `shadow` utility in components renders this group, drop and
 * inset layers together. An empty layer list means no shadow.
 */
export function shadowLayersToGroups(layers: ThemeShadowLayerInput[]): string {
  const group: ShadowGroup = {
    id: "default",
    name: "Default",
    isDefault: true,
    layers: layers.map((layer, index) => ({
      id: `layer-${index + 1}`,
      type: layer.type,
      offsetX: `${layer.offsetX}px`,
      offsetY: `${layer.offsetY}px`,
      blur: `${Math.max(0, layer.blur)}px`,
      spread: `${layer.spread}px`,
      opacity: String(Math.min(1, Math.max(0, layer.opacity))),
      color: layer.color,
    })),
  };
  return JSON.stringify([group]);
}

/**
 * Normalize an `update_theme` call into the theme patch Luova applies:
 * `{light, dark}` modes (a flat patch becomes light), the typed `shadow`
 * layers as the default shadow group, and no per-component shadow overrides.
 * Shared by the chat route and the MCP server.
 */
export function buildThemePatch(input: {
  patch: Record<string, unknown>;
  shadow?: ThemeShadowLayerInput[];
}): Record<string, Record<string, unknown>> {
  const raw = input.patch as Record<string, Record<string, unknown>>;
  const modes: Record<string, Record<string, unknown>> = raw &&
  !raw.light &&
  !raw.dark
    ? { light: { ...(raw as Record<string, unknown>) } }
    : { ...raw };

  for (const mode of ["light", "dark"]) {
    const styles = modes[mode];
    if (!styles) continue;
    const next = { ...styles };
    for (const key of Object.keys(next)) {
      if (key.endsWith("-shadow")) delete next[key];
    }
    if (input.shadow) delete next["shadow-groups"];
    modes[mode] = next;
  }
  if (input.shadow) {
    modes.light = {
      ...modes.light,
      "shadow-groups": shadowLayersToGroups(input.shadow),
    };
  }
  return modes;
}
