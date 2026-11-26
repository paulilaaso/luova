import { describe, expect, it } from "vitest";
import { formatExportErrors, validateExports } from "@/utils/validate-exports";

describe("validateExports", () => {
  describe("valid imports", () => {
    it("should accept valid named imports from lucide-react", () => {
      const code = 'import { Home } from "lucide-react";\nexport default Home;';
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept valid named imports from react", () => {
      const code =
        'import { useState } from "react";\nexport default function () { return null; }';
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept namespace imports", () => {
      const code =
        'import * as React from "react";\nexport default React.createElement("div");';
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept multiple valid imports", () => {
      const code = `import { useState, useEffect } from "react";
import { Home, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
export default function Component() { return null; }`;
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept imports from @/lib/utils", () => {
      const code =
        'import { cn } from "@/lib/utils";\nexport default function() { return null; }';
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("invalid imports", () => {
    it("should reject non-existent named export", () => {
      const code =
        'import { NonExistent } from "react";\nexport default NonExistent;';
      const result = validateExports(code);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].symbol).toBe("NonExistent");
      expect(result.errors[0].reason).toContain("not found");
    });

    it("should reject multiple invalid exports", () => {
      const code = 'import { Bad1, Bad2 } from "react";\nexport default Bad1;';
      const result = validateExports(code);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("should suggest similar export names", () => {
      const code =
        'import { usestate } from "react";\nexport default usestate;';
      const result = validateExports(code);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].suggestion).toContain("useState");
    });

    it("should provide lucide icon examples for missing icons", () => {
      const code =
        'import { FakeIcon } from "lucide-react";\nexport default FakeIcon;';
      const result = validateExports(code);
      expect(result.isValid).toBe(false);
      if (result.errors[0].suggestion) {
        expect(result.errors[0].suggestion).toContain("Available icons");
      }
    });

    it("should track line numbers for errors", () => {
      const code = `import { useState } from "react";
import { BadExport } from "lucide-react";
export default function() { return null; }`;
      const result = validateExports(code);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].line).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should handle code with no imports", () => {
      const code = "export default function Component() { return null; }";
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle empty code", () => {
      const code = "";
      const result = validateExports(code);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should be case-sensitive for symbol names", () => {
      const code =
        'import { UseSt ate } from "react";\nexport default UseState;';
      const result = validateExports(code);
      expect(result.isValid).toBe(false);
    });
  });
});

describe("formatExportErrors", () => {
  it("should format errors with line numbers and suggestions", () => {
    const code =
      'import { BadExport } from "react";\nexport default BadExport;';
    const { errors } = validateExports(code);
    const formatted = formatExportErrors(errors);
    expect(formatted).toContain("Line 1");
    expect(formatted).toContain("EXPORT_ERROR");
  });

  it("should handle empty error list", () => {
    const formatted = formatExportErrors([]);
    expect(formatted).toBe("");
  });
});

describe("integration with import parser", () => {
  it("should validate real AI-generated pattern", () => {
    const code = `import * as React from "react";
import { useState } from "react";
import { Home, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import * as BaseUI from "@base-ui/react";

export default function Component() {
  const [count, setCount] = useState(0);
  return (
    <BaseUI.Popover>
      <Home />
      <motion.div>{count}</motion.div>
    </BaseUI.Popover>
  );
}`;
    const result = validateExports(code);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should catch typos in common hooks", () => {
    const code = `import { useStat, useEfect } from "react";
export default function Component() { 
  return null; 
}`;
    const result = validateExports(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});
