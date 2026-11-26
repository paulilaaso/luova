import type { TextAlignment } from "@/stores/text-format-store";
import { getDescendantAstIndices } from "./ast-indexer";
import {
  extractJsxClassNamesByAstIndex,
  updateJsxClassNameByAstIndex,
  updateJsxStyleByAstIndex,
} from "./ast-modifier-v2";
import {
  generateTailwindClass,
  getConflictingClasses,
  isConflictingColorClass,
} from "./tailwind-mapping";
import type { TypographyProperty } from "./text-typography";

interface UpdateTypographyOptions {
  /**
   * When true, the same property's conflicting classes are also removed from
   * every nested element. This is what makes a block-level change authoritative
   * over per-run formatting ("apply to the whole block").
   */
  stripDescendants?: boolean;
}

/** Shared AST adapter for text blocks and captured elements. */
export function updateTypographyCode(
  code: string,
  astIndex: number,
  property: TypographyProperty,
  value: string | number,
  mode: "light" | "dark",
  tokenKey?: string,
  options?: UpdateTypographyOptions
): string {
  const classes = extractJsxClassNamesByAstIndex(code, astIndex);
  const generated =
    property === "textColor" && tokenKey
      ? `text-${tokenKey}`
      : generateTailwindClass(property, value, mode);
  const conflicts =
    property === "textColor"
      ? classes.filter(
          (cls) =>
            isConflictingColorClass(cls, "textColor", mode) ||
            (tokenKey &&
              (cls === `light:text-${tokenKey}` ||
                cls === `dark:text-${tokenKey}`))
        )
      : getConflictingClasses(property, classes);

  let updated = updateJsxClassNameByAstIndex(
    code,
    astIndex,
    generated ? [generated] : [],
    conflicts
  );
  // An inline style for the same property would outrank the new class and
  // the edit would have no visible effect, so the class takes over.
  updated = updateJsxStyleByAstIndex(
    updated,
    astIndex,
    property === "textColor" ? "color" : property,
    null
  );

  if (options?.stripDescendants) {
    for (const descendantIndex of getDescendantAstIndices(updated, astIndex)) {
      const descendantClasses = extractJsxClassNamesByAstIndex(
        updated,
        descendantIndex
      );
      const descendantConflicts = getConflictingClasses(
        property,
        descendantClasses
      );
      if (descendantConflicts.length) {
        updated = updateJsxClassNameByAstIndex(
          updated,
          descendantIndex,
          [],
          descendantConflicts
        );
      }
    }
  }

  return updated;
}

/** Apply one alignment to the whole Text component, replacing nested overrides. */
export function updateTextAlignmentCode(
  code: string,
  alignment: TextAlignment
): string {
  const rootClasses = extractJsxClassNamesByAstIndex(code, 0);
  let updated = updateJsxClassNameByAstIndex(
    code,
    0,
    [`text-${alignment}`],
    getConflictingClasses("textAlign", rootClasses)
  );
  for (const index of getDescendantAstIndices(updated, 0)) {
    const classes = extractJsxClassNamesByAstIndex(updated, index);
    const conflicts = getConflictingClasses("textAlign", classes);
    if (conflicts.length)
      updated = updateJsxClassNameByAstIndex(updated, index, [], conflicts);
  }
  return updated;
}
