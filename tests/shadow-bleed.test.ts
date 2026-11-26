import { describe, expect, it } from "vitest";
import { parseBoxShadow, parseDropShadows } from "@/lib/shadow-bleed";

describe("shadow parsing", () => {
  it("parses computed multi-layer box-shadows with color functions", () => {
    expect(
      parseBoxShadow(
        "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, oklch(0.2 0.01 250 / 0.5) 2px 4px 6px"
      )
    ).toEqual([
      { x: 0, y: 10, blur: 15, spread: -3 },
      { x: 2, y: 4, blur: 6, spread: 0 },
    ]);
  });

  it("ignores inset shadows and none", () => {
    expect(parseBoxShadow("none")).toEqual([]);
    expect(parseBoxShadow("rgb(0, 0, 0) 0px 2px 4px 0px inset")).toEqual([]);
  });

  it("parses drop-shadow filters among other filters", () => {
    expect(
      parseDropShadows(
        "blur(2px) drop-shadow(rgba(0, 0, 0, 0.1) 0px 4px 3px) drop-shadow(rgb(0, 0, 0) -1px 2px 0px)"
      )
    ).toEqual([
      { x: 0, y: 4, blur: 3, spread: 0 },
      { x: -1, y: 2, blur: 0, spread: 0 },
    ]);
  });
});
