import type { Hsl } from "culori";
import * as culori from "culori";
import valueParser from "postcss-value-parser";
import type { ColorFormat } from "../types";
import { LRUCache } from "./lru-cache";

// LRU caches for expensive Culori operations
const decomposeCache = new LRUCache<string, OklchComponents | null>(32);
// Perceptual mid-gray pivot — slightly below 0.5 to prevent mid-tone brightening
const PERCEPTUAL_PIVOT = 0.45;

/**
 * Power-Symmetric S-Curve contrast transformation.
 *
 * Anchored on a perceptual mid-gray pivot so mid-tones remain stable.
 * Positive contrast (>1) expands away from the pivot; negative (<1)
 * compresses toward it. Both directions are equally potent.
 *
 * @param x - Lightness value in [0, 1]
 * @param contrast - Contrast factor (1.0 = no change, >1 = expand, <1 = compress)
 * @returns Transformed lightness value in [0, 1]
 */
function applySigmoidalContrast(x: number, contrast: number): number {
  if (contrast === 1 || contrast <= 0) return x;

  const pivot = PERCEPTUAL_PIVOT;
  const exponent = 1 / contrast;

  if (x >= pivot) {
    const normalized = (x - pivot) / (1 - pivot);
    return pivot + (1 - pivot) * Math.max(0, normalized) ** exponent;
  } else {
    const normalized = (pivot - x) / pivot;
    return pivot - pivot * Math.max(0, normalized) ** exponent;
  }
}

/**
 * Computes the local derivative (stretch factor) of the power-symmetric curve.
 * Used for Hunt Effect chroma scaling — chroma is boosted where lightness
 * is stretched (mid-tones) and reduced where it is compressed (extremes).
 */
function sigmoidalStretchFactor(x: number, contrast: number): number {
  if (contrast === 1 || contrast <= 0) return 1;

  const pivot = PERCEPTUAL_PIVOT;
  const exponent = 1 / contrast;

  if (x >= pivot) {
    const normalized = (x - pivot) / (1 - pivot);
    if (normalized <= 1e-6) return Math.min(exponent, 3);
    return exponent * normalized ** (exponent - 1);
  } else {
    const normalized = (pivot - x) / pivot;
    if (normalized <= 1e-6) return Math.min(exponent, 3);
    return exponent * normalized ** (exponent - 1);
  }
}

export const formatNumber = (num?: number) => {
  if (num === undefined || num === null || Number.isNaN(num)) return "0";
  if (num === 0) return "0";
  return num % 1 === 0 ? String(num) : num.toFixed(4);
};

export const formatHsl = (hsl: Hsl) => {
  const alpha =
    hsl.alpha !== undefined && hsl.alpha < 1
      ? ` / ${formatNumber(hsl.alpha)}`
      : "";
  return `hsl(${formatNumber(hsl.h)} ${formatNumber(hsl.s * 100)}% ${formatNumber(hsl.l * 100)}%${alpha})`;
};

export function formatColorObject(
  color: culori.Color,
  format: ColorFormat = "oklch"
): string {
  switch (format) {
    case "hsl": {
      const hsl = culori.converter("hsl")(color);
      return formatHsl(hsl);
    }
    case "rgb":
      return culori.formatRgb(color);
    case "oklch": {
      const mode = (color as any).mode;
      const oklch =
        mode === "oklch"
          ? (color as culori.Oklch)
          : culori.converter("oklch")(color);
      const alpha =
        oklch.alpha !== undefined && oklch.alpha < 1
          ? ` / ${formatNumber(oklch.alpha)}`
          : "";
      const hVal = oklch.h !== undefined ? ((oklch.h % 360) + 360) % 360 : 0;
      const hStr = formatNumber(hVal);
      return `oklch(${formatNumber(oklch.l)} ${formatNumber(oklch.c)} ${hStr}${alpha})`;
    }
    case "hex": {
      const alphaVal = (color as any).alpha;
      const alpha = alphaVal !== undefined && alphaVal < 1 ? alphaVal : null;
      return alpha
        ? (culori as any).formatHex8(color)
        : culori.formatHex(color);
    }
    default:
      return culori.formatHex(color);
  }
}

