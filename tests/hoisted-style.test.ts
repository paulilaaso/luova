import { describe, expect, it } from "vitest";
import {
  extractJsxClassNamesByAstIndex,
  extractJsxInlineStyleByAstIndex,
  updateJsxModeAwareStyle,
  updateJsxStyleByAstIndex,
} from "@/utils/ast-modifier-v2";

// After a bake, styles are often hoisted into a constant: style={surface}.
const code = `export default function Card() {
  const surface = {"--luova-bg-light": "linear-gradient(red, blue)", "--luova-bg-dark": "linear-gradient(black, gray)"} as React.CSSProperties;
  return <div style={surface} className="luova-bg-themed rounded-xl" />;
}`;

describe("editing a hoisted style object", () => {
  it("edits one mode's gradient and keeps the other", () => {
    const next = updateJsxModeAwareStyle(
      code,
      0,
      "gradient",
      "light",
      "linear-gradient(green, yellow)"
    );
    const style = extractJsxInlineStyleByAstIndex(next, 0);
    expect(style["--luova-bg-light"]).toBe("linear-gradient(green, yellow)");
    expect(style["--luova-bg-dark"]).toBe("linear-gradient(black, gray)");
    expect(extractJsxClassNamesByAstIndex(next, 0)).toContain(
      "luova-bg-themed"
    );
    // The constant was only used here, so it is folded in and removed.
    expect(next).not.toContain("const surface");
    expect(next).not.toContain("linear-gradient(red, blue)");
  });

  it("keeps a constant that other elements still use", () => {
    const shared = `export default function Fields() {
  const shadow = {"--luova-shadow-light": "var(--shadow-sm)", "--luova-shadow-dark": "var(--shadow-lg)"} as React.CSSProperties;
  return <div><span style={shadow} /><span style={shadow} /></div>;
}`;
    const next = updateJsxModeAwareStyle(
      shared,
      1,
      "shadow",
      "dark",
      "0 4px 8px black"
    );
    expect(next).toContain("const shadow");
    expect(next).toContain("<span style={shadow} />");
    const style = extractJsxInlineStyleByAstIndex(next, 1);
    expect(style["--luova-shadow-light"]).toBe("var(--shadow-sm)");
    expect(style["--luova-shadow-dark"]).toBe("0 4px 8px black");
  });

  it("spreads a style it can't resolve and adds properties after it", () => {
    const prop = `export default function Box({ style }) {
  return <div style={style} />;
}`;
    const next = updateJsxStyleByAstIndex(prop, 0, "opacity", "0.5");
    expect(next).toContain("...style");
    expect(extractJsxInlineStyleByAstIndex(next, 0).opacity).toBe("0.5");
  });

  it("leaves the code alone when only removing", () => {
    expect(updateJsxStyleByAstIndex(code, 0, "opacity", null)).toBe(code);
  });
});
