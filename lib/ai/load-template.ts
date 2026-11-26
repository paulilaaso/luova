import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(process.cwd(), "prompts");

export function loadTemplate(
  name: string,
  vars: Record<string, string> = {}
): string {
  let content = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return content;
}
