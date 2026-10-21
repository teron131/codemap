/** Deterministic text ordering and small string-collection helpers shared by every renderer. */

/** Compares UTF-16 code units rather than using `localeCompare`, whose ICU-dependent order would let rendered output differ between machines. */
export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

/** Keeps the first, middle, and last of already sorted values, as in `[a, b, c, d, e]` → `[a, c, e]`; three or fewer pass through. */
export function extentSamples(values: string[]): string[] {
  if (values.length <= 3) {
    return values;
  }
  return uniqueStrings([
    values[0] ?? "",
    values[Math.floor((values.length - 1) / 2)] ?? "",
    values.at(-1) ?? "",
  ]).filter(Boolean);
}
