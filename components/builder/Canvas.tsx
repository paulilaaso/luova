"use client";

import { useDroppable } from "@dnd-kit/core";
import { MotionGlobalConfig } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/luova-ui/context-menu";
import { useAlignmentShortcuts } from "@/hooks/use-alignment-shortcuts";
import { useCanvasCamera } from "@/hooks/use-canvas-camera";
import { useCanvasFileDrop } from "@/hooks/use-canvas-file-drop";
import { useCanvasInteractions } from "@/hooks/use-canvas-interactions";
import { useThemeCSS } from "@/hooks/use-theme-css";
import { useUndoRedo } from "@/hooks/use-unified-history";
import { cn } from "@/lib/luova-utils";
import { useCanvasStore } from "@/stores/canvas-store";
import type { ProjectStore } from "@/stores/project-store";
import { useProjectStore } from "@/stores/project-store";
import { type CodeReveal, useUIStore } from "@/stores/ui-store";

import AnnotationOverlay from "./AnnotationOverlay";
import { CanvasCrashFallback } from "./CanvasErrorFallback";
import CanvasRenderer from "./CanvasRenderer";
import CapturedCopiesOverlay from "./CapturedCopiesOverlay";
import { LiveErrorBoundary } from "./ErrorBoundary";
import GridOverlay from "./GridOverlay";
import InspectorOverlay from "./InspectorOverlay";
import MarqueeSelection from "./MarqueeSelection";
import WireframeDrawer from "./WireframeDrawer";
import ZoomControls from "./ZoomControls";

/**
 * Canvas Component
 * The main workspace where users build their UI
 * Uses 2D spatial positioning with absolute coordinates
 * Canvas automatically expands as components move beyond visible area
 */

