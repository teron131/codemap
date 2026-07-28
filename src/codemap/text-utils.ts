/**
 * Provides shared text ordering, escaping, and deduplication primitives.
 *
 * Rendered output is compared across runs, so ordering must stay stable and locale-independent: `compareText` uses plain code-unit comparison rather than `localeCompare`, which varies by ICU data.
 *
 * `escapeRegExp` escapes every regular-expression metacharacter and is therefore wrong for glob compilation, where `*` and `[...]` must survive to be translated; see the scanner's own glob-literal escaper for that case.
 */

/** Sorts text values with stable lexical ordering. */
export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Escapes text for literal use inside regular expressions. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes duplicate values while preserving first-seen order. */
export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}
