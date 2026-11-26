import { describe, expect, it } from "vitest";
import {
  getColorFromClasses,
  getConflictingClasses,
  getFontSizeFromClasses,
  getPaddingFromClasses,
} from "@/utils/tailwind-mapping";

describe("tailwind variant-aware mapping", () => {
  it("reads the active responsive font size from prefixed classes", () => {
    expect(getFontSizeFromClasses(["text-3xl", "@3xl:text-5xl"])).toBe(48);
    expect(
      getFontSizeFromClasses(["text-muted-foreground", "@3xl:text-xl"])
    ).toBe(20);
  });
});

describe("tailwind mapping core parsing", () => {
  it("resolves multi-axis padding correctly", () => {
    const classes = ["p-2", "px-4", "mt-6"];

    expect(getPaddingFromClasses(classes, "left")).toBe(16);
    expect(getPaddingFromClasses(classes, "top")).toBe(8);
  });

  it("extracts exact colors, ignoring structural suffixes", () => {
    const classes = [
      "bg-blue-500",
      "text-foreground",
      "border-[2px]",
      "border-red-400",
    ];

    expect(getColorFromClasses(classes, "bg", "light")).toBe("blue-500");
    expect(getColorFromClasses(classes, "text", "light")).toBe("foreground");
    expect(getColorFromClasses(classes, "border", "light")).toBe("red-400");
  });

  it("identifies conflicting classes for removal", () => {
    const existing = [
      "flex",
      "flex-col",
      "p-4",
      "items-center",
      "justify-between",
    ];

    expect(getConflictingClasses("flexDirection", existing)).toEqual([
      "flex-col",
    ]);
  });
});
