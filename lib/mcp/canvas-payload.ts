/**
 * Pure builders for the MCP `get_canvas_state` payload and the
 * `update_component_code` target resolution.
 *
 * Extracted so the spatial rules (reading-order sorting, topology hints) can
 * be unit-tested without standing up the MCP transport. The route handler in
 * `lib/mcp/server.ts` is a thin wrapper over these functions.
 */

import {
  analyzeSpatialTopology,
  type BoundingRect,
  sortByReadingOrder,
  sortIdsByReadingOrder,
} from "@/utils/spatial-engine";

export interface McpNodeLike {
  id: string;
  type: string;
  kind?: string;
  code?: string;
  comment?: string;
  parentId?: string;
  children?: string[];
  props: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    fileName?: string;
    alt?: string;
    title?: string;
    [key: string]: unknown;
  };
  capturedMetadata?: {
    selector?: string;
    label?: string;
    sourceComponentId?: string;
  };
}

export interface McpSnapshotLike {
  nodes: Record<string, McpNodeLike>;
  selectedIds: string[];
}

function rectOf(node: McpNodeLike): BoundingRect {
  return {
    x: node.props.x,
    y: node.props.y,
    w: node.props.w ?? 0,
    h: node.props.h ?? 0,
  };
}

export interface McpNestedChild {
  id: string;
  type: string;
  comment: string;
  relX: number;
  relY: number;
  w: number;
  h: number;
  widthPct: number;
  heightPct: number;
  hAnchor: "start" | "center" | "end" | "stretch";
  vAnchor: "start" | "center" | "end" | "stretch";
  flowRole: "column" | "row-item" | "grid-cell" | "overlay" | "solo";
}

export interface McpNodeIntent {
  id: string;
  kind?: string;
  type: string;
  /**
   * True only when this intent is armed by the canvas selection (selected
   * itself, or the topmost wireframe ancestor of a selected nested child).
   * Unselected wireframes are inert ideas — agents must leave them alone
   * unless the user explicitly asks.
   */
  selected: boolean;
  comment: string;
  selector?: string;
  label?: string;
  sourceComponentId?: string;
  sourceCode?: string;
  rect: { x: number; y: number; w: number; h: number };
  nestedChildren?: McpNestedChild[];
}

export interface McpSelectedNode {
  id: string;
  type: string;
  props: McpNodeLike["props"];
  code?: string;
}

export interface McpCanvasPayload {
  /** Selection in spatial reading order — click order never leaks through. */
  selectedIds: string[];
  selectedNodes: McpSelectedNode[];
  generatedNodes: Array<{
    id: string;
    type: string;
    rect: { x: number; y: number; w: number; h: number };
    fileName?: string;
    alt?: string;
  }>;
  nodeIntents?: McpNodeIntent[];
}

/**
 * Mirrors the in-browser armed-roots logic: a wireframe is armed when
 * selected itself, or when a selected nested child resolves up to it.
 * Everything else on the canvas is inert.
 */
function armedRootIds(
  nodes: Record<string, McpNodeLike>,
  selectedIds: string[]
): Set<string> {
  const armed = new Set<string>();
  for (const id of selectedIds) {
    let current = nodes[id];
    if (!current || current.kind !== "wireframe") continue;
    while (
      current.parentId != null &&
      nodes[current.parentId]?.kind === "wireframe"
    ) {
      current = nodes[current.parentId]!;
    }
    armed.add(current.id);
  }
  return armed;
}

