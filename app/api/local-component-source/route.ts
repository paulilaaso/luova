import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalRequest(request)) return forbiddenResponse();

  const { searchParams } = new URL(request.url);
  const moduleId = searchParams.get("moduleId");

  if (!moduleId?.startsWith("@/") || moduleId.includes("..")) {
    return NextResponse.json({ source: null });
  }

  const relativePath = moduleId.slice(2);
  const candidates = resolveLocalModuleCandidates(relativePath);

  for (const fullPath of candidates) {
    if (existsSync(fullPath)) {
      return NextResponse.json({ source: readFileSync(fullPath, "utf-8") });
    }
  }

  return NextResponse.json({ source: null });
}

function resolveLocalModuleCandidates(relativePath: string) {
  const extensions = [".tsx", ".ts", "/index.tsx", "/index.ts"];

  if (relativePath.startsWith("components/")) {
    return extensions.map((ext) =>
      join(
        process.cwd(),
        "components",
        relativePath.slice("components/".length) + ext
      )
    );
  }

  if (relativePath.startsWith("lib/")) {
    return extensions.map((ext) =>
      join(process.cwd(), "lib", relativePath.slice("lib/".length) + ext)
    );
  }

  if (relativePath.startsWith("utils/")) {
    return extensions.map((ext) =>
      join(process.cwd(), "utils", relativePath.slice("utils/".length) + ext)
    );
  }

  if (relativePath.startsWith("hooks/")) {
    return extensions.map((ext) =>
      join(process.cwd(), "hooks", relativePath.slice("hooks/".length) + ext)
    );
  }

  if (relativePath.startsWith("config/")) {
    return extensions.map((ext) =>
      join(process.cwd(), "config", relativePath.slice("config/".length) + ext)
    );
  }

  return [];
}
