import { type NextRequest, NextResponse } from "next/server";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

import type {
  FontCategory,
  FontInfo,
  PaginatedFontsResponse,
} from "@/types/fonts";
import { FALLBACK_FONTS } from "@/utils/fonts";

const CATEGORY_MAP: Record<string, FontCategory> = {
  "sans serif": "sans-serif",
  serif: "serif",
  display: "display",
  handwriting: "handwriting",
  monospace: "monospace",
};

interface FontMetadataEntry {
  family: string;
  category: string;
  fonts: Record<string, unknown>;
}

interface FontMetadataResponse {
  familyMetadataList: FontMetadataEntry[];
}

function metadataToFontInfo(entry: FontMetadataEntry): FontInfo {
  const category = CATEGORY_MAP[entry.category.toLowerCase()] || "sans-serif";
  const fontKeys = Object.keys(entry.fonts);
  const variants = fontKeys
    .map((k) => k.replace("i", "").replace("regular", "400"))
    .filter((v) => /^\d+$/.test(v));
  const uniqueVariants = [...new Set(variants)];

  return {
    family: entry.family,
    category,
    variants: uniqueVariants.length > 0 ? uniqueVariants : ["400"],
    variable: Object.values(entry.fonts).some(
      (font) => typeof font === "object" && font !== null && "axes" in font
    ),
  };
}

// The metadata is ~2.7 MB — download it once a day, not per keystroke.
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 5 * 60 * 1000;

let fontsCache: { fonts: FontInfo[]; expiresAt: number } | null = null;
let inflightFetch: Promise<FontInfo[]> | null = null;

function cacheFonts(fonts: FontInfo[], ttlMs: number): FontInfo[] {
  fontsCache = { fonts, expiresAt: Date.now() + ttlMs };
  return fonts;
}

async function fetchGoogleFonts(): Promise<FontInfo[]> {
  try {
    const response = await fetch("https://fonts.google.com/metadata/fonts", {
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Google Fonts metadata error:", response.status);
      return cacheFonts(FALLBACK_FONTS, FAILURE_RETRY_MS);
    }

    const text = await response.text();
    // Google prefixes the response with )]}' for XSSI prevention
    const jsonText = text.replace(/^\)\]\}'\n/, "");
    const data = JSON.parse(jsonText) as FontMetadataResponse;

    if (!data.familyMetadataList?.length) {
      return cacheFonts(FALLBACK_FONTS, FAILURE_RETRY_MS);
    }

    const fonts = data.familyMetadataList
      .map(metadataToFontInfo)
      .sort((a, b) => a.family.localeCompare(b.family));
    return cacheFonts(fonts, METADATA_TTL_MS);
  } catch (error) {
    console.error("Failed to fetch Google Fonts metadata:", error);
    return cacheFonts(FALLBACK_FONTS, FAILURE_RETRY_MS);
  }
}

async function getGoogleFonts(): Promise<FontInfo[]> {
  if (fontsCache && fontsCache.expiresAt > Date.now()) return fontsCache.fonts;
  // Concurrent searches share one download.
  inflightFetch ??= fetchGoogleFonts().finally(() => {
    inflightFetch = null;
  });
  return inflightFetch;
}

export async function GET(request: NextRequest) {
  if (!isLocalRequest(request)) return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.toLowerCase() || "";
    const category = searchParams.get("category")?.toLowerCase();
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
    const offset = Number(searchParams.get("offset")) || 0;

    // Exact family lookup (case-insensitive) — used to read one font's weights.
    const family = searchParams.get("family")?.toLowerCase();

    let filteredFonts = await getGoogleFonts();

    if (family) {
      filteredFonts = filteredFonts.filter(
        (font) => font.family.toLowerCase() === family
      );
    }

    if (query) {
      filteredFonts = filteredFonts.filter((font) =>
        font.family.toLowerCase().includes(query)
      );
    }

    if (category && category !== "all") {
      filteredFonts = filteredFonts.filter(
        (font) => font.category === category
      );
    }

    const paginatedFonts = filteredFonts.slice(offset, offset + limit);

    const response: PaginatedFontsResponse = {
      fonts: paginatedFonts,
      total: filteredFonts.length,
      offset,
      limit,
      hasMore: offset + limit < filteredFonts.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in Google Fonts API:", error);
    return NextResponse.json(
      { error: "Failed to fetch fonts" },
      { status: 500 }
    );
  }
}
