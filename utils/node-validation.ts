import type { ComponentNodeAny, NodeKind } from "@/types/builder";

const VALID_KINDS: ReadonlySet<string> = new Set([
  "generated",
  "captured",
  "wireframe",
  "draft",
]);

const FALLBACK_TYPE = "Container";

function toFiniteNumber(value: unknown, fallback: number): number {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function toOptionalDimension(value: unknown): number | undefined {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/**
 * Validate + repair a single raw node (from localStorage, file import, AI).
 * Returns a usable node, or null when the record is beyond repair
 * (missing id). Never throws.
 */
export function sanitizeNode(raw: unknown): ComponentNodeAny | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, any>;

  if (typeof n.id !== "string" || n.id.trim() === "") return null;
  const id = n.id;

  const type =
    typeof n.type === "string" && n.type.trim() !== "" ? n.type : FALLBACK_TYPE;

  const rawProps =
    n.props && typeof n.props === "object"
      ? (n.props as Record<string, any>)
      : {};

  const props: Record<string, any> = {
    ...rawProps,
    x: toFiniteNumber(rawProps.x, 0),
    y: toFiniteNumber(rawProps.y, 0),
  };
  const w = toOptionalDimension(rawProps.w);
  const h = toOptionalDimension(rawProps.h);
  if (w !== undefined) props.w = w;
  else delete props.w;
  if (h !== undefined) props.h = h;
  else delete props.h;

  let kind: NodeKind | undefined;
  if (typeof n.kind === "string" && VALID_KINDS.has(n.kind)) {
    kind = n.kind as NodeKind;
  } else if (id !== "root") {
    kind = "generated";
  }

  const node: ComponentNodeAny = {
    ...(n as object),
    id,
    type,
    props: props as ComponentNodeAny["props"],
    code: typeof n.code === "string" ? n.code : "",
  } as ComponentNodeAny;
  if (kind !== undefined) node.kind = kind;
  else delete (node as { kind?: unknown }).kind;

  return node;
}

export interface SanitizeResult {
  nodes: Record<string, ComponentNodeAny>;
  layerOrder: string[];
  rootId: string;
  removedIds: string[];
}

/**
 * Validate + repair a whole project blob. Drops unrecoverable records,
 * re-adds a missing root, prunes dangling parent/children refs and
 * normalizes layerOrder. Never throws — on total garbage returns a
 * fresh empty canvas so the app always boots.
 */
export function sanitizeProjectState(input: {
  nodes?: unknown;
  layerOrder?: unknown;
  rootId?: unknown;
}): SanitizeResult {
  const removedIds: string[] = [];
  const clean: Record<string, ComponentNodeAny> = {};

  const rawNodes =
    input.nodes && typeof input.nodes === "object"
      ? (input.nodes as Record<string, unknown>)
      : {};

  for (const [key, raw] of Object.entries(rawNodes)) {
    const fixed = sanitizeNode(raw);
    if (!fixed) {
      removedIds.push(key);
      continue;
    }
    if (fixed.id !== key) removedIds.push(key);
    clean[fixed.id] = fixed;
  }

  let rootId =
    typeof input.rootId === "string" && input.rootId.trim() !== ""
      ? input.rootId
      : "root";
  if (!clean[rootId]) {
    if (clean.root) {
      rootId = "root";
    } else {
      clean.root = {
        id: "root",
        type: "Container",
        props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
        code: "",
      } as ComponentNodeAny;
      rootId = "root";
      removedIds.push("(missing-root-recreated)");
    }
  }
  // Root must never carry a kind / parent
  const root = clean[rootId];
  if (root) {
    delete (root as { kind?: unknown }).kind;
    delete (root as { parentId?: unknown }).parentId;
    delete (root as { children?: unknown }).children;
  }

  // Prune dangling hierarchy refs
  for (const node of Object.values(clean)) {
    if (node.id === rootId) continue;
    if (
      node.parentId !== undefined &&
      (typeof node.parentId !== "string" || !clean[node.parentId])
    ) {
      node.parentId = undefined;
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        node.children = undefined;
      } else {
        const kept = node.children.filter(
          (cid): cid is string => typeof cid === "string" && Boolean(clean[cid])
        );
        node.children = kept.length > 0 ? kept : undefined;
      }
    }
  }

  // Normalize layerOrder: existing non-root ids, deduped, + append missing
  const seen = new Set<string>();
  const order: string[] = [];
  if (Array.isArray(input.layerOrder)) {
    for (const entry of input.layerOrder) {
      if (typeof entry !== "string") continue;
      if (entry === rootId || !clean[entry] || seen.has(entry)) continue;
      seen.add(entry);
      order.push(entry);
    }
  }
  for (const id of Object.keys(clean)) {
    if (id === rootId || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  return { nodes: clean, layerOrder: order, rootId, removedIds };
}
