"use client";

/**
 * Live CSS injection hook for captured element styling.
 *
 * During slider drag (onChangeImmediate), injects raw CSS targeting the
 * captured element's selector inside its source component wrapper.
 * On drag commit (onChangeCommit), the caller performs the AST rewrite
 * and this hook clears the injected override.
 */

import { useCallback, useEffect, useRef } from "react";
import { componentStyleManager } from "@/utils/canvas-style-manager";
import { isGradientValue } from "@/utils/color-converter";
import {
  type StyleProperty,
  stylePropertyToCss,
} from "@/utils/tailwind-mapping";

/**
 * Returns helpers to inject/clear live CSS overrides for a captured element.
 *
 * @param nodeId            - The captured node's ID (used as the style key)
 * @param astIndex          - The data-ast-index of the captured element
 * @param sourceComponentId - The source component's node ID, used to scope the CSS rule
 * @param currentMode       - The current theme mode ("light" or "dark")
 */
export function useCapturedStyles(
  nodeId: string,
  astIndex: string,
  sourceComponentId: string,
  currentMode: "light" | "dark" = "light",
  includeDescendants = false
) {
  // Track active overrides so we can rebuild the full CSS block on each change
  const overridesRef = useRef<Map<StyleProperty, number | string>>(new Map());

  // Clean up on unmount
  useEffect(() => {
    return () => {
      componentStyleManager.unregisterStyle(`captured-live-${nodeId}`);
    };
  }, [nodeId]);

  const buildCss = useCallback(
    (overrides: Map<StyleProperty, number | string>): string => {
      if (overrides.size === 0) return "";

      // Use ast-index directly to target the element
      const elementSelector = `[data-ast-index="${astIndex}"]`;
      const scopePrefix = sourceComponentId
        ? `[data-component-id="${sourceComponentId}"]`
        : "";
      const scopedSelector = scopePrefix
        ? `${scopePrefix} ${elementSelector}`
        : elementSelector;
      const themeScopedSelector =
        currentMode === "dark"
          ? `.dark ${scopedSelector}`
          : `:root:not(.dark) ${scopedSelector}`;
      // Text runs can carry their own inline typography. Match them during a
      // whole-component drag so the preview shows the value that commit will
      // write after stripping the conflicting run styles.
      const previewSelector = includeDescendants
        ? `${themeScopedSelector}, ${themeScopedSelector} *`
        : themeScopedSelector;

      // Separate gradient-border overrides from regular ones
      const borderColorEntry = overrides.get("borderColor");
      const isGradientBorder =
        borderColorEntry !== undefined &&
        isGradientValue(String(borderColorEntry));

      const regularDeclarations = Array.from(overrides.entries())
        .filter(([prop]) => !(prop === "borderColor" && isGradientBorder))
        .map(([prop, val]) => stylePropertyToCss(prop, val))
        .filter(Boolean)
        .join(" ");

      const rules: string[] = [];

      if (regularDeclarations) {
        rules.push(`${previewSelector} { ${regularDeclarations} }`);
      }

      if (isGradientBorder) {
        const gradientValue = String(borderColorEntry);
        // Update the CSS var on the element so the ::after pseudo-element picks it up.
        // This avoids injecting border-image (which ignores border-radius) and prevents
        // a second border from appearing on top of the existing luova-border-themed one.
        const cssVarProp =
          currentMode === "dark"
            ? "--luova-border-dark"
            : "--luova-border-light";
        rules.push(
          `${themeScopedSelector} { ${cssVarProp}: ${gradientValue}; }`
        );
        // Also directly update the ::after background-image so it's instant even if
        // the element doesn't yet have the luova-border-themed class (e.g. first-time set)
        rules.push(
          `${themeScopedSelector}::after { background-image: ${gradientValue} !important; content: "" !important; }`
        );
      }

      return rules.join("\n");
    },
    [astIndex, sourceComponentId, currentMode, includeDescendants]
  );

  /** Inject a live CSS override for a single property (called during drag) */
  const injectOverride = useCallback(
    (property: StyleProperty, value: number | string) => {
      overridesRef.current.set(property, value);
      const css = buildCss(overridesRef.current);
      componentStyleManager.registerStyle(`captured-live-${nodeId}`, css);
    },
    [nodeId, buildCss]
  );

  /** Clear all live overrides (called after AST commit) */
  const clearOverrides = useCallback(() => {
    overridesRef.current.clear();
    componentStyleManager.unregisterStyle(`captured-live-${nodeId}`);
  }, [nodeId]);

  /** Clear a single property override */
  const clearOverride = useCallback(
    (property: StyleProperty) => {
      overridesRef.current.delete(property);
      const css = buildCss(overridesRef.current);
      if (css) {
        componentStyleManager.registerStyle(`captured-live-${nodeId}`, css);
      } else {
        componentStyleManager.unregisterStyle(`captured-live-${nodeId}`);
      }
    },
    [nodeId, buildCss]
  );

  return { injectOverride, clearOverrides, clearOverride };
}
