/**
 * How far (in unscaled CSS px) shadows painted inside a container reach past
 * each of its edges. Fixed-size canvas frames clip their content, and this is
 * used to widen that clip so shadows are never cut off.
 */
export interface ShadowBleed {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_BLEED: ShadowBleed = { top: 0, right: 0, bottom: 0, left: 0 };

interface ShadowGeometry {
  x: number;
  y: number;
  blur: number;
  spread: number;
}

/** Splits on commas that are not nested inside parentheses. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** Removes parenthesised groups (color functions like rgb()/oklch()). */
function stripFunctions(value: string): string {
  let out = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

function parseLengths(shadow: string): number[] {
  return stripFunctions(shadow)
    .split(/\s+/)
    .filter((token) => /^-?[\d.]+(px)?$/.test(token))
    .map((token) => Number.parseFloat(token));
}

/** Parses a computed `box-shadow` value, ignoring inset shadows. */
export function parseBoxShadow(value: string): ShadowGeometry[] {
  if (!value || value === "none") return [];
  return splitTopLevel(value).flatMap((shadow) => {
    if (/\binset\b/.test(stripFunctions(shadow))) return [];
    const [x = 0, y = 0, blur = 0, spread = 0] = parseLengths(shadow);
    return [{ x, y, blur, spread }];
  });
}

/** Parses every `drop-shadow()` in a computed `filter` value. */
export function parseDropShadows(value: string): ShadowGeometry[] {
  if (!value || value === "none") return [];
  const shadows: ShadowGeometry[] = [];
  const marker = "drop-shadow(";
  let index = value.indexOf(marker);
  while (index !== -1) {
    let depth = 1;
    let end = index + marker.length;
    while (end < value.length && depth > 0) {
      if (value[end] === "(") depth++;
      else if (value[end] === ")") depth--;
      end++;
    }
    const [x = 0, y = 0, blur = 0] = parseLengths(
      value.slice(index + marker.length, end - 1)
    );
    shadows.push({ x, y, blur, spread: 0 });
    index = value.indexOf(marker, end);
  }
  return shadows;
}

/**
 * Walks the container's descendants and returns how far their outer shadows
 * extend beyond the container's border box. Accounts for canvas zoom by
 * converting screen-space rects back to the container's local scale.
 */
export function measureShadowBleed(container: HTMLElement): ShadowBleed {
  const box = container.getBoundingClientRect();
  if (box.width === 0 || container.offsetWidth === 0) return NO_BLEED;
  const scale = box.width / container.offsetWidth;

  const bleed = { ...NO_BLEED };
  for (const el of container.querySelectorAll<HTMLElement>("*")) {
    const computed = getComputedStyle(el);
    const shadows = [
      ...parseBoxShadow(computed.boxShadow),
      ...parseDropShadows(computed.filter),
    ];
    if (shadows.length === 0) continue;

    const rect = el.getBoundingClientRect();
    const top = (rect.top - box.top) / scale;
    const left = (rect.left - box.left) / scale;
    const bottom = (rect.bottom - box.top) / scale;
    const right = (rect.right - box.left) / scale;
    const width = box.width / scale;
    const height = box.height / scale;

    for (const { x, y, blur, spread } of shadows) {
      const reach = blur + spread;
      bleed.top = Math.max(bleed.top, -(top + y - reach));
      bleed.left = Math.max(bleed.left, -(left + x - reach));
      bleed.bottom = Math.max(bleed.bottom, bottom + y + reach - height);
      bleed.right = Math.max(bleed.right, right + x + reach - width);
    }
  }

  return {
    top: Math.ceil(bleed.top),
    right: Math.ceil(bleed.right),
    bottom: Math.ceil(bleed.bottom),
    left: Math.ceil(bleed.left),
  };
}
