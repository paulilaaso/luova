/**
 * Normalises a block of text for fuzzy matching:
 * - Collapses runs of spaces/tabs on each line to a single space
 * - Trims leading/trailing whitespace from each line
 * - Strips blank lines at the start and end of the block
 */
function normalise(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/**
 * Attempts to find `search` inside `source` using progressively looser
 * matching strategies:
 *
 * 1. Exact substring match
 * 2. Normalised (collapsed whitespace) match
 *
 * Returns `{ index, length }` on success, or `null` on failure.
 */
function findBlock(
  source: string,
  search: string
): { index: number; length: number } | null {
  // 1. Exact match
  const exact = source.indexOf(search);
  if (exact !== -1) return { index: exact, length: search.length };

  // 2. Normalised match — rebuild the original slice boundaries after matching
  const normSource = normalise(source);
  const normSearch = normalise(search);
  const normIdx = normSource.indexOf(normSearch);
  if (normIdx === -1) return null;

  // Map the normalised index back to the original source.
  // We walk both strings simultaneously, skipping the whitespace that was
  // collapsed during normalisation.
  let origIdx = 0;
  let normPos = 0;
  while (normPos < normIdx && origIdx < source.length) {
    const origChar = source[origIdx];
    const normChar = normSource[normPos];
    if (origChar === normChar) {
      origIdx++;
      normPos++;
    } else {
      // Original has extra whitespace that was collapsed — skip it
      origIdx++;
    }
  }
  const startOrig = origIdx;

  // Now find the end of the matched region in the original source
  const normEnd = normIdx + normSearch.length;
  normPos = normIdx;
  while (normPos < normEnd && origIdx < source.length) {
    const origChar = source[origIdx];
    const normChar = normSource[normPos];
    if (origChar === normChar) {
      origIdx++;
      normPos++;
    } else {
      origIdx++;
    }
  }

  return { index: startOrig, length: origIdx - startOrig };
}

/**
 * Detects whether a string contains Search/Replace diff markers.
 */
export function isSearchReplaceDiff(code: string): boolean {
  return code.includes("<<<< SEARCH") || code.includes("<<<<<<< SEARCH");
}

/**
 * Parses and applies one or more Search/Replace diff blocks to `sourceCode`.
 *
 * Supported marker formats (both are accepted):
 *   <<<< SEARCH          or   <<<<<<< SEARCH
 *   ====                 or   =======
 *   >>>> REPLACE         or   >>>>>>> REPLACE
 *
 * Multiple blocks are applied sequentially in the order they appear.
 *
 * **THROWS on any error** — this is intentional. If a SEARCH block cannot be found,
 * the server will throw an error, which the AI SDK uses to force the LLM to retry.
 * This enables self-correction for models like OpenRouter that may hallucinate
 * search strings.
 *
 * If no diff markers are detected at all, the input is returned unchanged so
 * callers can decide whether to treat it as a full rewrite.
 */
export function applyCodeDiff(sourceCode: string, diffContent: string): string {
  if (!isSearchReplaceDiff(diffContent)) {
    // No markers — return input unchanged
    return diffContent;
  }

  // Normalise marker variants: <<<<<<< → <<<<, >>>>>>> → >>>>
  const normalised = diffContent
    .replace(/^<{5,}\s*SEARCH\s*$/gm, "<<<< SEARCH")
    .replace(/^={4,}\s*$/gm, "====")
    .replace(/^>{5,}\s*REPLACE\s*$/gm, ">>>> REPLACE");

  // Split on the opening marker to get individual blocks
  const rawBlocks = normalised.split(/^<<<< SEARCH\s*$/m).slice(1);

  let result = sourceCode;

  for (const rawBlock of rawBlocks) {
    const sepIdx = rawBlock.search(/^====\s*$/m);
    if (sepIdx === -1) {
      throw new Error(
        'Malformed diff block: missing "====" separator. Check that your SEARCH/REPLACE markers are on separate lines.'
      );
    }

    const endIdx = rawBlock.search(/^>>>> REPLACE\s*$/m);
    if (endIdx === -1) {
      throw new Error(
        'Malformed diff block: missing ">>>> REPLACE" marker. Check that your diff block is properly closed.'
      );
    }

    const searchText = rawBlock
      .slice(0, sepIdx)
      .replace(/^\n/, "")
      .replace(/\n$/, "");
    const replaceText = rawBlock
      .slice(sepIdx + rawBlock.match(/^====\s*$/m)![0].length, endIdx)
      .replace(/^\n/, "")
      .replace(/\n$/, "");

    const found = findBlock(result, searchText);
    if (!found) {
      const preview = searchText.slice(0, 100).trim();
      throw new Error(
        `Could not find the SEARCH block in the code. Searched for (first 100 chars): "${preview}"\n\nMake sure the search block matches the existing code exactly, including all whitespace and indentation.`
      );
    }

    result =
      result.slice(0, found.index) +
      replaceText +
      result.slice(found.index + found.length);
  }

  return result;
}

/**
 * Applies an array of JSON edits to the source code.
 * Each edit contains a `search` string and a `replace` string.
 *
 * Uses `findBlock` for fuzzy matching with whitespace tolerance.
 * If any search block cannot be found, throws an error with context.
 *
 * Edits are applied sequentially in order.
 */
export function applyJsonEdits(
  sourceCode: string,
  edits: Array<{ search: string; replace: string }>
): string {
  let result = sourceCode;

  for (const edit of edits) {
    const found = findBlock(result, edit.search);
    if (!found) {
      const preview = edit.search.slice(0, 50);
      throw new Error(
        `Could not find search block in code. First 50 chars: "${preview}"`
      );
    }

    result =
      result.slice(0, found.index) +
      edit.replace +
      result.slice(found.index + found.length);
  }

  return result;
}

export function cleanLLMOutput(code: string): string {
  let cleaned = code.trim();

  cleaned = cleaned
    .replace(/^```(?:tsx?|jsx?|react)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  if (/^n(import|export|const|function|"use client")/.test(cleaned)) {
    cleaned = cleaned.substring(1).trim();
  }

  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    const internal = cleaned.substring(1, cleaned.length - 1).trim();
    if (/(?:import|export|function|const|React|"use client")/.test(internal)) {
      cleaned = internal;
    }
  }

  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (
        typeof parsed === "string" &&
        /(?:import|export|function|const|React|"use client")/.test(parsed)
      ) {
        return parsed.trim();
      }
    } catch {
      // Fallback to raw text
    }
  }

  if (
    !cleaned.includes("\n") &&
    (cleaned.includes('\\"') || cleaned.includes("\\n"))
  ) {
    try {
      const parsed = JSON.parse(`"${cleaned}"`);
      if (
        typeof parsed === "string" &&
        /(?:import|export|function|const|React|"use client")/.test(parsed)
      ) {
        return parsed.trim();
      }
    } catch {
      // Fallback to raw text
    }
  }

  return cleaned;
}
