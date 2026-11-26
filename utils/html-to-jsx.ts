/**
 * Helpers for extracting and wrapping the inner JSX of a component's code.
 *
 * Rich-text (de)serialization now lives in `utils/rich-text.ts` and uses the
 * DOM as the parser. The previous regex-based HTML<->JSX converters
 * (`htmlToTailwindJsx` / `tailwindJsxToHtml`) were removed in favour of that
 * DOM-based pipeline.
 */

/**
 * Extracts the inner JSX from a component's code string.
 * Assumes the standard structure: export default function ... { return ( ... ); }
 */
export function extractInnerJsx(code: string): string {
  const match = code.match(/return\s*\(\s*<div[^>]*>([\s\S]*)<\/div>\s*\);/);
  if (match) {
    return match[1].trim();
  }
  return code;
}

/**
 * Wraps inner JSX back into a component's code string.
 */
export function wrapInnerJsx(code: string, innerJsx: string): string {
  // Extract the outer part (everything before the inner JSX and everything after)
  const regex = /(return\s*\(\s*<div[^>]*>)([\s\S]*)(<\/div>\s*\);)/;
  const match = code.match(regex);

  if (match) {
    const [_, before, __, after] = match;
    // A replacement callback keeps literal text such as "$&" and "$'" from
    // being interpreted as String.replace substitution tokens.
    return code.replace(
      regex,
      () => `${before}\n      ${innerJsx}\n    ${after}`
    );
  }

  return code;
}
