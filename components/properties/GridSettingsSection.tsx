"use client";

import { Eye, Magnet } from "lucide-react";
import { Switch } from "@/components/luova-ui/switch";
import { useCanvasStore } from "@/stores/canvas-store";
import { SliderWithInput } from "./SliderWithInput";

export default function GridSettingsSection() {
  const gridConfig = useCanvasStore((state) => state.gridConfig);
  const toggleGrid = useCanvasStore((state) => state.toggleGrid);
  const toggleSnapToGrid = useCanvasStore((state) => state.toggleSnapToGrid);
  const setGridSize = useCanvasStore((state) => state.setGridSize);
  const setGridSizeImmediate = useCanvasStore(
    (state) => state.setGridSizeImmediate
  );
  const setGridOpacity = useCanvasStore((state) => state.setGridOpacity);
  const setGridOpacityImmediate = useCanvasStore(
    (state) => state.setGridOpacityImmediate
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <SliderWithInput
          label="Grid Opacity"
          value={gridConfig.gridOpacity}
          onChange={setGridOpacity}
          onChangeImmediate={setGridOpacityImmediate}
          min={0}
          max={1}
          step={0.001}
        />

        <SliderWithInput
          label="Grid Size"
          value={gridConfig.gridSize}
          onChange={setGridSize}
          onChangeImmediate={setGridSizeImmediate}
          min={5}
          max={100}
          step={1}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Show Grid</span>
        </div>
        <Switch checked={gridConfig.showGrid} onCheckedChange={toggleGrid} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Magnet className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Snap to Grid</span>
        </div>
        <Switch
          checked={gridConfig.snapToGrid}
          onCheckedChange={toggleSnapToGrid}
        />
      </div>
    </div>
  );
}
