import { THEME_TOKENS } from "@/config/theme-tokens";

/**
 * Produces a compact token atlas for the AI system prompt.
 * Groups tokens by category with their types, replacing verbose markdown lists.
 */
export function getMinifiedTokenAtlas(): string {
  const colors: string[] = [];
  const described: Record<"typography" | "shape", string[]> = {
    typography: [],
    shape: [],
  };

  for (const [key, def] of Object.entries(THEME_TOKENS)) {
    const opt = def.optional ? "?" : "";
    if (def.category === "color") {
      colors.push(`${key}${opt}`);
    } else if (def.category === "typography" || def.category === "shape") {
      const note = def.description ? ` — ${def.description}` : "";
      described[def.category].push(`- ${key}${opt}${note}`);
    }
    // Shadows come from the tool's `shadow` field; there are no
    // per-component shadow overrides.
  }

  return [
    "Available theme tokens by category:",
    `[Colors (oklch, paired base↔foreground)]: ${colors.join(", ")}`,
    "[Typography (shared light/dark)]:",
    ...described.typography,
    "[Shape & Layout (shared light/dark)]:",
    ...described.shape,
  ].join("\n");
}
