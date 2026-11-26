"use client";

import {
  Check,
  ChevronDown,
  FunnelX,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/luova-ui/button";
import { Command, CommandEmpty } from "@/components/luova-ui/command";
import { Input } from "@/components/luova-ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/luova-ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/luova-ui/select";
import { Separator } from "@/components/luova-ui/separator";
import {
  DEFAULT_FONT_MONO,
  DEFAULT_FONT_SANS,
  DEFAULT_FONT_SERIF,
} from "@/config/theme-tokens";
import {
  type FilterFontCategory,
  useFontSearch,
} from "@/hooks/use-font-search";
import { cn } from "@/lib/luova-utils";
import { useThemeStore } from "@/stores/theme-store";
import type { FontInfo } from "@/types/fonts";
import type { CustomFont } from "@/types/theme";
import {
  buildFontFamily,
  extractFontFamily,
  getFontDisplayName,
  loadGoogleFont,
} from "@/utils/fonts";

const THEME_FONTS: FontInfo[] = [
  {
    family: "sans",
    category: "sans-serif",
    variants: ["400"],
    variable: false,
  },
  { family: "serif", category: "serif", variants: ["400"], variable: false },
  { family: "mono", category: "monospace", variants: ["400"], variable: false },
  {
    family: "heading",
    category: "sans-serif",
    variants: ["400"],
    variable: false,
  },
];

interface FontPickerProps {
  value?: string;
  category?: FilterFontCategory;
  onSelect: (font: FontInfo) => void;
  onDeleteFont?: (fontId: string) => void;
  placeholder?: string;
  className?: string;
  /** Style the trigger like the panel's text fields (theme input look). */
  fieldLook?: boolean;
  /** Leading icon inside the trigger, like the panel's other fields. */
  icon?: React.ReactNode;
  customFonts?: CustomFont[];
  hideThemeFonts?: boolean;
  themeFontsPosition?: "top" | "bottom";
}

export function FontPicker({
  value,
  category,
  onSelect,
  onDeleteFont,
  placeholder = "Search fonts...",
  className,
  fieldLook = false,
  icon,
  customFonts = [],
  hideThemeFonts = false,
  themeFontsPosition = "top",
}: FontPickerProps) {
  const [open, setOpen] = useState(false);
  // Font tokens are shared between light and dark, so the light styles hold them.
  const themeStyles = useThemeStore((state) => state.themeState.styles.light);
  const themeSans = themeStyles["font-sans"] || DEFAULT_FONT_SANS;
  const themeFontStacks: Record<string, string> = {
    sans: themeSans,
    serif: themeStyles["font-serif"] || DEFAULT_FONT_SERIF,
    mono: themeStyles["font-mono"] || DEFAULT_FONT_MONO,
    heading: themeStyles["font-heading"] || themeSans,
  };
  const isThemeFont = (family: string) =>
    !hideThemeFonts && Object.hasOwn(themeFontStacks, family);
  // "Inter" for a Google font, "System Serif" for a generic keyword.
  const themeFontName = (family: string) => {
    const stack = themeFontStacks[family] ?? "";
    return (
      extractFontFamily(stack) ??
      getFontDisplayName(stack.split(",")[0].replace(/['"]/g, ""))
    );
  };
  const [inputValue, setInputValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<FilterFontCategory>(
    category || "all"
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedFontRef = useRef<HTMLDivElement>(null);
  const hasScrolledToSelectedFont = useRef(false);

  // Pre-load on mount so data is ready before the popover opens
  const fontQuery = useFontSearch({
    query: inputValue,
    category: selectedCategory,
    limit: 30,
    enabled: true,
  });

  // Flatten all pages into a single array
  const allFonts = useMemo(() => {
    if (!fontQuery.data.pages.length) return [];
    return fontQuery.data.pages.flatMap((page) => page.fonts);
  }, [fontQuery.data]);

  // Scroll to selected font once on open — double rAF ensures the popover
  // entrance animation and list paint are both complete before measuring.
  useEffect(() => {
    if (!open) {
      hasScrolledToSelectedFont.current = false;
      return;
    }
    if (hasScrolledToSelectedFont.current) return;
    if (allFonts.length === 0) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = selectedFontRef.current;
        const container = scrollRef.current;
        if (!container || !el) return;

        hasScrolledToSelectedFont.current = true;
        container.style.scrollBehavior = "auto";
        const elTop = el.offsetTop;
        const elHeight = el.offsetHeight;
        const containerHeight = container.clientHeight;
        container.scrollTop = elTop - containerHeight / 2 + elHeight / 2;
      });
    });
  }, [open, allFonts.length]);

  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !fontQuery.hasMore || fontQuery.isLoading) return;

    let observer: IntersectionObserver;

    const raf = requestAnimationFrame(() => {
      if (!scrollRef.current || !loadMoreRef.current) return;

      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            fontQuery.loadMore?.();
          }
        },
        { root: scrollRef.current, rootMargin: "100px" }
      );

      observer.observe(loadMoreRef.current);
    });

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [open, fontQuery.hasMore, fontQuery.isLoading, fontQuery.loadMore]);

  const handleFontSelect = useCallback(
    (font: FontInfo) => {
      onSelect(font);
      setTimeout(() => setOpen(false), 0);
    },
    [onSelect]
  );

  // Get current font info for display
  const currentFont = useMemo(() => {
    if (!value) return null;

    // First try to find the font in the search results
    const foundFont = allFonts.find((font: FontInfo) => font.family === value);
    if (foundFont) return foundFont;

    // If not found in search results, create a fallback FontInfo object
    // This happens when a font is selected and then the search changes
    const extractedFontName = value.split(",")[0].trim().replace(/['"]/g, "");

    return {
      family: extractedFontName,
      category: category || "sans-serif",
      variants: ["400"],
      variable: false,
    } as FontInfo;
  }, [value, allFonts, category]);

  // Load fonts when they become visible
  useEffect(() => {
    if (currentFont) {
      loadGoogleFont(currentFont.family);
    }
  }, [currentFont]);

  // Preload fonts from search results
  useEffect(() => {
    allFonts.forEach((font: FontInfo) => {
      loadGoogleFont(font.family);
    });
  }, [allFonts]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            {...(fieldLook ? { "data-slot": "input" } : {})}
            className={cn(
              "bg-input/25 w-full justify-between",
              className,
              // Field look: same padding as the panel's other dropdowns.
              fieldLook && "px-2"
            )}
          >
            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
              {icon && (
                <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5">
                  {icon}
                </span>
              )}
              {currentFont ? (
                <span className="inline-flex items-center gap-2 min-w-0 overflow-hidden">
                  <span
                    className="truncate"
                    style={{
                      fontFamily: isThemeFont(currentFont.family)
                        ? themeFontStacks[currentFont.family]
                        : buildFontFamily(
                            currentFont.family,
                            currentFont.category
                          ),
                    }}
                  >
                    {isThemeFont(currentFont.family)
                      ? `${currentFont.family.charAt(0).toUpperCase()}${currentFont.family.slice(1)} (Theme)`
                      : getFontDisplayName(currentFont.family)}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </div>
            <ChevronDown
              className={cn(
                "ml-2 shrink-0",
                fieldLook
                  ? "size-3.5 text-muted-foreground"
                  : "size-4 opacity-50"
              )}
            />
          </Button>
        }
      />

      <PopoverContent className="w-[300px] p-0 z-50" align="start">
        <Command shouldFilter={false} className="h-96 w-full overflow-hidden">
          <div className="flex flex-col">
            <div className="relative px-2 py-2">
              <div className="flex items-center">
                <Search className="absolute left-3.5 size-4 text-muted-foreground" />
                <Input
                  className="h-8 w-full pl-8 pr-8"
                  placeholder="Search Google fonts..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
                {inputValue && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setInputValue("")}
                    className="-ml-8 size-8 p-0 flex-shrink-0"
                  >
                    <FunnelX className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <div className="px-2 pb-2">
              <Select
                value={selectedCategory}
                onValueChange={(value) =>
                  setSelectedCategory(value as FilterFontCategory)
                }
              >
                <SelectTrigger className="focus bg-input/25 h-8 w-full px-2 text-xs outline-none capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Fonts</SelectItem>
                  <SelectItem value="sans-serif">Sans Serif</SelectItem>
                  <SelectItem value="serif">Serif</SelectItem>
                  <SelectItem value="monospace">Monospace</SelectItem>
                  <SelectItem value="display">Display</SelectItem>
                  <SelectItem value="handwriting">Handwriting</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div
            className="relative isolate size-full"
            style={{ minHeight: "300px" }}
          >
            {fontQuery.isLoading && allFonts.length === 0 ? (
              <div className="absolute inset-0 flex size-full items-center justify-center gap-2 text-center">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-muted-foreground text-sm">
                  Loading fonts...
                </span>
              </div>
            ) : allFonts.length === 0 && customFonts.length === 0 ? (
              <CommandEmpty>No fonts found.</CommandEmpty>
            ) : (
              <div
                className="scrollbar-thin size-full overflow-y-auto p-1"
                style={{ overflowAnchor: "none" }}
                ref={scrollRef}
              >
                {themeFontsPosition === "top" && !hideThemeFonts && (
                  <>
                    {THEME_FONTS.map((font) => {
                      const isSelected = font.family === value;
                      return (
                        <div
                          key={font.family}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={-1}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-sm p-2 hover:bg-accent",
                            isSelected && "bg-accent/50"
                          )}
                          onClick={() => handleFontSelect(font)}
                          onKeyDown={() => {}}
                        >
                          <div className="line-clamp-1 flex flex-1 flex-col">
                            <span
                              className="truncate capitalize"
                              style={{
                                fontFamily: themeFontStacks[font.family],
                              }}
                            >
                              {font.family}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              Theme · {themeFontName(font.family)}
                            </span>
                          </div>
                          {isSelected && (
                            <Check className="size-4 shrink-0 opacity-70" />
                          )}
                        </div>
                      );
                    })}
                    <Separator className="my-1" />
                  </>
                )}
                {customFonts.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      Custom Fonts
                    </div>
                    {customFonts.map((font) => {
                      const isSelected = font.family === value;
                      return (
                        <div
                          key={font.id}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={-1}
                          className="flex cursor-pointer items-center gap-2 rounded-sm p-2 hover:bg-accent"
                          onClick={() => {
                            handleFontSelect({
                              family: font.family,
                              category: "sans-serif",
                              variants: ["400"],
                              variable: false,
                            } as FontInfo);
                          }}
                          onKeyDown={() => {}}
                        >
                          <div className="line-clamp-1 flex flex-1 flex-col">
                            <span
                              className="truncate"
                              style={{ fontFamily: font.family }}
                            >
                              {font.family}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              Custom
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {isSelected && (
                              <Check className="size-4 shrink-0 opacity-70" />
                            )}
                            {onDeleteFont && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteFont(font.id);
                                  toast.success(
                                    `Removed "${font.family}" from your fonts`
                                  );
                                }}
                                className="rounded p-1 text-destructive hover:bg-destructive/20 hover:text-destructive"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <Separator className="my-1" />
                  </>
                )}
                {allFonts.map((font: FontInfo) => {
                  const isSelected = font.family === value;
                  const fontFamily = buildFontFamily(
                    font.family,
                    font.category
                  );

                  return (
                    <div
                      key={font.family}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      ref={isSelected ? selectedFontRef : null}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-sm p-2 hover:bg-accent",
                        isSelected && "bg-accent/50"
                      )}
                      onClick={() => handleFontSelect(font)}
                      onKeyDown={() => {}}
                    >
                      <div className="line-clamp-1 flex flex-1 flex-col">
                        <span className="truncate" style={{ fontFamily }}>
                          {font.family}
                        </span>

                        <div className="flex items-center gap-1 text-xs font-normal text-muted-foreground capitalize">
                          <span>{font.category}</span>

                          {font.variable && (
                            <span className="inline-flex items-center gap-1">
                              <span>•</span>
                              <span>Variable</span>
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="size-4 shrink-0 opacity-70" />
                      )}
                    </div>
                  );
                })}
                {fontQuery.hasMore && (
                  <div ref={loadMoreRef} className="flex justify-center py-2">
                    {fontQuery.isLoading ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Scroll for more
                      </span>
                    )}
                  </div>
                )}
                {themeFontsPosition === "bottom" && !hideThemeFonts && (
                  <>
                    <Separator className="my-1" />
                    {THEME_FONTS.map((font) => {
                      const isSelected = font.family === value;
                      return (
                        <div
                          key={font.family}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={-1}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-sm p-2 hover:bg-accent",
                            isSelected && "bg-accent/50"
                          )}
                          onClick={() => handleFontSelect(font)}
                          onKeyDown={() => {}}
                        >
                          <div className="line-clamp-1 flex flex-1 flex-col">
                            <span
                              className="truncate capitalize"
                              style={{
                                fontFamily: themeFontStacks[font.family],
                              }}
                            >
                              {font.family}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              Theme · {themeFontName(font.family)}
                            </span>
                          </div>
                          {isSelected && (
                            <Check className="size-4 shrink-0 opacity-70" />
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
