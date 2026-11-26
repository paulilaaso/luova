/**
 * Canonical margin/padding classes for one element.
 *
 * Edits from the spacing box are applied to the element's full set of
 * per-side values and written back in the shortest form, so repeated edits
 * never pile up as `py-4 pt-0 pb-0`. Only unprefixed classes are touched
 * (`md:px-4` and other variants are left alone).
 */

export type SpacingSide = "top" | "right" | "bottom" | "left";
export type SpacingPrefix = "p" | "m";
/** Class suffix including sign: "4", "px", "[3px]", "auto", "-2". */
export type SpacingToken = string;
export type SideTokens = Record<SpacingSide, SpacingToken | null>;

const SIDES: SpacingSide[] = ["top", "right", "bottom", "left"];
const SIDE_LETTER: Record<SpacingSide, string> = {
  top: "t",
  right: "r",
  bottom: "b",
  left: "l",
};
const COVERS: Record<string, SpacingSide[]> = {
  "": SIDES,
  x: ["left", "right"],
  y: ["top", "bottom"],
  t: ["top"],
  r: ["right"],
  b: ["bottom"],
  l: ["left"],
};
// Tailwind applies a single side over its axis over the shorthand,
// whatever the order in the class list.
const SPECIFICITY: Record<string, number> = {
  "": 0,
  x: 1,
  y: 1,
  t: 2,
  r: 2,
  b: 2,
  l: 2,
};

function matcher(prefix: SpacingPrefix) {
  return new RegExp(
    `^(-?)${prefix}([xytrbl]?)-(\\d+(?:\\.\\d+)?|px|auto|\\[[^\\]]+\\])$`
  );
}

/** Whether a class is one of this element's unprefixed spacing classes. */
export function isSpacingClass(cls: string, prefix: SpacingPrefix): boolean {
  return matcher(prefix).test(cls);
}

/** Resolve the classes to one token per side (null = not set by a class). */
export function parseSpacing(
  classes: string[],
  prefix: SpacingPrefix
): SideTokens {
  const re = matcher(prefix);
  const sides: SideTokens = {
    top: null,
    right: null,
    bottom: null,
    left: null,
  };
  const rank: Record<SpacingSide, number> = {
    top: -1,
    right: -1,
    bottom: -1,
    left: -1,
  };
  for (const cls of classes) {
    const match = re.exec(cls);
    if (!match) continue;
    const [, sign, axis, suffix] = match;
    for (const side of COVERS[axis]) {
      if (SPECIFICITY[axis] >= rank[side]) {
        rank[side] = SPECIFICITY[axis];
        sides[side] = `${sign}${suffix}`;
      }
    }
  }
  return sides;
}

/** Shortest class list for the given per-side tokens. */
export function buildSpacingClasses(
  sides: SideTokens,
  prefix: SpacingPrefix
): string[] {
  const cls = (axis: string, token: SpacingToken) =>
    token.startsWith("-")
      ? `-${prefix}${axis}-${token.slice(1)}`
      : `${prefix}${axis}-${token}`;
  const { top, right, bottom, left } = sides;
  if (top !== null && top === right && top === bottom && top === left) {
    return [cls("", top)];
  }
  const out: string[] = [];
  if (left !== null && left === right) out.push(cls("x", left));
  if (top !== null && top === bottom) out.push(cls("y", top));
  for (const side of SIDES) {
    const token = sides[side];
    if (token === null) continue;
    const paired =
      side === "left" || side === "right" ? left === right : top === bottom;
    if (!paired) out.push(cls(SIDE_LETTER[side], token));
  }
  return out;
}

/**
 * Set `sides` to `token`, drop sides that would equal the element's own
 * value without any class (`naturalZero`), and return the classes to remove
 * and add.
 */
export function applySpacingEdit(
  classes: string[],
  prefix: SpacingPrefix,
  sides: SpacingSide[],
  token: SpacingToken,
  naturalZero: Record<SpacingSide, boolean>
): { remove: string[]; add: string[] } {
  const next = parseSpacing(classes, prefix);
  for (const side of sides) next[side] = token;
  for (const side of SIDES) {
    if (next[side] === "0" && naturalZero[side]) next[side] = null;
  }
  const remove = classes.filter((c) => isSpacingClass(c, prefix));
  const add = buildSpacingClasses(next, prefix);
  // Leave the class list untouched when the result is the same set.
  const same =
    remove.length === add.length && add.every((c) => remove.includes(c));
  return same ? { remove: [], add: [] } : { remove, add };
}
