"use client";

import {
  Bold,
  CaseSensitive,
  ChevronDown,
  type LucideIcon,
  MoveHorizontal,
  MoveVertical,
  Type,
  UnfoldHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Separator } from "@/components/luova-ui/separator";
import {
  DEFAULT_FONT_MONO,
  DEFAULT_FONT_SANS,
  DEFAULT_FONT_SERIF,
} from "@/config/theme-tokens";
import { cn, stopShortcutsExceptUndo } from "@/lib/luova-utils";
import type { TextAlignment } from "@/stores/text-format-store";
import { useThemeStore } from "@/stores/theme-store";
import {
  extractFontFamily,
  fetchGoogleFontWeights,
  loadCustomFont,
  loadGoogleFont,
  registerCustomFont,
} from "@/utils/fonts";
import {
  type TypographyProperty,
  type TypographyValues,
  typographyPresets,
} from "@/utils/text-typography";
import { resolveDisplayColor } from "@/utils/theme-resolver";
import { FontPicker } from "./FontPicker";
import { FormatButton } from "./FormatButton";
import { InlineFormatToggles } from "./InlineFormatToggles";
import { OptimizedColorPicker } from "./OptimizedColorPicker";
import { SliderWithInput } from "./SliderWithInput";
import { ALIGNMENTS } from "./TextBlockFormatControls";
import { PanelRow, ROW_GRID } from "./ui/PanelRow";
import { TOOLBAR_BUTTON, TOOLBAR_TRACK } from "./ui/toolbar";

interface Props {
  values: TypographyValues;
  onChange: (
    property: TypographyProperty,
    value: string | number,
    tokenKey?: string
  ) => void;
  onPreview?: (property: TypographyProperty, value: string | number) => void;
  system?: boolean;
  /** Render the bold/italic/underline row at the top (captured elements). The
   * text panel hosts these in its own toolbar instead. */
  showInlineFormats?: boolean;
  /** When given, alignment buttons join the bold/italic/underline row. */
  alignment?: string;
  onAlign?: (alignment: TextAlignment) => void;
  /** Show the text color picker (off where a Colors card already has one). */
  showColor?: boolean;
  /** "rows": label-left rows on the Edit mode label column (font, weight,
   * size, line height, letter and word spacing, then color) in the
   * panel's field look, no dividers; "grid" (default): the older icon grid. */
  layout?: "grid" | "rows";
}

