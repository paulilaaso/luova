"use client";

import type React from "react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/luova-ui/button";
import { Label } from "@/components/luova-ui/label";
import { useOptimizedSliderUpdate } from "@/hooks/use-optimized-theme-update";
import { useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import type { FontInfo } from "@/types/fonts";
import type { CustomFont } from "@/types/theme";
import { isValidFontFile, readFontAsBase64 } from "@/utils/file-helpers";
import { buildFontFamily, loadGoogleFont } from "@/utils/fonts";
import { ThemeEngine } from "@/utils/theme-engine";
import { FontPicker } from "./FontPicker";
import { SliderWithInput } from "./SliderWithInput";
import { ExpandableCard } from "./ui/ExpandableCard";

const PANEL_KEY = "theme";

export default function TypographySettings() {
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);
  const { handleSliderChange } = useOptimizedSliderUpdate();

  const expandedItems = useUIStore(
    (state) => state.expandedAccordions[PANEL_KEY] || []
  );
  const setExpandedItems = useUIStore((state) => state.setExpandedItems);

  const isExpanded = (key: string) => expandedItems.includes(key);

  const handleToggle = (key: string) => {
    if (isExpanded(key)) {
      setExpandedItems(
        PANEL_KEY,
        expandedItems.filter((id) => id !== key)
      );
    } else {
      setExpandedItems(PANEL_KEY, [...expandedItems, key]);
    }
  };

  const currentStyles = themeState.styles[currentMode];
  const customFonts = (currentStyles.customFonts || []) as CustomFont[];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addAsset = useProjectStore((state) => state.addAsset);
  const addCustomFont = useThemeStore((state) => state.addCustomFont);
  const removeCustomFont = useThemeStore((state) => state.removeCustomFont);

  const handleDeleteCustomFont = (fontId: string) => {
    removeCustomFont(fontId);
  };

  const handleUploadFont = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (!isValidFontFile(file)) {
        toast.error("Invalid font file", {
          description: `${file.name}: Please upload a WOFF, WOFF2, TTF, or OTF file.`,
        });
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) return;

    try {
      const uploadedFamilies: string[] = [];
      for (const file of validFiles) {
        const base64 = await readFontAsBase64(file);
        const assetId = addAsset(base64, file.name);

        const extension = file.name.split(".").pop() || "woff2";
        const family = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

        addCustomFont(family, assetId, extension);
        uploadedFamilies.push(family);
      }

      const message =
        uploadedFamilies.length === 1
          ? `Added "${uploadedFamilies[0]}" to your fonts`
          : `Added ${uploadedFamilies.length} fonts: ${uploadedFamilies.join(", ")}`;
      toast.success(message);
    } catch (err) {
      console.error("Failed to upload font:", err);
      toast.error("Failed to upload font file", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ExpandableCard
        title="Fonts"
        isExpanded={isExpanded("fonts")}
        onToggle={() => handleToggle("fonts")}
      >
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">
              Sans-Serif Font
            </Label>
            <FontPicker
              value={
                currentStyles["font-sans"]
                  ?.split(",")[0]
                  .trim()
                  .replace(/['"]/g, "") ?? ""
              }
              category="sans-serif"
              placeholder="Choose a sans-serif font..."
              customFonts={customFonts}
              hideThemeFonts={true}
              onDeleteFont={handleDeleteCustomFont}
              onSelect={(font: FontInfo) => {
                const fontFamily = buildFontFamily(font.family, font.category);
                updateThemeToken("font-sans", fontFamily);
                loadGoogleFont(font.family);
              }}
            />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">
              Serif Font
            </Label>
            <FontPicker
              value={
                currentStyles["font-serif"]
                  ?.split(",")[0]
                  .trim()
                  .replace(/['"]/g, "") ?? ""
              }
              category="serif"
              placeholder="Choose a serif font..."
              customFonts={customFonts}
              hideThemeFonts={true}
              onDeleteFont={handleDeleteCustomFont}
              onSelect={(font: FontInfo) => {
                const fontFamily = buildFontFamily(font.family, font.category);
                updateThemeToken("font-serif", fontFamily);
                loadGoogleFont(font.family);
              }}
            />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">
              Monospace Font
            </Label>
            <FontPicker
              value={
                currentStyles["font-mono"]
                  ?.split(",")[0]
                  .trim()
                  .replace(/['"]/g, "") ?? ""
              }
              category="monospace"
              placeholder="Choose a monospace font..."
              customFonts={customFonts}
              hideThemeFonts={true}
              onDeleteFont={handleDeleteCustomFont}
              onSelect={(font: FontInfo) => {
                const fontFamily = buildFontFamily(font.family, font.category);
                updateThemeToken("font-mono", fontFamily);
                loadGoogleFont(font.family);
              }}
            />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">
              Heading Font
            </Label>
            <FontPicker
              value={
                currentStyles["font-heading"]
                  ?.split(",")[0]
                  .trim()
                  .replace(/['"]/g, "") ?? ""
              }
              placeholder="Same as Sans-Serif"
              customFonts={customFonts}
              onDeleteFont={handleDeleteCustomFont}
              onSelect={(font: FontInfo) => {
                const fontFamily = buildFontFamily(font.family, font.category);
                updateThemeToken("font-heading", fontFamily);
                loadGoogleFont(font.family);
              }}
            />
          </div>
          <div className="pt-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".woff,.woff2,.ttf,.otf"
              onChange={handleUploadFont}
              className="hidden"
              multiple
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="w-full text-xs h-8"
            >
              Upload Custom Font
            </Button>
          </div>
        </div>
      </ExpandableCard>

      <ExpandableCard
        title="Font Scale"
        isExpanded={isExpanded("font-scale")}
        onToggle={() => handleToggle("font-scale")}
      >
        <SliderWithInput
          value={parseFloat(currentStyles["font-scale"] ?? "1")}
          onChange={(value) => updateThemeToken("font-scale", `${value}`)}
          onChangeImmediate={(value) =>
            handleSliderChange("font-scale", value, "")
          }
          onReset={() => {
            ThemeEngine.clearTokensCssVariables(["font-scale"]);
            updateThemeToken("font-scale", undefined);
          }}
          min={0.75}
          max={1.5}
          step={0.05}
          label="Master Font Scale"
        />
      </ExpandableCard>

      <ExpandableCard
        title="Letter Spacing"
        isExpanded={isExpanded("letter-spacing")}
        onToggle={() => handleToggle("letter-spacing")}
      >
        <SliderWithInput
          value={parseFloat(
            currentStyles["letter-spacing"]?.replace("em", "") ?? "0"
          )}
          onChange={(value) => updateThemeToken("letter-spacing", `${value}em`)}
          onChangeImmediate={(value) =>
            handleSliderChange("letter-spacing", value, "em")
          }
          onReset={() => {
            ThemeEngine.clearTokensCssVariables(["letter-spacing"]);
            updateThemeToken("letter-spacing", undefined);
          }}
          min={-0.1}
          max={1.0}
          step={0.01}
          label="Letter Spacing"
        />
      </ExpandableCard>
    </div>
  );
}
