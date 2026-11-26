import { useProjectStore } from "@/stores/project-store";
import type { AppStore } from "@/stores/types";
import type { GridConfig } from "@/types/builder";

export function useNodeOperations() {
  const moveNodes = useProjectStore((state: AppStore) => state.moveNodes);
  const resizeNode = useProjectStore((state: AppStore) => state.resizeNode);
  const updateLayouts = useProjectStore(
    (state: AppStore) => state.updateLayouts
  );

  const moveComponent = (
    id: string,
    x: number,
    y: number,
    gridConfig?: GridConfig
  ) => {
    moveNodes([{ id, x, y }], gridConfig);
  };

  const moveMultipleComponents = (
    updates: Array<{ id: string; x: number; y: number }>,
    gridConfig?: GridConfig
  ) => {
    moveNodes(updates, gridConfig);
  };

  const resizeComponent = (
    id: string,
    w: number,
    h: number,
    gridConfig?: GridConfig
  ) => {
    resizeNode(id, w, h, gridConfig);
  };

  return {
    moveComponent,
    moveMultipleComponents,
    resizeComponent,
    updateLayouts,
  };
}