export const colorFormatter = (
  colorValue: string,
  format: ColorFormat = "oklch",
  tailwindVersion: "3" | "4" = "3"
): string => {
  try {
    if (!colorValue || typeof colorValue !== "string") {
      console.warn("Invalid color value provided:", colorValue);
      return colorValue || "";
    }

    if (colorValue === "transparent") return "transparent";

    const color = culori.parse(colorValue);
    if (!color) {
      console.warn("Could not parse color:", colorValue);
      return colorValue;
    }

    switch (format) {
      case "hsl": {
        const hsl = culori.converter("hsl")(color);
        if (tailwindVersion === "4") {
          return formatHsl(hsl);
        }
        return `${formatNumber(hsl.h)} ${formatNumber(hsl.s * 100)}% ${formatNumber(hsl.l * 100)}%`;
      }
      case "rgb":
        return culori.formatRgb(color);
      case "oklch": {
        const oklch = culori.converter("oklch")(color);
        const alpha =
          oklch.alpha !== undefined && oklch.alpha < 1
            ? ` / ${formatNumber(oklch.alpha)}`
            : "";
        const hVal = oklch.h !== undefined ? ((oklch.h % 360) + 360) % 360 : 0;
        const hStr = formatNumber(hVal);
        return `oklch(${formatNumber(oklch.l)} ${formatNumber(oklch.c)} ${hStr}${alpha})`;
      }
      case "hex": {
        const alphaVal = (color as any).alpha;
        const alpha = alphaVal !== undefined && alphaVal < 1 ? alphaVal : null;
        return alpha
          ? (culori as any).formatHex8(color)
          : culori.formatHex(color);
      }
      default:
        return colorValue;
    }
  } catch (error) {
    console.warn(`Failed to convert color: ${colorValue}`, error);
    return colorValue;
  }
};

