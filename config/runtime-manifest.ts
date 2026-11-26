import { RUNTIME_SCOPE } from "./runtime-scope";

const REGISTERED_MODULE_IDS = Object.keys(RUNTIME_SCOPE);

export interface RuntimeManifestEntry {
  moduleId: string;
  support: "full" | "disabled";
  notes?: string;
}

/** Modules that are always blocked in the sandbox, regardless of config. */
const BLOCKED_MODULES: RuntimeManifestEntry[] = [
  {
    moduleId: "@/components/luova-ui/*",
    support: "disabled",
    notes:
      "Internal Luova UI components are not available in the sandbox. Use @radix-ui/* primitives or plain HTML instead.",
  },
  {
    moduleId: "next/link",
    support: "disabled",
    notes: "Next.js modules are not available in the sandbox.",
  },
  {
    moduleId: "next/image",
    support: "disabled",
    notes: "Use a standard <img> tag instead.",
  },
  {
    moduleId: "next/navigation",
    support: "disabled",
    notes: "Router context is not available in the sandbox.",
  },
];

/** Dynamically built from the static scope + block-list. */
export const RUNTIME_MANIFEST: RuntimeManifestEntry[] = [
  ...REGISTERED_MODULE_IDS.map((moduleId) => ({
    moduleId,
    support: "full" as const,
  })),
  ...BLOCKED_MODULES,
];

export function buildManifestIndex() {
  const byId = new Map<string, RuntimeManifestEntry>();
  const supported = new Set<string>();
  const disabled = new Set<string>();

  for (const entry of RUNTIME_MANIFEST) {
    byId.set(entry.moduleId, entry);
    if (entry.support === "disabled") {
      disabled.add(entry.moduleId);
    } else {
      supported.add(entry.moduleId);
    }
  }

  return { byId, supported, disabled };
}

export const MANIFEST_INDEX = buildManifestIndex();

export function validateImport(
  moduleId?: string,
  _importStyle?: string
): { ok: boolean; reason?: string } {
  if (!moduleId) return { ok: true };

  if (MANIFEST_INDEX.disabled.has(moduleId)) {
    const entry = MANIFEST_INDEX.byId.get(moduleId);
    return {
      ok: false,
      reason:
        entry?.notes ?? `Module "${moduleId}" is disabled in the sandbox.`,
    };
  }

  if (moduleId.startsWith("@/components/luova-ui/")) {
    return {
      ok: false,
      reason:
        "Internal Luova UI components are not available in the sandbox. Use @radix-ui/* primitives or plain HTML instead.",
    };
  }

  if (moduleId.startsWith("next/")) {
    return {
      ok: false,
      reason: `Next.js module "${moduleId}" is not available in the sandbox.`,
    };
  }

  // Allowlist: anything outside RUNTIME_SCOPE resolves to an empty module at
  // runtime and crashes on render, so reject it here with a clear reason.
  if (!MANIFEST_INDEX.supported.has(moduleId)) {
    return {
      ok: false,
      reason: `Module "${moduleId}" is not available in the sandbox.`,
    };
  }

  return { ok: true };
}
