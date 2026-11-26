import type { ComponentNodeAny } from "@/types/builder";
import { findDeepestContainer } from "@/utils/spatial-engine";
import type { AppStateCreator, CanvasHierarchySlice } from "../types";

// ─── Hierarchy helpers (consolidated from spatial-utils + layer-utils) ───────

export interface HierarchyUpdate {
  parentId: string | undefined;
  children: string[] | undefined;
}

export type HierarchyResult = Record<string, HierarchyUpdate>;

/**
 * Pure function: computes the hierarchy (parentId + children) for all nodes
 * without mutating. Returns a map of nodeId → { parentId, children } for
 * every node whose hierarchy values differ from the current state.
 *
 * When `changedNodeIds` is provided, only those nodes are re-evaluated for
 * parent assignment (incremental mode). Otherwise a full scan is performed.
 */
export function computeHierarchy(
  nodes: Record<string, ComponentNodeAny>,
  changedNodeIds?: string[]
): HierarchyResult {
  const updates: HierarchyResult = {};

  // Step 1 — Determine the new parentId for each eligible node
  const newParentIds: Record<string, string | undefined> = {};

  if (changedNodeIds && changedNodeIds.length > 0) {
    // Incremental: only recompute parents for the changed nodes
    for (const id of changedNodeIds) {
      const node = nodes[id];
      if (!node) continue;
      if (node.id === "root" || node.kind === "captured") continue;

      newParentIds[id] = findDeepestContainer(
        node.id,
        {
          x: node.props.x,
          y: node.props.y,
          w: node.props.w ?? 0,
          h: node.props.h ?? 0,
        },
        nodes
      );
    }
  } else {
    // Full scan
    for (const node of Object.values(nodes)) {
      if (node.id === "root" || node.kind === "captured") continue;
      newParentIds[node.id] = findDeepestContainer(
        node.id,
        {
          x: node.props.x,
          y: node.props.y,
          w: node.props.w ?? 0,
          h: node.props.h ?? 0,
        },
        nodes
      );
    }
  }

  // Step 2 — Collect which parents were affected by parent changes
  const affectedParents = new Set<string>();

  for (const [id, newPid] of Object.entries(newParentIds)) {
    const node = nodes[id];
    if (!node) continue;
    const currentPid = node.parentId;
    if (newPid !== currentPid) {
      if (!updates[id])
        updates[id] = { parentId: node.parentId, children: node.children };
      updates[id].parentId = newPid;
      if (newPid) affectedParents.add(newPid);
      if (currentPid) affectedParents.add(currentPid);
    }
  }

  // Step 3 — Rebuild children arrays for affected parents
  // We need to simulate the updated parentIds when computing children,
  // so build a merged view of parentId per node.
  const effectiveParentId = (id: string): string | undefined => {
    if (updates[id]) return updates[id].parentId;
    return nodes[id]?.parentId;
  };

  for (const parentId of affectedParents) {
    const parent = nodes[parentId];
    if (!parent) continue;

    const nextChildren = Object.values(nodes)
      .filter((n) => effectiveParentId(n.id) === parentId)
      .map((n) => n.id);

    const currentChildren = parent.children ?? [];
    const childrenChanged =
      nextChildren.length !== currentChildren.length ||
      nextChildren.some((id, i) => id !== currentChildren[i]);

    if (childrenChanged) {
      if (!updates[parentId])
        updates[parentId] = {
          parentId: parent.parentId,
          children: parent.children,
        };
      updates[parentId].children =
        nextChildren.length > 0 ? nextChildren : undefined;
    }
  }

  // For full-scan mode, also rebuild children for non-affected parents
  // that may have lost all their children.
  if (!changedNodeIds) {
    const newChildrenMap: Record<string, string[]> = {};
    for (const node of Object.values(nodes)) {
      const pid = effectiveParentId(node.id);
      if (pid) {
        if (!newChildrenMap[pid]) newChildrenMap[pid] = [];
        newChildrenMap[pid].push(node.id);
      }
    }

    for (const node of Object.values(nodes)) {
      if (affectedParents.has(node.id)) continue; // already handled
      const nextChildren = newChildrenMap[node.id];
      const currentChildren = node.children;

      if (!nextChildren) {
        if (currentChildren && currentChildren.length > 0) {
          if (!updates[node.id])
            updates[node.id] = {
              parentId: node.parentId,
              children: node.children,
            };
          updates[node.id].children = undefined;
        }
      } else {
        if (
          !currentChildren ||
          nextChildren.length !== currentChildren.length ||
          nextChildren.some((id, i) => id !== currentChildren[i])
        ) {
          if (!updates[node.id])
            updates[node.id] = {
              parentId: node.parentId,
              children: node.children,
            };
          updates[node.id].children = nextChildren;
        }
      }
    }
  }

  return updates;
}

