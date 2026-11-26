import { describe, expect, it } from "vitest";
import {
  extractJsxClassNamesByAstIndex,
  extractJsxStyleByAstIndex,
  setJsxStyleByAstIndex,
  updateJsxClassNameByAstIndex,
  updateJsxModeAwareStyle,
  updateJsxStyleByAstIndex,
} from "@/utils/ast-modifier-v2";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Inject a data-ast-index="0" attribute for testing */
function withAstIndex(jsx: string, index = 0): string {
  return jsx.replace(/(<\w+)/, `$1 data-ast-index="${index}"`);
}

/** Parse a style object expression string into a Record for assertion helpers */
function _parseStyleObj(source: string): Record<string, string> {
  const match = source.match(/style=\{?\{([^}]+)\}?\}?/);
  if (!match) return {};
  const props: Record<string, string> = {};
  for (const part of match[1].split(",")) {
    const [k, ...v] = part.split(":");
    if (k && v.length) {
      const key = k.trim().replace(/["']/g, "");
      const val = v.join(":").trim().replace(/["']/g, "");
      props[key] = val;
    }
  }
  return props;
}

// ─── Task 1: className extraction ─────────────────────────────────────────────

describe("extractJsxClassNamesByAstIndex", () => {
  it("extracts from string literal", () => {
    const code = withAstIndex(`<div className="foo bar" />`);
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual(["foo", "bar"]);
  });

  it("extracts from template literal", () => {
    const code = withAstIndex("<div className={`foo bar`} />");
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual(["foo", "bar"]);
  });

  it("extracts from cn() call", () => {
    const code = withAstIndex(`<div className={cn("foo", "bar")} />`);
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual(["foo", "bar"]);
  });

  it("extracts only direct string literal args from cn() with mixed args", () => {
    const code = withAstIndex(
      `<div className={cn("base", isActive && "active")} />`
    );
    // "active" is inside a BinaryExpression, not a direct cn() argument
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual(["base"]);
  });

  it("extracts from clsx() call", () => {
    const code = withAstIndex(`<div className={clsx("a", "b")} />`);
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual(["a", "b"]);
  });

  it("extracts from twMerge() call", () => {
    const code = withAstIndex(`<div className={twMerge("x", "y")} />`);
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual(["x", "y"]);
  });

  it("returns empty array for non-cn expression", () => {
    const code = withAstIndex(
      `<div className={isActive ? "active" : "inactive"} />`
    );
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual([]);
  });

  it("returns empty array when no className attribute", () => {
    const code = withAstIndex(`<div />`);
    expect(extractJsxClassNamesByAstIndex(code, 0)).toEqual([]);
  });
});

// ─── Task 2: className rewriting ──────────────────────────────────────────────

describe("updateJsxClassNameByAstIndex", () => {
  it("adds classes to a string literal", () => {
    const code = withAstIndex(`<div className="foo" />`);
    const result = updateJsxClassNameByAstIndex(code, 0, ["bar"], []);
    expect(extractJsxClassNamesByAstIndex(result, 0)).toContain("bar");
  });

  it("removes classes from a string literal", () => {
    const code = withAstIndex(`<div className="foo bar" />`);
    const result = updateJsxClassNameByAstIndex(code, 0, [], ["foo"]);
    expect(extractJsxClassNamesByAstIndex(result, 0)).toEqual(["bar"]);
  });

  it("preserves cn() wrapper when modifying args", () => {
    const code = withAstIndex(`<div className={cn("a", "b", "c")} />`);
    const result = updateJsxClassNameByAstIndex(code, 0, ["d"], ["a"]);
    expect(result).toContain("cn(");
    expect(result).not.toContain('"a"');
    const classes = extractJsxClassNamesByAstIndex(result, 0);
    expect(classes).toContain("d");
    expect(classes).not.toContain("a");
  });

  it("preserves non-string arguments in cn() call", () => {
    const code = withAstIndex(
      `<div className={cn("base", isActive && "active")} />`
    );
    const result = updateJsxClassNameByAstIndex(code, 0, ["new"], ["base"]);
    expect(result).toContain("isActive &&");
    expect(result).toContain("cn(");
    expect(extractJsxClassNamesByAstIndex(result, 0)).toContain("new");
  });

  it("wraps complex expression in cn() when adding classes", () => {
    const code = withAstIndex(
      `<div className={isActive ? "active" : "inactive"} />`
    );
    const result = updateJsxClassNameByAstIndex(code, 0, ["new-class"], []);
    expect(result).toContain('import { cn } from "@/lib/utils";');
    expect(result).toContain("cn(");
    expect(result).toContain("isActive ?");
    expect(result).toContain('"new-class"');
    expect(extractJsxClassNamesByAstIndex(result, 0)).toContain("new-class");
  });

  it("does not duplicate an existing cn import", () => {
    const code = `import { cn } from "@/lib/utils";\n${withAstIndex(
      `<div className={isActive ? "active" : "inactive"} />`
    )}`;
    const result = updateJsxClassNameByAstIndex(code, 0, ["new-class"], []);
    expect(result.match(/import \{ cn \} from "@\/lib\/utils";/g)).toHaveLength(
      1
    );
  });

  it("collapses cn() to string literal when all args removed", () => {
    const code = withAstIndex(`<div className={cn("a")} />`);
    const result = updateJsxClassNameByAstIndex(code, 0, ["b"], ["a"]);
    // Only "b" remains, should be a plain string literal
    expect(extractJsxClassNamesByAstIndex(result, 0)).toEqual(["b"]);
  });

  it("applies twMerge to resolve conflicts", () => {
    const code = withAstIndex(`<div className="px-4" />`);
    const result = updateJsxClassNameByAstIndex(code, 0, ["px-6"], []);
    const classes = extractJsxClassNamesByAstIndex(result, 0);
    // twMerge should keep only px-6 (px-4 is overridden)
    expect(classes).toContain("px-6");
    expect(classes).not.toContain("px-4");
  });
});

// ─── Task 3+4: Style object surgical editing ──────────────────────────────────

describe("updateJsxStyleByAstIndex", () => {
  it("adds a new property to an empty style object", () => {
    const code = withAstIndex(`<div style={{}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "color", "red");
    expect(result).toContain('color: "red"');
  });

  it("adds a new property to an existing style object", () => {
    const code = withAstIndex(`<div style={{color: "red"}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "margin", "10px");
    expect(extractJsxStyleByAstIndex(result, 0)).toContain("margin");
  });

  it("updates an existing property value surgically", () => {
    const code = withAstIndex(`<div style={{color: "red"}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "color", "blue");
    expect(result).toContain('color: "blue"');
    expect(result).not.toContain("red");
  });

  it("deletes an existing property surgically", () => {
    const code = withAstIndex(`<div style={{color: "red", margin: "10px"}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "margin", null);
    expect(result).not.toContain("margin");
    expect(result).toContain("color");
  });

  it("preserves spread operators when adding properties", () => {
    const code = withAstIndex(`<div style={{color: "red", ...props.style}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "margin", "10px");
    expect(result).toContain("...props.style");
    expect(result).toContain("margin");
  });

  it("empties the style object when last property deleted", () => {
    const code = withAstIndex(`<div style={{color: "red"}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "color", null);
    expect(result).toContain("style={{}}");
  });

  it("handles CSS custom properties with quoted keys", () => {
    const code = withAstIndex(`<div style={{}} />`);
    const result = updateJsxStyleByAstIndex(code, 0, "--my-var", "10px");
    expect(result).toContain('"--my-var"');
  });

  it("creates a new style attribute when none exists", () => {
    const code = withAstIndex(`<div />`);
    const result = updateJsxStyleByAstIndex(code, 0, "color", "red");
    expect(result).toContain("style={{");
    expect(extractJsxStyleByAstIndex(result, 0)).toContain("color");
  });
});

// ─── setJsxStyleByAstIndex ────────────────────────────────────────────────────

describe("setJsxStyleByAstIndex", () => {
  it("replaces the entire style object", () => {
    const code = withAstIndex(`<div style={{color: "red"}} />`);
    const result = setJsxStyleByAstIndex(code, 0, "{color: 'blue'}");
    expect(result).toContain('color: "blue"');
  });

  it("adds a style attribute when none exists", () => {
    const code = withAstIndex(`<div />`);
    const result = setJsxStyleByAstIndex(code, 0, "{color: 'red'}");
    expect(result).toContain("style={");
  });

  it("removes the style attribute when value is empty", () => {
    const code = withAstIndex(`<div style={{color: "red"}} />`);
    const result = setJsxStyleByAstIndex(code, 0, "");
    expect(result).not.toContain("style=");
  });
});

// ─── Task 5: Mode-aware style injection ──────────────────────────────────────

describe("updateJsxModeAwareStyle", () => {
  it("adds a gradient CSS variable and utility class", () => {
    const code = withAstIndex(`<div />`);
    const result = updateJsxModeAwareStyle(
      code,
      0,
      "gradient",
      "light",
      "linear-gradient(red, blue)"
    );
    expect(result).toContain("--luova-bg-light");
    expect(result).toContain("luova-bg-themed");
  });

  it("injects --luova-bg-light without destroying other style props", () => {
    const code = withAstIndex(
      `<div className="some-class" style={{color: "red", ...spread}} />`
    );
    const result = updateJsxModeAwareStyle(
      code,
      0,
      "gradient",
      "light",
      "#fff"
    );
    expect(result).toContain('color: "red"');
    expect(result).toContain("...spread");
    expect(result).toContain("--luova-bg-light");
    expect(result).toContain("luova-bg-themed");
  });

  it("removes only the targeted mode var when nullifying one mode", () => {
    const code = withAstIndex(
      `<div className="luova-bg-themed" style={{"--luova-bg-light": "#fff", "--luova-bg-dark": "#000"}} />`
    );
    const result = updateJsxModeAwareStyle(code, 0, "gradient", "light", null);
    expect(result).not.toContain("--luova-bg-light");
    expect(result).toContain("--luova-bg-dark"); // other mode preserved
  });

  it("consolidates old --luova-* vars when new value is set", () => {
    const code = withAstIndex(
      `<div style={{"--luova-bg-light": "red", "--luova-bg-dark": "blue", color: "green"}} />`
    );
    const result = updateJsxModeAwareStyle(
      code,
      0,
      "gradient",
      "light",
      "yellow"
    );
    // Old values should be replaced, not accumulated
    const style = extractJsxStyleByAstIndex(result, 0);
    expect(style).toContain("yellow");
    expect(style).not.toContain("red");
    expect(style).toContain("green"); // non-luova prop preserved
  });

  it("sets border-width from classes when kind is border", () => {
    const code = withAstIndex(`<div className="border-2" />`);
    const result = updateJsxModeAwareStyle(code, 0, "border", "light", "#fff");
    expect(result).toContain("--luova-border-width");
    expect(result).toContain("luova-border-themed");
    expect(result).toContain("relative");
  });

  it("preserves className with cn() when injecting mode-aware style", () => {
    const code = withAstIndex(
      `<div className={cn("base", condition && "extra")} style={{color: "red"}} />`
    );
    const result = updateJsxModeAwareStyle(
      code,
      0,
      "shadow",
      "dark",
      "0 0 5px rgba(0,0,0,0.5)"
    );
    expect(result).toContain("cn(");
    expect(result).toContain("condition &&");
    expect(result).toContain("base");
    expect(result).toContain("luova-shadow-themed");
    expect(result).toContain("--luova-shadow-dark");
  });
});
