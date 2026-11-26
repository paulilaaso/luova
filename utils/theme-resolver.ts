import { isGradientValue } from "./color-converter";

/**
 * Recursively resolves CSS variables in a string to their literal color values.
 * For example: "linear-gradient(var(--primary), var(--secondary))" →
 *              "linear-gradient(oklch(...), oklch(...))"
 *
 * @param cssString The CSS string potentially containing `var(--token)` references
 * @param styles The style dictionary mapping token names to color values
 * @returns The same string with all var() calls replaced by their resolved literal values
 */
export function resolveThemeVariablesInString(
  cssString: string,
  styles: Record<string, string | undefined>
): string {
  if (!cssString || typeof cssString !== "string") return "";

  // Match standard CSS variable syntax: var(--name) or var(--name, fallback)
  const varRegex = /var\(--([a-zA-Z0-9-]+)(?:,\s*([^)]+))?\)/g;

  return cssString.replace(varRegex, (match, tokenName, fallback) => {
    // Try to resolve the token from styles
    const resolved = styles[tokenName];

    if (resolved) {
      // Recursively resolve in case the resolved value contains more variables
      return resolveThemeVariablesInString(resolved, styles);
    }

    // If no resolved value, use the fallback if provided
    if (fallback?.trim()) {
      return resolveThemeVariablesInString(fallback.trim(), styles);
    }

    // If nothing found, return the original match (preserve invalid variables)
    return match;
  });
}

/**
 * Resolves a color value to its displayable string.
 * If the input is a semantic token (e.g., "primary"), it looks up the value in the provided styles.
 * If the input is already a color string (hex, oklch, etc.), it returns it as-is.
 * If the input contains CSS variables (e.g., "var(--primary)"), it resolves them to literal values.
 * Handles recursive resolution if a token points to another token.
 */
export function resolveDisplayColor(
  color: string | undefined,
  styles: Record<string, string | undefined>
): string {
  if (!color) return "";

  // If it contains CSS variables, resolve them to literal values
  if (color.includes("var(")) {
    return resolveThemeVariablesInString(color, styles);
  }

  // If it's a raw color value (has #, oklch, rgb, etc.), return as-is
  if (
    color.includes("oklch") ||
    color.includes("#") ||
    color.includes("rgb") ||
    color.includes("hsl") ||
    isGradientValue(color)
  ) {
    return color;
  }

  // Otherwise, it's likely a token name. Resolve from styles.
  const resolved = styles[color];

  if (!resolved) return color;

  // Prevent infinite recursion if a token points to itself
  if (resolved === color) return color;

  // Recursively resolve in case of nested tokens
  return resolveDisplayColor(resolved, styles);
}
