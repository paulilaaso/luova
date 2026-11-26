import { getTokenDefinition } from "@/config/theme-tokens";

const SHADOW_KEYS = new Set(["shadow-groups"]);

export function isColorProperty(key: string): boolean {
  if (SHADOW_KEYS.has(key)) return false;

  const token = getTokenDefinition(key);
  if (!token) return false;
  return (
    token.category === "color" ||
    (token.category !== "typography" && !token.common)
  );
}

export function isNonColorProperty(key: string): boolean {
  if (
    key.endsWith("-shadow") ||
    key.endsWith("-opacity") ||
    key.endsWith("-filter") ||
    key.endsWith("-smoothing")
  )
    return true;

  if (key === "shadow-groups" || key === "smoothing") return true;

  if (SHADOW_KEYS.has(key)) return false;

  return !isColorProperty(key);
}

export function isSharedShapeToken(key: string): boolean {
  if (key === "shadow-groups") return true;

  // Fallback for global tokens
  if (key.endsWith("-shadow") || SHADOW_KEYS.has(key)) return false;
  if (isColorProperty(key)) return false;

  const token = getTokenDefinition(key);
  if (!token) return false;
  // Shared tokens include shape and typography (font-scale, letter-spacing)
  return token.category === "shape" || token.category === "typography";
}

export { SHADOW_KEYS };
