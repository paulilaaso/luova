/**
 * Core data types for the Luova Builder
 * This structure is designed to be AI-readable and serializable
 */

export type ComponentType = string;

export type ComponentNodeAny = ComponentNode<ComponentType>;

export const MIN_COMPONENT_WIDTH = 450;

/**
 * Alignment options for positioning component content within its overlay box
 */
export type ContentAlignment =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/**
 * Props interface for spatial positioning and sizing
 */
export interface Rect {
  x: number; // X coordinate relative to parent (px)
  y: number; // Y coordinate relative to parent (px)
  w?: number; // Width (px)
  h?: number; // Height (px)
}

/**
 * Sizing mode for a dimension — "fixed" uses explicit px, "auto" hugs content.
 */
export type SizingMode = "fixed" | "auto";

/**
 * Props interface for spatial positioning and sizing
 * Added for 2D canvas support
 */
export interface SpatialProps extends Rect {
  positionType?: "absolute" | "relative"; // Position mode
  alignment?: ContentAlignment; // Content alignment within the overlay box
  widthMode?: SizingMode; // How width is determined
  heightMode?: SizingMode; // How height is determined
  /** 1-based stacking order of the component on the canvas */
  zIndex?: number;
}

/**
 * Default sizing traits per component type.
 * "auto" = hug contents (max-content), "fixed" = explicit px dimension.
 * Only core canvas primitives are hardcoded — AI can generate any component name.
 */
export const COMPONENT_SIZING_TRAITS: Record<
  ComponentType,
  { widthMode: SizingMode; heightMode: SizingMode }
> = {
  Container: { widthMode: "fixed", heightMode: "fixed" },
  Image: { widthMode: "fixed", heightMode: "auto" },
  AspectRatio: { widthMode: "fixed", heightMode: "fixed" },
  Card: { widthMode: "fixed", heightMode: "fixed" },
  Text: { widthMode: "auto", heightMode: "auto" },
};

/**
 * Grid configuration for snapping and alignment
 */
export interface GridConfig {
  gridSize: number; // Grid spacing in pixels (default 20px)
  gridColor: string; // Grid line color (default #e0e0e0)
  gridOpacity: number; // Grid opacity (0-1, default 0.3)
  snapToGrid: boolean; // Enable snapping to grid (default true)
  showGrid: boolean; // Show grid overlay (default true)
  snapTolerance: number; // Pixel tolerance for snapping (default 5px)
}

/**
 * Base props that all components can have
 */
export interface BaseComponentProps extends Partial<SpatialProps> {
  className?: string;
  /** Original image filename (e.g. "hero-banner.png") — set for Image nodes */
  fileName?: string;
  /** Accessible description for Image nodes; also used as semantic label */
  alt?: string;
  /** Optional title/tooltip for Image nodes */
  title?: string;
  [key: string]: unknown; // Allow additional props for user code flexibility
}

/**
 * Component props map
 * Keeps the type surface small while allowing future per-component specialization.
 */
export type ComponentPropsMap = Record<ComponentType, BaseComponentProps>;

/**
 * Distinguishes how a node was created:
 * - "generated": a new component created from scratch in the builder
 * - "captured": an existing DOM element ingested from the live app
 * - "wireframe": a low-fidelity skeleton placeholder
 * - "draft": an AI-planned placeholder awaiting code fulfillment (two-phase pipeline)
 */
export type NodeKind = "generated" | "captured" | "wireframe" | "draft";

/**
 * Metadata stored when a node is captured from the live DOM.
 * Preserves the original selector and bounding box so the AI can
 * calculate the delta between where the element started and where
 * the user moved it.
 */
export interface CapturedMetadata {
  astIndex: string; // data-ast-index from the compiled JSX element (deterministic identification)
  /** Structural fingerprint (tag ancestor chain) used to re-locate the element after
   *  structural edits that shift numeric indices. Format: "nav/div/button" */
  elementFingerprint?: string;
  originalRect: { x: number; y: number; w: number; h: number }; // Original bounding box in canvas coords
  label?: string; // Human-readable label (e.g. "nav", "main", "footer")
  sourceComponentId: string; // ID of the component node this element was captured from
  originalClasses?: string[]; // Original className array
  originalStyle?: string; // Original inline style string
  hasEdits?: boolean; // True if the element has been modified from its original state
}

