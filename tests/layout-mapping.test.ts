import { describe, expect, it } from "vitest";
import {
  generateTailwindClass,
  getConflictingClasses,
  getLineHeightFromClasses,
  snapSpacingPx,
  stylePropertyToCss,
} from "@/utils/tailwind-mapping";

describe("display mapping", () => {
  it("emits the display utility as given", () => {
    expect(generateTailwindClass("display", "flex")).toBe("flex");
    expect(generateTailwindClass("display", "inline-grid")).toBe("inline-grid");
    expect(generateTailwindClass("display", "block")).toBe("block");
  });

  it("replaces only unprefixed display classes", () => {
    const classes = [
      "flex",
      "flex-col",
      "items-center",
      "md:grid",
      "hidden",
      "inline-block",
    ];
    expect(getConflictingClasses("display", classes)).toEqual([
      "flex",
      "inline-block",
    ]);
  });

  it("previews display without other properties", () => {
    expect(stylePropertyToCss("display", "grid")).toBe(
      "display: grid !important;"
    );
  });
});

describe("flex/grid control previews", () => {
  it("do not force display: flex", () => {
    for (const [property, value] of [
      ["flexDirection", "col"],
      ["alignItems", "center"],
      ["justifyContent", "between"],
    ] as const) {
      expect(stylePropertyToCss(property, value)).not.toContain("display");
    }
  });

  it("previews justify-between as CSS space-between", () => {
    expect(stylePropertyToCss("justifyContent", "between")).toBe(
      "justify-content: space-between !important;"
    );
    expect(stylePropertyToCss("justifyContent", "center")).toBe(
      "justify-content: center !important;"
    );
  });
});

describe("per-side margin mapping", () => {
  it("generates side classes on the spacing scale", () => {
    expect(generateTailwindClass("marginTop", 16)).toBe("mt-4");
    expect(generateTailwindClass("marginRight", 8)).toBe("mr-2");
    expect(generateTailwindClass("marginBottom", 0)).toBe("mb-0");
    expect(generateTailwindClass("marginLeft", 13)).toBe("ml-3");
  });

  it("conflicts only with the same side", () => {
    expect(
      getConflictingClasses("marginTop", ["mt-4", "my-2", "m-1", "mb-3"])
    ).toEqual(["mt-4"]);
  });

  it("previews a single side", () => {
    expect(stylePropertyToCss("marginLeft", 12)).toBe(
      "margin-left: 12px !important;"
    );
  });
});

describe("snapSpacingPx", () => {
  it("snaps to the nearest spacing step", () => {
    expect(snapSpacingPx(13)).toBe(12);
    expect(snapSpacingPx(15)).toBe(16);
    expect(snapSpacingPx(0)).toBe(0);
    expect(snapSpacingPx(70)).toBe(64);
  });
});

describe("line height units", () => {
  it("reads fixed leading-N heights as a percentage of the font size", () => {
    expect(getLineHeightFromClasses(["leading-6"], 16)).toBe(150);
    expect(getLineHeightFromClasses(["leading-6"], 24)).toBe(100);
    expect(getLineHeightFromClasses(["leading-tight"], 24)).toBe(125);
  });

  it("writes percentages as relative values, never fixed pixel classes", () => {
    expect(generateTailwindClass("lineHeight", 24)).toBe("leading-[0.24]");
    expect(generateTailwindClass("lineHeight", 150)).toBe("leading-normal");
  });

  it("still replaces an old fixed class", () => {
    expect(getConflictingClasses("lineHeight", ["leading-6", "p-2"])).toEqual([
      "leading-6",
    ]);
  });
});