export function adjustColor(
  color: string,
  hueShift: number,
  chromaScale: number,
  lightnessScale: number,
  contrast: number = 1,
  temperature: number = 0
): string {
  if (isGradientValue(color)) {
    const parsedGradient = parseGradient(color);
    if (!parsedGradient) return color;
    const adjustedStops = parsedGradient.stops.map((stop) => ({
      ...stop,
      color: adjustColor(
        stop.color,
        hueShift,
        chromaScale,
        lightnessScale,
        contrast,
        temperature
      ),
    }));
    return buildGradientString(
      adjustedStops,
      parsedGradient.angle,
      parsedGradient.type,
      parsedGradient.radialScale,
      parsedGradient.radialPositionX,
      parsedGradient.radialPositionY
    );
  }

  if (
    hueShift === 0 &&
    chromaScale === 1 &&
    lightnessScale === 1 &&
    contrast === 1 &&
    temperature === 0
  ) {
    return color;
  }

  // Safely skip non-colors (e.g. padding and typography tokens)
  const parsed = culori.parse(color);
  if (!parsed) return color;

  const oklch = culori.converter("oklch")(parsed);
  if (!oklch) return color;

  const safeContrast = Math.max(0.01, contrast);

  // Power-symmetric S-Curve anchored on perceptual mid-gray pivot
  let l = oklch.l ?? 0;
  l = applySigmoidalContrast(l, safeContrast);
  l = l * lightnessScale;

  // Hunt Effect: chroma scales with the local slope of the lightness curve.
  // Mid-tones (high slope) get a chroma boost; extremes (low slope) stay muted,
  // preventing burnt highlights and keeping flat areas naturally desaturated.
  const originalL = oklch.l ?? 0;
  const stretchFactor = sigmoidalStretchFactor(originalL, safeContrast);
  const huntChromaFactor = 1 + (stretchFactor - 1) * 0.6;
  const finalChromaScale = chromaScale * huntChromaFactor;

  let c = oklch.c ?? 0;
  c = c * finalChromaScale;

  // Hue: shifted by hue shift
  let h = (oklch.h ?? 0) + hueShift;

  // Temperature: perceptual color filter using Oklab interpolation
  // Blends the current color toward warm (amber) or cool (azure) reference points
  // in Oklab space, creating a natural lighting-change effect that also tints neutrals
  if (temperature !== 0) {
    const intensity = Math.abs(temperature) / 100; // -100 to 100 maps to 0 to 1

    // Perceptual temperature reference colors in OKLCH
    // Warm: tungsten/incandescent light — amber/yellow cast (high b in Oklab)
    // Cool: daylight/shadow — azure/blue cast (negative b in Oklab)
    const warmRefOklch: culori.Oklch = {
      mode: "oklch",
      l: 0.85,
      c: 0.14,
      h: 80,
    };
    const coolRefOklch: culori.Oklch = {
      mode: "oklch",
      l: 0.75,
      c: 0.12,
      h: 250,
    };
    const targetRefOklch = temperature > 0 ? warmRefOklch : coolRefOklch;
    const targetRef = culori.converter("oklab")(targetRefOklch);

    // Convert current color to Oklab for perceptual interpolation
    const currentOklab = culori.converter("oklab")(oklch);

    // Interpolate in Oklab space: blend current color toward the reference
    // This naturally tints neutral colors (grays/whites/blacks) because the
    // a and b channels shift toward the reference's chromaticity
    const interp = culori.interpolate([currentOklab, targetRef], "oklab");
    const blended = interp(intensity);

    // Convert back to OKLCH for output
    const blendedOklch = culori.converter("oklch")(blended);

    l = blendedOklch.l ?? l;
    c = blendedOklch.c ?? c;
    h = blendedOklch.h ?? h;
  }

  // Clamp basic ranges
  l = Math.max(0, Math.min(1, l));
  c = Math.max(0, c);
  h = ((h % 360) + 360) % 360;

  // Lightness-preserving gamut clamping: if the color is outside sRGB,
  // reduce chroma (not lightness) until it fits — preserving the
  // perceived brightness while avoiding gamut clipping artifacts
  const tempColor: culori.Oklch = {
    mode: "oklch",
    l,
    c,
    h,
    alpha: oklch.alpha ?? 1,
  };
  const rgb = culori.converter("rgb")(tempColor) as
    | { r: number; g: number; b: number }
    | undefined;

  if (rgb) {
    const { r = 0, g = 0, b = 0 } = rgb;
    if (
      r < -0.001 ||
      r > 1.001 ||
      g < -0.001 ||
      g > 1.001 ||
      b < -0.001 ||
      b > 1.001
    ) {
      // Binary search for the maximum in-gamut chroma
      let lo = 0;
      let hi = c;
      let safeC = c;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const testColor: culori.Oklch = {
          mode: "oklch",
          l,
          c: mid,
          h,
          alpha: 1,
        };
        const testRgb = culori.converter("rgb")(testColor) as
          | { r: number; g: number; b: number }
          | undefined;
        if (testRgb) {
          const inGamut =
            testRgb.r >= -0.001 &&
            testRgb.r <= 1.001 &&
            testRgb.g >= -0.001 &&
            testRgb.g <= 1.001 &&
            testRgb.b >= -0.001 &&
            testRgb.b <= 1.001;
          if (inGamut) {
            safeC = mid;
            lo = mid;
          } else {
            hi = mid;
          }
        } else {
          hi = mid;
        }
      }
      c = safeC;
    }
  }

  const alpha =
    oklch.alpha !== undefined && oklch.alpha < 1
      ? ` / ${formatNumber(oklch.alpha)}`
      : "";
  return `oklch(${formatNumber(l)} ${formatNumber(c)} ${formatNumber(h)}${alpha})`;
}

export function isGradientValue(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.startsWith("linear-gradient") ||
    trimmed.startsWith("radial-gradient") ||
    trimmed.startsWith("conic-gradient") ||
    trimmed.startsWith("repeating-linear-gradient") ||
    trimmed.startsWith("repeating-radial-gradient") ||
    trimmed.startsWith("repeating-conic-gradient")
  );
}

