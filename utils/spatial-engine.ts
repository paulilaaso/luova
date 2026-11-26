import { type GridConfig, MIN_COMPONENT_WIDTH } from "@/types/builder";

export interface Point {
  x: number;
  y: number;
}

export interface CanvasTransform {
  zoom: number;
  panX?: number;
  panY?: number;
}

export function snapToGrid(value: number, gridSize: number = 16): number {
  return snapToGridNear(value, gridSize, Infinity);
}

export function snapToGridNear(
  value: number,
  gridSize: number = 16,
  tolerancePx: number = Infinity
): number {
  if (gridSize <= 0) return value;
  if (tolerancePx <= 0) return value;

  const snapped = Math.round(value / gridSize) * gridSize;
  return Math.abs(value - snapped) <= tolerancePx ? snapped : value;
}

export function snapPosition(
  x: number,
  y: number,
  gridConfig: GridConfig
): Point {
  if (!gridConfig.snapToGrid) {
    return { x, y };
  }

  const tolerance = gridConfig.snapTolerance;
  return {
    x: snapToGridNear(x, gridConfig.gridSize, tolerance),
    y: snapToGridNear(y, gridConfig.gridSize, tolerance),
  };
}

export function snapDimensions(
  width: number,
  height: number,
  gridConfig: GridConfig
): { width: number; height: number } {
  if (!gridConfig.snapToGrid) {
    return { width, height };
  }

  const tolerance = gridConfig.snapTolerance;
  return {
    width: snapToGridNear(width, gridConfig.gridSize, tolerance),
    height: snapToGridNear(height, gridConfig.gridSize, tolerance),
  };
}

export function normalizeWidth(width: number): number {
  return width <= 0 ? MIN_COMPONENT_WIDTH : width;
}

export function normalizeDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  return {
    width: normalizeWidth(width),
    height,
  };
}

export function screenPointToCanvas(
  screenPoint: Point,
  viewportElement: Element,
  transform: CanvasTransform
): Point {
  const rect = viewportElement.getBoundingClientRect();
  const panX = transform.panX ?? 0;
  const panY = transform.panY ?? 0;
  return {
    x: (screenPoint.x - rect.left - panX) / transform.zoom,
    y: (screenPoint.y - rect.top - panY) / transform.zoom,
  };
}

