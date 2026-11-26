import { describe, expect, it } from "vitest";
import {
  formatImportErrors,
  normalizeImports,
  parseImports,
} from "@/utils/parse-imports";

const component = "\nexport default function C() { return null; }";

function rejected(code: string) {
  return normalizeImports(code + component).errors.map((e) => e.moduleId);
}

describe("parseImports", () => {
  it("parses default, named, namespace and combined imports", () => {
    const { imports } =
      parseImports(`import React, { useState as useS } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Home, User } from "lucide-react";`);

    expect(imports.map((i) => i.source)).toEqual([
      "react",
      "@radix-ui/react-dialog",
      "lucide-react",
    ]);
    expect(imports[0].specifiers).toEqual([
      { type: "default", names: ["React"] },
      { type: "named", names: ["useState"] },
    ]);
    expect(imports[1].specifiers).toEqual([
      { type: "namespace", names: ["Dialog"] },
    ]);
    expect(imports[2].specifiers[0].names).toEqual(["Home", "User"]);
  });

  it("tracks line numbers of indented imports", () => {
    const { imports } = parseImports(`
      import { foo } from "bar";
      const x = 1;
      import { baz } from "qux";
    `);
    expect(imports.map((i) => i.line)).toEqual([2, 4]);
  });
});

describe("import validation (compiler worker and MCP)", () => {
  it("accepts every module the sandbox provides", () => {
    const code = `import * as React from "react";
import { useState } from "react";
import { Home } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import * as Dialog from "@radix-ui/react-dialog";`;
    expect(rejected(code)).toEqual([]);
  });

  it("rejects internal Luova UI components with a pointer to Radix", () => {
    const { errors } = normalizeImports(
      `import { Button } from "@/components/luova-ui/button";${component}`
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain("@radix-ui/*");
  });

  it("rejects Next.js modules", () => {
    expect(
      rejected(`import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { cookies } from "next/headers";`)
    ).toEqual(["next/link", "next/image", "next/navigation", "next/headers"]);
  });

  it("rejects modules outside the runtime scope and lists what is available", () => {
    const { errors } =
      normalizeImports(`import * as BaseUI from "@base-ui/react";
import { Button } from "@/components/ui/button";
import { useMobile } from "@/hooks/useMobile";${component}`);
    expect(errors.map((e) => e.moduleId)).toEqual([
      "@base-ui/react",
      "@/components/ui/button",
      "@/hooks/useMobile",
    ]);
    expect(errors[0].suggestion).toContain("lucide-react");
    expect(errors[0].suggestion).toContain("@radix-ui/react-*");
  });

  it("ignores type-only imports (stripped before runtime)", () => {
    expect(
      rejected(`import type { VariantProps } from "class-variance-authority";`)
    ).toEqual([]);
  });
});

describe("formatImportErrors", () => {
  it("formats each error with its line and a suggestion", () => {
    const { errors } = normalizeImports(`
import { A } from "@/components/luova-ui/badge";
import { B } from "@/components/luova-ui/button";${component}`);
    const formatted = formatImportErrors(errors);
    expect(formatted).toContain("IMPORT_ERROR");
    expect(formatted).toContain("Line 2");
    expect(formatted).toContain("Line 3");
    expect(formatted).toContain("Suggestion");
    expect(formatImportErrors([])).toBe("");
  });
});