export interface GradientStop {
  id: string;
  color: string;
  position: number;
}

export type GradientType = "linear" | "radial" | "conic";

export interface ParsedGradient {
  stops: GradientStop[];
  angle: number;
  type: GradientType;
  radialScale: number;
  radialPositionX: number;
  radialPositionY: number;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function getEasedStops(
  colorA: string,
  posA: number,
  colorB: string,
  posB: number,
  steps: number = 6
): Array<{ color: string; position: number }> {
  // Short-circuit: identical colors don't need easing — just two stops
  if (colorA.trim() === colorB.trim()) {
    return [
      { color: colorA, position: posA },
      { color: colorB, position: posB },
    ];
  }

  const parsedA = culori.parse(colorA);
  const parsedB = culori.parse(colorB);
  if (!parsedA || !parsedB) {
    return [
      { color: colorA, position: posA },
      { color: colorB, position: posB },
    ];
  }

  const interp = culori.interpolate([parsedA, parsedB], "oklab");
  const result: Array<{ color: string; position: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const linearT = i / steps;
    const easedT = easeInOutQuad(linearT);
    const c = interp(easedT);
    const oklch = culori.converter("oklch")(c);
    const alpha =
      oklch.alpha !== undefined && oklch.alpha < 1
        ? ` / ${formatNumber(oklch.alpha)}`
        : "";
    const hVal = oklch.h !== undefined ? ((oklch.h % 360) + 360) % 360 : 0;
    const hStr = formatNumber(hVal);
    const color = `oklch(${formatNumber(oklch.l)} ${formatNumber(oklch.c)} ${hStr}${alpha})`;
    const position = posA + (posB - posA) * linearT;
    result.push({ color, position });
  }

  return result;
}

function buildEasedStops(
  stops: GradientStop[]
): Array<{ color: string; position: number }> {
  if (stops.length < 2) {
    return stops.map((s) => ({ color: s.color, position: s.position }));
  }
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const result: Array<{ color: string; position: number }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const eased = getEasedStops(
      sorted[i].color,
      sorted[i].position,
      sorted[i + 1].color,
      sorted[i + 1].position
    );
    if (i > 0) eased.shift();
    result.push(...eased);
  }
  return result;
}

export function buildGradientString(
  stops: GradientStop[],
  angle: number,
  type: GradientType = "linear",
  radialScale: number = 100,
  radialPositionX: number = 50,
  radialPositionY: number = 50
): string {
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  const stopsString = sortedStops
    .map((s) => `${s.color} ${s.position}%`)
    .join(", ");
  if (type === "radial") {
    return `radial-gradient(in oklab ${radialScale}% ${radialScale}% at ${radialPositionX}% ${radialPositionY}%, ${stopsString})`;
  }
  if (type === "conic") {
    return `conic-gradient(in oklab from ${angle}deg, ${stopsString})`;
  }
  return `linear-gradient(in oklab ${angle}deg, ${stopsString})`;
}

export function easeGradientCSS(gradientCSS: string): string {
  if (!isGradientValue(gradientCSS)) return gradientCSS;
  const parsed = parseGradient(gradientCSS);
  if (!parsed || parsed.stops.length < 2) return gradientCSS;

  const easedStops = buildEasedStops(parsed.stops);
  const stopsString = easedStops
    .map((s) => `${s.color} ${s.position}%`)
    .join(", ");

  if (parsed.type === "radial") {
    return `radial-gradient(in oklab ${parsed.radialScale}% ${parsed.radialScale}% at ${parsed.radialPositionX}% ${parsed.radialPositionY}%, ${stopsString})`;
  }
  if (parsed.type === "conic") {
    return `conic-gradient(in oklab from ${parsed.angle}deg, ${stopsString})`;
  }
  return `linear-gradient(in oklab ${parsed.angle}deg, ${stopsString})`;
}

function _stringifyNode(node: valueParser.Node): string {
  return valueParser.stringify(node);
}

