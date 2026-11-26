import type { AiMode, PropertiesPanelTab } from "@/types/ai";

interface ModeNodeLike {
  id?: string;
  kind?: string;
  type?: string;
  comment?: string;
  usedInCreation?: boolean;
}

/**
 * The ids an AI request treats as selected. In create mode with nothing
 * selected, every fresh wireframe (one not yet used in a kept creation) is
 * armed, so drawn wireframes join the Create without being selected. Any
 * selection limits the Create to exactly the selected wireframes, fresh or
 * used. Other modes use the selection as is.
 */
export function getArmedSelectionIds(
  mode: AiMode,
  selectedIds: string[],
  nodes: Record<string, ModeNodeLike>
): string[] {
  if (mode !== "create" || selectedIds.length > 0) return selectedIds;
  return Object.entries(nodes)
    .filter(([, node]) => node.kind === "wireframe" && !node.usedInCreation)
    .map(([id]) => id);
}

export function canSubmitWithoutPrompt(
  mode: AiMode,
  selectedIds: string[],
  nodes?: Record<string, ModeNodeLike>
): boolean {
  // A selected image is enough for recreate, and for a theme derived from it.
  if (mode === "theme" || mode === "recreate") {
    const node = selectedIds.length === 1 ? nodes?.[selectedIds[0]] : undefined;
    return node?.type === "Image" && node.kind !== "wireframe";
  }
  // Selected wireframes arm an empty-prompt submission on their own.
  if (nodes && selectedIds.some((id) => nodes[id]?.kind === "wireframe")) {
    return true;
  }
  // Commented captured intents do the same.
  if (
    nodes &&
    Object.values(nodes).some(
      (n) => n.kind === "captured" && (n.comment ?? "").trim().length > 0
    )
  ) {
    return true;
  }
  // Bake merges the selection itself — no prompt needed.
  if (mode === "bake" && selectedIds.length > 0) {
    return true;
  }
  return false;
}

/**
 * Create/Recreate with Theme: a theme first, then the normal request. Recreate
 * derives the theme from its image; Create derives it from the prompt, so it
 * needs one even when armed wireframes would allow an empty Create.
 */
export function canSubmitWithTheme(
  mode: AiMode,
  prompt: string,
  selectedIds: string[],
  nodes?: Record<string, ModeNodeLike>
): boolean {
  if (mode === "recreate") {
    return canSubmitWithoutPrompt(mode, selectedIds, nodes);
  }
  return mode === "create" && prompt.trim().length > 0;
}

export function detectAiMode(
  selectedIds: string[],
  activeTab: PropertiesPanelTab,
  nodes: Record<string, ModeNodeLike>
): AiMode {
  if (activeTab === "theme") {
    return "theme";
  }

  if (selectedIds.length === 0) {
    return "create";
  }

  if (
    selectedIds.length === 1 &&
    nodes[selectedIds[0]]?.type === "Image" &&
    nodes[selectedIds[0]]?.kind !== "wireframe"
  ) {
    return "recreate";
  }

  // Wireframes are inert canvas objects until selected:
  // - wireframe-only selection → create from them
  // - mixed wireframes + elements → bake (merge)
  const known = selectedIds
    .map((id) => nodes[id])
    .filter((n): n is ModeNodeLike => Boolean(n));
  const hasWireframe = known.some((n) => n.kind === "wireframe");
  const hasOther = known.some((n) => n.kind !== "wireframe");
  if (hasWireframe && !hasOther) {
    return "create";
  }
  if (hasWireframe && hasOther) {
    return "bake";
  }

  if (selectedIds.length === 1) {
    return "edit";
  }

  return "bake";
}

export const AI_MODE_LABEL: Record<AiMode, string> = {
  create: "Create",
  edit: "Edit",
  bake: "Bake",
  theme: "Theme",
  recreate: "Recreate",
};
