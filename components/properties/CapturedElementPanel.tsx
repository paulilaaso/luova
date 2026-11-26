"use client";
import {
  inlineTypographyValues,
  type TypographyProperty,
  typographyCss,
  typographyFromClasses,
} from "@/utils/text-typography";
import { updateTypographyCode } from "@/utils/typography-commit";
import { TypographyControls } from "./TypographyControls";

/**
 * CapturedElementPanel
 *
 * Properties panel for nodes with kind="captured".
 * Provides visual sliders and color pickers that:
 *  - Inject live CSS during drag (60fps via ComponentStyleManager)
 *  - Commit an AST rewrite on drag release (offline, no AI)
 */

import * as culori from "culori";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowRight,
  Baseline,
  Droplet,
  Layers2,
  RotateCcw,
  SeparatorHorizontal,
  SeparatorVertical,
  Square,
  SquareRoundCorner,
  Squircle,
  StretchHorizontal,
  StretchVertical,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch } from "@/components/luova-ui/switch";
import { defaultThemeState } from "@/config/theme";
import { useCapturedStyles } from "@/hooks/use-captured-styles";
import { getLiveCameraState } from "@/stores/canvas-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import type { ComponentNodeAny } from "@/types/builder";
import {
  extractJsxClassNamesByAstIndex,
  extractJsxInlineStyleByAstIndex,
  extractJsxStyleByAstIndex,
  updateJsxClassNameByAstIndex,
  updateJsxModeAwareStyle,
  updateJsxStyleByAstIndex,
} from "@/utils/ast-modifier-v2";
import { onComponentRendered } from "@/utils/canvas-style-manager";
import { isGradientValue } from "@/utils/color-converter";
import { applySpacingEdit, isSpacingClass } from "@/utils/spacing-classes";
import {
  detectSystemRadius,
  injectSystemRadius,
  removeSystemRadius,
} from "@/utils/system-radius-helper";
import {
  generateTailwindClass,
  getAlignItemsFromClasses,
  getBorderGradientFromStyle,
  getBorderWidthFromClasses,
  getColorFromClasses,
  getConflictingClasses,
  getFlexDirectionFromClasses,
  getGapFromClasses,
  getGradientFromStyle,
  getJustifyContentFromClasses,
  getModeAwareShadowFromStyle,
  getOpacityFromClasses,
  getRadiusFromClasses,
  getShadowFromStyle,
  getSmoothingFromStyle,
  getTextAlignFromClasses,
  isConflictingColorClass,
  type StyleProperty,
  snapSpacingPx,
  spacingToken,
} from "@/utils/tailwind-mapping";
import { resolveDisplayColor } from "@/utils/theme-resolver";
import { OptimizedColorPicker } from "./OptimizedColorPicker";
import ShadowSelect from "./ShadowSelect";
import { SliderWithInput } from "./SliderWithInput";
import { ExpandableCard } from "./ui/ExpandableCard";
import { PanelRow, ROW_GRID } from "./ui/PanelRow";
import { SegmentedControl, type SegmentOption } from "./ui/SegmentedControl";
import {
  type BoxLayer,
  type BoxLayerState,
  type BoxSide,
  type BoxValues,
  SpacingBox,
} from "./ui/SpacingBox";

const PANEL_KEY = "captured-element";

/**
 * Sanitize a Tailwind color value extracted from AST.
 * Converts arbitrary values like "[oklch(0.5_0.2_250)]" to "oklch(0.5 0.2 250)"
 */
function cleanTailwindColor(value: string | undefined): string | undefined {
  if (!value) return value;

  // Remove square brackets and replace underscores with spaces
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).replace(/_/g, " ");
  }

  return value;
}

/**
 * Extract the alpha value from a color string.
 * Returns a number between 0 and 1, or 1 if no alpha is present.
 */
function extractAlphaFromColor(colorValue: string): number {
  try {
    const parsed = culori.parse(colorValue);
    if (!parsed || (parsed as any).alpha === undefined) return 1;
    return (parsed as any).alpha;
  } catch {
    return 1;
  }
}

/**
 * Apply an alpha value to a color string, preserving the color components.
 * Returns the color with the new alpha applied.
 */
function applyAlphaToColor(colorValue: string, alpha: number): string {
  try {
    const parsed = culori.parse(colorValue);
    if (!parsed) return colorValue;
    const withAlpha = { ...parsed, alpha };
    const oklch = culori.converter("oklch")(withAlpha as culori.Color) as any;
    if (!oklch) return colorValue;
    const alphaStr = alpha < 1 ? ` / ${alpha.toFixed(4)}` : "";
    const hVal = oklch.h !== undefined ? ((oklch.h % 360) + 360) % 360 : 0;
    return `oklch(${oklch.l?.toFixed(4) ?? 0} ${oklch.c?.toFixed(4) ?? 0} ${hVal.toFixed(4)}${alphaStr})`;
  } catch {
    return colorValue;
  }
}

interface CapturedElementPanelProps {
  node: ComponentNodeAny;
  nodeId: string;
  onDelete?: () => void;
}

type LayoutMode = "block" | "flex" | "grid";

/**
 * Label on the left, control on the right. Rows are grid items of the
 * parent's two-column grid, so the label column is only as wide as the
 * longest label and every control still lines up.
 */
// Icons follow the main axis: a column layout aligns across the horizontal
// axis and justifies down the vertical one, so the pictograms rotate with it.
function alignOptions(column: boolean): SegmentOption<string>[] {
  return [
    {
      value: "start",
      label: "Align start",
      icon: column ? AlignStartVertical : AlignStartHorizontal,
    },
    {
      value: "center",
      label: "Align center",
      icon: column ? AlignCenterVertical : AlignCenterHorizontal,
    },
    {
      value: "end",
      label: "Align end",
      icon: column ? AlignEndVertical : AlignEndHorizontal,
    },
    {
      value: "stretch",
      label: "Stretch",
      icon: column ? StretchHorizontal : StretchVertical,
    },
    { value: "baseline", label: "Baseline", icon: Baseline },
  ];
}

function justifyOptions(column: boolean): SegmentOption<string>[] {
  return [
    {
      value: "start",
      label: "Justify start",
      icon: column ? AlignVerticalJustifyStart : AlignHorizontalJustifyStart,
    },
    {
      value: "center",
      label: "Justify center",
      icon: column ? AlignVerticalJustifyCenter : AlignHorizontalJustifyCenter,
    },
    {
      value: "end",
      label: "Justify end",
      icon: column ? AlignVerticalJustifyEnd : AlignHorizontalJustifyEnd,
    },
    {
      value: "between",
      label: "Space between",
      icon: column ? AlignVerticalSpaceBetween : AlignHorizontalSpaceBetween,
    },
    {
      value: "around",
      label: "Space around",
      icon: column ? AlignVerticalSpaceAround : AlignHorizontalSpaceAround,
    },
    {
      value: "evenly",
      label: "Space evenly",
      icon: column
        ? AlignVerticalDistributeCenter
        : AlignHorizontalDistributeCenter,
    },
  ];
}