function _findFirstCommaIndex(nodes: valueParser.Node[]): number {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type === "div" && nodes[i].value === ",") {
      return i;
    }
  }
  return -1;
}

function findFirstCommaIndexInNonSpace(nodes: valueParser.Node[]): number {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== "space" && nodes[i].type !== "div") {
      continue;
    }
    if (nodes[i].type === "div" && nodes[i].value === ",") {
      return i;
    }
  }
  return -1;
}

function parseStopsFromNodes(
  nodes: valueParser.Node[],
  alreadySliced = false
): GradientStop[] {
  const firstCommaIdx = alreadySliced
    ? -1
    : findFirstCommaIndexInNonSpace(nodes);
  const stopNodes = firstCommaIdx >= 0 ? nodes.slice(firstCommaIdx + 1) : nodes;

  const cleanStopNodes: valueParser.Node[] = [];
  let currentColorNodes: valueParser.Node[] = [];

  for (const node of stopNodes) {
    if (node.type === "div" && node.value === ",") {
      if (currentColorNodes.length > 0) {
        cleanStopNodes.push(...currentColorNodes);
        cleanStopNodes.push(node);
      }
      currentColorNodes = [];
    } else if (node.type !== "space") {
      currentColorNodes.push(node);
    }
  }
  if (currentColorNodes.length > 0) {
    cleanStopNodes.push(...currentColorNodes);
  }

  const stops: GradientStop[] = [];
  let i = 0;

  while (i < cleanStopNodes.length) {
    const node = cleanStopNodes[i];

    if (node.type === "div" && node.value === ",") {
      i++;
      continue;
    }

    let colorNode: valueParser.Node | undefined;
    let positionNode: valueParser.Node | undefined;

    if (
      node.type === "function" ||
      node.type === "word" ||
      node.type === "string"
    ) {
      colorNode = node;

      if (i + 1 < cleanStopNodes.length) {
        const nextNode = cleanStopNodes[i + 1];
        if (nextNode.type === "word" && nextNode.value.endsWith("%")) {
          positionNode = nextNode;
          i += 2;
        }
      }
    }

    const color = colorNode ? valueParser.stringify(colorNode).trim() : "";
    let position: number;

    if (positionNode) {
      position = parseFloat(positionNode.value);
    } else {
      const totalStops =
        (cleanStopNodes.filter((n) => n.type !== "div").length + 1) / 2;
      position = (stops.length / Math.max(totalStops - 1, 1)) * 100;
    }

    stops.push({
      id: `stop-${stops.length}-${Math.random().toString(36).slice(2, 11)}`,
      color,
      position: Number.isNaN(position) ? 0 : position,
    });

    i++;
  }

  return stops;
}

