import type { ComponentNodeAny, ComponentType } from "@/types/builder";

export type AiMode = "create" | "edit" | "bake" | "theme" | "recreate";

export type AiStatus =
  | "idle"
  | "submitted"
  | "thinking"
  | "streaming"
  | "ready"
  | "error";

export type PropertiesPanelTab = "components" | "code" | "theme";

export interface AiSelectedNodeSnapshot {
  id: string;
  type: string;
  props: ComponentNodeAny["props"];
  code: string;
}

export interface AiNestedChildIntent {
  id: string;
  type: string;
  comment: string;
  /** Offset relative to the parent wireframe origin (parent x/y subtracted). */
  relX: number;
  relY: number;
  w: number;
  h: number;
  /** Proportional width share of the parent (0-100). Deliberate visual structure — preserve. */
  widthPct?: number;
  /** Proportional height share of the parent (0-100). Deliberate visual structure — preserve. */
  heightPct?: number;
  /** Horizontal alignment anchor relative to the parent frame. */
  hAnchor?: "start" | "center" | "end" | "stretch";
  /** Vertical alignment anchor relative to the parent frame. */
  vAnchor?: "start" | "center" | "end" | "stretch";
  /** Layout flow role of this child within the parent composition. */
  flowRole?: "column" | "row-item" | "grid-cell" | "overlay" | "solo";
}

export interface AiNodeIntent {
  id: string;
  kind: "wireframe" | "captured";
  type: string;
  comment: string;
  selector?: string;
  label?: string;
  sourceComponentId?: string;
  sourceCode?: string;
  rect: { x: number; y: number; w: number; h: number };
  /**
   * Structured nested child wireframes contained within this parent,
   * pre-sorted top-to-bottom in spatial reading order — emit DOM in this
   * exact order even when unconventional. Omitted from top-level
   * nodeIntents: fulfill as internal JSX inside the single parent
   * component, never as separate canvas nodes.
   */
  nestedChildren?: AiNestedChildIntent[];
}

export interface AiThemePatch {
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

export interface AiContextSnapshot {
  mode: AiMode;
  activeTab: PropertiesPanelTab;
  prompt: string;
  selectedIds: string[];
  selectedNodes?: AiSelectedNodeSnapshot[];
  /** Image reference and current canvas frame; pixels travel only as a message attachment. */
  /** Image-derived theme: token → the image element its color came from. */
  themeTokenSources?: Record<string, string>;
  sourceImage?: {
    nodeId: string;
    assetId: string;
    rect: { x: number; y: number; w: number; h: number };
  };
  canvasBounds?: {
    width: number;
    height: number;
  };
  themeState?: {
    currentMode: "light" | "dark";
    styles: {
      light: Record<string, string>;
      dark: Record<string, string>;
    };
  };
  /**
   * Wireframe and captured nodes with their user comments.
   * Always included when present — these are the user's explicit design instructions.
   * - wireframe: "create a component here that does X"
   * - captured: "edit this existing element to do Y"
   */
  nodeIntents?: AiNodeIntent[];
}

interface AiPendingActionBase {
  id: string;
  tool:
    | "add_component"
    | "update_component_code"
    | "update_theme"
    | "draft_layout";
  toolCallId?: string;
  rationale?: string;
  validationError?: string | null;
}

export interface AiPendingAddComponentAction extends AiPendingActionBase {
  tool: "add_component";
  componentType?: ComponentType | string;
  code: string;
  position?: {
    x?: number;
    y?: number;
  };
  size?: {
    w?: number;
    h?: number;
  };
  draftId?: string;
}

export interface AiPendingUpdateComponentCodeAction
  extends AiPendingActionBase {
  tool: "update_component_code";
  targetId: string;
  code: string;
  componentType?: ComponentType | string;
  bakedSourceIds?: string[];
}

export interface AiPendingUpdateThemeAction extends AiPendingActionBase {
  tool: "update_theme";
  patch: AiThemePatch;
  tokenSources?: Record<string, string>;
}

export interface AiPendingDraftLayoutAction extends AiPendingActionBase {
  tool: "draft_layout";
  components: Array<{
    id?: string;
    componentType: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

export type AiPendingAction =
  | AiPendingAddComponentAction
  | AiPendingUpdateComponentCodeAction
  | AiPendingUpdateThemeAction
  | AiPendingDraftLayoutAction;

export interface AddComponentToolOutput {
  tool: "add_component";
  toolCallId?: string;
  componentType: ComponentType | string;
  code: string;
  position?: {
    x?: number;
    y?: number;
  };
  size?: {
    w?: number;
    h?: number;
  };
  draftId?: string;
  rationale?: string;
}

export interface UpdateComponentCodeToolOutput {
  tool: "update_component_code";
  toolCallId?: string;
  targetId?: string;
  code: string;
  componentType?: ComponentType | string;
  rationale?: string;
}

export interface UpdateThemeToolOutput {
  tool: "update_theme";
  toolCallId?: string;
  patch: AiThemePatch;
  rationale?: string;
  tokenSources?: Record<string, string>;
}

export interface DraftLayoutToolOutput {
  tool: "draft_layout";
  toolCallId?: string;
  components: Array<{
    id?: string;
    componentType: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  rationale?: string;
}

export type AiToolOutput =
  | AddComponentToolOutput
  | UpdateComponentCodeToolOutput
  | UpdateThemeToolOutput
  | DraftLayoutToolOutput;