export function screenCoordsFromEvent(
  event: Pick<MouseEvent, "clientX" | "clientY">
): Point {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

// ─── Intelligent Placement Engine ────────────────────────────────────────────

export interface BoundingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PLACEMENT_PADDING = 20;

/**
 * Returns true if two rectangles overlap (with padding margin).
 */
export function checkOverlap(
  a: BoundingRect,
  b: BoundingRect,
  padding = PLACEMENT_PADDING
): boolean {
  return (
    a.x < b.x + b.w + padding &&
    a.x + a.w + padding > b.x &&
    a.y < b.y + b.h + padding &&
    a.y + a.h + padding > b.y
  );
}

/**
 * Scans the canvas using a concentric-ring search pattern starting from
 * (startX, startY) and returns the first snapped position where a rect of
 * (desiredWidth × desiredHeight) does not overlap any existing node.
 */
export function findFreeSpace(
  existingNodes: BoundingRect[],
  desiredWidth: number,
  desiredHeight: number,
  startX: number,
  startY: number,
  gridConfig: { gridSize: number; snapToGrid: boolean }
): Point {
  const step = gridConfig.snapToGrid ? gridConfig.gridSize : PLACEMENT_PADDING;

  const snap = (v: number) =>
    gridConfig.snapToGrid ? Math.round(v / step) * step : v;

  const candidate: BoundingRect = {
    x: snap(startX),
    y: snap(startY),
    w: desiredWidth,
    h: desiredHeight,
  };

  const hasCollision = (rect: BoundingRect): boolean => {
    return existingNodes.some((n) => checkOverlap(rect, n));
  };

  // Quick check: if the start position is already free, use it
  // Use padding=0 here: AESTHETIC_GAP already provides visual spacing,
  // and adding PLACEMENT_PADDING on top causes false collisions that send
  // the spiral search in the wrong direction.
  if (!existingNodes.some((n) => checkOverlap(candidate, n, 0))) {
    return { x: candidate.x, y: candidate.y };
  }

  // Concentric ring search: expand outward ring by ring
  // Iterate in spiral order (right → down → left → up) which naturally
  // visits points in increasing distance from origin, avoiding O(N log N) sort
  const maxRings = 60;
  for (let ring = 1; ring <= maxRings; ring++) {
    const ringW = ring * (desiredWidth + PLACEMENT_PADDING);
    const ringH = ring * (desiredHeight + PLACEMENT_PADDING);

    // Top edge: left to right
    for (let i = -ring; i <= ring; i++) {
      const pt = {
        x: startX + i * (desiredWidth + PLACEMENT_PADDING),
        y: startY - ringH,
      };
      if (
        !hasCollision({
          x: Math.max(0, snap(pt.x)),
          y: Math.max(0, snap(pt.y)),
          w: desiredWidth,
          h: desiredHeight,
        })
      ) {
        return { x: Math.max(0, snap(pt.x)), y: Math.max(0, snap(pt.y)) };
      }
    }
    // Right edge: top to bottom (skip corners already checked)
    for (let i = -ring + 1; i < ring; i++) {
      const pt = {
        x: startX + ringW,
        y: startY + i * (desiredHeight + PLACEMENT_PADDING),
      };
      if (
        !hasCollision({
          x: Math.max(0, snap(pt.x)),
          y: Math.max(0, snap(pt.y)),
          w: desiredWidth,
          h: desiredHeight,
        })
      ) {
        return { x: Math.max(0, snap(pt.x)), y: Math.max(0, snap(pt.y)) };
      }
    }
    // Bottom edge: right to left (skip corners already checked)
    for (let i = ring - 1; i > -ring; i--) {
      const pt = {
        x: startX + i * (desiredWidth + PLACEMENT_PADDING),
        y: startY + ringH,
      };
      if (
        !hasCollision({
          x: Math.max(0, snap(pt.x)),
          y: Math.max(0, snap(pt.y)),
          w: desiredWidth,
          h: desiredHeight,
        })
      ) {
        return { x: Math.max(0, snap(pt.x)), y: Math.max(0, snap(pt.y)) };
      }
    }
    // Left edge: bottom to top (skip corners already checked)
    for (let i = ring - 1; i > -ring + 1; i--) {
      const pt = {
        x: startX - ringW,
        y: startY + i * (desiredHeight + PLACEMENT_PADDING),
      };
      if (
        !hasCollision({
          x: Math.max(0, snap(pt.x)),
          y: Math.max(0, snap(pt.y)),
          w: desiredWidth,
          h: desiredHeight,
        })
      ) {
        return { x: Math.max(0, snap(pt.x)), y: Math.max(0, snap(pt.y)) };
      }
    }
  }

  // Fallback: stack below all existing nodes
  const maxY = existingNodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
  return { x: snap(startX), y: snap(maxY + PLACEMENT_PADDING) };
}

// ─── Spatial Containment Engine ──────────────────────────────────────────────

/**
 * The fraction of a child's area that must overlap a candidate container
 * for the child to be considered "inside" it.
 */
const CONTAINMENT_THRESHOLD = 0.6;

/**
 * Returns the fraction of rect `child` that is covered by rect `container`.
 */
export function containmentRatio(
  child: BoundingRect,
  container: BoundingRect
): number {
  const ix = Math.max(
    0,
    Math.min(child.x + child.w, container.x + container.w) -
      Math.max(child.x, container.x)
  );
  const iy = Math.max(
    0,
    Math.min(child.y + child.h, container.y + container.h) -
      Math.max(child.y, container.y)
  );
  const intersection = ix * iy;
  const childArea = child.w * child.h;
  return childArea > 0 ? intersection / childArea : 0;
}

/**
 * Returns true when `child` is sufficiently contained inside `container`
 * (at least CONTAINMENT_THRESHOLD of the child's area overlaps).
 */
export function isContainedIn(
  child: BoundingRect,
  container: BoundingRect
): boolean {
  return containmentRatio(child, container) >= CONTAINMENT_THRESHOLD;
}

/**
 * Given a target node's bounding box and a map of all other nodes, returns
 * the ID of the "deepest" valid container that wraps the target — i.e. the
 * smallest container whose area fully (or mostly) covers the target.
 *
 * Only nodes with kind "generated" or undefined (regular components) and
 * type "Container" are eligible as parents. Wireframes can also be parents.
 *
 * Returns `undefined` when no suitable container is found (root level).
 */
export function findDeepestContainer(
  targetId: string,
  targetRect: BoundingRect,
  nodes: Record<
    string,
    {
      id: string;
      type: string;
      kind?: string;
      props: { x: number; y: number; w?: number; h?: number };
    }
  >
): string | undefined {
  let bestId: string | undefined;
  let bestArea = Infinity;

  for (const node of Object.values(nodes)) {
    if (node.id === targetId) continue;
    if (node.id === "root") continue;
    // Only wireframes and generated Container-type nodes can be parents.
    // Captured nodes are DOM shadow overlays and must never act as containers.
    if (node.kind === "captured") continue;
    if (node.kind !== "wireframe" && node.type !== "Container") continue;

    const containerRect: BoundingRect = {
      x: node.props.x,
      y: node.props.y,
      w: node.props.w ?? 0,
      h: node.props.h ?? 0,
    };

    if (containerRect.w <= 0 || containerRect.h <= 0) continue;
    if (!isContainedIn(targetRect, containerRect)) continue;

    const area = containerRect.w * containerRect.h;
    if (area < bestArea) {
      bestArea = area;
      bestId = node.id;
    }
  }

  return bestId;
}

// ─── Spatial Topology Analysis (Semantic Layout Extraction) ──────────────────

export type SpatialFlowAxis = "row" | "column" | "grid" | "single" | "free";
export type SpatialAnchor = "start" | "center" | "end" | "stretch";

export interface TopologyChildInput extends BoundingRect {
  id?: string;
}

export interface ChildSpatialInfo {
  /** Proportional width share of the parent (0-100, rounded). */
  widthPct: number;
  /** Proportional height share of the parent (0-100, rounded). */
  heightPct: number;
  /** Horizontal alignment anchor relative to the parent frame. */
  hAnchor: SpatialAnchor;
  /** Vertical alignment anchor relative to the parent frame. */
  vAnchor: SpatialAnchor;
  /** Layout flow role of this child within the parent composition. */
  flowRole: "column" | "row-item" | "grid-cell" | "overlay" | "solo";
  /** True when the child intentionally deviates from a uniform grid. */
  isOffset: boolean;
}

export interface SpatialTopologyResult {
  flow: SpatialFlowAxis;
  description: string;
  children: ChildSpatialInfo[];
  /** True when column/row shares are deliberately unequal. */
  asymmetric: boolean;
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  minOverlap = 0
): number {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > minOverlap
    ? Math.min(aEnd, bEnd) - Math.max(aStart, bStart)
    : 0;
}

function resolveAnchor(
  childStart: number,
  childSize: number,
  parentStart: number,
  parentSize: number
): { anchor: SpatialAnchor; isOffset: boolean } {
  if (parentSize <= 0 || childSize <= 0) {
    return { anchor: "stretch", isOffset: false };
  }
  // Near-full-bleed children stretch rather than anchor.
  if (childSize >= parentSize * 0.9) {
    return { anchor: "stretch", isOffset: false };
  }
  const leading = childStart - parentStart;
  const trailing = parentStart + parentSize - (childStart + childSize);
  const edgeTol = Math.max(12, parentSize * 0.05);
  // Center snap band is deliberately generous: hand-drawn wireframes carry
  // jitter, so near-center elements must resolve to center rather than being
  // misread as intentional off-center placements.
  const centerTol = Math.max(24, parentSize * 0.08);
  // Only deviations beyond this band count as deliberate offsets worth
  // preserving; anything smaller snaps to its canonical anchor.
  const offsetThreshold = Math.max(32, parentSize * 0.12);
  const centerOffset = Math.abs(
    childStart + childSize / 2 - (parentStart + parentSize / 2)
  );

  // Center-first: jitter around the middle snaps to center.
  if (centerOffset <= centerTol) {
    return { anchor: "center", isOffset: false };
  }
  if (leading <= edgeTol && trailing <= edgeTol) {
    return { anchor: "stretch", isOffset: false };
  }
  if (leading <= edgeTol) {
    // Edge-pinned; only flag offset when the element sits far from center.
    return { anchor: "start", isOffset: centerOffset > offsetThreshold };
  }
  if (trailing <= edgeTol) {
    return { anchor: "end", isOffset: centerOffset > offsetThreshold };
  }
  // Ambiguous middle ground within the offset threshold is still jitter —
  // snap to center so the model doesn't invent off-center placements.
  if (centerOffset <= offsetThreshold) {
    return { anchor: "center", isOffset: false };
  }
  // Clearly deliberate off-center placement: anchor to the nearer edge.
  return {
    anchor: leading < trailing ? "start" : "end",
    isOffset: true,
  };
}

/**
 * Analyzes 2D topology of children inside a parent bounding box and returns
 * high-level layout semantics (flow axis, proportional shares, alignment
 * anchors, asymmetry flags) suitable for LLM prompt ingestion.
 *
 * Raw pixel coordinates are ambiguous to language models; this translates
 * them into architectural concepts (column splits, alignment anchors, flow
 * roles) before prompt construction.
 */
export function analyzeSpatialTopology(
  parent: BoundingRect,
  children: TopologyChildInput[]
): SpatialTopologyResult {
  if (children.length === 0) {
    return {
      flow: "single",
      description: "empty container with no nested children",
      children: [],
      asymmetric: false,
    };
  }

  const infos: ChildSpatialInfo[] = children.map((child) => {
    const widthPct = parent.w > 0 ? Math.round((child.w / parent.w) * 100) : 0;
    const heightPct = parent.h > 0 ? Math.round((child.h / parent.h) * 100) : 0;
    const h = resolveAnchor(child.x, child.w, parent.x, parent.w);
    const v = resolveAnchor(child.y, child.h, parent.y, parent.h);
    return {
      widthPct,
      heightPct,
      hAnchor: h.anchor,
      vAnchor: v.anchor,
      flowRole: "solo",
      isOffset: h.isOffset || v.isOffset,
    };
  });

  if (children.length === 1) {
    infos[0].flowRole = "solo";
    const c = children[0];
    const soloDesc = `single child occupying ~${infos[0].widthPct}% width anchored ${infos[0].hAnchor}-${infos[0].vAnchor}`;
    void c;
    return {
      flow: "single",
      description: soloDesc,
      children: infos,
      asymmetric: false,
    };
  }

  // Detect row-like (side-by-side) vs column-like (stacked) grouping based
  // on element overlap: pairs sharing vertical range are in the same row;
  // pairs sharing horizontal range are in the same column.
  let sideBySide = 0;
  let stacked = 0;
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i];
      const b = children[j];
      const yOverlap = rangesOverlap(
        a.y,
        a.y + a.h,
        b.y,
        b.y + b.h,
        Math.min(a.h, b.h) * 0.3
      );
      const xOverlap = rangesOverlap(
        a.x,
        a.x + a.w,
        b.x,
        b.x + b.w,
        Math.min(a.w, b.w) * 0.3
      );
      const xDisjoint = a.x + a.w <= b.x || b.x + b.w <= a.x;
      const yDisjoint = a.y + a.h <= b.y || b.y + b.h <= a.y;
      if (yOverlap > 0 && xDisjoint) sideBySide++;
      else if (yOverlap > 0 && xOverlap === 0) sideBySide++;
      if (xOverlap > 0 && yDisjoint) stacked++;
      else if (xOverlap > 0 && yOverlap === 0) stacked++;
    }
  }

  let flow: SpatialFlowAxis;
  if (sideBySide > 0 && stacked === 0) flow = "row";
  else if (stacked > 0 && sideBySide === 0) flow = "column";
  else if (sideBySide > 0 && stacked > 0) flow = "grid";
  else flow = "free";

  const roleForFlow =
    flow === "row"
      ? ("column" as const)
      : flow === "column"
        ? ("row-item" as const)
        : flow === "grid"
          ? ("grid-cell" as const)
          : ("overlay" as const);
  for (const info of infos) {
    info.flowRole = roleForFlow;
  }

  // Asymmetry: deliberate unequal shares (e.g. 25/75 sidebar split).
  const widths = infos.map((c) => c.widthPct);
  const heights = infos.map((c) => c.heightPct);
  const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
  const asymmetric =
    (flow === "row" || flow === "grid") && spread(widths) >= 15
      ? true
      : flow === "column" && spread(heights) >= 15
        ? true
        : spread(widths) >= 30 || spread(heights) >= 30;

  const n = children.length;
  const widthList = `${widths.join("% / ")}%`;
  let description: string;
  if (flow === "row") {
    description = asymmetric
      ? `${n}-column split with unequal columns (${widthList} widths)`
      : `${n}-column even split (${widthList} widths) in a horizontal row`;
  } else if (flow === "column") {
    description = asymmetric
      ? `vertical stack of ${n} items with varying heights`
      : `vertical stack of ${n} items`;
  } else if (flow === "grid") {
    description = `grid composition of ${n} items (${widthList} widths)`;
  } else {
    const offsetCount = infos.filter((c) => c.isOffset).length;
    description =
      offsetCount > 0
        ? `freeform composition of ${n} items with ${offsetCount} intentionally offset element(s)`
        : `freeform composition of ${n} items`;
  }

  return { flow, description, children: infos, asymmetric };
}