export function parseGradient(value: string): ParsedGradient | null {
  if (!value || typeof value !== "string") return null;

  const normalizedValue = value.replace(
    /\s*\bin\s+(?:oklab|oklch|srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65|hsl|hwb|lch|lab)\b\s*/gi,
    " "
  );

  const parsed = valueParser(normalizedValue);
  const firstNode = parsed.nodes[0];

  if (!firstNode || firstNode.type !== "function") return null;

  const funcName = firstNode.value.toLowerCase();
  const funcNodes = firstNode.nodes;

  if (
    funcName === "linear-gradient" ||
    funcName === "repeating-linear-gradient"
  ) {
    let angle = 180;

    const firstCommaIdx = findFirstCommaIndexInNonSpace(funcNodes);
    const nonSpaceNodes = funcNodes.filter((n) => n.type !== "space");

    if (nonSpaceNodes.length > 0) {
      let firstPart: string;
      if (firstCommaIdx > 0) {
        const beforeFirstComma = nonSpaceNodes.slice(
          0,
          Math.min(nonSpaceNodes.length, firstCommaIdx)
        );
        firstPart = beforeFirstComma
          .map((n) => valueParser.stringify(n))
          .join("")
          .trim();
      } else {
        firstPart = valueParser.stringify(nonSpaceNodes[0]);
      }

      const angleMatch = firstPart.match(/^([\d.]+)deg$/i);
      if (angleMatch) {
        angle = parseFloat(angleMatch[1]);
      } else if (firstPart.startsWith("to ")) {
        const directionMap: Record<string, number> = {
          "to top": 0,
          "to top right": 45,
          "to right": 90,
          "to bottom right": 135,
          "to bottom": 180,
          "to bottom left": 225,
          "to left": 270,
          "to top left": 315,
        };
        angle = directionMap[firstPart.toLowerCase()] ?? 180;
      }
    }

    const stopNodes =
      firstCommaIdx >= 0 ? funcNodes.slice(firstCommaIdx + 1) : funcNodes;
    const stops = parseStopsFromNodes(stopNodes, true);

    if (stops.length < 2) return null;
    return {
      stops,
      angle,
      type: "linear",
      radialScale: 100,
      radialPositionX: 50,
      radialPositionY: 50,
    };
  }

  if (
    funcName === "radial-gradient" ||
    funcName === "repeating-radial-gradient"
  ) {
    let radialScale = 100;
    let radialPositionX = 50;
    let radialPositionY = 50;

    const firstCommaIdx = findFirstCommaIndexInNonSpace(funcNodes);

    if (firstCommaIdx > 0) {
      const beforeFirstComma = funcNodes.slice(0, firstCommaIdx);
      const firstPart = beforeFirstComma
        .map((n) => valueParser.stringify(n))
        .join("")
        .trim();
      const firstLower = firstPart.toLowerCase();

      const hasAt = /\bat\b/i.test(firstPart);
      const isDescriptor =
        hasAt ||
        firstLower.startsWith("circle") ||
        firstLower.startsWith("ellipse") ||
        firstLower.startsWith("closest") ||
        firstLower.startsWith("farthest");

      if (isDescriptor) {
        const atMatch = firstPart.match(/^(.*?)\bat\s+(.*)$/i);
        let descriptor = firstPart;
        let position = "";

        if (atMatch) {
          descriptor = atMatch[1].trim();
          position = atMatch[2].trim();
        }

        const sizeMatch = descriptor.match(/([\d.]+)%/);
        if (sizeMatch) {
          radialScale = parseFloat(sizeMatch[1]);
        }

        if (position) {
          const posMatches = position.matchAll(/([\d.]+)%/g);
          const posValues = [...posMatches].map((m) => parseFloat(m[1]));
          if (posValues.length >= 2) {
            radialPositionX = posValues[0];
            radialPositionY = posValues[1];
          } else if (posValues.length === 1) {
            radialPositionX = posValues[0];
          } else {
            const posLower = position.toLowerCase();
            const keywordMap: Record<string, [number, number]> = {
              center: [50, 50],
              top: [50, 0],
              bottom: [50, 100],
              left: [0, 50],
              right: [100, 50],
              "top left": [0, 0],
              "top right": [100, 0],
              "bottom left": [0, 100],
              "bottom right": [100, 100],
            };
            const coords = keywordMap[posLower];
            if (coords) {
              radialPositionX = coords[0];
              radialPositionY = coords[1];
            }
          }
        }
      }
    }

    const stopNodes =
      firstCommaIdx >= 0 ? funcNodes.slice(firstCommaIdx + 1) : funcNodes;
    const stops = parseStopsFromNodes(stopNodes, true);

    if (stops.length < 2) return null;
    return {
      stops,
      angle: 0,
      type: "radial",
      radialScale,
      radialPositionX,
      radialPositionY,
    };
  }

  if (
    funcName === "conic-gradient" ||
    funcName === "repeating-conic-gradient"
  ) {
    let angle = 0;

    const firstCommaIdx = findFirstCommaIndexInNonSpace(funcNodes);

    if (firstCommaIdx > 0) {
      const beforeFirstComma = funcNodes.slice(0, firstCommaIdx);
      const firstPart = beforeFirstComma
        .map((n) => valueParser.stringify(n))
        .join("")
        .trim();

      const fromMatch = firstPart.match(/^from\s+([\d.]+)deg/i);
      if (fromMatch) {
        angle = parseFloat(fromMatch[1]);
      }
    }

    const stopNodes =
      firstCommaIdx >= 0 ? funcNodes.slice(firstCommaIdx + 1) : funcNodes;
    const stops = parseStopsFromNodes(stopNodes, true);

    if (stops.length < 2) return null;
    return {
      stops,
      angle,
      type: "conic",
      radialScale: 100,
      radialPositionX: 50,
      radialPositionY: 50,
    };
  }

  return null;
}

