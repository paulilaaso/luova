"use client";

import {
  Image as ImageIcon,
  Plus,
  Square,
  SquareDashed,
  Type,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/luova-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/luova-ui/dropdown-menu";
import { useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import { getDefaultComponentSize } from "@/types/builder";
import {
  buildImageCode,
  getImageDimensions,
  readImageAsBase64,
} from "@/utils/file-helpers";
import { getInitialCodeTemplate } from "@/utils/initial-code";
import { calculateAestheticPlacement } from "@/utils/spatial-engine";

const PRIMITIVE_COMPONENTS = [
  { type: "Container" as const, label: "Container", icon: Square },
  { type: "Text" as const, label: "Text", icon: Type },
  { type: "Image" as const, label: "Image", icon: ImageIcon },
  { type: "Wireframe" as const, label: "Wireframe", icon: SquareDashed },
];

export default function PrimitivesDropdown() {
  const activeMenu = useUIStore((state) => state.activeMenu);
  const setActiveMenu = useUIStore((state) => state.setActiveMenu);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const addComponentToCanvas = async (
    componentType: "Container" | "Text" | "Card" | "Image"
  ) => {
    const { w, h } = getDefaultComponentSize(componentType);
    const { panX, panY, zoom, gridConfig } = useCanvasStore.getState();
    const container = document.querySelector("[data-canvas-container]");
    const containerRect = container?.getBoundingClientRect();
    const vw = containerRect?.width ?? 1200;
    const vh = containerRect?.height ?? 800;

    const initialCode = getInitialCodeTemplate(componentType);

    const { nodes, rootId } = useProjectStore.getState();
    const selectedIds = useUIStore.getState().selectedIds;
    const { x, y } = calculateAestheticPlacement({
      nodes,
      rootId,
      selectedIds,
      incomingW: w,
      incomingH: h,
      viewport: { panX, panY, zoom, viewportW: vw, viewportH: vh },
      gridConfig,
    });

    const addComponent = useProjectStore.getState().addComponent;
    const selectComponent = useUIStore.getState().selectComponent;
    const newId = addComponent(componentType, { x, y }, initialCode);
    selectComponent(newId);

    const compScreenCX = x * zoom + panX + (w * zoom) / 2;
    const compScreenCY = y * zoom + panY + (h * zoom) / 2;
    if (
      compScreenCX < 0 ||
      compScreenCX > vw ||
      compScreenCY < 0 ||
      compScreenCY > vh
    ) {
      useCanvasStore
        .getState()
        .setPan(
          vw / 2 - x * zoom - (w * zoom) / 2,
          vh / 2 - y * zoom - (h * zoom) / 2
        );
    }
  };

  const addWireframeToCanvas = () => {
    const addWireframeComponent =
      useProjectStore.getState().addWireframeComponent;
    const selectComponent = useUIStore.getState().selectComponent;
    const selectedIds = useUIStore.getState().selectedIds;

    const w = 300;
    const h = 120;
    const { panX, panY, zoom, gridConfig } = useCanvasStore.getState();
    const container = document.querySelector("[data-canvas-container]");
    const containerRect = container?.getBoundingClientRect();
    const vw = containerRect?.width ?? 1200;
    const vh = containerRect?.height ?? 800;

    const { nodes, rootId } = useProjectStore.getState();
    const { x, y } = calculateAestheticPlacement({
      nodes,
      rootId,
      selectedIds,
      incomingW: w,
      incomingH: h,
      viewport: { panX, panY, zoom, viewportW: vw, viewportH: vh },
      gridConfig,
    });

    const newId = addWireframeComponent("Container", { x, y }, { w, h });
    selectComponent(newId);
  };

  const onImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    try {
      const base64 = await readImageAsBase64(file);
      const dims = await getImageDimensions(base64);
      const fileName = file.name;
      const assetId = useProjectStore.getState().addAsset(base64, fileName);
      const code = buildImageCode(assetId, { fileName, alt: fileName });
      const w = dims.width;
      const h = dims.height;
      const { panX, panY, zoom, gridConfig } = useCanvasStore.getState();
      const container = document.querySelector("[data-canvas-container]");
      const containerRect = container?.getBoundingClientRect();
      const vw = containerRect?.width ?? 1200;
      const vh = containerRect?.height ?? 800;
      const selectedIds = useUIStore.getState().selectedIds;

      const { nodes, rootId } = useProjectStore.getState();
      const { x, y } = calculateAestheticPlacement({
        nodes,
        rootId,
        selectedIds,
        incomingW: w,
        incomingH: h,
        viewport: { panX, panY, zoom, viewportW: vw, viewportH: vh },
        gridConfig,
      });

      const addComponent = useProjectStore.getState().addComponent;
      const selectComponent = useUIStore.getState().selectComponent;
      const newId = addComponent(
        "Image",
        { x, y },
        code,
        { w },
        { fileName, alt: fileName }
      );
      selectComponent(newId);
    } catch (err) {
      console.error("Failed to load image:", err);
    }
  };

  const triggerImagePicker = () => {
    imageInputRef.current?.click();
  };

  return (
    <div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/gif,image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={onImageFileChange}
      />
      <DropdownMenu
        open={activeMenu === "primitives"}
        onOpenChange={(open) => setActiveMenu(open ? "primitives" : null)}
        modal={false}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-foreground flex items-center gap-2 h-8 py-1"
            >
              <Plus className="h-4 w-4" />
              <span className="text-xs">Add</span>
            </Button>
          }
        />
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="w-48 p-1"
        >
          {PRIMITIVE_COMPONENTS.map((comp) => (
            <DropdownMenuItem
              key={comp.type}
              onClick={() => {
                if (comp.type === "Wireframe") {
                  addWireframeToCanvas();
                } else if (comp.type === "Image") {
                  triggerImagePicker();
                } else {
                  addComponentToCanvas(comp.type as any);
                }
                setActiveMenu(null);
              }}
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md"
            >
              <comp.icon className="h-4 w-4 text-muted-foreground" />
              <span>{comp.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