interface FieldDef {
  key: TypographyProperty;
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  unit?: string;
  Icon: LucideIcon;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WEIGHT_NAMES: Record<string, string> = {
  "font-thin": "Thin",
  "font-extralight": "Extra Light",
  "font-light": "Light",
  "font-normal": "Regular",
  "font-medium": "Medium",
  "font-semibold": "Semibold",
  "font-bold": "Bold",
  "font-extrabold": "Extra Bold",
  "font-black": "Black",
};

/** Designer-facing name for a preset ("Base · 16", "Regular", "Tight · 1.2"). */
function presetLabel(
  key: TypographyProperty,
  name: string,
  value: number
): string {
  switch (key) {
    case "fontSize": {
      const size = name.replace(/^text-/, "");
      return `${size === "base" ? "Base" : size.toUpperCase()} · ${value}`;
    }
    case "fontWeight":
      return WEIGHT_NAMES[name] ?? name;
    case "lineHeight":
      // leading-6 etc. are fixed heights; the named ones are ratios.
      return /^\d+$/.test(name)
        ? `${value}px`
        : `${capitalize(name)} · ${value / 100}`;
    case "letterSpacing":
      return value === 0
        ? capitalize(name)
        : `${capitalize(name)} · ${value}em`;
    default:
      return name;
  }
}

const fields: FieldDef[] = [
  {
    key: "fontSize",
    label: "Font size",
    min: 1,
    max: 256,
    step: 1,
    fallback: 16,
    unit: "px",
    Icon: Type,
  },
  {
    key: "fontWeight",
    label: "Font weight",
    min: 100,
    max: 900,
    step: 100,
    fallback: 400,
    Icon: Bold,
  },
  {
    key: "lineHeight",
    label: "Line height (%)",
    min: 50,
    max: 500,
    step: 5,
    fallback: 150,
    unit: "%",
    Icon: MoveVertical,
  },
  {
    key: "letterSpacing",
    label: "Letter spacing (em)",
    min: -0.1,
    max: 1,
    step: 0.005,
    fallback: 0,
    unit: "em",
    Icon: MoveHorizontal,
  },
  {
    key: "wordSpacing",
    label: "Word spacing (em)",
    min: -0.1,
    max: 1,
    step: 0.01,
    fallback: 0,
    unit: "em",
    Icon: UnfoldHorizontal,
  },
];

/**
 * The weights the font actually ships, or null when unknown (custom/system
 * fonts, mixed selection, lookup still pending or failed).
 */
function useAvailableFontWeights(family: string | undefined) {
  const [result, setResult] = useState<{
    family: string;
    weights: number[] | null;
  } | null>(null);

  useEffect(() => {
    if (!family) return;
    let cancelled = false;
    fetchGoogleFontWeights(family).then((weights) => {
      if (cancelled) return;
      setResult({ family, weights });
      // Make sure every weight offered below can actually render.
      if (weights) loadGoogleFont(family, { allWeights: true });
    });
    return () => {
      cancelled = true;
    };
  }, [family]);

  return result && result.family === family ? result.weights : null;
}

// Two controls per row, matching the rest of the config panels; an odd one
// out (word spacing) spans the full row.
const FIELD_GRID =
  "grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2";

export function TypographyControls({
  values,
  onChange,
  onPreview,
  system = false,
  showInlineFormats = true,
  alignment,
  onAlign,
  showColor = true,
  layout = "grid",
}: Props) {
  const themeState = useThemeStore((s) => s.themeState);
  const mode = useThemeStore((s) => s.currentMode);
  const customFonts = themeState.styles[mode].customFonts || [];

  // Theme tokens ("sans", "heading"…) resolve to the theme's font. Font
  // tokens are shared between light and dark, so the light styles hold them.
  const lightStyles = themeState.styles.light;
  const themeSans = lightStyles["font-sans"] || DEFAULT_FONT_SANS;
  const themeFontStacks: Record<string, string> = {
    sans: themeSans,
    serif: lightStyles["font-serif"] || DEFAULT_FONT_SERIF,
    mono: lightStyles["font-mono"] || DEFAULT_FONT_MONO,
    heading: lightStyles["font-heading"] || themeSans,
  };
  const family = values.fontFamily || undefined;
  const resolvedFamily =
    family && Object.hasOwn(themeFontStacks, family)
      ? (extractFontFamily(themeFontStacks[family]) ?? undefined)
      : family;
  const availableWeights = useAvailableFontWeights(resolvedFamily);

  const renderField = (field: FieldDef) => {
    const presets =
      field.key in typographyPresets
        ? typographyPresets[field.key as keyof typeof typographyPresets]
        : null;
    const raw = values[field.key];
    const numeric = Number(raw);
    const isMixed = raw === "" || !Number.isFinite(numeric);
    // Font weight only offers the weights this font has.
    const weights = field.key === "fontWeight" ? availableWeights : null;

    if (system && presets) {
      const options = Object.entries(presets).filter(
        ([, value]) => !weights || weights.includes(value)
      );
      // A weight the font lacks shows as "Custom" rather than vanishing.
      const matchedPreset = !isMixed
        ? options.find(([, value]) => value === numeric)?.[0]
        : undefined;
      const tokenLabel = (name: string) =>
        presetLabel(field.key, name, presets[name as keyof typeof presets]);
      const customLabel = isMixed
        ? "Mixed"
        : `Custom (${raw}${field.unit ?? ""})`;

      return (
        <label
          key={field.key}
          title={field.label}
          // Rows layout: the theme's input look, same as the scrub fields.
          data-slot={layout === "rows" ? "input" : undefined}
          className="cn-input relative flex h-7 min-w-0 items-center gap-2 px-2 focus-within:ring-2 focus-within:ring-ring/50"
        >
          <field.Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground"
          />
          <select
            aria-label={field.label}
            className="h-full min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pr-5 text-xs outline-none"
            value={matchedPreset ? numeric : raw}
            onChange={(e) => onChange(field.key, Number(e.target.value))}
          >
            {!matchedPreset && <option value={raw}>{customLabel}</option>}
            {options.map(([name, value]) => (
              <option key={name} value={value}>
                {tokenLabel(name)}
              </option>
            ))}
          </select>
        </label>
      );
    }

    // Always expose the Luova scrub-handle slider — including while a text
    // range is selected and for mixed values — so granular drag adjustment
    // is never silently replaced by a plain number input.
    return (
      <SliderWithInput
        key={field.key}
        label={isMixed ? `${field.label} · mixed` : field.label}
        value={isMixed ? field.fallback : numeric}
        min={weights ? weights[0] : field.min}
        max={weights ? weights[weights.length - 1] : field.max}
        step={field.step}
        icon={<field.Icon className="size-3.5" />}
        unit={field.unit}
        onChange={(v) => onChange(field.key, v)}
        onChangeImmediate={(v) => onPreview?.(field.key, v)}
        onCommit={(v) => onChange(field.key, v)}
      />
    );
  };

  // The text color may be a theme token name ("foreground"): paint the
  // swatch with its resolved color and show the name as text.
  const rawTextColor = values.textColor || undefined;
  const textColorToken =
    rawTextColor && !rawTextColor.includes("(") && !rawTextColor.includes("#")
      ? rawTextColor
      : undefined;
  const textColorProps = {
    label: "Text color",
    color: textColorToken
      ? resolveDisplayColor(textColorToken, themeState.styles[mode]) ||
        rawTextColor
      : rawTextColor,
    onChange: (value: string) => onPreview?.("textColor", value),
    onChangeCommit: (value: string, token?: string) =>
      onChange("textColor", value, token),
  };

  const field = (key: TypographyProperty) =>
    fields.find((f) => f.key === key) as FieldDef;

  const fontPicker = (
    <FontPicker
      className="h-7 text-xs"
      fieldLook={layout === "rows"}
      icon={layout === "rows" ? <CaseSensitive /> : undefined}
      value={values.fontFamily || undefined}
      placeholder="Mixed fonts"
      customFonts={customFonts}
      onSelect={(font) => {
        const custom = customFonts.find((f) => f.family === font.family);
        if (custom) {
          registerCustomFont(font.family);
          loadCustomFont([custom]);
        }
        onChange("fontFamily", font.family);
      }}
    />
  );

  return (
    <fieldset
      aria-label="Typography"
      data-text-format-controls="true"
      className="space-y-3"
      onKeyDown={stopShortcutsExceptUndo}
    >
      {showInlineFormats && (
        <div className="flex gap-1.5">
          <div className={TOOLBAR_TRACK}>
            <InlineFormatToggles
              values={values}
              onChange={onChange}
              buttonClassName={TOOLBAR_BUTTON}
            />
          </div>
          {onAlign && (
            <div className={cn(TOOLBAR_TRACK, "flex-[4]")}>
              {ALIGNMENTS.map(({ alignment: value, label, Icon }) => (
                <FormatButton
                  key={value}
                  label={label}
                  active={alignment === value}
                  disabled={false}
                  className={TOOLBAR_BUTTON}
                  onClick={() => onAlign(value)}
                >
                  <Icon className="size-3.5" />
                </FormatButton>
              ))}
            </div>
          )}
        </div>
      )}

      {layout === "rows" ? (
        <div className={ROW_GRID}>
          <PanelRow label="Font">{fontPicker}</PanelRow>
          <PanelRow label="Weight">{renderField(field("fontWeight"))}</PanelRow>
          <PanelRow label="Size">{renderField(field("fontSize"))}</PanelRow>
          <PanelRow label="Height">{renderField(field("lineHeight"))}</PanelRow>
          <PanelRow label="Letter">
            {renderField(field("letterSpacing"))}
          </PanelRow>
          <PanelRow label="Word">{renderField(field("wordSpacing"))}</PanelRow>
          {showColor && (
            <PanelRow label="Color">
              <OptimizedColorPicker
                {...textColorProps}
                variant="row"
                displayValue={textColorToken}
              />
            </PanelRow>
          )}
        </div>
      ) : (
        <>
          {showInlineFormats && <Separator className="bg-border" />}
          {fontPicker}
          <div className={FIELD_GRID}>
            {fields.slice(0, 2).map(renderField)}
          </div>
          <Separator className="bg-border" />
          <div className={FIELD_GRID}>{fields.slice(2).map(renderField)}</div>
          {showColor && (
            <>
              <Separator className="bg-border" />
              <OptimizedColorPicker {...textColorProps} />
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
