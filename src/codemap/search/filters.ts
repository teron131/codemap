/** Owns shared text and glob filter semantics for search output paths. */

export type TextFilterOptions = {
  exact?: boolean;
};

/** Applies an exact or regex text filter while treating invalid regexes literally. */
export function matchesTextFilter(
  value: string | null,
  filter: string | undefined,
  { exact = false }: TextFilterOptions = {},
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (value === null) {
    return false;
  }
  if (exact) {
    return value === filter;
  }
  try {
    return new RegExp(filter).test(value);
  } catch {
    return value.includes(filter);
  }
}

/** Applies a small star-glob filter to source file paths. */
export function matchesGlobFilter(value: string | null, filter: string | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  if (value === null) {
    return false;
  }
  return globPatternRegex(filter).test(value);
}

/** Converts a star-glob pattern into a regular expression. */
function globPatternRegex(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}