/**
 * Sorts items into spatial reading order (top-to-bottom, left-to-right)
 * using row banding, so small hand-drawn y jitter between side-by-side
 * items never flips their left/right sequence. The returned array order IS
 * the DOM emission order for wireframe fulfillment — even when the sequence
 * looks unconventional, it must be preserved, never re-sorted into
 * conventional patterns.
 */
export function sortByReadingOrder<T>(
  items: T[],
  getRect: (item: T) => BoundingRect = (item) => item as unknown as BoundingRect
): T[] {
  const rectOf = getRect;
  const rows: T[][] = [];
  const byCenterY = [...items].sort(
    (a, b) => rectOf(a).y + rectOf(a).h / 2 - (rectOf(b).y + rectOf(b).h / 2)
  );
  for (const item of byCenterY) {
    const rect = rectOf(item);
    const cy = rect.y + rect.h / 2;
    let placed = false;
    for (const row of rows) {
      const rowCy =
        row.reduce((sum, c) => sum + rectOf(c).y + rectOf(c).h / 2, 0) /
        row.length;
      const band = Math.max(
        24,
        Math.min(rect.h, ...row.map((c) => rectOf(c).h)) * 0.5
      );
      if (Math.abs(cy - rowCy) <= band) {
        row.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([item]);
  }
  for (const row of rows) row.sort((a, b) => rectOf(a).x - rectOf(b).x);
  return rows.flat();
}

/**
 * Orders node ids into spatial reading order (top-to-bottom,
 * left-to-right) by their canvas rects. Click/selection order must never
 * leak into generated layouts — layout comes from coordinates only. Ids
 * without a resolvable rect keep their relative order at the end.
 */
export function sortIdsByReadingOrder(
  ids: string[],
  getRect: (id: string) => BoundingRect | undefined
): string[] {
  const withRect: string[] = [];
  const withoutRect: string[] = [];
  for (const id of ids) {
    if (getRect(id)) withRect.push(id);
    else withoutRect.push(id);
  }
  const sorted = sortByReadingOrder(withRect, (id) => getRect(id)!);
  return [...sorted, ...withoutRect];
}
// ─── Aesthetic Sequential Placement ──────────────────────────────────────────

const AESTHETIC_GAP = 24;

/**
 * Phase 1: Live DOM Size Resolver
 * Returns the actual rendered dimensions of a component by querying the DOM,
 * or falls back to explicit props, or sensible defaults.
 */
export function getRealNodeSize(node: {
  id: string;
  props: { w?: number; h?: number };
}): { w: number; h: number } {
  // If explicit dimensions are set, use them
  if (node.props.w !== undefined && node.props.h !== undefined) {
    return { w: node.props.w, h: node.props.h };
  }

  // Query the DOM for the actual rendered size
  if (typeof document !== "undefined") {
    const element = document.querySelector(
      `[data-node-id="${node.id}"]`
    ) as HTMLElement | null;
    if (element) {
      return { w: element.offsetWidth, h: element.offsetHeight };
    }
  }

  // Fallback: sensible defaults for auto-sized components
  return { w: 100, h: 40 };
}

export interface AestheticPlacementOptions {
  nodes: Record<
    string,
    { id: string; props: { x: number; y: number; w?: number; h?: number } }
  >;
  rootId: string;
  selectedIds: string[];
  incomingW: number;
  incomingH: number;
  /** Camera state for empty-canvas centering */
  viewport: {
    panX: number;
    panY: number;
    zoom: number;
    viewportW: number;
    viewportH: number;
  };
  gridConfig: { gridSize: number; snapToGrid: boolean };
  /**
   * ID of the node being placed. When provided, this node is excluded from
   * the existing-nodes measurement so its provisional DOM size (which can be
   * arbitrarily large for overlays/auto-sized components) never skews the
   * rightmost-node calculation.
   */
  excludeId?: string;
}

/**
 * Linear placement:
 * 1. Empty canvas → center of current viewport.
 * 2. Selection → right of the selected node, aligned to its top.
 * 3. No selection → right of the right-most node on the canvas.
 */
export function calculateAestheticPlacement({
  nodes,
  rootId,
  selectedIds,
  incomingW,
  incomingH,
  viewport,
  gridConfig,
  excludeId,
}: AestheticPlacementOptions): Point {
  const snap = (v: number) =>
    gridConfig.snapToGrid && gridConfig.gridSize > 0
      ? Math.round(v / gridConfig.gridSize) * gridConfig.gridSize
      : v;

  const nonRootNodes = Object.values(nodes).filter(
    (n) => n.id !== rootId && n.id !== excludeId
  );

  // Phase 2: Pre-build the BoundingRect array using live DOM measurements
  const existingRects: BoundingRect[] = nonRootNodes.map((n) => {
    const size = getRealNodeSize(n);
    return {
      x: n.props.x,
      y: n.props.y,
      w: size.w,
      h: size.h,
    };
  });

  // 1. Empty canvas — no collision check needed
  if (nonRootNodes.length === 0) {
    const cx = (-viewport.panX + viewport.viewportW / 2) / viewport.zoom;
    const cy = (-viewport.panY + viewport.viewportH / 2) / viewport.zoom;
    return { x: snap(cx - incomingW / 2), y: snap(cy - incomingH / 2) };
  }

  // 2. Selection bias — use combined bounding box of the entire selection
  // Exclude the incoming node (excludeId) — it's at provisional (0,0) and its
  // DOM size may be unreliable (overlays, full-screen drawers, etc.)
  const selectedNodes = selectedIds
    .map((id) => nodes[id])
    .filter((n): n is NonNullable<typeof n> => !!n && n.id !== excludeId);
  if (selectedNodes.length > 0) {
    let selMaxRight = -Infinity;
    let selMinY = Infinity;
    for (const n of selectedNodes) {
      const size = getRealNodeSize(n);
      selMaxRight = Math.max(selMaxRight, n.props.x + size.w);
      selMinY = Math.min(selMinY, n.props.y);
    }
    const targetX = selMaxRight + AESTHETIC_GAP;
    const targetY = selMinY;
    return findFreeSpace(
      existingRects,
      incomingW,
      incomingH,
      targetX,
      targetY,
      gridConfig
    );
  }

  // 3. Right-most node bias
  let rightMost = nonRootNodes[0];
  let rightMostSize = getRealNodeSize(rightMost);
  let rightMostRight = rightMost.props.x + rightMostSize.w;

  for (const n of nonRootNodes) {
    const size = getRealNodeSize(n);
    const nRight = n.props.x + size.w;
    if (nRight > rightMostRight) {
      rightMost = n;
      rightMostSize = size;
      rightMostRight = nRight;
    }
  }
  const targetX = rightMostRight + AESTHETIC_GAP;
  const targetY = rightMost.props.y;
  return findFreeSpace(
    existingRects,
    incomingW,
    incomingH,
    targetX,
    targetY,
    gridConfig
  );
}