// Generic ComponentNode with proper typing
export interface ComponentNode<T extends ComponentType = ComponentType> {
  id: string; // Unique UUID
  type: T; // Component type identifier
  props: ComponentPropsMap[T] & Rect; // Ensure Rect is always present at node level
  code: string; // Raw user-provided JSX/TSX code
  imports?: string[]; // Array of imports needed for this code
  kind?: NodeKind; // How this node was created (defaults to "generated")
  capturedMetadata?: CapturedMetadata; // Only present when kind === "captured"
  comment?: string; // User's intent note — used by AI for wireframe/captured nodes
  /** Offset of the floating annotation bubble relative to the frame's right-center */
  annotationOffset?: { x: number; y: number };
  /**
   * Wireframes only: true once the wireframe took part in a creation the user
   * kept (Accept / Keep Both). With nothing selected, Create uses every fresh
   * wireframe; used ones join only while selected.
   */
  usedInCreation?: boolean;
  /** ID of the parent node that spatially contains this node (undefined = root level) */
  parentId?: string;
  /** IDs of nodes spatially contained within this node */
  children?: string[];
}

/**
 * Spatial defaults for 2D canvas
 */
export const SPATIAL_DEFAULTS: Rect & { positionType: "absolute" } = {
  x: 0,
  y: 0,
  positionType: "absolute",
};

/**
 * Default props for each component type.
 * Only core canvas primitives are hardcoded — AI can generate any component name.
 */
export const DEFAULT_PROPS: Record<ComponentType, Record<string, unknown>> = {
  Container: {
    ...SPATIAL_DEFAULTS,
    gridConfig: {
      gridSize: 20,
      gridColor: "#e0e0e0",
      gridOpacity: 0.05,
      snapToGrid: true,
      showGrid: true,
      snapTolerance: 5,
      alignmentGuides: true,
    },
  },
  AspectRatio: {
    ...SPATIAL_DEFAULTS,
    w: 320,
    h: 180,
  },
  Card: {
    ...SPATIAL_DEFAULTS,
    w: 320,
    h: 200,
  },
  Text: {
    ...SPATIAL_DEFAULTS,
  },
  Image: {
    ...SPATIAL_DEFAULTS,
    w: 400,
    h: 300,
    brightness: 1,
    contrast: 1,
    blur: 0,
    hueRotate: 0,
    rotation: 0,
    svgFillLight: undefined,
    svgFillDark: undefined,
    fileName: undefined,
    alt: undefined,
    title: undefined,
  },
};

/**
 * Returns the default width and height for a component type,
 * falling back to MIN_COMPONENT_WIDTH / 200 if not explicitly set.
 */
export function getDefaultComponentSize(
  type: ComponentType | string | undefined
): {
  w: number;
  h: number;
} {
  const defaults = DEFAULT_PROPS[(type ?? "") as ComponentType] as
    | Record<string, unknown>
    | undefined;
  return {
    w: typeof defaults?.w === "number" ? defaults.w : MIN_COMPONENT_WIDTH,
    h: typeof defaults?.h === "number" ? defaults.h : 200,
  };
}

export type InteractionState =
  | "IDLE"
  | "DRAGGING"
  | "RESIZING"
  | "DEFERRED_DRAG";

export interface InteractionFrame {
  id: string;
  el: HTMLElement;
  startX: number;
  startY: number;
  startW?: number;
  startH?: number;
  startAspectRatio?: number;
}

export interface DragState {
  state: InteractionState;
  type: "drag" | "resize" | null;
  direction?: string;
  startClientX: number;
  startClientY: number;
  frames: InteractionFrame[];
  wasSelected: boolean;
  isModifierActive?: boolean; // Track if Shift/Cmd/Ctrl was held during pointer down
}