export interface OklchComponents {
  l: number;
  c: number;
  h: number;
  alpha: number;
}

export function decomposeToOklch(colorValue: string): OklchComponents | null {
  if (!colorValue || isGradientValue(colorValue)) return null;
  const cached = decomposeCache.get(colorValue);
  if (cached !== undefined) return cached;
  try {
    const parsed = culori.parse(colorValue);
    if (!parsed) {
      decomposeCache.set(colorValue, null);
      return null;
    }
    const oklch = culori.converter("oklch")(parsed);
    if (!oklch) {
      decomposeCache.set(colorValue, null);
      return null;
    }
    const result: OklchComponents = {
      l: oklch.l ?? 0,
      c: oklch.c ?? 0,
      h: (((oklch.h ?? 0) % 360) + 360) % 360,
      alpha: oklch.alpha ?? 1,
    };
    decomposeCache.set(colorValue, result);
    return result;
  } catch {
    decomposeCache.set(colorValue, null);
    return null;
  }
}

export function composeFromOklch(components: OklchComponents): string {
  const { l, c, h, alpha } = components;
  const normalizedH = ((h % 360) + 360) % 360;
  const alphaStr = alpha < 1 ? ` / ${formatNumber(alpha)}` : "";
  return `oklch(${formatNumber(l)} ${formatNumber(c)} ${formatNumber(normalizedH)}${alphaStr})`;
}

export function isOutsideSrgb(colorValue: string): boolean {
  if (!colorValue || isGradientValue(colorValue)) return false;
  try {
    const parsed = culori.parse(colorValue);
    if (!parsed) return false;
    const rgb = culori.converter("rgb")(parsed) as
      | { mode: "rgb"; r: number; g: number; b: number; alpha?: number }
      | undefined;
    if (!rgb) return false;
    const { r = 0, g = 0, b = 0 } = rgb;
    return (
      r < -0.001 ||
      r > 1.001 ||
      g < -0.001 ||
      g > 1.001 ||
      b < -0.001 ||
      b > 1.001
    );
  } catch {
    return false;
  }
}

export function clampToSrgb(colorValue: string): string {
  if (!colorValue || isGradientValue(colorValue)) return colorValue;
  try {
    const parsed = culori.parse(colorValue);
    if (!parsed) return colorValue;
    const rgb = culori.converter("rgb")(parsed) as
      | { mode: "rgb"; r: number; g: number; b: number; alpha?: number }
      | undefined;
    if (!rgb) return colorValue;
    const clamped: {
      mode: "rgb";
      r: number;
      g: number;
      b: number;
      alpha?: number;
    } = {
      mode: "rgb" as const,
      r: Math.max(0, Math.min(1, rgb.r ?? 0)),
      g: Math.max(0, Math.min(1, rgb.g ?? 0)),
      b: Math.max(0, Math.min(1, rgb.b ?? 0)),
      alpha: (parsed as any).alpha as number | undefined,
    };
    const oklch = culori.converter("oklch")(clamped as unknown as culori.Color);
    const alpha =
      oklch.alpha !== undefined && oklch.alpha < 1
        ? ` / ${formatNumber(oklch.alpha)}`
        : "";
    const hVal = oklch.h !== undefined ? ((oklch.h % 360) + 360) % 360 : 0;
    const hStr = formatNumber(hVal);
    return `oklch(${formatNumber(oklch.l)} ${formatNumber(oklch.c)} ${hStr}${alpha})`;
  } catch {
    return colorValue;
  }
}