/**
 * Applies the result of `computeHierarchy` to an immer-drafted state.
 * Returns true if any node was changed.
 */
export function applyHierarchy(
  state: { nodes: Record<string, ComponentNodeAny> },
  result: HierarchyResult
): boolean {
  let hasChanged = false;
  for (const [id, update] of Object.entries(result)) {
    const node = state.nodes[id];
    if (!node) continue;
    if (node.parentId !== update.parentId) {
      node.parentId = update.parentId;
      hasChanged = true;
    }
    const curChildren = node.children;
    const nextChildren = update.children;
    if (curChildren !== nextChildren) {
      if (
        !curChildren ||
        !nextChildren ||
        curChildren.length !== nextChildren.length ||
        curChildren.some((c, i) => c !== nextChildren[i])
      ) {
        node.children = nextChildren;
        hasChanged = true;
      }
    }
  }
  return hasChanged;
}

export const isLayerableNode = (node?: ComponentNodeAny, rootId = "root") =>
  Boolean(node) && node?.id !== rootId;

export const getLayerableNodeIds = (
  nodes: Record<string, ComponentNodeAny>,
  rootId = "root"
) =>
  Object.values(nodes)
    .filter((node) => isLayerableNode(node, rootId))
    .map((node) => node.id);

export const normalizeLayerOrder = (
  layerOrder: string[],
  nodes: Record<string, ComponentNodeAny>,
  rootId = "root"
) => {
  const validIds = new Set(getLayerableNodeIds(nodes, rootId));
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const id of Array.isArray(layerOrder) ? layerOrder : []) {
    if (!validIds.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
  }

  for (const id of getLayerableNodeIds(nodes, rootId)) {
    if (seen.has(id)) {
      continue;
    }
    normalized.push(id);
  }

  return normalized;
};

export const createLayerIndexMap = (
  layerOrder: string[],
  nodes: Record<string, ComponentNodeAny>,
  rootId = "root"
) => {
  const orderedIds = normalizeLayerOrder(layerOrder, nodes, rootId);
  const indexById: Record<string, number> = {};

  orderedIds.forEach((id, index) => {
    indexById[id] = index;
  });

  return { orderedIds, indexById };
};

export const moveIdsToFront = (layerOrder: string[], ids: string[]) => {
  if (ids.length === 0) return layerOrder;
  const orderSet = new Set(layerOrder);
  const idSet = new Set(ids);
  const existingInOrder = layerOrder.filter((id) => idSet.has(id));
  const missing = ids.filter((id) => !orderSet.has(id));
  const moving = [...existingInOrder, ...missing];
  if (moving.length === 0) return layerOrder;
  return [...layerOrder.filter((id) => !idSet.has(id)), ...moving];
};

export const moveIdsToBack = (layerOrder: string[], ids: string[]) => {
  if (ids.length === 0) return layerOrder;
  const orderSet = new Set(layerOrder);
  const idSet = new Set(ids);
  const existingInOrder = layerOrder.filter((id) => idSet.has(id));
  const missing = ids.filter((id) => !orderSet.has(id));
  const moving = [...existingInOrder, ...missing];
  if (moving.length === 0) return layerOrder;
  return [...moving, ...layerOrder.filter((id) => !idSet.has(id))];
};

// ─── Captured node syncing ───────────────────────────────────────────────────

