"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { ComponentNodeAny, GridConfig } from "@/types/builder";
import { getRealNodeSize } from "@/utils/spatial-engine";
import { useProjectStore } from "./project-store";
import { useUIStore } from "./ui-store";

// ---------------------------------------------------------------------------
// Live Camera Singleton — millisecond-accurate source of truth for pointer math
// Zustand is debounced; this object is always current at 60fps.
// ---------------------------------------------------------------------------
const LIVE_CAMERA_STATE = { panX: 0, panY: 0, zoom: 1 };

export function getLiveCameraState() {
  return LIVE_CAMERA_STATE;
}

export function setLiveCameraState(panX: number, panY: number, zoom: number) {
  LIVE_CAMERA_STATE.panX = panX;
  LIVE_CAMERA_STATE.panY = panY;
  LIVE_CAMERA_STATE.zoom = zoom;
}

/**
 * Zoom to `newZoom` while keeping the target point fixed on screen.
 * If a selection exists, pivots around the selected items' center.
 * Otherwise, pivots around the viewport center.
 * Reads from the live camera singleton for the freshest values,
 * then writes to the Zustand store via `setCamera`.
 *
 * Shared by keyboard shortcuts and dropdown controls so zoom
 * always pivots from the same point.
 */
export function zoomAroundViewportCenter(newZoom: number) {
  const container = document.querySelector("[data-canvas-container]");
  if (!container) return;
  const { panX, panY, zoom: curZoom } = LIVE_CAMERA_STATE;
  const rect = container.getBoundingClientRect();

  // Determine the target canvas coordinates to pivot around
  let targetCanvasX: number;
  let targetCanvasY: number;

  // Check if there's an active selection
  const selectedIds = useUIStore
    .getState()
    .selectedIds.filter((id) => id !== "root");
  if (selectedIds.length > 0) {
    // If selection exists, calculate the center of the selected items' bounding box
    const { minX, minY, maxX, maxY } = getNodesBoundingBox();
    targetCanvasX = minX + (maxX - minX) / 2;
    targetCanvasY = minY + (maxY - minY) / 2;
  } else {
    // Otherwise, use the viewport center in canvas coordinates
    targetCanvasX = (rect.width / 2 - panX) / curZoom;
    targetCanvasY = (rect.height / 2 - panY) / curZoom;
  }

  // Calculate the current screen coordinates of this target
  const targetScreenX = targetCanvasX * curZoom + panX;
  const targetScreenY = targetCanvasY * curZoom + panY;

  // Calculate the new pan values to keep the target at the same screen coordinates
  const nextPanX = targetScreenX - targetCanvasX * newZoom;
  const nextPanY = targetScreenY - targetCanvasY * newZoom;

  useCanvasStore.getState().setCamera(nextPanX, nextPanY, newZoom);
}

const DEFAULT_GRID_CONFIG: GridConfig = {
  gridSize: 20,
  gridColor: "#e0e0e0",
  gridOpacity: 1,
  snapToGrid: true,
  showGrid: true,
  snapTolerance: 5,
};

const ZOOM_FACTOR = 1.25;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 20;
const FIT_PADDING = 80;

const ANNOTATION_W = 200;
const ANNOTATION_BUBBLE_H = 110;
const DEFAULT_ANN_X = 60;
const DEFAULT_ANN_Y = -20;

function getNodesBoundingBox() {
  const { nodes, rootId } = useProjectStore.getState();
  const selectedIds = useUIStore
    .getState()
    .selectedIds.filter((id) => id !== "root");

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasNodes = false;

  for (const node of Object.values(nodes) as ComponentNodeAny[]) {
    if (node.id === rootId) continue;
    if (node.kind === "captured") continue;

    // If a selection exists, only calculate bounds for selected nodes
    if (selectedIds.length > 0 && !selectedIds.includes(node.id)) continue;

    hasNodes = true;
    const x = node.props.x;
    const y = node.props.y;
    const w = node.props.w ?? 100;
    const h = node.props.h ?? 50;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);

    // Include annotation bubble bounds for annotated nodes
    if (
      (node.kind as string) === "wireframe" ||
      (node.kind as string) === "captured"
    ) {
      const anchorX = x + w;
      const anchorY = y + h / 2;
      const offset = node.annotationOffset ?? {
        x: DEFAULT_ANN_X,
        y: DEFAULT_ANN_Y,
      };
      const bubbleX = anchorX + offset.x;
      const bubbleY = anchorY + offset.y;
      maxX = Math.max(maxX, bubbleX + ANNOTATION_W);
      maxY = Math.max(maxY, bubbleY + ANNOTATION_BUBBLE_H);
      minX = Math.min(minX, bubbleX);
      minY = Math.min(minY, bubbleY);
    }
  }

  if (!hasNodes) {
    return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  }

  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Shared cluster camera centering
