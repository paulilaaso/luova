import { THEME_TOKENS } from "@/config/theme-tokens";
import type {
  AiContextSnapshot,
  AiMode,
  AiNestedChildIntent,
  AiSelectedNodeSnapshot,
  PropertiesPanelTab,
} from "@/types/ai";
import type { ComponentNodeAny } from "@/types/builder";
import type { ThemeEditorState } from "@/types/editor";
import {
  analyzeSpatialTopology,
  getRealNodeSize,
  sortByReadingOrder,
  sortIdsByReadingOrder,
} from "@/utils/spatial-engine";

const DEFAULT_VIEWPORT = { width: 1200, height: 800 };
const RECREATE_FONT_TOKENS = new Set([
  "font-sans",
  "font-serif",
  "font-mono",
  "font-heading",
]);

interface BuildAiContextParams {
  prompt: string;
  mode: AiMode;
  activeTab: PropertiesPanelTab;
  selectedIds: string[];
  nodes: Record<string, ComponentNodeAny>;
  themeState: ThemeEditorState;
  currentMode: "light" | "dark";
}

function toSelectedNodeSnapshot(
  node: ComponentNodeAny
): AiSelectedNodeSnapshot {
  return {
    id: node.id,
    type: node.type,
    props: {
      ...node.props,
      // Explicitly preserve visual fidelity properties
      ...(node.type === "Text" && {
        fontSize: node.props.fontSize,
        fontWeight: node.props.fontWeight,
        textAlign: node.props.textAlign,
        color: node.props.color,
        fontFamily: node.props.fontFamily,
      }),
      ...(node.type === "Image" && {
        brightness: node.props.brightness,
        contrast: node.props.contrast,
        blur: node.props.blur,
        hueRotate: node.props.hueRotate,
        rotation: node.props.rotation,
        opacity: node.props.opacity,
        src: node.props.src,
        fileName: node.props.fileName,
        alt: node.props.alt,
        title: node.props.title,
      }),
    },
    code: node.code,
  };
}

/**
 * The selected uploaded image as a source for recreate or an image-derived
 * theme: exactly one selected Image node backed by an uploaded asset.
 */
function readSourceImage(
  selectedIds: string[],
  nodes: Record<string, ComponentNodeAny>
): AiContextSnapshot["sourceImage"] {
  if (selectedIds.length !== 1) return undefined;
  const node = nodes[selectedIds[0]];
  const assetId = node?.code.match(/asset:image-[a-zA-Z0-9]+/)?.[0];
  if (!node || node.type !== "Image" || node.kind === "wireframe" || !assetId) {
    return undefined;
  }
  // Auto height must come from the displayed image after resizing its width.
  const measured = getRealNodeSize({
    id: node.id,
    props: {
      w: node.props.widthMode === "auto" ? undefined : node.props.w,
      h: node.props.heightMode === "auto" ? undefined : node.props.h,
    },
  });
  const w =
    node.props.widthMode === "auto" ? measured.w : (node.props.w ?? measured.w);
  const h =
    node.props.heightMode === "auto"
      ? measured.h
      : (node.props.h ?? measured.h);
  return {
    nodeId: node.id,
    assetId,
    rect: { x: node.props.x, y: node.props.y, w, h },
  };
}