export default function Canvas() {
  const rootId = useProjectStore((state: ProjectStore) => state.rootId);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const setPropertiesTab = useUIStore((state) => state.setPropertiesTab);
  const selectedIds = useUIStore((state) => state.selectedIds);
  const previewMode = useUIStore((state) => state.previewMode);
  const inspectorMode = useUIStore((state) => state.inspectorMode);
  const copyComponents = useProjectStore(
    (state: ProjectStore) => state.copyComponents
  );
  const cutComponents = useProjectStore(
    (state: ProjectStore) => state.cutComponents
  );
  const pasteComponents = useProjectStore(
    (state: ProjectStore) => state.pasteComponents
  );
  const duplicateComponents = useProjectStore(
    (state: ProjectStore) => state.duplicateComponents
  );
  const canUndo = useProjectStore((state: ProjectStore) => state.canUndo());
  const canRedo = useProjectStore((state: ProjectStore) => state.canRedo());
  const { undo, redo } = useUndoRedo();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contextMenuCanvasPosition = useRef<{ x: number; y: number } | null>(
    null
  );
  // Element under the cursor at right-click in Edit mode, for "Go to Code".
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);

  useThemeCSS();

  const { setNodeRef: setDroppableRef } = useDroppable({ id: "main-canvas" });

  useEffect(() => {
    MotionGlobalConfig.skipAnimations = !previewMode && selectedIds.length > 0;
  }, [selectedIds.length, previewMode]);

  // Initialize keyboard shortcuts for alignment
  useAlignmentShortcuts();

  // Initialize camera controls (zoom, pan, space+drag, middle-click drag)
  useCanvasCamera({ containerRef, canvasRef, enabled: !previewMode });

  // Handle native OS image file drops onto the canvas
  useCanvasFileDrop(containerRef);

  const { onCanvasPointerDown, onCanvasDoubleClick } = useCanvasInteractions();

  const bounds = useProjectStore(
    useShallow((state: ProjectStore) => {
      if (!previewMode) return null;

      // Create a filtered list of valid selected IDs (excluding root and
      // any stale IDs whose nodes no longer exist, e.g. discarded overlays)
      const filteredSelectedIds = selectedIds.filter(
        (id) => id !== state.rootId && Boolean(state.nodes[id])
      );
      const hasValidSelection = filteredSelectedIds.length > 0;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let hasContent = false;

      const nodes = Object.values(state.nodes);
      for (const node of nodes) {
        if (node.id === state.rootId) continue;
        if (node.kind === "captured" || node.kind === "draft") continue;

        // If there's an active valid selection, only include selected nodes
        if (hasValidSelection && !filteredSelectedIds.includes(node.id))
          continue;

        hasContent = true;
        const x = node.props.x;
        const y = node.props.y;
        const w = node.props.w ?? 100;
        const h = node.props.h ?? 50;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }

      if (!hasContent || minX === Infinity) {
        return { width: "100%", height: "100%", offsetX: 0, offsetY: 0 };
      }

      // Add padding
      const padding = 100;
      return {
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
        offsetX: -minX + padding,
        offsetY: -minY + padding,
      };
    })
  );

  const { width, height, offsetX, offsetY } = bounds || {
    width: "100%",
    height: "100%",
    offsetX: 0,
    offsetY: 0,
  };

  // Preview uses native scrolling. Reset that scroll offset before returning to
  // the transformed canvas, otherwise hidden scroll state shifts the camera/grid.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (previewMode) {
      canvas.style.transform = "";
      return;
    }

    if (container) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }

    const { panX, panY, zoom } = useCanvasStore.getState();
    canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
  }, [previewMode]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={containerRef}
        className={cn(
          "flex-1 min-h-0 w-full relative scrollbar-thin text-foreground",
          previewMode
            ? "block overflow-auto bg-canvas"
            : "flex flex-col overflow-hidden"
        )}
        data-canvas-container="true"
        onClick={(e) => {
          // Deselect when clicking on the canvas background
          if (e.target === e.currentTarget && !previewMode) {
            // Blur first so an active text editor commits before unmount.
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            clearSelection();
            // Exit theme mode — switch back to create
            const propertiesTab = useUIStore.getState().propertiesTab;
            if (propertiesTab === "theme") {
              setPropertiesTab("components");
            }
          }
        }}
        onContextMenu={(e) => {
          // Disable right-click menus in preview mode
          if (previewMode) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          const target = e.target as HTMLElement;
          const inEditMode = useUIStore.getState().inspectorMode;
          if (inEditMode) {
            setCodeTarget(findCodeTarget(e.clientX, e.clientY));
          }
          // Allow right-click inside selected non-wireframe component content (e.g. ContextMenu components).
          // In Edit mode the canvas menu (with "Go to Code") always opens.
          const frame = target.closest<HTMLElement>(".canvas-frame");
          if (frame && !inEditMode) {
            const id = frame.getAttribute("data-node-id");
            const kind = frame.getAttribute("data-node-kind");
            const currentSelectedIds = useUIStore.getState().selectedIds;
            if (id && currentSelectedIds.includes(id) && kind !== "wireframe") {
              return;
            }
          }
          // Capture canvas coordinates from right-click position
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const { panX, panY, zoom } = useCanvasStore.getState();
            contextMenuCanvasPosition.current = {
              x: (e.clientX - rect.left - panX) / zoom,
              y: (e.clientY - rect.top - panY) / zoom,
            };
          }
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* Editor workspace background.
            In preview mode the container becomes a scroll box, so `fixed`
            keeps the background pinned to the viewport across the entire
            scrollable area — an `absolute inset-0` element only covers the
            initial viewport height and scrolls away, leaving the uncovered
            area to fall back to :root's (live theme) background. */}
        <div
          data-app-chrome="true"
          className={cn(
            "z-0 pointer-events-none",
            previewMode ? "fixed inset-0" : "absolute inset-0"
          )}
          style={{ backgroundColor: "var(--background)" }}
        />

        {/* Infinite Grid - fixed to viewport, behind canvas */}
        {!previewMode && <GridOverlay containerRef={containerRef} />}

        {/* biome-ignore lint/a11y/noStaticElementInteractions: Canvas drawing surface — remapping to <button> breaks HTML nesting rules and triggers React hydration failures */}
        <div
          role="presentation"
          ref={(node) => {
            canvasRef.current = node;
            setDroppableRef(node);
          }}
          className="relative origin-top-left"
          data-canvas="true"
          onPointerDown={previewMode ? undefined : onCanvasPointerDown}
          onDoubleClick={previewMode ? undefined : onCanvasDoubleClick}
          style={
            previewMode
              ? { width, height, minWidth: "100%", minHeight: "100%" }
              : undefined
          }
        >
          {/* Wrapper div that applies preview crop offset */}
          <div
            style={{
              transform: previewMode
                ? `translate(${offsetX}px, ${offsetY}px)`
                : "translate(0px, 0px)",
            }}
          >
            <LiveErrorBoundary
              resetOnChange={rootId}
              fallback={(error) => <CanvasCrashFallback error={error} />}
            >
              <CanvasRenderer nodeId={rootId} />
            </LiveErrorBoundary>
          </div>

          {/* Annotation bezier connectors + bubbles — inside canvas transform
            so pan/zoom is handled natively by the browser. */}
          {!previewMode && <AnnotationOverlay />}

          {/* Outlines every copy of a selected captured element, below the
            prompt bubbles */}
          {!previewMode && <CapturedCopiesOverlay />}

          {/* Marquee Selection Box - inside zoomed canvas for correct coordinates */}
          {!previewMode && (
            <MarqueeSelection
              containerRef={containerRef}
              canvasRef={canvasRef}
            />
          )}

          {/* Wireframe Drawer - inside zoomed canvas so overlay coords match zoom/pan */}
          {!previewMode && (
            <WireframeDrawer
              containerRef={containerRef}
              canvasRef={canvasRef}
            />
          )}
        </div>

        {!previewMode && (
          <>
            {/* Inspector overlay: hover highlight for element capture */}
            <InspectorOverlay />

            {/* Floating zoom controls — bottom-right, pointer-events only on the button */}
            <div
              className="absolute bottom-4 right-6 z-50 pointer-events-none"
              data-app-chrome="true"
            >
              <div className="pointer-events-auto">
                <ZoomControls />
              </div>
            </div>
          </>
        )}

        {/* Toasts are app UI: they follow the locked theme, not the canvas. */}
        <div data-app-chrome="true" className="contents">
          <Toaster position="bottom-center" />
        </div>
      </ContextMenuTrigger>

      {!previewMode && (
        <ContextMenuContent className="w-48" data-app-chrome="true">
          <ContextMenuItem
            onClick={() => {
              if (selectedIds.length > 0) {
                useProjectStore.getState().withBatchedHistory(() => {
                  cutComponents(selectedIds);
                });
                clearSelection();
              }
            }}
            disabled={selectedIds.length === 0}
          >
            Cut
            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              if (selectedIds.length > 0) {
                copyComponents(selectedIds);
              }
            }}
            disabled={selectedIds.length === 0}
          >
            Copy
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              const pos = contextMenuCanvasPosition.current ?? undefined;
              const newIds = useProjectStore
                .getState()
                .withBatchedHistory(() => {
                  return pasteComponents(pos);
                });
              useUIStore.getState().selectComponents(newIds);
            }}
            disabled={useProjectStore.getState().clipboard.length === 0}
          >
            Paste
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              if (selectedIds.length > 0) {
                const newIds = useProjectStore
                  .getState()
                  .withBatchedHistory(() => {
                    return duplicateComponents(selectedIds);
                  });
                if (newIds.length > 0) {
                  useUIStore.getState().selectComponents(newIds);
                }
              }
            }}
            disabled={selectedIds.length === 0}
          >
            Duplicate
            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onClick={undo} disabled={!canUndo}>
            Undo
            <ContextMenuShortcut>⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={redo} disabled={!canRedo}>
            Redo
            <ContextMenuShortcut>⇧⌘Z</ContextMenuShortcut>
          </ContextMenuItem>

          {inspectorMode && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  if (codeTarget) {
                    useUIStore
                      .getState()
                      .revealInCode(
                        codeTarget.selectId,
                        codeTarget.reveal,
                        codeTarget.capturedId
                      );
                  }
                }}
                disabled={!codeTarget}
              >
                Go to Code
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

