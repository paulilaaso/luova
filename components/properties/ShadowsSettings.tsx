"use client";

import { Eye, EyeOff, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Card } from "@/components/luova-ui/card";
import { Input } from "@/components/luova-ui/input";
import { defaultThemeState } from "@/config/theme";
import { useThemeStore } from "@/stores/theme-store";
import type { ShadowGroup, ShadowLayer } from "@/types/theme";
import { debounce } from "@/utils/debounce";
import { ThemeEngine } from "@/utils/theme-engine";
import ShadowControl from "./ShadowControl";

export default function ShadowsSettings() {
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  const currentStyles = useMemo(
    () => ({
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    }),
    [currentMode, themeState]
  );

  const [groups, setGroups] = useState<ShadowGroup[]>([]);
  const committedShadowJsonRef = useRef<string>("");

  const shadowGroupsJson = currentStyles["shadow-groups"];
  useEffect(() => {
    // Defense-in-depth: skip when the JSON string hasn't changed (A2)
    if (shadowGroupsJson === committedShadowJsonRef.current) return;

    try {
      const parsed = JSON.parse(shadowGroupsJson || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) {
        setGroups(parsed);
      } else {
        setGroups([
          { id: "default", name: "Default", isDefault: true, layers: [] },
        ]);
      }
    } catch {
      setGroups([
        { id: "default", name: "Default", isDefault: true, layers: [] },
      ]);
    }
  }, [shadowGroupsJson]);

  const debouncedStoreUpdate = useMemo(
    () =>
      debounce((updated: ShadowGroup[]) => {
        const json = JSON.stringify(updated);
        committedShadowJsonRef.current = json;
        updateThemeToken("shadow-groups", json);
      }, 150),
    [updateThemeToken]
  );

  const persistGroups = (updated: ShadowGroup[]) => {
    setGroups(updated);
    debouncedStoreUpdate(updated);
  };

  // During a drag: only update the CSS preview on the DOM.
  // No setGroups, no updateThemeTokenImmediate — those happen on drag-end via persistGroups (A1, A4).
  const persistGroupsImmediate = (updated: ShadowGroup[]) => {
    for (const group of updated) {
      ThemeEngine.applyShadowGroupPreview(
        group.id,
        group.layers,
        group.isDefault ?? false
      );
    }
  };

  const addGroup = () => {
    const existingCount = groups.filter((g) => !g.isDefault).length;
    const newGroup: ShadowGroup = {
      id: uuidv4(),
      name: `Shadow ${existingCount + 1}`,
      isDefault: false,
      layers: [
        {
          id: `layer-${Date.now()}`,
          type: "drop",
          offsetX: "0px",
          offsetY: "1px",
          blur: "3px",
          spread: "0px",
          opacity: "0.1",
          color: "oklch(0 0 0)",
        },
      ],
    };
    persistGroups([...groups, newGroup]);
  };

  const deleteGroup = (id: string) => {
    persistGroups(groups.filter((g) => g.id !== id));
  };

  const renameGroup = (id: string, name: string) => {
    persistGroups(groups.map((g) => (g.id === id ? { ...g, name } : g)));
  };

  const toggleGroupVisibility = (id: string) => {
    persistGroups(
      groups.map((g) => (g.id === id ? { ...g, visible: !g.visible } : g))
    );
  };

  const updateGroupLayers = (id: string, layers: ShadowLayer[]) => {
    persistGroups(groups.map((g) => (g.id === id ? { ...g, layers } : g)));
  };

  const addLayerToGroup = (groupId: string) => {
    const newLayer: ShadowLayer = {
      id: uuidv4(),
      type: "drop",
      offsetX: "0px",
      offsetY: "1px",
      blur: "3px",
      spread: "0px",
      opacity: "0.1",
      color: "oklch(0 0 0)",
    };
    persistGroups(
      groups.map((g) =>
        g.id === groupId ? { ...g, layers: [...g.layers, newLayer] } : g
      )
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-4">
        <span className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Shadow Groups
        </span>
        <button
          type="button"
          onClick={addGroup}
          className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="w-full space-y-5">
        {groups.map((group) => {
          const isVisible = group.visible !== false;
          return (
            <Card
              key={group.id}
              className="overflow-hidden border p-0 !py-0 shadow-none"
            >
              <div className="flex w-full items-center gap-3 px-4 pt-3 pb-0 text-xs font-medium">
                <Input
                  value={group.name}
                  onChange={(e) => renameGroup(group.id, e.target.value)}
                  disabled={group.id === "default"}
                  className="h-6 w-32 px-1.5 py-0 text-xs"
                />
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroupVisibility(group.id)}
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
                    onClick={() => addLayerToGroup(group.id)}
                    className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {!group.isDefault && (
                    <button
                      type="button"
                      onClick={() => deleteGroup(group.id)}
                      className="hover:bg-accent hover:text-accent-foreground text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="px-4 pt-3 pb-3">
                <ShadowControl
                  layers={group.layers}
                  onChange={(layers) => updateGroupLayers(group.id, layers)}
                  onChangeImmediate={(layers) =>
                    persistGroupsImmediate(
                      groups.map((g) =>
                        g.id === group.id ? { ...g, layers } : g
                      )
                    )
                  }
                />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