// Used by both project import and AI generation so every "bring the new
// elements into view" flow computes the bounding box, viewport dimensions and
// pan offsets with identical math.
// ---------------------------------------------------------------------------

export interface ClusterBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

/** Fallback viewport used only when neither a container nor `window` exist. */
const FALLBACK_VIEWPORT = { width: 1024, height: 768 };

/**
 * Computes the axis-aligned bounding box and center of a cluster of nodes.
 * Undefined (or non-positive) dimensions fall back to the node's live DOM
 * size, then to `getRealNodeSize`'s defaults. Nodes missing from the map are
 * ignored; returns `null` when no measurable node is present.
 */
export function getClusterBounds(
  nodeIds: Iterable<string>,
  nodes: Record<
    string,
    { id: string; props: { x?: number; y?: number; w?: number; h?: number } }
  > = useProjectStore.getState().nodes as unknown as Record<
    string,
    { id: string; props: { x?: number; y?: number; w?: number; h?: number } }
  >
): ClusterBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasNode = false;

  for (const id of nodeIds) {
    const node = nodes[id];
    if (!node?.props) continue;

    const x = Number(node.props.x) || 0;
    const y = Number(node.props.y) || 0;
    const measured = getRealNodeSize(node);
    const rawW = Number(node.props.w);
    const rawH = Number(node.props.h);
    const width = Number.isFinite(rawW) && rawW > 0 ? rawW : measured.w;
    const height = Number.isFinite(rawH) && rawH > 0 ? rawH : measured.h;

    hasNode = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  if (!hasNode || !Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Resolves the size of the drawable canvas viewport. Prefers the measured
 * `[data-canvas-container]` element (so open sidebars / the properties panel
 * are excluded) and only falls back to raw `window` dimensions when the
 * container is unavailable (headless / test environments).
 */
export function resolveViewportSize(container?: Element | null): {
  width: number;
  height: number;
} {
  const el =
    container ??
    (typeof document !== "undefined"
      ? document.querySelector("[data-canvas-container]")
      : null);

  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    const cw = (el as HTMLElement).clientWidth;
    const ch = (el as HTMLElement).clientHeight;
    if (cw > 0 && ch > 0) {
      return { width: cw, height: ch };
    }
  }

  if (typeof window !== "undefined") {
    return {
      width: window.innerWidth || FALLBACK_VIEWPORT.width,
      height: window.innerHeight || FALLBACK_VIEWPORT.height,
    };
  }

  return { ...FALLBACK_VIEWPORT };
}

export interface CenterCameraOptions {
  /** Explicit container element (defaults to `[data-canvas-container]`). */
  container?: Element | null;
}

/**
 * Pans the camera so the center of `rect` sits at the center of the viewport,
 * preserving the current zoom. Zoom is read from the live camera singleton for
 * the freshest value (Zustand updates are debounced).
 */
export function centerCameraOnRect(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  options: CenterCameraOptions = {}
): void {
  const centerX = (rect.minX + rect.maxX) / 2;
  const centerY = (rect.minY + rect.maxY) / 2;
  const { width, height } = resolveViewportSize(options.container);
  const { zoom } = getLiveCameraState();
  useCanvasStore
    .getState()
    .setPan(width / 2 - centerX * zoom, height / 2 - centerY * zoom);
}

/**
 * Centers the camera on the bounding box of the given node ids. No-op when
 * the list is empty or none of the ids resolve to a measurable node.
 */
export function centerCameraOnNodes(
  nodeIds: string[],
  options: CenterCameraOptions = {}
): void {
  if (!nodeIds || nodeIds.length === 0) return;
  const bounds = getClusterBounds(nodeIds);
  if (!bounds) return;
  centerCameraOnRect(bounds, options);
}

export interface CanvasRenderState {
  gridConfig: GridConfig;
  panX: number;
  panY: number;
  zoom: number;
  isCanvasDragging: boolean;
  isCanvasResizing: boolean;
}

export interface CanvasRenderActions {
  updateGridConfig: (config: Partial<GridConfig>) => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;
  setGridSizeImmediate: (size: number) => void;
  setGridColor: (color: string) => void;
  setGridOpacity: (opacity: number) => void;
  setGridOpacityImmediate: (opacity: number) => void;
  setSnapTolerance: (tolerance: number) => void;
  setPan: (x: number, y: number) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (viewportWidth: number, viewportHeight: number) => void;
  zoomTo100: (viewportWidth: number, viewportHeight: number) => void;
  setCamera: (panX: number, panY: number, zoom: number) => void;
  resetView: () => void;
  setCanvasDragging: (isDragging: boolean) => void;
  setCanvasResizing: (isResizing: boolean) => void;
  reset: () => void;
}

export type CanvasStore = CanvasRenderState & CanvasRenderActions;

const initialState: CanvasRenderState = {
  gridConfig: DEFAULT_GRID_CONFIG,
  panX: 0,
  panY: 0,
  zoom: 1,
  isCanvasDragging: false,
  isCanvasResizing: false,
};

export const useCanvasStore = create<CanvasStore>()(
  persist(
    immer((set) => ({
      ...initialState,

      updateGridConfig: (config) => {
        set((state) => {
          state.gridConfig = {
            ...state.gridConfig,
            ...config,
          };
        });
      },

      toggleGrid: () => {
        set((state) => {
          state.gridConfig.showGrid = !state.gridConfig.showGrid;
        });
      },

      toggleSnapToGrid: () => {
        set((state) => {
          state.gridConfig.snapToGrid = !state.gridConfig.snapToGrid;
        });
      },

      setGridSize: (size) => {
        set((state) => {
          state.gridConfig.gridSize = size;
        });
      },

      setGridSizeImmediate: (size) => {
        set((state) => {
          state.gridConfig.gridSize = size;
        });
      },

      setGridColor: (color) => {
        set((state) => {
          state.gridConfig.gridColor = color;
        });
      },

      setGridOpacity: (opacity) => {
        set((state) => {
          state.gridConfig.gridOpacity = opacity;
        });
      },

      setGridOpacityImmediate: (opacity) => {
        set((state) => {
          state.gridConfig.gridOpacity = opacity;
        });
      },

      setSnapTolerance: (tolerance) => {
        set((state) => {
          state.gridConfig.snapTolerance = tolerance;
        });
      },

      setPan: (x, y) => {
        set((state) => {
          state.panX = x;
          state.panY = y;
        });
      },

      panBy: (deltaX, deltaY) => {
        set((state) => {
          state.panX = state.panX + deltaX;
          state.panY = state.panY + deltaY;
        });
      },

      setZoom: (zoom) => {
        set((state) => {
          state.zoom = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
        });
      },

      zoomIn: () => {
        set((state) => {
          const newZoom = Math.min(state.zoom * ZOOM_FACTOR, MAX_ZOOM);
          state.zoom = Math.round(newZoom * 1000) / 1000;
        });
      },

      zoomOut: () => {
        set((state) => {
          const newZoom = Math.max(state.zoom / ZOOM_FACTOR, MIN_ZOOM);
          state.zoom = Math.round(newZoom * 1000) / 1000;
        });
      },

      zoomToFit: (viewportWidth, viewportHeight) => {
        // Abort early if viewport hasn't painted yet to avoid division by zero
        if (viewportWidth <= 0 || viewportHeight <= 0) {
          return;
        }

        const { minX, minY, maxX, maxY } = getNodesBoundingBox();
        // Ensure content dimensions are always >= 1 to prevent division by zero
        const contentWidth = Math.max(maxX - minX, 1);
        const contentHeight = Math.max(maxY - minY, 1);

        const scaleX = (viewportWidth - FIT_PADDING * 2) / contentWidth;
        const scaleY = (viewportHeight - FIT_PADDING * 2) / contentHeight;
        const zoom = Math.min(
          Math.max(Math.min(scaleX, scaleY), MIN_ZOOM),
          MAX_ZOOM
        );

        const centerX = minX + contentWidth / 2;
        const centerY = minY + contentHeight / 2;
        const panX = viewportWidth / 2 - centerX * zoom;
        const panY = viewportHeight / 2 - centerY * zoom;

        set({
          zoom: Math.round(zoom * 1000) / 1000,
          panX: Math.round(panX),
          panY: Math.round(panY),
        });
      },

      zoomTo100: (viewportWidth, viewportHeight) => {
        const { minX, minY, maxX, maxY } = getNodesBoundingBox();
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const panX = viewportWidth / 2 - centerX;
        const panY = viewportHeight / 2 - centerY;

        set({ zoom: 1, panX: Math.round(panX), panY: Math.round(panY) });
      },

      setCamera: (panX, panY, zoom) => {
        set({
          panX: Math.round(panX),
          panY: Math.round(panY),
          zoom: Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM),
        });
      },

      resetView: () => {
        set({ zoom: 1, panX: 0, panY: 0 });
      },

      setCanvasDragging: (isDragging) => {
        set((state) => {
          state.isCanvasDragging = isDragging;
        });
      },

      setCanvasResizing: (isResizing) => {
        set((state) => {
          state.isCanvasResizing = isResizing;
        });
      },

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    {
      name: "canvas-storage",
      partialize: (state) => ({
        gridConfig: state.gridConfig,
      }),
    }
  )
);
