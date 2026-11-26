import { describe, expect, it } from "vitest";
import {
  extractJsxClassNamesByAstIndex,
  extractJsxInlineStyleByAstIndex,
} from "@/utils/ast-modifier-v2";
import {
  generateTailwindClass,
  getColorFromClasses,
  getConflictingClasses,
  getFontSizeFromClasses,
} from "@/utils/tailwind-mapping";
import { inlineTypographyValues } from "@/utils/text-typography";
import { updateTypographyCode } from "@/utils/typography-commit";

// A recreated heading: geometry from a spread, typography set inline.
const code = `export default function Cover() {
  return <span className="whitespace-nowrap" style={{...box(373,190,550,146),fontSize:'calc(140px * var(--font-scale, 1))',lineHeight:1,letterSpacing:'-.061em',fontWeight:800}}>science</span>;
}`;

describe("inline typography in Edit mode", () => {
  it("reads the inline values the browser actually renders", () => {
    const style = extractJsxInlineStyleByAstIndex(code, 0);
    expect(inlineTypographyValues(style, 16)).toEqual({
      fontSize: "140",
      fontWeight: "800",
      lineHeight: "100",
      letterSpacing: "-0.061",
    });
  });

  it("converts px spacing and line height relative to the font size", () => {
    expect(
      inlineTypographyValues(
        { fontSize: "20px", lineHeight: "30px", letterSpacing: "2px" },
        16
      )
    ).toEqual({ fontSize: "20", lineHeight: "150", letterSpacing: "0.1" });
  });

  it("removes the inline property it replaces, keeping the rest of the style", () => {
    const sized = updateTypographyCode(code, 0, "fontSize", 150, "light");
    expect(extractJsxClassNamesByAstIndex(sized, 0)).toContain(
      "text-[length:calc(150px*var(--font-scale,1))]"
    );
    const style = extractJsxInlineStyleByAstIndex(sized, 0);
    expect(style.fontSize).toBeUndefined();
    expect(style.letterSpacing).toBe("-.061em");
    expect(sized).toContain("...box(373,190,550,146)");

    const tracked = updateTypographyCode(
      sized,
      0,
      "letterSpacing",
      -0.08,
      "light"
    );
    expect(extractJsxClassNamesByAstIndex(tracked, 0)).toContain(
      "tracking-[-0.08em]"
    );
    expect(
      extractJsxInlineStyleByAstIndex(tracked, 0).letterSpacing
    ).toBeUndefined();
  });

  it("keeps sizes past the named scale on the global font scale", () => {
    expect(generateTailwindClass("fontSize", 128)).toBe("text-9xl");
    expect(generateTailwindClass("fontSize", 100)).toBe("text-[100px]");
    const scaled = generateTailwindClass("fontSize", 140)!;
    expect(scaled).toBe("text-[length:calc(140px*var(--font-scale,1))]");
    expect(getFontSizeFromClasses([scaled])).toBe(140);
    expect(getConflictingClasses("fontSize", [scaled])).toEqual([scaled]);
    // A scaled size is never mistaken for a text color.
    expect(getColorFromClasses([scaled], "text")).toBeUndefined();
    expect(getConflictingClasses("textColor", [scaled])).toEqual([]);
  });
});
