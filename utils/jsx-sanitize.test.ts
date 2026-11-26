import { describe, expect, it } from "vitest";
import { sanitizeInvalidJsxNesting } from "@/utils/jsx-sanitize";

describe("sanitizeInvalidJsxNesting", () => {
  it("rewrites nested paragraph tags to spans", () => {
    const code = `
      export default function Component() {
        return (
          <p className="text-5xl">
            <span>Lead</span>
            <p className="text-sm">Nested copy</p>
          </p>
        );
      }
    `;

    const sanitized = sanitizeInvalidJsxNesting(code);

    expect(sanitized).toContain('<p className="text-5xl">');
    expect(sanitized).toContain('<span className="text-sm">Nested copy</span>');
    expect(sanitized).not.toContain('<p className="text-sm">Nested copy</p>');
  });

  it("leaves sibling paragraphs intact", () => {
    const code = `
      export default function Component() {
        return (
          <div>
            <p>First</p>
            <p>Second</p>
          </div>
        );
      }
    `;

    expect(sanitizeInvalidJsxNesting(code)).toBe(code);
  });
});
