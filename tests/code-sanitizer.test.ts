import { describe, expect, it } from "vitest";
import { cleanComponentCode } from "@/lib/ai/code-cleaner";
import { cleanLLMOutput } from "@/utils/code-processing";

describe("cleanLLMOutput", () => {
  it("should strip markdown code fences", () => {
    const input =
      '```tsx\nimport React from "react";\nexport default () => <div>Hello</div>\n```';
    const expected =
      'import React from "react";\nexport default () => <div>Hello</div>';
    expect(cleanLLMOutput(input)).toBe(expected);
  });

  it("should unescape JSON-style strings", () => {
    const input =
      '"import React from \\"react\\";\\nexport default () => <div>Hello</div>"';
    const result = cleanLLMOutput(input);
    expect(result).toBe(
      'import React from "react";\nexport default () => <div>Hello</div>'
    );
  });

  it("should unescape escaped code even without surrounding quotes", () => {
    const input =
      'import React from \\"react\\";\\nexport default () => <div>Hello</div>';
    const result = cleanLLMOutput(input);
    expect(result).toBe(
      'import React from "react";\nexport default () => <div>Hello</div>'
    );
  });

  it("should handle legitimate escaped code correctly", () => {
    const input = 'const s = "a \\"quoted\\" string";';
    const result = cleanLLMOutput(input);
    expect(result).toBe(input);
  });

  it("should handle code with complex internal escapes correctly in multi-line raw code", () => {
    const input =
      "const regex = /\\\\n/g;\nexport default () => <div>{regex.toString()}</div>;";
    const result = cleanLLMOutput(input);
    expect(result).toBe(input);
  });
});

describe("cleanComponentCode", () => {
  it("preserves text-white on colored badges", () => {
    const out = cleanComponentCode(
      '<span className="bg-chart-1 text-white">hi</span>'
    );
    expect(out).toContain("text-white");
  });

  it("preserves transparent utilities", () => {
    expect(
      cleanComponentCode('<div className="bg-transparent">x</div>')
    ).toContain("bg-transparent");
    expect(
      cleanComponentCode('<div className="border border-transparent">x</div>')
    ).toContain("border-transparent");
  });

  it("preserves inner palette colors instead of erasing them", () => {
    const out = cleanComponentCode(
      'export default function C() { return (<div className="w-full h-full bg-background text-foreground"><div className="bg-red-500 text-gray-200">x</div></div>); }'
    );
    // Inner authored colors must survive — no destructive hole-punching.
    expect(out).toContain("bg-red-500");
    expect(out).toContain("text-gray-200");
  });

  it("normalizes only the root surface to theme tokens", () => {
    const out = cleanComponentCode(
      'export default function Slide() { return (<div className="w-full h-full bg-black text-white flex"><div className="bg-zinc-900 rounded-xl px-5 py-3"><p className="text-gray-400 text-xs mt-1">sub</p></div></div>); }'
    );
    // Root maps to the canvas surface …
    expect(out).toContain("bg-background");
    expect(out).toContain("text-foreground");
    // … while inner cards, subtitles, and sizes stay intact.
    expect(out).toContain("bg-zinc-900");
    expect(out).toContain("text-gray-400");
    expect(out).toContain("text-xs");
    // No orphaned double-spaces left inside class attributes.
    expect(out).not.toMatch(/className="[^"]* {2}[^"]*"/);
  });

  it("keeps inner gradients intact", () => {
    const out = cleanComponentCode(
      'export default function C() { return (<div className="w-full h-full bg-background text-foreground"><div className="bg-gradient-to-br from-zinc-900 to-black border-4 border-zinc-800">x</div></div>); }'
    );
    expect(out).toContain("from-zinc-900");
    expect(out).toContain("to-black");
    expect(out).toContain("border-zinc-800");
  });
});
