import type { ComponentNodeAny, GridConfig } from "@/types/builder";
import { checkOverlap, getRealNodeSize } from "@/utils/spatial-engine";

/** Move a new creation as a unit, preserving its internal layout and existing nodes. */
export function getCreationPlacementUpdates(
  nodes: Record<string, ComponentNodeAny>,
  rootId: string,
  preExistingIds: Set<string>,
  gridConfig: GridConfig
): { id: string; x: number; y: number }[] {
  const canvasNodes = Object.values(nodes).filter(
    (node) => node.id !== rootId && node.kind !== "captured"
  );
  const created = canvasNodes.filter((node) => !preExistingIds.has(node.id));
  const existing = canvasNodes.filter((node) => preExistingIds.has(node.id));
  if (created.length === 0 || existing.length === 0) return [];

  const rectOf = (node: ComponentNodeAny) => {
    const measured = getRealNodeSize(node);
    return {
      x: node.props.x,
      y: node.props.y,
      w: node.props.w ?? measured.w,
      h: node.props.h ?? measured.h,
    };
  };
  const createdRects = created.map(rectOf);
  const existingRects = existing.map(rectOf);
  const minX = Math.min(...createdRects.map((rect) => rect.x));
  const minY = Math.min(...createdRects.map((rect) => rect.y));
  const bounds = {
    x: minX,
    y: minY,
    w: Math.max(...createdRects.map((rect) => rect.x + rect.w)) - minX,
    h: Math.max(...createdRects.map((rect) => rect.y + rect.h)) - minY,
  };
  if (!existingRects.some((rect) => checkOverlap(bounds, rect, 0))) return [];

  // The right edge guarantees free space even for very large or dense canvases.
  // Round the translation up to keep both the gap and the relative layout intact.
  const rightEdge = Math.max(...existingRects.map((rect) => rect.x + rect.w));
  const step =
    gridConfig.snapToGrid && gridConfig.gridSize > 0 ? gridConfig.gridSize : 1;
  const dx = Math.ceil((rightEdge + 40 - minX) / step) * step;
  return created.map((node) => ({
    id: node.id,
    x: node.props.x + dx,
    y: node.props.y,
  }));
}