export function buildAiContextSnapshot({
  prompt,
  mode,
  activeTab,
  selectedIds,
  nodes,
  themeState,
  currentMode,
}: BuildAiContextParams): AiContextSnapshot {
  // In bake mode the selection doubles as the merge sequence: pre-sort ids
  // into spatial reading order so click order can never leak into the
  // generated layout. This also makes selectedIds[0] (the merge target and
  // tool-call fallback) the top-left source.
  const orderedIds =
    mode === "bake"
      ? sortIdsByReadingOrder(selectedIds, (id) => {
          const node = nodes[id];
          return node
            ? {
                x: node.props.x,
                y: node.props.y,
                w: node.props.w ?? 0,
                h: node.props.h ?? 0,
              }
            : undefined;
        })
      : selectedIds;

  const snapshot: AiContextSnapshot = {
    prompt,
    mode,
    activeTab,
    selectedIds: orderedIds,
  };

  if (mode === "recreate") {
    const sourceImage = readSourceImage(selectedIds, nodes);
    if (!sourceImage) {
      throw new Error("Select an uploaded image to recreate its structure.");
    }
    snapshot.sourceImage = sourceImage;
    snapshot.canvasBounds = {
      width: sourceImage.rect.w,
      height: sourceImage.rect.h,
    };
    // Colors and font families let the model map the reference's palette and
    // typefaces onto theme tokens. Fonts are usually set only in light styles,
    // so dark falls back to them.
    const light = themeState.styles.light as Record<string, unknown>;
    const themeTokens = (styles: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(THEME_TOKENS).flatMap(([key, token]) => {
          const isFont =
            token.category === "typography" && RECREATE_FONT_TOKENS.has(key);
          if (token.category !== "color" && !isFont) return [];
          const value = styles[key] ?? (isFont ? light[key] : undefined);
          return typeof value === "string" && value.trim()
            ? [[key, value]]
            : [];
        })
      );
    snapshot.themeState = {
      currentMode,
      styles: {
        light: themeTokens(light),
        dark: themeTokens(themeState.styles.dark),
      },
    };
    return snapshot;
  }

  // Only include selectedNodes for edit/bake (the LLM needs the source code to modify)
  if (mode === "edit" || mode === "bake") {
    snapshot.selectedNodes = orderedIds
      .map((id) => {
        const node = nodes[id];
        // If the selected node is a captured overlay, resolve it to its source component
        if (
          node &&
          node.kind === "captured" &&
          node.capturedMetadata?.sourceComponentId
        ) {
          return nodes[node.capturedMetadata.sourceComponentId];
        }
        return node;
      })
      .filter((node): node is ComponentNodeAny => Boolean(node))
      .map((node) => toSelectedNodeSnapshot(node));
  }

  // Include a default viewport size for create (positioning) and edit/bake (layout awareness)
  if (mode !== "theme") {
    snapshot.canvasBounds = DEFAULT_VIEWPORT;
  }

  // Only include themeState for theme mode (exclude customFonts as it's not AI-relevant)
  if (mode === "theme") {
    // A selected uploaded image is the reference the theme is derived from.
    const sourceImage = readSourceImage(selectedIds, nodes);
    if (sourceImage) snapshot.sourceImage = sourceImage;
    else if (!prompt.trim()) {
      throw new Error("Describe the theme, or select an uploaded image.");
    }
    const { customFonts: _, ...lightStyles } = themeState.styles
      .light as Record<string, unknown>;
    const { customFonts: __, ...darkStyles } = themeState.styles.dark as Record<
      string,
      unknown
    >;
    snapshot.themeState = {
      currentMode,
      styles: {
        light: lightStyles as Record<string, string>,
        dark: darkStyles as Record<string, string>,
      },
    };
  }

  // Collect wireframe and captured node intents only in non-theme modes.
  // In theme mode, component-level intents are irrelevant since we're only generating global CSS.
  // In create mode, only include wireframes (strictly exclude captured nodes).
  // In edit mode, filter intents to only include the selected component's captured nodes.
  // In bake mode, filter intents to only include the selected wireframes.
  if (mode !== "theme") {
    let intentNodes = Object.values(nodes).filter(
      (n) => n.kind === "wireframe" || n.kind === "captured"
    );

    // In create mode, strictly exclude captured nodes AND unselected wireframes.
    // Wireframes are inert until selected: creating from them requires an
    // explicit wireframe selection, otherwise this is a normal prompt-based
    // creation workflow that ignores canvas wireframes entirely.
    if (mode === "create") {
      if (selectedIds.length === 0) {
        intentNodes = [];
      } else {
        const selectedSet = new Set(selectedIds);
        // Selecting a nested child arms its root container: walk up through
        // wireframe ancestors so the whole subtree is fulfilled as one component.
        const rootWireframeFor = (id: string): string | undefined => {
          let current = nodes[id];
          if (!current || current.kind !== "wireframe") return undefined;
          while (
            current.parentId != null &&
            nodes[current.parentId]?.kind === "wireframe"
          ) {
            current = nodes[current.parentId]!;
          }
          return current.id;
        };
        const armedRoots = new Set<string>();
        for (const id of selectedSet) {
          const root = rootWireframeFor(id);
          if (root) armedRoots.add(root);
        }
        intentNodes = intentNodes.filter(
          (n) => n.kind === "wireframe" && armedRoots.has(n.id)
        );
      }
    }

    // In edit mode, narrow intents to only the selected component
    if (mode === "edit" && selectedIds.length > 0) {
      const selectedId = selectedIds[0];
      intentNodes = intentNodes.filter(
        (n) =>
          // Include wireframes that have this component as a child
          (n.kind === "wireframe" && n.parentId === selectedId) ||
          // Include captured nodes that were captured from this component
          (n.kind === "captured" &&
            n.capturedMetadata?.sourceComponentId === selectedId) ||
          // Include the captured node itself if it is the selected node
          (n.kind === "captured" && n.id === selectedId)
      );
    }

    // In bake mode, narrow intents to only the selected wireframes
    if (mode === "bake" && selectedIds.length > 0) {
      const selectedSet = new Set(selectedIds);
      intentNodes = intentNodes.filter(
        (n) =>
          // Only include wireframes that are selected
          n.kind === "wireframe" && selectedSet.has(n.id)
      );
    }

    if (intentNodes.length > 0) {
      // Separate wireframes that are children of other wireframes (nested) from top-level ones.
      // Child wireframes are folded into their parent's intent so the AI builds a single
      // composite component rather than separate nodes.
      const wireframeIds = new Set(
        intentNodes.filter((n) => n.kind === "wireframe").map((n) => n.id)
      );

      const isChildWireframe = (n: ComponentNodeAny) =>
        n.kind === "wireframe" &&
        n.parentId != null &&
        wireframeIds.has(n.parentId);

      snapshot.nodeIntents = intentNodes
        .filter((n) => !isChildWireframe(n))
        .map((n) => {
          const sourceId = n.capturedMetadata?.sourceComponentId;
          const sourceNode = sourceId ? nodes[sourceId] : undefined;

          // For wireframe parents: collect all direct child wireframes and
          // expose them BOTH as a structured nestedChildren tree (machine-
          // readable, with coordinates relative to the parent origin) AND as
          // a textual "Contains nested components" block (human-readable
          // fallback). Child wireframes are omitted from the top-level list
          // so the model only ever fulfills the root parent id.
          let enrichedComment = n.comment ?? "";
          let nestedChildren: AiNestedChildIntent[] | undefined;
          if (n.kind === "wireframe" && n.children && n.children.length > 0) {
            // Pre-sort into spatial reading order (top-to-bottom,
            // left-to-right): hierarchy order reflects draw sequence, not
            // layout sequence, so sort before analysis and emission.
            const childNodes = sortByReadingOrder(
              n.children
                .map((childId) => nodes[childId])
                .filter(
                  (child): child is ComponentNodeAny =>
                    Boolean(child) && child.kind === "wireframe"
                ),
              (child) => ({
                x: child.props.x,
                y: child.props.y,
                w: child.props.w ?? 0,
                h: child.props.h ?? 0,
              })
            );

            if (childNodes.length > 0) {
              // Semantic spatial translation: pre-compute topology so the
              // model receives architectural concepts (column splits, anchors,
              // flow roles) instead of ambiguous raw coordinate arrays.
              const topology = analyzeSpatialTopology(
                {
                  x: n.props.x,
                  y: n.props.y,
                  w: n.props.w ?? 0,
                  h: n.props.h ?? 0,
                },
                childNodes.map((child) => ({
                  x: child.props.x,
                  y: child.props.y,
                  w: child.props.w ?? 0,
                  h: child.props.h ?? 0,
                }))
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
                  ...(spatial
                    ? {
                        widthPct: spatial.widthPct,
                        heightPct: spatial.heightPct,
                        hAnchor: spatial.hAnchor,
                        vAnchor: spatial.vAnchor,
                        flowRole: spatial.flowRole,
                      }
                    : {}),
                } satisfies AiNestedChildIntent;
              });

              const childIntents = childNodes.map((child, index) => {
                const relX = Math.round(child.props.x - n.props.x);
                const relY = Math.round(child.props.y - n.props.y);
                const spatial = topology.children[index];
                const struct = spatial
                  ? ` (w~${spatial.widthPct}%, h:${spatial.hAnchor} / v:${spatial.vAnchor}, ${spatial.flowRole})`
                  : "";
                return `  - [${child.type}] id=${child.id} at (+${relX}px, +${relY}px), ${child.props.w ?? 0}×${child.props.h ?? 0}px${struct}: ${child.comment ?? "(no comment)"}`;
              });

              enrichedComment = `${enrichedComment}\nContains nested components (fulfill as ONE single component targeting parent id ${n.id} — NEVER target these child ids individually):\nLayout structure: ${topology.description} (flow: ${topology.flow}). Children below are pre-sorted in spatial reading order — emit DOM in this exact order even when unconventional. Preserve clear proportions in resilient CSS; snap jitter to clean alignment.\n${childIntents.join("\n")}`;
            }
          }

          return {
            id: n.id,
            kind: n.kind as "wireframe" | "captured",
            type: n.type,
            comment: enrichedComment,
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
  }

  return snapshot;
}
