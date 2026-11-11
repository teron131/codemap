/** The `--graph` filter set and the text and glob matching both graph lanes apply to it. */

/** Filters the backend graph lane and its working-tree fallback both honor. */
export type GraphSearchFilters = {
  label?: string;
  namePattern?: string;
  qnPattern?: string;
  filePattern?: string;
  relationship?: string;
  minDegree?: number;
  maxDegree?: number;
  excludeEntryPoints?: boolean;
  offset?: number;
};

export type GraphSearchOptions = GraphSearchFilters & { includeTests?: boolean };

const GRAPH_FILTER_KEYS = [
  "label",
  "namePattern",
  "qnPattern",
  "filePattern",
  "relationship",
  "minDegree",
  "maxDegree",
  "excludeEntryPoints",
  "offset",
] as const satisfies readonly (keyof GraphSearchFilters)[];

/** An unset flag and an explicit `false` both count as no filter. */
export function hasGraphFilters(filters: GraphSearchFilters): boolean {
  return GRAPH_FILTER_KEYS.some((key) => filters[key] !== undefined && filters[key] !== false);
}

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

/** Only `*` is special and it also crosses `/`, so `src/*.ts` matches `src/a/b.ts`; the pattern must cover the whole path. */
export function matchesGlobFilter(value: string | null, filter: string | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  if (value === null) {
    return false;
  }
  return globPatternRegex(filter).test(value);
}

function globPatternRegex(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}
