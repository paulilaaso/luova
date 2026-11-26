"use client";

import { Lock, Maximize2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/luova-ui/input";
import { Label } from "@/components/luova-ui/label";
import { Switch } from "@/components/luova-ui/switch";
import { useCapturedStyles } from "@/hooks/use-captured-styles";
import { cn } from "@/lib/luova-utils";
import type { AppStore } from "@/stores/app-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { normalizeLayerOrder } from "@/stores/slices/canvas-hierarchy-slice";
import {
  type TextAlignment,
  useTextFormatStore,
} from "@/stores/text-format-store";
import { useThemeStore } from "@/stores/theme-store";
import type { AssetMeta } from "@/stores/types";
import { useUIStore } from "@/stores/ui-store";
import {
  COMPONENT_SIZING_TRAITS,
  type ContentAlignment,
} from "@/types/builder";
import { getDescendantAstIndices } from "@/utils/ast-indexer";
import {
  extractJsxClassNamesByAstIndex,
  updateJsxClassNameByAstIndex,
} from "@/utils/ast-modifier-v2";
import { onComponentRendered } from "@/utils/canvas-style-manager";
import {
  buildImageCode,
  type ImageAdjustments,
  readImageAsBase64,
} from "@/utils/file-helpers";
import { extractInnerJsx, wrapInnerJsx } from "@/utils/html-to-jsx";
import {
  getSharedBlockClasses,
  resetInnerJsxToPlainText,
} from "@/utils/rich-text";
import {
  getConflictingClasses,
  getTextAlignFromClasses,
  type StyleProperty,
} from "@/utils/tailwind-mapping";
import {
  type TypographyProperty,
  typographyFromClasses,
} from "@/utils/text-typography";
import {
  updateTextAlignmentCode,
  updateTypographyCode,
} from "@/utils/typography-commit";
import CapturedElementPanel from "./CapturedElementPanel";
import GridSettingsSection from "./GridSettingsSection";
import { OptimizedColorPicker } from "./OptimizedColorPicker";
import { SliderWithInput } from "./SliderWithInput";
import { TextBlockFormatControls } from "./TextBlockFormatControls";
import { TypographyControls } from "./TypographyControls";
import { ExpandableCard } from "./ui/ExpandableCard";

const PANEL_KEY = "components";

const ALIGNMENTS: ContentAlignment[][] = [
  ["top-left", "top-center", "top-right"],
  ["center-left", "center", "center-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

interface ComponentPropsFormProps {
  onDelete: () => void;
}

export default function ComponentPropsForm({
  onDelete,
}: ComponentPropsFormProps) {
  const textSession = useTextFormatStore((s) => s.session);
  const textController = useTextFormatStore((s) => s.controller);
  const selectedIds = useUIStore((state) => state.selectedIds);
  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const rootId = useProjectStore((state: ProjectStore) => state.rootId);
  const layerOrder = useProjectStore((state: ProjectStore) => state.layerOrder);
  const selectedId = selectedIds[0] ?? null;
  const selectedNode = selectedId ? nodes[selectedId] : null;
  const updateComponentProps = useProjectStore(
    (state: ProjectStore) => state.updateComponentProps
  );
  const updateComponentPropsImmediate = useProjectStore(
    (state: ProjectStore) => state.updateComponentPropsImmediate
  );
  const updateComponentCode = useProjectStore(
    (state: ProjectStore) => state.updateComponentCode
  );
  const assets = useProjectStore((state: ProjectStore) => state.assets);

  // Calculate z-index from layer order position
  const effectiveLayerOrder = useMemo(() => {
    return normalizeLayerOrder(layerOrder, nodes, rootId);
  }, [layerOrder, nodes, rootId]);
  const zIndex = selectedId ? effectiveLayerOrder.indexOf(selectedId) + 1 : 0;
  const setNodeZIndex = useProjectStore(
    (state: AppStore) => state.setNodeZIndex
  );
  const withBatchedHistory = useProjectStore(
    (state: AppStore) => state.withBatchedHistory
  );

  // Local input state so typing/backspacing never jumps between keypresses.
  const [zInput, setZInput] = useState<string>("");
  // Sync local input when selection or external layer order changes
  // (e.g. Undo, Bring to Front).
  useEffect(() => {
    setZInput(zIndex > 0 ? String(zIndex) : "");
  }, [zIndex]);

  const commitZValue = (raw: string) => {
    if (!selectedId) return;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const maxZ = effectiveLayerOrder.length;
    if (parsed < 1 || parsed > maxZ) return;
    if (parsed === zIndex) return;
    withBatchedHistory(() => {
      setNodeZIndex(selectedId, parsed);
    });
  };

  const commitZIndex = () => {
    // On blur/Enter: restore the display for empty/invalid input, otherwise
    // clamp into range and commit (no-op when already in sync).
    if (zInput.trim() === "" || Number.isNaN(parseInt(zInput, 10))) {
      setZInput(zIndex > 0 ? String(zIndex) : "");
      return;
    }
    const maxZ = effectiveLayerOrder.length;
    const clamped = Math.max(1, Math.min(maxZ, parseInt(zInput, 10)));
    if (clamped !== parseInt(zInput, 10)) setZInput(String(clamped));
    commitZValue(String(clamped));
  };
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const expandedItems = useUIStore(
    (state) => state.expandedAccordions[PANEL_KEY] || []
  );
  const setExpandedItems = useUIStore((state) => state.setExpandedItems);

  const isExpanded = (value: string) => expandedItems.includes(value);

  const handleToggle = (value: string) => {
    if (isExpanded(value)) {
      setExpandedItems(
        PANEL_KEY,
        expandedItems.filter((id) => id !== value)
      );
    } else {
      setExpandedItems(PANEL_KEY, [...expandedItems, value]);
    }
  };

  const currentMode = useThemeStore((state) => state.currentMode);
  const { injectOverride, clearOverrides } = useCapturedStyles(
    selectedId ?? "",
    "0",
    selectedId ?? "",
    currentMode,
    selectedNode?.type === "Text"
  );

  // Pending commit tracking: after we write new code, we wait for the component
  // to actually finish compiling and painting before clearing the CSS override.
  // We subscribe to the render-signal emitted by NativeRenderer after each paint,
  // scoped to the component's nodeId, so we clear at exactly the right moment.
  const pendingClearRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useTailwindTypography = useUIStore((s) => s.systemTypography);
  const setUseTailwindTypography = useUIStore((s) => s.setSystemTypography);

  useEffect(() => {
    const unsub = onComponentRendered((renderedNodeId) => {
      if (!pendingClearRef.current) return;
      if (renderedNodeId !== selectedId) return;
      pendingClearRef.current = false;
      // One extra rAF to ensure the browser has composited the new frame
      requestAnimationFrame(() => {
        clearOverrides();
      });
    });
    return () => {
      unsub();
      pendingClearRef.current = false;
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [selectedId, clearOverrides]);

  /** Schedule a deferred clearOverrides that fires only after the component re-renders */
  const deferredClearOverrides = useRef(() => {});
  deferredClearOverrides.current = () => {
    pendingClearRef.current = true;
    // Safety fallback: if the component never re-renders (no-op commit), clear after 1.5s
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      if (pendingClearRef.current) {
        pendingClearRef.current = false;
        clearOverrides();
      }
    }, 1500);
  };

  const commitClass = (
    property: TypographyProperty,
    value: string | number,
    tokenKey?: string
  ) => {
    if (!selectedId || !selectedNode) return;
    if (textController?.nodeId === selectedId) {
      textController.flush();
      textController.clearProperty(property);
      textController.flush();
    }
    const liveCode = useProjectStore.getState().nodes[selectedId]?.code;
    if (!liveCode) return;

    const updatedCode = updateTypographyCode(
      liveCode,
      0,
      property as TypographyProperty,
      value,
      currentMode,
      tokenKey,
      // Applying typography to the whole text block overrides any per-run
      // formatting nested inside it, so the block value actually takes effect.
      { stripDescendants: true }
    );

    if (updatedCode !== liveCode) {
      updateComponentCode(selectedId, updatedCode);
      deferredClearOverrides.current();
    } else {
      clearOverrides();
    }
  };

  const handleResetText = () => {
    if (!selectedId || !selectedNode) return;

    // While the node is open in the live editor, typography may exist as
    // pending run/block styles that aren't committed to the code yet. Reset
    // those too — otherwise they'd be serialized back in on commit and the
    // reset would appear to do nothing.
    if (textController?.nodeId === selectedId) {
      textController.flush();
      textController.resetText();
      textController.flush();
    }

    const liveCode = useProjectStore.getState().nodes[selectedId]?.code;
    if (!liveCode) return;

    // Properties to reset — the whole typography surface the sidebar can set.
    const propsToReset: StyleProperty[] = [
      "fontSize",
      "fontWeight",
      "fontFamily",
      "lineHeight",
      "letterSpacing",
      "wordSpacing",
      "fontStyle",
      "textDecoration",
      "textColor",
    ];

    // Strip conflicting classes from the block and every nested element so
    // committed per-run formatting is cleared too.
    const astIndices = [0, ...getDescendantAstIndices(liveCode, 0)];
    let updatedCode = liveCode;
    for (const astIndex of astIndices) {
      const classes = extractJsxClassNamesByAstIndex(updatedCode, astIndex);
      const classesToRemove = propsToReset.flatMap((prop) =>
        getConflictingClasses(prop, classes)
      );
      if (classesToRemove.length) {
        updatedCode = updateJsxClassNameByAstIndex(
          updatedCode,
          astIndex,
          [], // Add nothing, just reset to defaults
          classesToRemove
        );
      }
    }

    // Collapse leftover structure (headings/quotes/lists, empty formatting
    // spans) back to plain paragraphs so the reset truly reads as plain text.
    updatedCode = wrapInnerJsx(
      updatedCode,
      resetInnerJsxToPlainText(extractInnerJsx(updatedCode))
    );

    if (updatedCode !== liveCode) {
      updateComponentCode(selectedId, updatedCode);
      deferredClearOverrides.current();
    } else {
      clearOverrides();
    }
  };

  if (!selectedId || !selectedNode) {
    return (
      <div className="p-4 w-full min-h-[200px]">
        <div className="flex items-center justify-between mb-4 h-7 px-2">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
            Canvas
          </h2>
        </div>
        <div className="space-y-5">
          <ExpandableCard
            title="Grid Settings"
            isExpanded={isExpanded("grid-settings")}
            onToggle={() => handleToggle("grid-settings")}
          >
            <GridSettingsSection />
          </ExpandableCard>
        </div>
      </div>
    );
  }

  const traits = COMPONENT_SIZING_TRAITS[selectedNode.type];
  const widthMode =
    selectedNode.props.widthMode ?? traits?.widthMode ?? "fixed";
  const heightMode =
    selectedNode.props.heightMode ?? traits?.heightMode ?? "fixed";

  // Typography values/handlers shared by the text toolbar and the rest of the
  // formatting panel. While a range is selected the live session drives them;
  // otherwise they read from (and commit to) the node's classes.
  const textValues =
    textSession?.nodeId === selectedId
      ? textSession.values
      : typographyFromClasses(
          [
            ...extractJsxClassNamesByAstIndex(selectedNode.code, 0),
            // Classes every block shares (an H1's size/weight) win in CSS,
            // so the fields show them, not the element's own value.
            ...(selectedNode.type === "Text"
              ? getSharedBlockClasses(extractInnerJsx(selectedNode.code))
              : []),
          ],
          currentMode
        );
  const explicitAlignments =
    selectedNode.type === "Text"
      ? [0, ...getDescendantAstIndices(selectedNode.code, 0)]
          .flatMap((index) =>
            getConflictingClasses(
              "textAlign",
              extractJsxClassNamesByAstIndex(selectedNode.code, index)
            )
          )
          .map((cls) => getTextAlignFromClasses([cls]) as TextAlignment)
      : [];
  const componentAlignment: TextAlignment | null =
    explicitAlignments.length === 0
      ? "left"
      : explicitAlignments.every((value) => value === explicitAlignments[0])
        ? explicitAlignments[0]
        : null;
  const activeTextController =
    textController?.nodeId === selectedId ? textController : null;
  const textAlignment = activeTextController
    ? activeTextController.alignment === ""
      ? componentAlignment
      : activeTextController.alignment
    : componentAlignment;
  const textOnChange = (
    property: TypographyProperty,
    value: string | number,
    tokenKey?: string
  ) => {
    const liveSession = useTextFormatStore.getState().session;
    if (liveSession?.nodeId === selectedId)
      liveSession.apply(property, value, tokenKey);
    else commitClass(property, value, tokenKey);
  };
  const textOnPreview = (
    property: TypographyProperty,
    value: string | number
  ) => {
    const liveSession = useTextFormatStore.getState().session;
    if (liveSession?.nodeId === selectedId)
      liveSession.preview(property, value);
    else injectOverride(property, value);
  };
  const textOnAlign = (alignment: TextAlignment) => {
    const liveController = useTextFormatStore.getState().controller;
    if (liveController?.nodeId === selectedId) {
      liveController.formatAlignment(alignment);
      return;
    }
    if (!selectedId) return;
    const liveCode = useProjectStore.getState().nodes[selectedId]?.code;
    if (!liveCode) return;
    injectOverride("textAlign", alignment);
    const updatedCode = updateTextAlignmentCode(liveCode, alignment);
    if (updatedCode !== liveCode) {
      updateComponentCode(selectedId, updatedCode);
      deferredClearOverrides.current();
    } else clearOverrides();
  };

  // ── Captured element: delegate to dedicated panel ──────────────────────────
  if (selectedNode.kind === "captured") {
    return (
      <div className="p-4 w-full min-h-[200px]">
        <CapturedElementPanel
          node={selectedNode}
          nodeId={selectedId}
          onDelete={onDelete}
        />
      </div>
    );
  }

  const imageFileName =
    selectedNode.type === "Image"
      ? ((selectedNode.props.fileName as string | undefined) ??
        (selectedNode.props.alt as string | undefined))
      : undefined;

  return (
    <div className="p-4 w-full min-h-[200px]">
      <div className="flex items-center justify-between mb-4 h-7 px-2 gap-2">
        <h2
          className="text-muted-foreground text-sm font-semibold tracking-wider uppercase truncate max-w-[180px]"
          title={
            imageFileName
              ? `${selectedNode.type} — ${imageFileName}`
              : selectedNode.type
          }
        >
          {selectedNode.type === "Image" && imageFileName
            ? imageFileName
            : selectedNode.type}
        </h2>
        <div className="flex items-center gap-1">
          {selectedNode.type === "Text" && (
            <button
              type="button"
              onClick={handleResetText}
              className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors"
              title="Reset text formatting"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {selectedId !== "root" && (
            <button
              type="button"
              onClick={onDelete}
              className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors"
              title="Delete component"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5 pb-6">
        {selectedNode.type === "Text" && (
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
            <div className="space-y-3">
              <TextBlockFormatControls
                nodeId={selectedId}
                values={textValues}
                onChange={textOnChange}
                alignment={textAlignment}
                onAlign={textOnAlign}
              />
              <TypographyControls
                values={textValues}
                system={useTailwindTypography}
                onChange={textOnChange}
                onPreview={textOnPreview}
                showInlineFormats={false}
                layout="rows"
              />
            </div>
          </ExpandableCard>
        )}

        <ExpandableCard
          title="Layout"
          isExpanded={isExpanded("layout")}
          onToggle={() => handleToggle("layout")}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <SliderWithInput
                label="X Position"
                value={selectedNode.props.x}
                onChangeImmediate={(val) =>
                  updateComponentPropsImmediate(selectedId, { x: val })
                }
                onCommit={(val) => updateComponentProps(selectedId, { x: val })}
                onChange={(val) => updateComponentProps(selectedId, { x: val })}
                min={-10000}
                max={10000}
                step={1}
              />
              <SliderWithInput
                label="Y Position"
                value={selectedNode.props.y}
                onChangeImmediate={(val) =>
                  updateComponentPropsImmediate(selectedId, { y: val })
                }
                onCommit={(val) => updateComponentProps(selectedId, { y: val })}
                onChange={(val) => updateComponentProps(selectedId, { y: val })}
                min={-10000}
                max={10000}
                step={1}
              />
              <div className="space-y-1.5">
                <Label htmlFor="prop-w" className="text-xs font-medium">
                  Width
                </Label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-pressed={widthMode === "fixed"}
                    aria-label={`Lock width`}
                    title={
                      widthMode === "fixed"
                        ? "Width locked — click for auto (hug content)"
                        : "Lock width to a fixed value"
                    }
                    onClick={() =>
                      updateComponentProps(selectedId, {
                        widthMode: widthMode === "fixed" ? "auto" : "fixed",
                      })
                    }
                    className={cn(
                      "h-7 w-7 shrink-0 rounded-md border flex items-center justify-center transition-colors",
                      widthMode === "fixed"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-accent"
                    )}
                  >
                    <Lock className="h-3 w-3" />
                  </button>
                  {widthMode === "fixed" ? (
                    <div className="flex-1">
                      <SliderWithInput
                        label=""
                        value={selectedNode.props.w ?? 0}
                        onChangeImmediate={(val) =>
                          updateComponentPropsImmediate(selectedId, { w: val })
                        }
                        onCommit={(val) =>
                          updateComponentProps(selectedId, { w: val })
                        }
                        onChange={(val) =>
                          updateComponentProps(selectedId, { w: val })
                        }
                        min={0}
                        max={10000}
                        step={1}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 relative">
                      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-7 h-full pointer-events-none">
                        <Maximize2 className="h-3 w-3 text-muted-foreground opacity-50" />
                      </div>
                      <Input
                        disabled
                        className="h-7 pl-7 text-xs text-right tabular-nums"
                        placeholder="Auto"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-h" className="text-xs font-medium">
                  Height
                </Label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-pressed={heightMode === "fixed"}
                    aria-label={`Lock height`}
                    title={
                      heightMode === "fixed"
                        ? "Height locked — click for auto (hug content)"
                        : "Lock height to a fixed value"
                    }
                    onClick={() =>
                      updateComponentProps(selectedId, {
                        heightMode: heightMode === "fixed" ? "auto" : "fixed",
                      })
                    }
                    className={cn(
                      "h-7 w-7 shrink-0 rounded-md border flex items-center justify-center transition-colors",
                      heightMode === "fixed"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-accent"
                    )}
                  >
                    <Lock className="h-3 w-3" />
                  </button>
                  {heightMode === "fixed" ? (
                    <div className="flex-1">
                      <SliderWithInput
                        label=""
                        value={selectedNode.props.h ?? 0}
                        onChangeImmediate={(val) =>
                          updateComponentPropsImmediate(selectedId, { h: val })
                        }
                        onCommit={(val) =>
                          updateComponentProps(selectedId, { h: val })
                        }
                        onChange={(val) =>
                          updateComponentProps(selectedId, { h: val })
                        }
                        min={0}
                        max={10000}
                        step={1}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 relative">
                      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-7 h-full pointer-events-none">
                        <Maximize2 className="h-3 w-3 text-muted-foreground opacity-50" />
                      </div>
                      <Input
                        disabled
                        className="h-7 pl-7 text-xs text-right tabular-nums"
                        placeholder="Auto"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-medium">Content Alignment</Label>
              <div className="grid grid-cols-3 gap-px bg-border rounded-md overflow-hidden">
                {ALIGNMENTS.map((row) => (
                  <div key={row[0]} className="contents">
                    {row.map((alignment) => {
                      const isActive =
                        selectedNode.props.alignment === alignment;
                      return (
                        <button
                          key={alignment}
                          type="button"
                          aria-pressed={isActive}
                          data-state={isActive ? "active" : "inactive"}
                          onClick={() =>
                            updateComponentProps(selectedId, {
                              alignment: isActive ? undefined : alignment,
                            })
                          }
                          className={cn(
                            "h-6 flex items-center justify-center transition-colors outline-none bg-muted/30 hover:bg-muted data-[state=active]:bg-primary/20",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          title={alignment.replace(/-/g, " ")}
                        >
                          <div
                            className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              isActive ? "bg-primary" : "bg-muted-foreground/50"
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Z Index</Label>
                <Input
                  type="number"
                  value={zInput}
                  onChange={(e) => {
                    // Live-apply valid values so the canvas re-stacks while
                    // typing; the local string state keeps the caret stable.
                    setZInput(e.target.value);
                    commitZValue(e.target.value);
                  }}
                  onBlur={commitZIndex}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitZIndex();
                    }
                  }}
                  min="1"
                  max={effectiveLayerOrder.length}
                  className="h-8 text-xs text-center tabular-nums"
                />
              </div>
            </div>
          </div>
        </ExpandableCard>

        <ExpandableCard
          title="Grid Settings"
          isExpanded={isExpanded("grid-settings")}
          onToggle={() => handleToggle("grid-settings")}
        >
          <GridSettingsSection />
        </ExpandableCard>

        {selectedNode.type === "Image" && (
          <ExpandableCard
            title="Image Settings"
            isExpanded={isExpanded("image-settings")}
            onToggle={() => handleToggle("image-settings")}
          >
            <div className="space-y-3">
              <input
                ref={replaceImageInputRef}
                type="file"
                accept="image/gif,image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !selectedId) return;
                  e.target.value = "";
                  try {
                    const base64 = await readImageAsBase64(file);
                    const fileName = file.name;
                    const assetId = useProjectStore
                      .getState()
                      .addAsset(base64, fileName);
                    // Preserve svgFillLight/svgFillDark if replacing with another SVG
                    const currentSvgFillLight =
                      selectedNode?.props.svgFillLight;
                    const currentSvgFillDark = selectedNode?.props.svgFillDark;
                    const isSvg = file.type === "image/svg+xml";
                    const imageAdjustments = {
                      ...(isSvg && (currentSvgFillLight || currentSvgFillDark)
                        ? {
                            svgFillLight: currentSvgFillLight,
                            svgFillDark: currentSvgFillDark,
                          }
                        : {}),
                      // Carry over existing adjustments so filters survive replacement
                      brightness:
                        (selectedNode?.props.brightness as number) ?? 1,
                      contrast: (selectedNode?.props.contrast as number) ?? 1,
                      blur: (selectedNode?.props.blur as number) ?? 0,
                      hueRotate: (selectedNode?.props.hueRotate as number) ?? 0,
                      rotation: (selectedNode?.props.rotation as number) ?? 0,
                      opacity: (selectedNode?.props.opacity as number) ?? 1,
                      fileName,
                      alt: fileName,
                    } as ImageAdjustments;
                    updateComponentCode(
                      selectedId,
                      buildImageCode(assetId, imageAdjustments)
                    );
                    updateComponentProps(selectedId, {
                      fileName,
                      alt: fileName,
                    });
                  } catch (err) {
                    console.error("Failed to replace image:", err);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => replaceImageInputRef.current?.click()}
                className="w-full h-8 rounded-md border border-border bg-muted/40 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Replace Image
              </button>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <SliderWithInput
                  label="Rotation"
                  value={(selectedNode.props.rotation as number) ?? 0}
                  onChangeImmediate={(val) =>
                    updateComponentPropsImmediate(selectedId, { rotation: val })
                  }
                  onCommit={(val) => {
                    updateComponentProps(selectedId, { rotation: val });
                    // Retrofit minimal image code if needed
                    const code = selectedNode.code || "";
                    if (!code.includes("brightness")) {
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            rotation: val,
                            brightness:
                              (selectedNode.props.brightness as number) ?? 1,
                            contrast:
                              (selectedNode.props.contrast as number) ?? 1,
                            blur: (selectedNode.props.blur as number) ?? 0,
                            hueRotate:
                              (selectedNode.props.hueRotate as number) ?? 0,
                            opacity:
                              (selectedNode.props.opacity as number) ?? 1,
                            svgFillLight: selectedNode.props
                              .svgFillLight as string,
                            svgFillDark: selectedNode.props
                              .svgFillDark as string,
                          })
                        );
                      }
                    }
                  }}
                  onChange={(val) =>
                    updateComponentProps(selectedId, { rotation: val })
                  }
                  min={-180}
                  max={180}
                  step={1}
                />
                <SliderWithInput
                  label="Brightness"
                  value={(selectedNode.props.brightness as number) ?? 1}
                  onChangeImmediate={(val) =>
                    updateComponentPropsImmediate(selectedId, {
                      brightness: val,
                    })
                  }
                  onCommit={(val) => {
                    updateComponentProps(selectedId, { brightness: val });
                    // Retrofit minimal image code if needed
                    const code = selectedNode.code || "";
                    if (!code.includes("brightness")) {
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            brightness: val,
                            rotation:
                              (selectedNode.props.rotation as number) ?? 0,
                            contrast:
                              (selectedNode.props.contrast as number) ?? 1,
                            blur: (selectedNode.props.blur as number) ?? 0,
                            hueRotate:
                              (selectedNode.props.hueRotate as number) ?? 0,
                            opacity:
                              (selectedNode.props.opacity as number) ?? 1,
                            svgFillLight: selectedNode.props
                              .svgFillLight as string,
                            svgFillDark: selectedNode.props
                              .svgFillDark as string,
                          })
                        );
                      }
                    }
                  }}
                  onChange={(val) =>
                    updateComponentProps(selectedId, { brightness: val })
                  }
                  min={0}
                  max={2}
                  step={0.01}
                />
                <SliderWithInput
                  label="Contrast"
                  value={(selectedNode.props.contrast as number) ?? 1}
                  onChangeImmediate={(val) =>
                    updateComponentPropsImmediate(selectedId, { contrast: val })
                  }
                  onCommit={(val) => {
                    updateComponentProps(selectedId, { contrast: val });
                    // Retrofit minimal image code if needed
                    const code = selectedNode.code || "";
                    if (!code.includes("brightness")) {
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            contrast: val,
                            brightness:
                              (selectedNode.props.brightness as number) ?? 1,
                            rotation:
                              (selectedNode.props.rotation as number) ?? 0,
                            blur: (selectedNode.props.blur as number) ?? 0,
                            hueRotate:
                              (selectedNode.props.hueRotate as number) ?? 0,
                            opacity:
                              (selectedNode.props.opacity as number) ?? 1,
                            svgFillLight: selectedNode.props
                              .svgFillLight as string,
                            svgFillDark: selectedNode.props
                              .svgFillDark as string,
                          })
                        );
                      }
                    }
                  }}
                  onChange={(val) =>
                    updateComponentProps(selectedId, { contrast: val })
                  }
                  min={0}
                  max={2}
                  step={0.01}
                />
                <SliderWithInput
                  label="Blur"
                  value={(selectedNode.props.blur as number) ?? 0}
                  onChangeImmediate={(val) =>
                    updateComponentPropsImmediate(selectedId, { blur: val })
                  }
                  onCommit={(val) => {
                    updateComponentProps(selectedId, { blur: val });
                    // Retrofit minimal image code if needed
                    const code = selectedNode.code || "";
                    if (!code.includes("brightness")) {
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            blur: val,
                            brightness:
                              (selectedNode.props.brightness as number) ?? 1,
                            contrast:
                              (selectedNode.props.contrast as number) ?? 1,
                            rotation:
                              (selectedNode.props.rotation as number) ?? 0,
                            hueRotate:
                              (selectedNode.props.hueRotate as number) ?? 0,
                            opacity:
                              (selectedNode.props.opacity as number) ?? 1,
                            svgFillLight: selectedNode.props
                              .svgFillLight as string,
                            svgFillDark: selectedNode.props
                              .svgFillDark as string,
                          })
                        );
                      }
                    }
                  }}
                  onChange={(val) =>
                    updateComponentProps(selectedId, { blur: val })
                  }
                  min={0}
                  max={20}
                  step={1}
                />
                <SliderWithInput
                  label="Hue"
                  value={(selectedNode.props.hueRotate as number) ?? 0}
                  onChangeImmediate={(val) =>
                    updateComponentPropsImmediate(selectedId, {
                      hueRotate: val,
                    })
                  }
                  onCommit={(val) => {
                    updateComponentProps(selectedId, { hueRotate: val });
                    // Retrofit minimal image code if needed
                    const code = selectedNode.code || "";
                    if (!code.includes("brightness")) {
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            hueRotate: val,
                            brightness:
                              (selectedNode.props.brightness as number) ?? 1,
                            contrast:
                              (selectedNode.props.contrast as number) ?? 1,
                            blur: (selectedNode.props.blur as number) ?? 0,
                            rotation:
                              (selectedNode.props.rotation as number) ?? 0,
                            opacity:
                              (selectedNode.props.opacity as number) ?? 1,
                            svgFillLight: selectedNode.props
                              .svgFillLight as string,
                            svgFillDark: selectedNode.props
                              .svgFillDark as string,
                          })
                        );
                      }
                    }
                  }}
                  onChange={(val) =>
                    updateComponentProps(selectedId, { hueRotate: val })
                  }
                  min={0}
                  max={360}
                  step={1}
                />
                <SliderWithInput
                  label="Opacity"
                  value={(selectedNode.props.opacity as number) ?? 1}
                  onChangeImmediate={(val) =>
                    updateComponentPropsImmediate(selectedId, {
                      opacity: val,
                    })
                  }
                  onCommit={(val) => {
                    updateComponentProps(selectedId, { opacity: val });
                    // Retrofit minimal image code if needed
                    const code = selectedNode.code || "";
                    if (!code.includes("brightness")) {
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            opacity: val,
                            brightness:
                              (selectedNode.props.brightness as number) ?? 1,
                            contrast:
                              (selectedNode.props.contrast as number) ?? 1,
                            blur: (selectedNode.props.blur as number) ?? 0,
                            hueRotate:
                              (selectedNode.props.hueRotate as number) ?? 0,
                            rotation:
                              (selectedNode.props.rotation as number) ?? 0,
                            svgFillLight: selectedNode.props
                              .svgFillLight as string,
                            svgFillDark: selectedNode.props
                              .svgFillDark as string,
                          })
                        );
                      }
                    }
                  }}
                  onChange={(val) =>
                    updateComponentProps(selectedId, { opacity: val })
                  }
                  min={0}
                  max={1}
                  step={0.01}
                />
              </div>
              {(() => {
                const code = selectedNode.code || "";
                const assetIdMatch = code.match(/asset:image-[a-zA-Z0-9]+/);
                const assetId = assetIdMatch ? assetIdMatch[0] : null;
                const assetMeta: AssetMeta | undefined = assetId
                  ? assets[assetId]
                  : undefined;
                const isSvg = assetMeta?.mimeType === "image/svg+xml";

                if (!isSvg) return null;

                // Get the current mode's fill value
                const svgFillLight =
                  (selectedNode.props.svgFillLight as string) ?? "";
                const svgFillDark =
                  (selectedNode.props.svgFillDark as string) ?? "";
                const currentColor =
                  currentMode === "dark" ? svgFillDark : svgFillLight;

                return (
                  <OptimizedColorPicker
                    label={`SVG Fill (${currentMode})`}
                    color={currentColor}
                    onChange={(val) => {
                      const updateProps =
                        currentMode === "dark"
                          ? { svgFillDark: val }
                          : { svgFillLight: val };
                      updateComponentPropsImmediate(selectedId, updateProps);
                    }}
                    onChangeCommit={(val, tokenKey) => {
                      let fillValue = val;
                      // If a semantic token was selected, use CSS variable reference
                      if (tokenKey) {
                        fillValue = `var(--${tokenKey})`;
                      }
                      const updateProps =
                        currentMode === "dark"
                          ? { svgFillDark: fillValue }
                          : { svgFillLight: fillValue };
                      updateComponentProps(selectedId, updateProps);
                      const code = selectedNode.code || "";
                      const assetIdMatch = code.match(
                        /asset:image-[a-zA-Z0-9]+/
                      );
                      const assetId = assetIdMatch ? assetIdMatch[0] : null;
                      if (assetId) {
                        const newSvgFillLight =
                          currentMode === "dark"
                            ? svgFillLight
                            : fillValue || undefined;
                        const newSvgFillDark =
                          currentMode === "dark"
                            ? fillValue || undefined
                            : svgFillDark;
                        // Also include adjustment props to handle retrofit
                        updateComponentCode(
                          selectedId,
                          buildImageCode(assetId, {
                            svgFillLight: newSvgFillLight,
                            svgFillDark: newSvgFillDark,
                            brightness:
                              (selectedNode.props.brightness as number) ?? 1,
                            contrast:
                              (selectedNode.props.contrast as number) ?? 1,
                            blur: (selectedNode.props.blur as number) ?? 0,
                            hueRotate:
                              (selectedNode.props.hueRotate as number) ?? 0,
                            rotation:
                              (selectedNode.props.rotation as number) ?? 0,
                            opacity:
                              (selectedNode.props.opacity as number) ?? 1,
                          })
                        );
                      }
                    }}
                    enableGradient={true}
                  />
                );
              })()}
            </div>
          </ExpandableCard>
        )}
      </div>
    </div>
  );
}
