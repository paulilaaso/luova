import { v4 as uuidv4 } from "uuid";
import {
  COMPONENT_SIZING_TRAITS,
  type ComponentNodeAny,
  type ComponentType,
  getDefaultComponentSize,
} from "@/types/builder";

export const createRootNode = (): ComponentNodeAny => ({
  id: "root",
  type: "Container",
  props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
  code: "",
});

export function createComponentNode(
  type: ComponentType,
  position?: { x?: number; y?: number },
  initialCode = "",
  size?: { w?: number; h?: number },
  extraProps?: Record<string, unknown>
): ComponentNodeAny {
  const safeType = (
    typeof type === "string" && type.trim() !== "" ? type : "Container"
  ) as ComponentType;
  const newId = uuidv4();
  const traits = COMPONENT_SIZING_TRAITS[safeType] ?? {
    widthMode: "auto",
    heightMode: "auto",
  };
  const defaults = getDefaultComponentSize(safeType);

  const resolvedW =
    size?.w !== undefined
      ? size.w
      : traits.widthMode === "fixed"
        ? defaults.w
        : undefined;

  const resolvedH =
    size?.h !== undefined
      ? size.h
      : traits.heightMode === "fixed"
        ? defaults.h
        : undefined;

  return {
    id: newId,
    type: safeType,
    props: {
      x: 0,
      y: 0,
      positionType: "absolute",
      widthMode: size?.w !== undefined ? "fixed" : traits.widthMode,
      heightMode: size?.h !== undefined ? "fixed" : traits.heightMode,
      ...(position?.x !== undefined && { x: position.x }),
      ...(position?.y !== undefined && { y: position.y }),
      ...(resolvedW !== undefined && { w: resolvedW }),
      ...(resolvedH !== undefined && { h: resolvedH }),
      ...(extraProps ?? {}),
    },
    code: initialCode,
  };
}

export function createCapturedNode(
  astIndex: string,
  boundingBox: { x: number; y: number; w: number; h: number },
  label: string,
  sourceComponentId?: string,
  originalClasses?: string[],
  originalStyle?: string,
  elementFingerprint?: string
): ComponentNodeAny {
  const newId = uuidv4();
  const safeBox = {
    x: boundingBox.x,
    y: boundingBox.y,
    w: Math.max(boundingBox.w, 1),
    h: Math.max(boundingBox.h, 1),
  };

  return {
    id: newId,
    type: "Container" as const,
    kind: "captured" as const,
    capturedMetadata: {
      astIndex,
      elementFingerprint,
      originalRect: { ...safeBox },
      label,
      sourceComponentId: sourceComponentId ?? "",
      originalClasses,
      originalStyle,
    },
    props: {
      x: safeBox.x,
      y: safeBox.y,
      w: safeBox.w,
      h: safeBox.h,
      positionType: "absolute" as const,
      widthMode: "fixed" as const,
      heightMode: "fixed" as const,
    },
    code: "",
  };
}

export function createWireframeNode(
  type: ComponentType,
  position?: { x?: number; y?: number },
  size?: { w?: number; h?: number }
): ComponentNodeAny {
  const safeType = (
    typeof type === "string" && type.trim() !== "" ? type : "Container"
  ) as ComponentType;
  return {
    id: uuidv4(),
    type: safeType,
    kind: "wireframe" as const,
    props: {
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      w: size?.w ?? 300,
      h: size?.h ?? 120,
      positionType: "absolute" as const,
      widthMode: "fixed" as const,
      heightMode: "fixed" as const,
    },
    code: "",
  };
}