function buildNodeIntents(
  nodes: Record<string, McpNodeLike>,
  selectedIds: string[]
): McpNodeIntent[] {
  const armed = armedRootIds(nodes, selectedIds);
  const intentNodes = Object.values(nodes).filter(
    (n) => n.id !== "root" && (n.kind === "wireframe" || n.kind === "captured")
  );

  const wireframeIds = new Set(
    intentNodes.filter((n) => n.kind === "wireframe").map((n) => n.id)
  );

  const isChildWireframe = (n: McpNodeLike) =>
    n.kind === "wireframe" &&
    n.parentId != null &&
    wireframeIds.has(n.parentId);

  return intentNodes
    .filter((n) => !isChildWireframe(n))
    .map((n) => {
      const sourceId = n.capturedMetadata?.sourceComponentId;
      const sourceNode = sourceId ? nodes[sourceId] : undefined;

      let enrichedComment = n.comment ?? "";
      let nestedChildren: McpNestedChild[] | undefined;
      if (n.kind === "wireframe" && n.children && n.children.length > 0) {
        // Pre-sort into spatial reading order: hierarchy order reflects draw
        // sequence, not layout sequence.
        const childNodes = sortByReadingOrder(
          n.children
            .map((childId) => nodes[childId])
            .filter(
              (child): child is McpNodeLike =>
                Boolean(child) && child.kind === "wireframe"
            ),
          rectOf
        );
        if (childNodes.length > 0) {
          const topology = analyzeSpatialTopology(
            rectOf(n),
            childNodes.map(rectOf)
          );
          nestedChildren = childNodes.map((child, index) => {
            const spatial = topology.children[index];
            return {
              id: child.id,
              type: child.type,
              comment: child.comment ?? "",
              relX: Math.round(child.props.x - n.props.x),
              relY: Math.round(child.props.y - n.props.y),
              w: Math.round(child.props.w ?? 0),
              h: Math.round(child.props.h ?? 0),
              widthPct: spatial.widthPct,
              heightPct: spatial.heightPct,
              hAnchor: spatial.hAnchor,
              vAnchor: spatial.vAnchor,
              flowRole: spatial.flowRole,
            };
          });
          const childIntents = childNodes.map((child, index) => {
            const relX = Math.round(child.props.x - n.props.x);
            const relY = Math.round(child.props.y - n.props.y);
            const spatial = topology.children[index];
            const struct = ` (w~${spatial.widthPct}%, h:${spatial.hAnchor} / v:${spatial.vAnchor}, ${spatial.flowRole})`;
            return `  - [${child.type}] id=${child.id} at (+${relX}px, +${relY}px), ${child.props.w ?? 0}×${child.props.h ?? 0}px${struct}: ${child.comment ?? "(no comment)"}`;
          });
          enrichedComment = `${enrichedComment}\nContains nested components (fulfill as ONE single component targeting parent id ${n.id} — NEVER target these child ids individually):\nLayout structure: ${topology.description} (flow: ${topology.flow}). Children below are pre-sorted in spatial reading order — emit DOM in this exact order even when unconventional.\n${childIntents.join("\n")}`;
        }
      }

      return {
        id: n.id,
        kind: n.kind,
        type: n.type,
        selected:
          n.kind === "wireframe" ? armed.has(n.id) : selectedIds.includes(n.id),
        comment: enrichedComment,
        selector: n.capturedMetadata?.selector,
        label: n.capturedMetadata?.label,
        sourceComponentId: sourceId,
        sourceCode: sourceNode?.code,
        rect: {
          x: Math.round(n.props.x),
          y: Math.round(n.props.y),
          w: Math.round(n.props.w ?? 0),
          h: Math.round(n.props.h ?? 0),
        },
        ...(nestedChildren ? { nestedChildren } : {}),
      };
    });
}

export function buildMcpCanvasPayload(
  snapshot: McpSnapshotLike
): McpCanvasPayload {
  const { nodes } = snapshot;
  // Spatial reading order — click order must never affect generated layouts.
  const selectedIds = sortIdsByReadingOrder(snapshot.selectedIds, (id) => {
    const node = nodes[id];
    return node ? rectOf(node) : undefined;
  });

  const nodeIntents = buildNodeIntents(nodes, snapshot.selectedIds);

  const selectedIdSet = new Set(selectedIds);

  const selectedNodes = selectedIds
    .map((selectedId) => nodes[selectedId])
    .filter(
      (n): n is McpNodeLike =>
        Boolean(n) && n.id !== "root" && (!n.kind || n.kind === "generated")
    )
    .map((n) => ({
      id: n.id,
      type: n.type,
      props: n.props,
      code: n.code,
    }));

  const generatedNodes = Object.values(nodes)
    .filter(
      (n) =>
        n.id !== "root" &&
        (!n.kind || n.kind === "generated") &&
        !selectedIdSet.has(n.id)
    )
    .map((n) => {
      const props = n.props as Record<string, unknown>;
      return {
        id: n.id,
        type: n.type,
        rect: {
          x: Math.round(n.props.x),
          y: Math.round(n.props.y),
          w: Math.round(n.props.w ?? 0),
          h: Math.round(n.props.h ?? 0),
        },
        ...(typeof props.fileName === "string" && {
          fileName: props.fileName,
        }),
        ...(typeof props.alt === "string" && { alt: props.alt }),
      };
    });

  return {
    selectedIds,
    selectedNodes,
    generatedNodes,
    ...(nodeIntents.length > 0 ? { nodeIntents } : {}),
  };
}

/**
 * Resolves the effective `update_component_code` target: an explicit targetId
 * wins (with captured overlays remapped to their source component); without
 * one, the top-left selected node wins — never click-order-first.
 */
export function resolveMcpEffectiveTargetId(
  snapshot: McpSnapshotLike,
  targetId?: string
): { effectiveTargetId: string; targetNode?: McpNodeLike } {
  let effectiveTargetId =
    targetId ??
    sortIdsByReadingOrder(snapshot.selectedIds, (id) => {
      const node = snapshot.nodes[id];
      return node ? rectOf(node) : undefined;
    })[0] ??
    "";
  let targetNode = effectiveTargetId
    ? snapshot.nodes[effectiveTargetId]
    : undefined;
  if (
    targetNode?.kind === "captured" &&
    targetNode.capturedMetadata?.sourceComponentId
  ) {
    const sourceId = targetNode.capturedMetadata.sourceComponentId;
    const sourceNode = snapshot.nodes[sourceId];
    if (sourceNode) {
      effectiveTargetId = sourceId;
      targetNode = sourceNode;
    }
  }
  return { effectiveTargetId, targetNode };
}
