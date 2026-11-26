import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Minus, Settings2 } from "lucide-react";
import type React from "react";
import { Card } from "@/components/luova-ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/luova-ui/popover";
import { cn } from "@/lib/luova-utils";
import type { ShadowLayer } from "../../types/theme";
import ColorPicker from "./ColorPicker";
import { SliderWithInput } from "./SliderWithInput";

interface ShadowControlProps {
  layers: ShadowLayer[];
  onChange: (layers: ShadowLayer[]) => void;
  onChangeImmediate?: (layers: ShadowLayer[]) => void;
  onAdd?: () => void;
}

function SortableLayerItem({
  layer,
  index,
  onUpdate,
  onUpdateImmediate,
  onRemove,
  onToggleVisibility,
}: {
  layer: ShadowLayer;
  index: number;
  onUpdate: (id: string, property: keyof ShadowLayer, value: string) => void;
  onUpdateImmediate?: (
    id: string,
    property: keyof ShadowLayer,
    value: string
  ) => void;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    // Override Card internal variables to make it distinct but themeable
    "--card-bg": "var(--muted)",
    "--card-py": "0.25rem",
  };

  const isVisible = layer.visible !== false;

  return (
    <Card
      ref={setNodeRef}
      style={style as React.CSSProperties}
      className="mb-2 flex flex-row items-center !gap-2 border px-2 py-1 shadow-none"
    >
      <span
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <span className="text-muted-foreground w-4 text-xs font-medium">
        {index + 1}.
      </span>
      <div
        className="border-border/40 flex gap-0.5 rounded border p-0.5"
        role="radiogroup"
        aria-label="Shadow type"
      >
        {/* biome-ignore lint/a11y/useSemanticElements: <button role="radio"> is needed for custom-styled radio buttons */}
        <button
          type="button"
          role="radio"
          aria-checked={layer.type === "drop"}
          data-state={layer.type === "drop" ? "active" : "inactive"}
          className={cn(
            "rounded px-1.5 py-0.5 text-2xs font-medium transition-colors outline-none",
            "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1",
            "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
            "data-[state=inactive]:text-muted-foreground hover:data-[state=inactive]:text-foreground"
          )}
          onClick={() => onUpdate(layer.id, "type", "drop")}
        >
          Drop
        </button>
        {/* biome-ignore lint/a11y/useSemanticElements: <button role="radio"> is needed for custom-styled radio buttons */}
        <button
          type="button"
          role="radio"
          aria-checked={layer.type === "inset"}
          data-state={layer.type === "inset" ? "active" : "inactive"}
          className={cn(
            "rounded px-1.5 py-0.5 text-2xs font-medium transition-colors outline-none",
            "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1",
            "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
            "data-[state=inactive]:text-muted-foreground hover:data-[state=inactive]:text-foreground"
          )}
          onClick={() => onUpdate(layer.id, "type", "inset")}
        >
          Inset
        </button>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            }
          />
          <PopoverContent className="w-72" side="left" align="start">
            <div className="space-y-3">
              <h4 className="text-sm leading-none font-medium">
                Layer {index + 1} — {layer.type === "inset" ? "Inset" : "Drop"}
              </h4>
              <div className="space-y-2">
                <ColorPicker
                  color={layer.color}
                  onChange={(color) => onUpdate(layer.id, "color", color)}
                  onChangeImmediate={(color) =>
                    onUpdateImmediate?.(layer.id, "color", color)
                  }
                  label="Color"
                  name=""
                />
                <div className="grid grid-cols-2 gap-2">
                  <SliderWithInput
                    value={parseFloat(layer.offsetX.replace("px", ""))}
                    onChange={(value) =>
                      onUpdate(layer.id, "offsetX", `${value}px`)
                    }
                    onChangeImmediate={(value) =>
                      onUpdateImmediate?.(layer.id, "offsetX", `${value}px`)
                    }
                    min={-400}
                    max={400}
                    step={0.5}
                    label="Offset X"
                  />
                  <SliderWithInput
                    value={parseFloat(layer.offsetY.replace("px", ""))}
                    onChange={(value) =>
                      onUpdate(layer.id, "offsetY", `${value}px`)
                    }
                    onChangeImmediate={(value) =>
                      onUpdateImmediate?.(layer.id, "offsetY", `${value}px`)
                    }
                    min={-400}
                    max={400}
                    step={0.5}
                    label="Offset Y"
                  />
                  <SliderWithInput
                    value={parseFloat(layer.opacity)}
                    onChange={(value) =>
                      onUpdate(layer.id, "opacity", value.toString())
                    }
                    onChangeImmediate={(value) =>
                      onUpdateImmediate?.(layer.id, "opacity", value.toString())
                    }
                    min={0}
                    max={1}
                    step={0.01}
                    label="Opacity"
                  />
                  <SliderWithInput
                    value={parseFloat(layer.blur.replace("px", ""))}
                    onChange={(value) =>
                      onUpdate(layer.id, "blur", `${value}px`)
                    }
                    onChangeImmediate={(value) =>
                      onUpdateImmediate?.(layer.id, "blur", `${value}px`)
                    }
                    min={0}
                    max={200}
                    step={0.5}
                    label="Blur"
                  />
                  <div className="col-span-2">
                    <SliderWithInput
                      value={parseFloat(layer.spread.replace("px", ""))}
                      onChange={(value) =>
                        onUpdate(layer.id, "spread", `${value}px`)
                      }
                      onChangeImmediate={(value) =>
                        onUpdateImmediate?.(layer.id, "spread", `${value}px`)
                      }
                      min={-400}
                      max={400}
                      step={0.5}
                      label="Spread"
                    />
                  </div>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={() => onToggleVisibility(layer.id)}
          className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {isVisible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="text-muted-foreground h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onRemove(layer.id)}
          className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  );
}

const ShadowControl: React.FC<ShadowControlProps> = ({
  layers,
  onChange,
  onChangeImmediate,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const updateShadowProperty = (
    id: string,
    property: keyof ShadowLayer,
    newValue: string
  ) => {
    onChange(
      layers.map((layer) =>
        layer.id === id ? { ...layer, [property]: newValue } : layer
      )
    );
  };

  const updateShadowPropertyImmediate = (
    id: string,
    property: keyof ShadowLayer,
    newValue: string
  ) => {
    if (onChangeImmediate) {
      onChangeImmediate(
        layers.map((layer) =>
          layer.id === id ? { ...layer, [property]: newValue } : layer
        )
      );
    }
  };

  const toggleVisibility = (id: string) => {
    onChange(
      layers.map((layer) =>
        layer.id === id ? { ...layer, visible: !layer.visible } : layer
      )
    );
  };

  const removeShadowLayer = (id: string) => {
    onChange(layers.filter((layer) => layer.id !== id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = layers.findIndex((l) => l.id === active.id);
      const newIndex = layers.findIndex((l) => l.id === over.id);
      onChange(arrayMove(layers, oldIndex, newIndex));
    }
  };

  return (
    <div className="space-y-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={layers.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {layers.map((layer, index) => (
            <SortableLayerItem
              key={layer.id}
              layer={layer}
              index={index}
              onUpdate={updateShadowProperty}
              onUpdateImmediate={updateShadowPropertyImmediate}
              onRemove={removeShadowLayer}
              onToggleVisibility={toggleVisibility}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
};

export default ShadowControl;