const DISPLAY_OPTIONS: {
  mode: LayoutMode;
  label: string;
  blockClass: string;
  inlineClass: string;
}[] = [
  {
    mode: "block",
    label: "Block",
    blockClass: "block",
    inlineClass: "inline-block",
  },
  {
    mode: "flex",
    label: "Flex",
    blockClass: "flex",
    inlineClass: "inline-flex",
  },
  {
    mode: "grid",
    label: "Grid",
    blockClass: "grid",
    inlineClass: "inline-grid",
  },
];

export default function CapturedElementPanel({
  node,
  nodeId,
  onDelete,
}: CapturedElementPanelProps) {
  const astIndex = node.capturedMetadata?.astIndex ?? "";
  const sourceComponentId = node.capturedMetadata?.sourceComponentId ?? "";

  const sourceNode = useProjectStore(
    (state: ProjectStore) => state.nodes[sourceComponentId]
  );
  const updateComponentCode = useProjectStore(
    (state: ProjectStore) => state.updateComponentCode
  );
  const resetCapturedElement = useProjectStore(
    (state: ProjectStore) => state.resetCapturedElement
  );
  const markCapturedNodeEdited = useProjectStore(
    (state: ProjectStore) => state.markCapturedNodeEdited
  );

  const rawExpandedItems = useUIStore(
    (state) => state.expandedAccordions[PANEL_KEY]
  );
  const expandedItems = useMemo(
    () => rawExpandedItems ?? [],
    [rawExpandedItems]
  );
  const setExpandedItems = useUIStore((state) => state.setExpandedItems);

  // Get theme state for color resolution
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);

  // Merge theme state with defaults for color resolution
  const currentStyles = useMemo(
    () => ({
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    }),
    [currentMode, themeState]
  );

  /**
   * Resolve a semantic color token or raw color string to a displayable value.
   * If the color is a semantic token (e.g., "primary"), resolve it to actual hex/oklch.
   * Otherwise, return as-is for custom colors.
   */
  /** Theme token name for a token value ("foreground", "primary/50"); raw
   * colors and gradients return undefined and show as they are. */
  const tokenName = (value: string | undefined) =>
    value && !value.includes("(") && !value.includes("#") ? value : undefined;

  const resolveColorForDisplay = useCallback(
    (colorValue: string | undefined): string | undefined => {
      if (!colorValue) return colorValue;

      // If it contains ( or # or oklch, it's a raw color value, use as-is
      if (colorValue.includes("(") || colorValue.includes("#")) {
        return colorValue;
      }

      // Otherwise, try to resolve as a semantic token
      const resolved = resolveDisplayColor(colorValue, currentStyles);
      return resolved || colorValue;
    },
    [currentStyles]
  );

  const { injectOverride, clearOverrides } = useCapturedStyles(
    nodeId,
    astIndex,
    sourceComponentId,
    currentMode
  );

  /**
   * Synchronize alpha value across both light and dark modes for color properties.
   * When a color with alpha is committed, we apply that alpha to the same color
   * in the opposite theme mode.
   */
  const syncAlphaBetweenModes = useCallback(
    (
      property: "bgColor" | "textColor" | "borderColor",
      newColorValue: string
    ) => {
      if (!sourceNode?.code || !astIndex) return;

      const astIndexNum = parseInt(astIndex, 10);
      if (Number.isNaN(astIndexNum)) return;

      const liveCode = sourceNode.code;
      const oppositeMode = currentMode === "light" ? "dark" : "light";

      // Extract the new alpha value
      const newAlpha = extractAlphaFromColor(newColorValue);

      // Get the current color in the opposite mode
      const currentClasses = extractJsxClassNamesByAstIndex(
        liveCode,
        astIndexNum
      );
      let oppositeColor: string | undefined;

      if (property === "bgColor") {
        oppositeColor = getColorFromClasses(currentClasses, "bg", oppositeMode);
      } else if (property === "textColor") {
        oppositeColor = getColorFromClasses(
          currentClasses,
          "text",
          oppositeMode
        );
      } else if (property === "borderColor") {
        oppositeColor =
          getColorFromClasses(currentClasses, "border", oppositeMode) ||
          getBorderGradientFromStyle(
            extractJsxStyleByAstIndex(liveCode, astIndexNum),
            oppositeMode
          );
      }

      if (!oppositeColor) return;

      // Apply the new alpha to the opposite mode's color
      const cleanedOppositeColor =
        cleanTailwindColor(oppositeColor) || oppositeColor;
      const oppositeColorWithNewAlpha = applyAlphaToColor(
        cleanedOppositeColor,
        newAlpha
      );

      // Update the opposite mode by directly updating the AST
      try {
        const updatedCode = updateJsxClassNameByAstIndex(
          liveCode,
          astIndexNum,
          [
            generateTailwindClass(
              property,
              oppositeColorWithNewAlpha,
              oppositeMode
            ) ?? "",
          ],
          extractJsxClassNamesByAstIndex(liveCode, astIndexNum).filter((c) =>
            isConflictingColorClass(c, property as StyleProperty, oppositeMode)
          )
        );
        if (updatedCode !== liveCode) {
          updateComponentCode(sourceComponentId, updatedCode);
        }
      } catch (err) {
        console.warn(
          "[CapturedElementPanel] Failed to sync alpha to opposite mode:",
          err
        );
      }
    },
    [
      astIndex,
      sourceNode?.code,
      currentMode,
      updateComponentCode,
      sourceComponentId,
    ]
  );

  // Pending commit tracking: after we write new code, we wait for the source component
  // to actually finish compiling and painting before clearing the CSS override.
  // We subscribe to the render-signal emitted by NativeRenderer after each paint,
  // scoped to the source component's nodeId, so we clear at exactly the right moment.
  const pendingClearRef = useRef(false);

  useEffect(() => {
    const unsub = onComponentRendered((renderedNodeId) => {
      if (!pendingClearRef.current) return;
      if (renderedNodeId !== sourceComponentId) return;
      pendingClearRef.current = false;
      // One extra rAF to ensure the browser has composited the new frame
      requestAnimationFrame(() => {
        clearOverrides();
      });
    });
    return unsub;
  }, [sourceComponentId, clearOverrides]);

  /** Schedule a deferred clearOverrides that fires only after the source component re-renders */
  const deferredClearOverrides = useCallback(() => {
    pendingClearRef.current = true;
    // Safety fallback: if the component never re-renders (no-op commit), clear after 1.5s
    setTimeout(() => {
      if (pendingClearRef.current) {
        pendingClearRef.current = false;
        clearOverrides();
      }
    }, 1500);
  }, [clearOverrides]);
  const setComponentPosition = useProjectStore(
    (state: ProjectStore) => state.setComponentPosition
  );
  const setComponentSize = useProjectStore(
    (state: ProjectStore) => state.setComponentSize
  );
  const syncRafRef = useRef<number | null>(null);
  const syncRafInnerRef = useRef<number | null>(null);
  // The element's rendered `display` decides which layout controls apply.
  // Read from the DOM so flex from any source (own classes, a component's
  // built-in styles) counts. Empty until the first measurement.
  const [renderedDisplay, setRenderedDisplay] = useState("");
  // Rendered margin/padding per side, read from the DOM like `display`, so
  // the box model shows real spacing whatever class or component set it.
  const [renderedBox, setRenderedBox] = useState<{
    margin: BoxValues;
    padding: BoxValues;
  } | null>(null);

  /** All rendered copies of the captured JSX element (one unless the tag is
   *  repeated, e.g. inside .map()). */
  const findCapturedElements = useCallback((): HTMLElement[] => {
    if (!sourceComponentId || !astIndex) return [];

    const wrapper = document.querySelector<HTMLElement>(
      `[data-component-id="${CSS.escape(sourceComponentId)}"]`
    );
    if (!wrapper) return [];

    // Find elements by ast-index directly in the DOM
    return Array.from(
      wrapper.querySelectorAll<HTMLElement>(`[data-ast-index="${astIndex}"]`)
    );
  }, [astIndex, sourceComponentId]);

  const syncCapturedNodeBoundingBox = useCallback(() => {
    const elements = findCapturedElements();
    if (elements[0]) {
      const style = getComputedStyle(elements[0]);
      setRenderedDisplay(style.display);
      const read = (prefix: "margin" | "padding"): BoxValues => ({
        top: Math.round(
          parseFloat(style.getPropertyValue(`${prefix}-top`)) || 0
        ),
        right: Math.round(
          parseFloat(style.getPropertyValue(`${prefix}-right`)) || 0
        ),
        bottom: Math.round(
          parseFloat(style.getPropertyValue(`${prefix}-bottom`)) || 0
        ),
        left: Math.round(
          parseFloat(style.getPropertyValue(`${prefix}-left`)) || 0
        ),
      });
      const next = { margin: read("margin"), padding: read("padding") };
      setRenderedBox((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
      );
    }
    const container = document.querySelector<HTMLElement>(
      "[data-canvas-container='true']"
    );
    const liveNode = useProjectStore.getState().nodes[nodeId];
    if (elements.length === 0 || !container || !liveNode?.props) return;

    const containerRect = container.getBoundingClientRect();
    const { panX, panY, zoom } = getLiveCameraState();
    if (zoom <= 0) return;

    // Canvas-space box of each copy. Follow the copy closest to the captured
    // node's current position — initially the copy the user clicked — so the
    // frame and its speech bubble stay on that copy rather than the first.
    let best: { x: number; y: number; w: number; h: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const box = {
        x: Math.round((rect.left - containerRect.left - panX) / zoom),
        y: Math.round((rect.top - containerRect.top - panY) / zoom),
        w: Math.round(rect.width / zoom),
        h: Math.round(rect.height / zoom),
      };
      const distance =
        Math.abs(box.x - liveNode.props.x) + Math.abs(box.y - liveNode.props.y);
      if (distance < bestDistance) {
        best = box;
        bestDistance = distance;
      }
    }
    if (!best) return;

    const { x: nextX, y: nextY, w: nextW, h: nextH } = best;

    if (
      !Number.isFinite(nextX) ||
      !Number.isFinite(nextY) ||
      !Number.isFinite(nextW) ||
      !Number.isFinite(nextH)
    ) {
      return;
    }

    if (liveNode.props.x !== nextX || liveNode.props.y !== nextY) {
      setComponentPosition(nodeId, nextX, nextY);
    }
    if (liveNode.props.w !== nextW || liveNode.props.h !== nextH) {
      setComponentSize(nodeId, nextW, nextH);
    }
  }, [findCapturedElements, nodeId, setComponentPosition, setComponentSize]);

  const scheduleBoundingBoxSync = useCallback(() => {
    if (syncRafRef.current) cancelAnimationFrame(syncRafRef.current);
    if (syncRafInnerRef.current) cancelAnimationFrame(syncRafInnerRef.current);

    // Wait two frames so both live CSS injection and component rerenders settle.
    syncRafRef.current = requestAnimationFrame(() => {
      syncRafInnerRef.current = requestAnimationFrame(() => {
        syncCapturedNodeBoundingBox();
      });
    });
  }, [syncCapturedNodeBoundingBox]);

  useEffect(() => {
    if (!astIndex || !sourceComponentId) return;

    const wrapper = document.querySelector<HTMLElement>(
      `[data-component-id="${CSS.escape(sourceComponentId)}"]`
    );
    if (!wrapper) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleBoundingBoxSync();
    });
    const mutationObserver = new MutationObserver(() => {
      scheduleBoundingBoxSync();
    });

    resizeObserver.observe(wrapper);
    for (const element of findCapturedElements()) {
      resizeObserver.observe(element);
    }
    mutationObserver.observe(wrapper, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", scheduleBoundingBoxSync);
    scheduleBoundingBoxSync();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleBoundingBoxSync);
      if (syncRafRef.current) cancelAnimationFrame(syncRafRef.current);
      if (syncRafInnerRef.current)
        cancelAnimationFrame(syncRafInnerRef.current);
    };
  }, [
    findCapturedElements,
    scheduleBoundingBoxSync,
    astIndex,
    sourceComponentId,
  ]);

  // Derive current classes from source component's code
  // Memoize to ensure stable reference and re-run when sourceNode code changes
  const currentClasses: string[] = useMemo(() => {
    if (!sourceNode?.code || !astIndex) return [];
    try {
      const astIndexNum = parseInt(astIndex, 10);
      if (Number.isNaN(astIndexNum)) return [];
      return extractJsxClassNamesByAstIndex(sourceNode.code, astIndexNum);
    } catch {
      return [];
    }
  }, [sourceNode?.code, astIndex]);

  // Derive current inline style from source component's code
  const currentStyle: string = useMemo(() => {
    if (!sourceNode?.code || !astIndex) return "";
    try {
      const astIndexNum = parseInt(astIndex, 10);
      if (Number.isNaN(astIndexNum)) return "";
      return extractJsxStyleByAstIndex(sourceNode.code, astIndexNum);
    } catch {
      return "";
    }
  }, [sourceNode?.code, astIndex]);

  // ── Derived initial values from current classes ──────────────────────────
  const initSystemRadius = detectSystemRadius(currentClasses, currentStyle);
  const initRadius = getRadiusFromClasses(currentClasses);
  const initSmoothing = initSystemRadius
    ? Number(currentStyles.smoothing) || 0
    : getSmoothingFromStyle(currentStyle);
  const initBorderWidth = getBorderWidthFromClasses(currentClasses);
  const initOpacity = getOpacityFromClasses(currentClasses);
  const initGap = getGapFromClasses(currentClasses);
  const initFlexDirection = getFlexDirectionFromClasses(currentClasses);
  const initAlignItems = getAlignItemsFromClasses(currentClasses);
  const initJustifyContent = getJustifyContentFromClasses(currentClasses);
  const initTextAlign = getTextAlignFromClasses(currentClasses);
  const initBgColor =
    cleanTailwindColor(
      getColorFromClasses(currentClasses, "bg", currentMode)
    ) ?? getGradientFromStyle(currentStyle, currentMode);
  const initTextColor = cleanTailwindColor(
    getColorFromClasses(currentClasses, "text", currentMode)
  );
  const initBorderColor =
    cleanTailwindColor(
      getColorFromClasses(currentClasses, "border", currentMode)
    ) ?? getBorderGradientFromStyle(currentStyle, currentMode);
  const initBoxShadow =
    getModeAwareShadowFromStyle(currentStyle, currentMode) ??
    getShadowFromStyle(currentStyle) ??
    undefined;

  // Local state for slider display values (updated on commit)
  const [radius, setRadius] = useState(initRadius);
  const [smoothing, setSmoothing] = useState(initSmoothing);
  const [borderWidth, setBorderWidth] = useState(initBorderWidth);
  const [opacity, setOpacity] = useState(initOpacity);
  const [gap, setGap] = useState(initGap);
  const [flexDirection, setFlexDirection] = useState(initFlexDirection);
  const [alignItems, setAlignItems] = useState(initAlignItems);
  const [justifyContent, setJustifyContent] = useState(initJustifyContent);
  const [textAlign, setTextAlign] = useState(initTextAlign);
  const [bgColor, setBgColor] = useState(initBgColor);
  const [textColor, setTextColor] = useState(initTextColor);
  const [borderColor, setBorderColor] = useState(initBorderColor);
  const [boxShadow, setBoxShadow] = useState(initBoxShadow);
  const [useSystemRadius, setUseSystemRadius] = useState(initSystemRadius);
  // System switches are preferences: they stay as set across selections.
  const useTailwindTypography = useUIStore((s) => s.systemTypography);
  const setUseTailwindTypography = useUIStore((s) => s.setSystemTypography);
  const useSystemSpacing = useUIStore((s) => s.systemSpacing);
  const setUseSystemSpacing = useUIStore((s) => s.setSystemSpacing);

  // Sync slider state when currentClasses change (re-selection of previously edited element)
  // Also re-run when currentMode changes so color pickers update for the active theme
  useEffect(() => {
    setRadius(initRadius);
    setSmoothing(initSmoothing);
    setBorderWidth(initBorderWidth);
    setOpacity(initOpacity);
    setGap(initGap);
    setFlexDirection(initFlexDirection);
    setAlignItems(initAlignItems);
    setJustifyContent(initJustifyContent);
    setTextAlign(initTextAlign);
    setBgColor(initBgColor);
    setTextColor(initTextColor);
    setBorderColor(initBorderColor);
    setBoxShadow(initBoxShadow);
    setUseSystemRadius(initSystemRadius);
  }, [
    initRadius,
    initSmoothing,
    initBorderWidth,
    initOpacity,
    initGap,
    initFlexDirection,
    initAlignItems,
    initJustifyContent,
    initTextAlign,
    initBgColor,
    initTextColor,
    initBorderColor,
    initBoxShadow,
    initSystemRadius,
  ]);

  const isExpanded = (key: string) => expandedItems.includes(key);
  const handleToggle = (key: string) => {
    setExpandedItems(
      PANEL_KEY,
      isExpanded(key)
        ? expandedItems.filter((id) => id !== key)
        : [...expandedItems, key]
    );
  };

  // ── Commit helper: AST rewrite via ast-index ────────────────────────────────
  /** The element's rendered typography: its classes, overridden by any
   * inline style (which outranks them in the browser). */
  function elementTypography() {
    const code = sourceNode?.code ?? "";
    const index = Number(astIndex);
    const fromClasses = typographyFromClasses(
      extractJsxClassNamesByAstIndex(code, index),
      currentMode
    );
    return {
      ...fromClasses,
      ...inlineTypographyValues(
        extractJsxInlineStyleByAstIndex(code, index),
        Number(fromClasses.fontSize)
      ),
    };
  }

  function commitClass(
    property: StyleProperty,
    value: number | string,
    tokenKey?: string
  ) {
    const liveCode = useProjectStore.getState().nodes[sourceComponentId]?.code;
    if (!liveCode || !astIndex) {
      return;
    }

    const astIndexNum = parseInt(astIndex, 10);
    if (Number.isNaN(astIndexNum)) return;

    if (property in typographyCss) {
      const updated = updateTypographyCode(
        liveCode,
        astIndexNum,
        property as TypographyProperty,
        value,
        currentMode,
        tokenKey
      );
      if (updated !== liveCode) {
        updateComponentCode(sourceComponentId, updated);
        markCapturedNodeEdited(nodeId);
        deferredClearOverrides();
      } else clearOverrides();
      return;
    }

    // Gradients cannot be expressed as Tailwind arbitrary classes (commas break bracket syntax).
    // Write them as mode-aware CSS custom properties + utility class, same as shadow.
    if (property === "bgColor" && isGradientValue(String(value))) {
      // Extract live classes to identify conflicting solid color classes
      const liveClasses = extractJsxClassNamesByAstIndex(liveCode, astIndexNum);
      const conflictingClasses = liveClasses.filter((c) =>
        isConflictingColorClass(c, "bgColor", currentMode)
      );

      const updatedCode = updateJsxModeAwareStyle(
        liveCode,
        astIndexNum,
        "gradient",
        currentMode,
        String(value),
        undefined,
        conflictingClasses
      );
      if (updatedCode !== liveCode) {
        updateComponentCode(sourceComponentId, updatedCode);
        markCapturedNodeEdited(nodeId);
        deferredClearOverrides();
      } else {
        clearOverrides();
      }
      return;
    }

    // Handle Border Gradients
    if (property === "borderColor" && isGradientValue(String(value))) {
      // Extract live classes to identify conflicting solid color classes
      const liveClasses = extractJsxClassNamesByAstIndex(liveCode, astIndexNum);
      const conflictingClasses = liveClasses.filter((c) =>
        isConflictingColorClass(c, "borderColor", currentMode)
      );

      const updatedCode = updateJsxModeAwareStyle(
        liveCode,
        astIndexNum,
        "border",
        currentMode,
        String(value),
        undefined,
        conflictingClasses
      );
      if (updatedCode !== liveCode) {
        updateComponentCode(sourceComponentId, updatedCode);
        markCapturedNodeEdited(nodeId);
        deferredClearOverrides();
      } else {
        clearOverrides();
      }
      return;
    }

    let generatedClass: string | null;

    if (tokenKey) {
      const property_prefix =
        property === "bgColor"
          ? "bg"
          : property === "textColor"
            ? "text"
            : "border";
      // Use semantic class without light:/dark: prefix
      // This allows the class to inherit light/dark mode behavior from Tailwind
      generatedClass = `${property_prefix}-${tokenKey}`;
    } else {
      generatedClass = generateTailwindClass(property, value, currentMode);
    }

    const liveClasses = extractJsxClassNamesByAstIndex(liveCode, astIndexNum);

    const existingStyle = extractJsxStyleByAstIndex(liveCode, astIndexNum);
    const hasGradientBorder =
      existingStyle &&
      (existingStyle.includes("--luova-border-light") ||
        existingStyle.includes("--luova-border-dark"));

    let classesToRemove: string[];
    if (["bgColor", "textColor", "borderColor"].includes(property)) {
      classesToRemove = liveClasses.filter((c) =>
        isConflictingColorClass(c, property as StyleProperty, currentMode)
      );
      // If setting a semantic token, also remove any light:/dark: prefixed versions
      if (tokenKey) {
        const property_prefix =
          property === "bgColor"
            ? "bg"
            : property === "textColor"
              ? "text"
              : "border";
        const lightVersion = `light:${property_prefix}-${tokenKey}`;
        const darkVersion = `dark:${property_prefix}-${tokenKey}`;
        classesToRemove = classesToRemove.filter(
          (c) => c !== lightVersion && c !== darkVersion
        );
        // Add both versions to remove if they exist
        if (liveClasses.includes(lightVersion)) {
          classesToRemove.push(lightVersion);
        }
        if (liveClasses.includes(darkVersion)) {
          classesToRemove.push(darkVersion);
        }
      }
    } else {
      classesToRemove = getConflictingClasses(property, liveClasses);
    }

    const newClass = generatedClass;

    if (
      newClass &&
      liveClasses.includes(newClass) &&
      classesToRemove.length === 1 &&
      classesToRemove[0] === newClass
    ) {
      clearOverrides();
      return;
    }

    try {
      const updatedCode = updateJsxClassNameByAstIndex(
        liveCode,
        astIndexNum,
        newClass ? [newClass] : [],
        classesToRemove
      );

      let resultCode = updatedCode;

      // Clear the corresponding inline style property so it doesn't override
      // the new Tailwind class (inline styles have higher CSS specificity).
      if (property === "textColor") {
        resultCode = updateJsxStyleByAstIndex(
          resultCode,
          astIndexNum,
          "color",
          null
        );
      } else if (property === "bgColor" && !isGradientValue(String(value))) {
        resultCode = updateJsxStyleByAstIndex(
          resultCode,
          astIndexNum,
          "backgroundColor",
          null
        );
      } else if (
        property === "borderColor" &&
        !isGradientValue(String(value))
      ) {
        resultCode = updateJsxStyleByAstIndex(
          resultCode,
          astIndexNum,
          "borderColor",
          null
        );
      }

      // If switching from gradient bg to solid, clean up mode-aware styles
      if (property === "bgColor" && !isGradientValue(String(value))) {
        resultCode = updateJsxModeAwareStyle(
          resultCode,
          astIndexNum,
          "gradient",
          currentMode,
          null
        );
      }

      // If switching from gradient border to solid, clean up mode-aware styles
      // but preserve the border width
      if (property === "borderColor" && !isGradientValue(String(value))) {
        if (hasGradientBorder) {
          const newClasses = extractJsxClassNamesByAstIndex(
            updatedCode,
            astIndexNum
          );
          const existingBorderWidth = getBorderWidthFromClasses(newClasses);
          resultCode = updateJsxModeAwareStyle(
            updatedCode,
            astIndexNum,
            "border",
            currentMode,
            null
          );
          if (existingBorderWidth > 0) {
            resultCode = updateJsxStyleByAstIndex(
              resultCode,
              astIndexNum,
              "--luova-border-width",
              `${existingBorderWidth}px`
            );
          }
        }
      }

      if (resultCode !== liveCode) {
        updateComponentCode(sourceComponentId, resultCode);
        markCapturedNodeEdited(nodeId);
        deferredClearOverrides();
      } else {
        clearOverrides();
      }
    } catch (err) {
      console.warn("[CapturedElementPanel] AST rewrite failed:", err);
      clearOverrides();
    }
  }

  /**
   * Sides whose margin/padding is 0 on a bare element of the same tag in the
   * same parent, so an explicit `-0` class there would be redundant.
   */
  function naturalZeroSides(layer: BoxLayer): Record<BoxSide, boolean> {
    const none = { top: false, right: false, bottom: false, left: false };
    const el = findCapturedElements()[0];
    if (!el?.parentElement) return none;
    const probe = document.createElementNS(el.namespaceURI, el.localName);
    if (!(probe instanceof HTMLElement || probe instanceof SVGElement))
      return none;
    probe.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none";
    el.parentElement.appendChild(probe);
    const style = getComputedStyle(probe);
    const zero = (side: BoxSide) =>
      parseFloat(style.getPropertyValue(`${layer}-${side}`)) === 0;
    const result = {
      top: zero("top"),
      right: zero("right"),
      bottom: zero("bottom"),
      left: zero("left"),
    };
    probe.remove();
    return result;
  }

  /** Rewrite one layer's spacing classes, then refresh the element. */
  function writeSpacingClasses(remove: string[], add: string[]) {
    const liveCode = useProjectStore.getState().nodes[sourceComponentId]?.code;
    const astIndexNum = parseInt(astIndex, 10);
    if (!liveCode || Number.isNaN(astIndexNum)) return;
    const updated =
      remove.length || add.length
        ? updateJsxClassNameByAstIndex(liveCode, astIndexNum, add, remove)
        : liveCode;
    if (updated !== liveCode) {
      updateComponentCode(sourceComponentId, updated);
      markCapturedNodeEdited(nodeId);
      deferredClearOverrides();
    } else {
      clearOverrides();
    }
    scheduleBoundingBoxSync();
  }

  /**
   * Apply a spacing edit to the element's full per-side values and write
   * them back in the shortest form (no `py-4 pt-0 pb-0` pile-ups); a 0 that
   * matches the element's natural value is dropped instead of written.
   */
  function commitSpacing(layer: BoxLayer, sides: BoxSide[], value: number) {
    const liveCode = useProjectStore.getState().nodes[sourceComponentId]?.code;
    const astIndexNum = parseInt(astIndex, 10);
    if (!liveCode || Number.isNaN(astIndexNum)) return;
    const prefix = layer === "padding" ? "p" : "m";
    const { remove, add } = applySpacingEdit(
      extractJsxClassNamesByAstIndex(liveCode, astIndexNum),
      prefix,
      sides,
      spacingToken(value),
      naturalZeroSides(layer)
    );
    writeSpacingClasses(remove, add);
  }

  /** Remove every unprefixed margin and padding class from the element. */
  function resetSpacing() {
    const liveCode = useProjectStore.getState().nodes[sourceComponentId]?.code;
    const astIndexNum = parseInt(astIndex, 10);
    if (!liveCode || Number.isNaN(astIndexNum)) return;
    const remove = extractJsxClassNamesByAstIndex(liveCode, astIndexNum).filter(
      (c) => isSpacingClass(c, "p") || isSpacingClass(c, "m")
    );
    writeSpacingClasses(remove, []);
  }

  if (!astIndex || !sourceNode) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No source component linked to this captured element.
      </div>
    );
  }

  const isInlineDisplay = renderedDisplay.startsWith("inline");
  const layoutMode: LayoutMode = /flex$/.test(renderedDisplay)
    ? "flex"
    : /grid$/.test(renderedDisplay)
      ? "grid"
      : "block";

  // A side counts as set when an unprefixed class covers it: `p-*`, its axis
  // (`py-*` for top) or the side itself (`pt-*`).
  const spacingClasses = extractJsxClassNamesByAstIndex(
    sourceNode.code ?? "",
    Number(astIndex)
  );
  const hasSpacingClasses = spacingClasses.some(
    (c) => isSpacingClass(c, "p") || isSpacingClass(c, "m")
  );
  const SIDE_LETTERS: Record<BoxSide, string> = {
    top: "ty",
    right: "rx",
    bottom: "by",
    left: "lx",
  };
  const boxLayer = (layer: BoxLayer): BoxLayerState => {
    const prefix = layer === "padding" ? "p" : "m";
    const covers = (side: BoxSide, value: string) =>
      spacingClasses.some((c) =>
        new RegExp(`^-?${prefix}[${SIDE_LETTERS[side]}]?-${value}$`).test(c)
      );
    const sideMap = (value: string) => ({
      top: covers("top", value),
      right: covers("right", value),
      bottom: covers("bottom", value),
      left: covers("left", value),
    });
    return {
      values: renderedBox?.[layer] ?? { top: 0, right: 0, bottom: 0, left: 0 },
      set: sideMap("(\\d+(?:\\.\\d+)?|px|auto|\\[[^\\]]+\\])"),
      auto: layer === "margin" ? sideMap("auto") : undefined,
    };
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 h-7 px-2">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          {node.capturedMetadata?.label ?? "Captured Element"}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              resetCapturedElement(nodeId);
              clearOverrides();
            }}
            className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors"
            title="Reset element styles"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors"
              title="Delete element from code"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5 pb-6">
        {/* Text Formatting */}
        <ExpandableCard
          title="Text Formatting"
          isExpanded={isExpanded("text-formatting")}
          onToggle={() => handleToggle("text-formatting")}
          headerAction={
            <div className="flex items-center gap-1.5">
              <Switch
                id="text-system-switch"
                checked={useTailwindTypography}
                onCheckedChange={setUseTailwindTypography}
              />
              <label
                htmlFor="text-system-switch"
                className="text-xs font-medium text-muted-foreground"
              >
                System
              </label>
            </div>
          }
        >
          <TypographyControls
            values={elementTypography()}
            system={useTailwindTypography}
            showColor={false}
            layout="rows"
            onPreview={injectOverride}
            onChange={(property, value, token) => {
              commitClass(property, value, token);
              scheduleBoundingBoxSync();
            }}
            alignment={textAlign}
            onAlign={(align) => {
              setTextAlign(align);
              injectOverride("textAlign", align);
              commitClass("textAlign", align);
              scheduleBoundingBoxSync();
            }}
          />
        </ExpandableCard>

        {/* Spacing */}
        <ExpandableCard
          title="Spacing"
          isExpanded={isExpanded("spacing")}
          onToggle={() => handleToggle("spacing")}
          headerAction={
            <div className="flex items-center gap-1.5">
              {hasSpacingClasses && (
                <button
                  type="button"
                  onClick={resetSpacing}
                  aria-label="Reset spacing"
                  title="Reset spacing (remove margin and padding classes)"
                  className="-my-1 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.94]"
                >
                  <RotateCcw className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
              <Switch
                id="spacing-system-switch"
                checked={useSystemSpacing}
                onCheckedChange={setUseSystemSpacing}
              />
              <label
                htmlFor="spacing-system-switch"
                className="text-xs font-medium text-muted-foreground"
              >
                System
              </label>
            </div>
          }
        >
          <div className="pt-1">
            <SpacingBox
              margin={boxLayer("margin")}
              padding={boxLayer("padding")}
              snap={useSystemSpacing ? snapSpacingPx : Math.round}
              onPreview={(layer, sides, value) => {
                for (const side of sides) {
                  injectOverride(
                    `${layer}${side[0].toUpperCase()}${side.slice(1)}` as StyleProperty,
                    value
                  );
                }
              }}
              onCommit={commitSpacing}
            />
          </div>
        </ExpandableCard>

        {/* Layout */}
        <ExpandableCard
          title="Layout"
          isExpanded={isExpanded("layout")}
          onToggle={() => handleToggle("layout")}
        >
          <div className={ROW_GRID}>
            {renderedDisplay && (
              <PanelRow label="Display">
                <SegmentedControl
                  value={layoutMode}
                  options={DISPLAY_OPTIONS.map((opt) => ({
                    value: opt.mode,
                    label: opt.label,
                  }))}
                  onChange={(mode) => {
                    if (mode === layoutMode) return;
                    const opt = DISPLAY_OPTIONS.find((o) => o.mode === mode);
                    if (!opt) return;
                    // Inline elements keep flowing inline (inline-flex etc.)
                    // so switching layout doesn't make them full width.
                    const cls = isInlineDisplay
                      ? opt.inlineClass
                      : opt.blockClass;
                    setRenderedDisplay(cls);
                    injectOverride("display", cls);
                    commitClass("display", cls);
                    scheduleBoundingBoxSync();
                  }}
                />
              </PanelRow>
            )}
            {layoutMode === "flex" && (
              <PanelRow label="Direction">
                <SegmentedControl
                  value={flexDirection}
                  options={[
                    { value: "row", label: "Row", icon: ArrowRight },
                    { value: "col", label: "Column", icon: ArrowDown },
                  ]}
                  onChange={(value) => {
                    setFlexDirection(value);
                    injectOverride("flexDirection", value);
                    commitClass("flexDirection", value);
                    scheduleBoundingBoxSync();
                  }}
                />
              </PanelRow>
            )}
            {layoutMode !== "block" && (
              <>
                <PanelRow label="Align">
                  <SegmentedControl
                    value={alignItems}
                    options={alignOptions(
                      layoutMode === "flex" && flexDirection === "col"
                    )}
                    onChange={(value) => {
                      setAlignItems(value);
                      injectOverride("alignItems", value);
                      commitClass("alignItems", value);
                      scheduleBoundingBoxSync();
                    }}
                  />
                </PanelRow>
                <PanelRow label="Justify">
                  <SegmentedControl
                    value={justifyContent}
                    options={justifyOptions(
                      layoutMode === "flex" && flexDirection === "col"
                    )}
                    onChange={(value) => {
                      setJustifyContent(value);
                      injectOverride("justifyContent", value);
                      commitClass("justifyContent", value);
                      scheduleBoundingBoxSync();
                    }}
                  />
                </PanelRow>
                <PanelRow label="Gap">
                  <SliderWithInput
                    label="Gap"
                    icon={
                      layoutMode === "flex" && flexDirection === "col" ? (
                        <SeparatorHorizontal className="size-3.5" />
                      ) : (
                        <SeparatorVertical className="size-3.5" />
                      )
                    }
                    unit="px"
                    value={gap}
                    min={0}
                    max={96}
                    step={4}
                    onChange={setGap}
                    onChangeImmediate={(v) => {
                      injectOverride("gap", v);
                    }}
                    onCommit={(v) => {
                      setGap(v);
                      commitClass("gap", v);
                      scheduleBoundingBoxSync();
                    }}
                  />
                </PanelRow>
              </>
            )}
          </div>
        </ExpandableCard>

        {/* Shape */}
        <ExpandableCard
          title="Shape"
          isExpanded={isExpanded("shape")}
          onToggle={() => handleToggle("shape")}
          headerAction={
            <div className="flex items-center gap-1.5">
              <Switch
                id="shape-system-switch"
                checked={useSystemRadius}
                onCheckedChange={(checked) => {
                  const liveCode =
                    useProjectStore.getState().nodes[sourceComponentId]?.code;
                  const astIndexNum = parseInt(astIndex, 10);
                  if (!liveCode || Number.isNaN(astIndexNum)) return;

                  setUseSystemRadius(checked);
                  const updatedCode = checked
                    ? injectSystemRadius(liveCode, astIndexNum)
                    : removeSystemRadius(liveCode, astIndexNum);

                  if (checked) {
                    setSmoothing(Number(currentStyles.smoothing) || 0);
                  } else {
                    setRadius(0);
                    setSmoothing(0);
                  }

                  if (updatedCode !== liveCode) {
                    updateComponentCode(sourceComponentId, updatedCode);
                    markCapturedNodeEdited(nodeId);
                  }
                  clearOverrides();
                }}
              />
              <label
                htmlFor="shape-system-switch"
                className="text-xs font-medium text-muted-foreground"
              >
                System
              </label>
            </div>
          }
        >
          <div className={ROW_GRID}>
            {!useSystemRadius && (
              <>
                <PanelRow label="Radius">
                  <SliderWithInput
                    label="Radius"
                    icon={<SquareRoundCorner className="size-3.5" />}
                    unit="px"
                    value={radius}
                    min={0}
                    max={100}
                    step={2}
                    onChange={setRadius}
                    onChangeImmediate={(v) => {
                      setUseSystemRadius(false);
                      injectOverride("borderRadius", v);
                    }}
                    onCommit={(v) => {
                      setUseSystemRadius(false);
                      setRadius(v);
                      const liveCode =
                        useProjectStore.getState().nodes[sourceComponentId]
                          ?.code;
                      const astIndexNum = parseInt(astIndex, 10);
                      if (liveCode && !Number.isNaN(astIndexNum)) {
                        const updatedCode = removeSystemRadius(
                          liveCode,
                          astIndexNum
                        );
                        if (updatedCode !== liveCode) {
                          updateComponentCode(sourceComponentId, updatedCode);
                          markCapturedNodeEdited(nodeId);
                        }
                      }
                      commitClass("borderRadius", v);
                      scheduleBoundingBoxSync();
                    }}
                  />
                </PanelRow>
                <PanelRow label="Smoothing">
                  <SliderWithInput
                    label="Smoothing"
                    icon={<Squircle className="size-3.5" />}
                    unit="%"
                    value={smoothing}
                    min={0}
                    max={100}
                    step={1}
                    onChange={setSmoothing}
                    onChangeImmediate={(v) => {
                      setUseSystemRadius(false);
                      injectOverride("smoothing", v);
                    }}
                    onCommit={(v) => {
                      setUseSystemRadius(false);
                      setSmoothing(v);
                      const liveCode =
                        useProjectStore.getState().nodes[sourceComponentId]
                          ?.code;
                      const astIndexNum = parseInt(astIndex, 10);
                      if (!liveCode || Number.isNaN(astIndexNum)) {
                        clearOverrides();
                        return;
                      }
                      const baseCode = removeSystemRadius(
                        liveCode,
                        astIndexNum
                      );
                      const updatedCode = updateJsxStyleByAstIndex(
                        baseCode,
                        astIndexNum,
                        "--smoothing",
                        String(v)
                      );
                      if (updatedCode !== liveCode) {
                        updateComponentCode(sourceComponentId, updatedCode);
                        markCapturedNodeEdited(nodeId);
                        deferredClearOverrides();
                      } else {
                        clearOverrides();
                      }
                      scheduleBoundingBoxSync();
                    }}
                  />
                </PanelRow>
              </>
            )}
            <PanelRow label="Border">
              <SliderWithInput
                label="Border width"
                icon={<Square className="size-3.5" />}
                unit="px"
                value={borderWidth}
                min={0}
                max={8}
                step={0.5}
                onChange={setBorderWidth}
                onChangeImmediate={(v) => {
                  injectOverride("borderWidth", v);
                }}
                onCommit={(v) => {
                  setBorderWidth(v);
                  commitClass("borderWidth", v);

                  // If element has gradient border, also update the width variable
                  const liveCode =
                    useProjectStore.getState().nodes[sourceComponentId]?.code;
                  if (liveCode && astIndex) {
                    const astIndexNum = parseInt(astIndex, 10);
                    if (!Number.isNaN(astIndexNum)) {
                      const liveClasses = extractJsxClassNamesByAstIndex(
                        liveCode,
                        astIndexNum
                      );
                      if (liveClasses.includes("luova-border-themed")) {
                        const widthValue = v > 0 ? `${v}px` : "0px";
                        const updatedCode = updateJsxStyleByAstIndex(
                          liveCode,
                          astIndexNum,
                          "--luova-border-width",
                          widthValue
                        );
                        if (updatedCode !== liveCode) {
                          updateComponentCode(sourceComponentId, updatedCode);
                          markCapturedNodeEdited(nodeId);
                        }
                      }
                    }
                  }

                  scheduleBoundingBoxSync();
                }}
              />
            </PanelRow>
          </div>
        </ExpandableCard>

        {/* Colors */}
        <ExpandableCard
          title="Colors"
          isExpanded={isExpanded("colors")}
          onToggle={() => handleToggle("colors")}
        >
          <div className={ROW_GRID}>
            <PanelRow label="Fill">
              <OptimizedColorPicker
                color={resolveColorForDisplay(bgColor)}
                onChange={(color, tokenKey) => {
                  const finalVal = tokenKey || color;
                  setBgColor(finalVal);
                }}
                onChangeImmediate={(color, _tokenKey) => {
                  injectOverride("bgColor", color);
                }}
                onChangeCommit={(color, tokenKey) => {
                  const finalVal = tokenKey || color;
                  setBgColor(finalVal);
                  commitClass("bgColor", color, tokenKey);
                  // Sync alpha to opposite mode for non-token colors
                  if (!tokenKey && !isGradientValue(color)) {
                    syncAlphaBetweenModes("bgColor", color);
                  }
                  scheduleBoundingBoxSync();
                }}
                label="Fill"
                variant="row"
                displayValue={tokenName(bgColor)}
                enableGradient={true}
                showOpacity={true}
              />
            </PanelRow>
            <PanelRow label="Text">
              <OptimizedColorPicker
                color={resolveColorForDisplay(textColor)}
                onChange={(color, tokenKey) => {
                  const finalVal = tokenKey || color;
                  setTextColor(finalVal);
                }}
                onChangeImmediate={(color, _tokenKey) => {
                  injectOverride("textColor", color);
                }}
                onChangeCommit={(color, tokenKey) => {
                  const finalVal = tokenKey || color;
                  setTextColor(finalVal);
                  commitClass("textColor", color, tokenKey);
                  // Sync alpha to opposite mode for non-token colors
                  if (!tokenKey && !isGradientValue(color)) {
                    syncAlphaBetweenModes("textColor", color);
                  }
                  scheduleBoundingBoxSync();
                }}
                label="Text"
                variant="row"
                displayValue={tokenName(textColor)}
                showOpacity={true}
              />
            </PanelRow>
            <PanelRow label="Border">
              <OptimizedColorPicker
                color={resolveColorForDisplay(borderColor)}
                onChange={(color, tokenKey) => {
                  const finalVal = tokenKey || color;
                  setBorderColor(finalVal);
                }}
                onChangeImmediate={(color, _tokenKey) => {
                  injectOverride("borderColor", color);
                }}
                onChangeCommit={(color, tokenKey) => {
                  const finalVal = tokenKey || color;
                  setBorderColor(finalVal);
                  commitClass("borderColor", color, tokenKey);
                  // Sync alpha to opposite mode for non-token colors (note: borderColor doesn't support gradient opacity in the UI)
                  if (!tokenKey && !isGradientValue(color)) {
                    syncAlphaBetweenModes("borderColor", color);
                  }
                  scheduleBoundingBoxSync();
                }}
                label="Border"
                variant="row"
                displayValue={tokenName(borderColor)}
                enableGradient={true}
                showOpacity={false}
              />
            </PanelRow>
          </div>
        </ExpandableCard>

        {/* Effects */}
        <ExpandableCard
          title="Effects"
          isExpanded={isExpanded("effects")}
          onToggle={() => handleToggle("effects")}
        >
          <div className={ROW_GRID}>
            <PanelRow label="Shadow">
              <ShadowSelect
                variant="row"
                icon={<Layers2 />}
                value={boxShadow}
                onChange={(val) => {
                  setBoxShadow(val);
                  // Apply shadow via inline style override (60fps preview)
                  injectOverride("boxShadow", val);

                  // Persist shadow as mode-aware CSS custom property
                  const liveCode =
                    useProjectStore.getState().nodes[sourceComponentId]?.code;
                  if (!liveCode || !astIndex) return;

                  const astIndexNum = parseInt(astIndex, 10);
                  if (Number.isNaN(astIndexNum)) return;

                  const updatedCode = updateJsxModeAwareStyle(
                    liveCode,
                    astIndexNum,
                    "shadow",
                    currentMode,
                    val === "none" ? null : val
                  );

                  updateComponentCode(sourceComponentId, updatedCode);
                  markCapturedNodeEdited(nodeId);
                  scheduleBoundingBoxSync();
                }}
                label="Shadow"
              />
            </PanelRow>
            <PanelRow label="Opacity">
              <SliderWithInput
                label="Opacity"
                icon={<Droplet className="size-3.5" />}
                unit="%"
                value={opacity}
                min={0}
                max={100}
                step={5}
                onChange={setOpacity}
                onChangeImmediate={(v) => {
                  injectOverride("opacity", v);
                }}
                onCommit={(v) => {
                  setOpacity(v);
                  commitClass("opacity", v);
                  scheduleBoundingBoxSync();
                }}
              />
            </PanelRow>
          </div>
        </ExpandableCard>
      </div>
    </div>
  );
}