/**
 * Translates all captured nodes that belong to `sourceId` by (dx, dy).
 * Designed for use inside immer `set()` callbacks.
 */
export function syncCapturedNodePositions(
  nodes: Record<string, ComponentNodeAny>,
  sourceId: string,
  dx: number,
  dy: number
): void {
  if (dx === 0 && dy === 0) return;
  for (const n of Object.values(nodes)) {
    if (
      n.kind === "captured" &&
      n.capturedMetadata?.sourceComponentId === sourceId
    ) {
      n.props.x += dx;
      n.props.y += dy;
    }
  }
}

/**
 * Deletes all captured nodes associated with `sourceId` and removes them
 * from `layerOrder`. Returns the updated layerOrder.
 * Designed for use inside immer `set()` callbacks.
 */
export function deleteCapturedNodes(
  nodes: Record<string, ComponentNodeAny>,
  layerOrder: string[],
  sourceId: string
): string[] {
  const toRemove: string[] = [];
  for (const [nid, n] of Object.entries(nodes)) {
    if (
      n.kind === "captured" &&
      n.capturedMetadata?.sourceComponentId === sourceId
    ) {
      toRemove.push(nid);
    }
  }
  if (toRemove.length === 0) return layerOrder;

  for (const nid of toRemove) {
    delete nodes[nid];
  }
  const removeSet = new Set(toRemove);
  return layerOrder.filter((id) => !removeSet.has(id));
}

// ─── Slice ──────────────────────────────────────────────────────────────────

/**
 * Writes the 1-based layer position into every layerable node's `props.zIndex`
 * so element props and `layerOrder` stay in sync.
 * Designed for use inside immer `set()` callbacks.
 */
export function syncLayerZIndices(state: {
  nodes: Record<string, ComponentNodeAny>;
  layerOrder: string[];
  rootId: string;
}): void {
  state.layerOrder.forEach((lid, index) => {
    const node = state.nodes[lid];
    if (!node || !isLayerableNode(node, state.rootId)) return;
    if (!node.props) return;
    (node.props as Record<string, unknown>).zIndex = index + 1;
  });
}

export const createCanvasHierarchySlice: AppStateCreator<
  CanvasHierarchySlice
> = (set) => ({
  bringToFront: (ids) =>
    set((state) => {
      if (!ids.length) return;
      const layerableIds = ids.filter((id) =>
        isLayerableNode(state.nodes[id], state.rootId)
      );
      state.layerOrder = normalizeLayerOrder(
        state.layerOrder,
        state.nodes,
        state.rootId
      );
      state.layerOrder = moveIdsToFront(state.layerOrder, layerableIds);
      state.pendingVersion++;
      syncLayerZIndices(state);
    }),

  sendToBack: (ids) =>
    set((state) => {
      if (!ids.length) return;
      const layerableIds = ids.filter((id) =>
        isLayerableNode(state.nodes[id], state.rootId)
      );
      state.layerOrder = normalizeLayerOrder(
        state.layerOrder,
        state.nodes,
        state.rootId
      );
      state.layerOrder = moveIdsToBack(state.layerOrder, layerableIds);
      state.pendingVersion++;
      syncLayerZIndices(state);
    }),

  setNodeZIndex: (id, newZIndex) =>
    set((state) => {
      const normalized = normalizeLayerOrder(
        state.layerOrder,
        state.nodes,
        state.rootId
      ).filter((lid) => isLayerableNode(state.nodes[lid], state.rootId));
      const currentIndex = normalized.indexOf(id);
      if (currentIndex === -1) return;
      if (!isLayerableNode(state.nodes[id], state.rootId)) return;
      const clamped = Math.max(
        1,
        Math.min(normalized.length, Math.round(newZIndex))
      );
      const targetIndex = clamped - 1;
      if (currentIndex === targetIndex) {
        state.layerOrder = normalized;
        syncLayerZIndices(state);
        return;
      }
      normalized.splice(currentIndex, 1);
      normalized.splice(targetIndex, 0, id);
      state.layerOrder = normalized;
      syncLayerZIndices(state);
      state.pendingVersion++;
    }),
});