interface CodeTarget {
  /** Node to select (always the component that owns the code). */
  selectId: string;
  reveal: CodeReveal;
  /** Captured element under the pointer, whose speech bubble gets hidden. */
  capturedId?: string;
}

/**
 * Finds the JSX element under the pointer for "Go to Code": a captured
 * element resolves to its source tag; otherwise the deepest element with a
 * data-ast-index inside a component; otherwise the component itself.
 */
function findCodeTarget(clientX: number, clientY: number): CodeTarget | null {
  const canvas = document.querySelector("[data-canvas='true']");
  if (!canvas) return null;
  const { nodes, rootId } = useProjectStore.getState();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!canvas.contains(el)) continue;
    const frame = el.closest<HTMLElement>("[data-component-id]");
    const id = frame?.getAttribute("data-component-id");
    const node = id ? nodes[id] : undefined;
    if (!id || !node || id === rootId) continue;

    if (node.kind === "captured") {
      const meta = node.capturedMetadata;
      if (!meta) continue;
      return {
        selectId: meta.sourceComponentId,
        reveal: {
          componentId: meta.sourceComponentId,
          astIndex: Number.parseInt(meta.astIndex, 10),
        },
        capturedId: id,
      };
    }
    if (!node.code) continue;
    const indexed = el.closest<HTMLElement>("[data-ast-index]");
    const astIndex =
      indexed && frame?.contains(indexed)
        ? Number.parseInt(indexed.getAttribute("data-ast-index") ?? "", 10)
        : Number.NaN;
    return {
      selectId: id,
      reveal: {
        componentId: id,
        astIndex: Number.isNaN(astIndex) ? null : astIndex,
      },
    };
  }
  return null;
}
