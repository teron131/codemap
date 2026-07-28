/** Owns Codebase Memory search filtering, fallback eligibility, and CLI rendering. */

import {
  callCodebaseMemoryTool,
  withFreshCodebaseMemoryProject,
} from "../codebase-memory/client.js";
import { arrayValue, numberField, recordValue, stringField } from "../json-utils.js";
import { uniqueStrings } from "../text-utils.js";
import { matchesGlobFilter, matchesTextFilter } from "./filters.js";

type CodebaseMemoryRenderOptions = {
  includeTests?: boolean;
};

export type CodebaseMemoryGraphSearchOptions = CodebaseMemoryRenderOptions & {
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

type CodebaseMemoryGraphRenderOptions = CodebaseMemoryRenderOptions &
  Pick<
    CodebaseMemoryGraphSearchOptions,
    | "excludeEntryPoints"
    | "filePattern"
    | "label"
    | "maxDegree"
    | "minDegree"
    | "namePattern"
    | "qnPattern"
    | "relationship"
  >;

const MIN_SEMANTIC_SCORE = 0.2;
const BACKEND_SEARCH_CANDIDATE_LIMIT = 100;
const JSON_FORMAT = { format: "json" } as const;

/** Reads graph-augmented backend source search results when available. */
function codebaseMemorySearch(root: string, searchText: string, limit: number): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("search_code", {
      project: project.name,
      pattern: searchText,
      limit,
      context: 1,
      ...JSON_FORMAT,
    });
    if (!result.ok || !hasSearchAnswer(result.value, ["results", "raw_matches"])) {
      return null;
    }
    return result.value;
  });
}

/** Reads backend graph search results when available. */
function codebaseMemoryGraphSearch(
  root: string,
  searchText: string,
  limit: number,
  options: CodebaseMemoryGraphSearchOptions = {},
): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("search_graph", {
      project: project.name,
      query: searchText,
      ...graphSearchArgs(options),
      limit,
      include_connected: true,
      ...JSON_FORMAT,
    });
    if (
      !result.ok ||
      !hasSearchAnswer(result.value, ["results", "semantic_results", "raw_matches"])
    ) {
      return null;
    }
    return result.value;
  });
}

/** Reads backend semantic graph search results when available. */
function codebaseMemorySemanticSearch(
  root: string,
  searchText: string,
  limit: number,
): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("search_graph", {
      project: project.name,
      semantic_query: semanticTerms(searchText),
      limit,
      include_connected: true,
      ...JSON_FORMAT,
    });
    if (!result.ok) {
      return null;
    }
    const payload = semanticSearchPayload(result.value);
    return hasSearchAnswer(payload, ["semantic_results"]) ? payload : null;
  });
}

/** Checks common backend search payload fields for no-answer responses. */
function hasSearchAnswer(value: unknown, arrayKeys: string[]): boolean {
  const record = recordValue(value);
  return arrayKeys.some((key) => arrayValue(record[key]).length > 0);
}

/** Converts search filters into Codebase Memory search_graph arguments. */
function graphSearchArgs(options: CodebaseMemoryGraphSearchOptions): Record<string, unknown> {
  return {
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.namePattern !== undefined ? { name_pattern: options.namePattern } : {}),
    ...(options.qnPattern !== undefined ? { qn_pattern: options.qnPattern } : {}),
    ...(options.filePattern !== undefined ? { file_pattern: options.filePattern } : {}),
    ...(options.relationship !== undefined ? { relationship: options.relationship } : {}),
    ...(options.minDegree !== undefined ? { min_degree: options.minDegree } : {}),
    ...(options.maxDegree !== undefined ? { max_degree: options.maxDegree } : {}),
    ...(options.excludeEntryPoints !== undefined
      ? { exclude_entry_points: options.excludeEntryPoints }
      : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
  };
}

/** Keeps only semantic rows whose score clears the useful-signal floor. */
function semanticSearchPayload(value: unknown): Record<string, unknown> {
  const record = recordValue(value);
  const semanticResults = arrayValue(record.semantic_results).filter((item) => {
    const score = numberField(recordValue(item).score);
    return score !== null && score >= MIN_SEMANTIC_SCORE;
  });
  return {
    search_mode: "semantic",
    semantic_results: semanticResults,
    has_more: typeof record.semantic_has_more === "boolean" ? record.semantic_has_more : false,
  };
}

/** Splits user search text into a bounded semantic keyword array. */
function semanticTerms(searchText: string): string[] {
  const terms = searchText
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 8);
  return terms.length > 0 ? terms : [searchText];
}

/** Prints graph-augmented CodebaseMemory source search results when available. */
export function printCodebaseMemorySearch(
  root: string,
  searchText: string,
  limit: number,
  options: CodebaseMemoryRenderOptions = {},
): boolean {
  const result = codebaseMemorySearch(root, searchText, backendFetchLimit(limit, options));
  if (result === null) {
    return false;
  }
  if (searchRowSelection(recordValue(result).results, options).visibleRows.length === 0) {
    return false;
  }
  console.log("\nCodebaseMemory code matches:");
  console.log(renderCodebaseMemoryCodeSearch(result, { limit, ...options }));
  return true;
}

/** Prints CodebaseMemory graph search results for relationship-oriented search when available. */
export function printCodebaseMemoryGraphSearch(
  root: string,
  searchText: string,
  limit: number,
  options: CodebaseMemoryGraphSearchOptions = {},
): boolean {
  const { includeTests = false, ...backendOptions } = options;
  const result = codebaseMemoryGraphSearch(
    root,
    searchText,
    backendFetchLimit(limit, { includeTests }),
    backendOptions,
  );
  if (result === null) {
    return false;
  }
  if (!hasVisibleGraphSearchRows(result, { includeTests, ...backendOptions })) {
    return false;
  }
  console.log("\nCodebaseMemory graph matches:");
  console.log(
    renderCodebaseMemoryGraphSearch(result, {
      limit,
      includeTests,
      ...backendOptions,
    }),
  );
  return true;
}

/** Prints CodebaseMemory semantic graph matches for semantic search when available. */
export function printCodebaseMemorySemanticSearch(
  root: string,
  searchText: string,
  limit: number,
  options: CodebaseMemoryRenderOptions = {},
): boolean {
  const result = codebaseMemorySemanticSearch(root, searchText, backendFetchLimit(limit, options));
  if (result === null) {
    return false;
  }
  if (searchRowSelection(recordValue(result).semantic_results, options).visibleRows.length === 0) {
    return false;
  }
  console.log("\nCodebaseMemory semantic matches:");
  console.log(renderCodebaseMemorySemanticSearch(result, { limit, ...options }));
  return true;
}

/** Renders compact CodebaseMemory search_code rows. */
function renderCodebaseMemoryCodeSearch(
  value: unknown,
  {
    includeTests = false,
    limit,
  }: CodebaseMemoryRenderOptions & {
    limit: number;
  },
): string {
  const record = recordValue(value);
  const {
    allRows,
    testFilteredRows,
    visibleRows: filteredRows,
  } = searchRowSelection(record.results, { includeTests });
  const rows = filteredRows.slice(0, limit);
  const hiddenRows = includeTests ? 0 : allRows.length - testFilteredRows.length;
  const visibleRows = filteredRows.length;
  const grepTotal = numberField(record.total_grep_matches);
  const lines = [`results: ${rows.length}`];
  if (hiddenRows > 0) {
    lines.push(`hidden tests: ${hiddenRows} (use --include-tests)`);
  }
  if (grepTotal !== null) {
    lines.push(`grep matches: ${grepTotal}`);
  }
  if (rows.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }
  for (const item of rows) {
    lines.push(...renderSearchRow(item));
  }
  if (visibleRows > rows.length) {
    lines.push("- ...");
  }
  return lines.join("\n");
}

/** Renders compact CodebaseMemory search_graph rows. */
function renderCodebaseMemoryGraphSearch(
  value: unknown,
  options: CodebaseMemoryGraphRenderOptions & { limit: number },
): string {
  const { includeTests = false, limit } = options;
  const record = recordValue(value);
  const { allRows, testFilteredRows, filteredRows } = graphSearchRows(value, options);
  const rows = filteredRows.slice(0, limit);
  const hiddenTestRows = includeTests ? 0 : allRows.length - testFilteredRows.length;
  const hiddenFilterRows = testFilteredRows.length - filteredRows.length;
  const lines = [`mode: ${stringField(record.search_mode) ?? "graph"}`, `results: ${rows.length}`];
  if (hiddenTestRows > 0) {
    lines.push(`hidden tests: ${hiddenTestRows} (use --include-tests)`);
  }
  if (hiddenFilterRows > 0) {
    lines.push(`hidden filtered: ${hiddenFilterRows}`);
  }
  if (rows.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }
  for (const item of rows) {
    lines.push(...renderSearchRow(item));
  }
  if (record.has_more) {
    lines.push("- ...");
  } else if (filteredRows.length > rows.length) {
    lines.push("- ...");
  }
  return lines.join("\n");
}

/** Returns whether graph search has rows visible after CLI-side filters. */
function hasVisibleGraphSearchRows(
  value: unknown,
  options: CodebaseMemoryGraphRenderOptions,
): boolean {
  return graphSearchRows(value, options).filteredRows.length > 0;
}

/** Applies test and graph filters to backend graph search rows. */
function graphSearchRows(
  value: unknown,
  options: CodebaseMemoryGraphRenderOptions,
): {
  allRows: unknown[];
  testFilteredRows: unknown[];
  filteredRows: unknown[];
} {
  const { allRows, testFilteredRows, visibleRows } = searchRowSelection(
    recordValue(value).results,
    options,
  );
  const filteredRows = visibleRows.filter((row) => graphSearchRowMatches(row, options));
  return { allRows, testFilteredRows, filteredRows };
}

/** Checks output-side graph filters when the backend returns broader rows. */
function graphSearchRowMatches(value: unknown, options: CodebaseMemoryGraphRenderOptions): boolean {
  const row = recordValue(value);
  const nested = recordValue(row.node);
  const label = stringField(row.label) ?? stringField(nested.label);
  const name = searchRowName(value);
  const qualifiedName = stringField(row.qualified_name) ?? stringField(nested.qualified_name);
  const filePath =
    stringField(row.file) ?? stringField(row.file_path) ?? stringField(nested.file_path);
  const degree = graphSearchRowDegree(row, nested);
  return (
    matchesTextFilter(label, options.label, { exact: true }) &&
    matchesTextFilter(name, options.namePattern, { exact: false }) &&
    matchesTextFilter(qualifiedName, options.qnPattern, { exact: false }) &&
    matchesGlobFilter(filePath, options.filePattern) &&
    graphSearchRowMatchesRelationship(row, nested, options.relationship) &&
    (options.minDegree === undefined || degree >= options.minDegree) &&
    (options.maxDegree === undefined || degree <= options.maxDegree) &&
    (options.excludeEntryPoints !== true || !graphSearchRowIsEntryPoint(row, nested))
  );
}

/** Reads a best-effort graph degree from common backend row shapes. */
function graphSearchRowDegree(
  row: Record<string, unknown>,
  nested: Record<string, unknown>,
): number {
  return (
    numberField(row.degree) ??
    numberField(nested.degree) ??
    sumDegreeFields(row) ??
    sumDegreeFields(nested) ??
    graphSearchRelationshipRows(row, nested).length
  );
}

/** Reads in/out graph degree fields when the backend exposes them separately. */
function sumDegreeFields(row: Record<string, unknown>): number | null {
  const inDegree = numberField(row.in_degree);
  const outDegree = numberField(row.out_degree);
  if (inDegree === null && outDegree === null) {
    return null;
  }
  return (inDegree ?? 0) + (outDegree ?? 0);
}

/** Checks backend graph rows against a requested relationship type. */
function graphSearchRowMatchesRelationship(
  row: Record<string, unknown>,
  nested: Record<string, unknown>,
  relationship: string | undefined,
): boolean {
  if (relationship === undefined) {
    return true;
  }
  return graphSearchRelationshipRows(row, nested).some((candidate) => candidate === relationship);
}

/** Extracts relationship labels from node, edge, and nested backend payload shapes. */
function graphSearchRelationshipRows(
  row: Record<string, unknown>,
  nested: Record<string, unknown>,
): string[] {
  const direct = [
    stringField(row.relationship),
    stringField(row.relationship_type),
    stringField(row.edge_type),
    stringField(nested.relationship),
    stringField(nested.relationship_type),
    stringField(nested.edge_type),
  ];
  const relatedRows = [
    ...arrayValue(row.relationships),
    ...arrayValue(row.edges),
    ...arrayValue(row.connected_edges),
    ...arrayValue(nested.relationships),
    ...arrayValue(nested.edges),
  ];
  return uniqueStrings(
    [...direct, ...relatedRows.flatMap(relationshipNames)].filter(
      (item): item is string => item !== null,
    ),
  );
}

/** Reads relationship names from one backend edge-like value. */
function relationshipNames(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  const record = recordValue(value);
  return [
    stringField(record.relationship),
    stringField(record.relationship_type),
    stringField(record.edge_type),
    stringField(record.type),
  ].filter((item): item is string => item !== null);
}

/** Detects entrypoint-tagged backend rows for output-side filtering. */
function graphSearchRowIsEntryPoint(
  row: Record<string, unknown>,
  nested: Record<string, unknown>,
): boolean {
  const textFields = [
    stringField(row.label),
    stringField(row.kind),
    stringField(row.type),
    stringField(nested.label),
    stringField(nested.kind),
    stringField(nested.type),
    ...arrayValue(row.tags).filter((item): item is string => typeof item === "string"),
    ...arrayValue(nested.tags).filter((item): item is string => typeof item === "string"),
  ].filter((item): item is string => item !== null);
  return textFields.some((item) => item.toLowerCase().startsWith("entry"));
}

/** Selects policy-visible, renderable backend search rows. */
function searchRowSelection(
  value: unknown,
  options: CodebaseMemoryRenderOptions,
): {
  allRows: unknown[];
  testFilteredRows: unknown[];
  visibleRows: unknown[];
} {
  const allRows = arrayValue(value);
  const testFilteredRows = allRows.filter(
    (item) => options.includeTests === true || !testLikeSearchRow(item),
  );
  const visibleRows = testFilteredRows.filter((item) => searchRowName(item) !== null);
  return { allRows, testFilteredRows, visibleRows };
}

/** Reads the display identity shared by backend search row shapes. */
function searchRowName(value: unknown): string | null {
  const row = recordValue(value);
  const nested = recordValue(row.node);
  return (
    stringField(row.name) ??
    stringField(row.node) ??
    stringField(nested.name) ??
    stringField(row.qualified_name) ??
    stringField(nested.qualified_name)
  );
}

/** Renders one backend search row without internal graph identifiers. */
function renderSearchRow(value: unknown): string[] {
  const row = recordValue(value);
  const nested = recordValue(row.node);
  const name = searchRowName(value);
  if (name === null) {
    return [];
  }
  const filePath =
    stringField(row.file) ?? stringField(row.file_path) ?? stringField(nested.file_path);
  const startLine = numberField(row.start_line) ?? numberField(nested.start_line);
  const endLine = numberField(row.end_line) ?? numberField(nested.end_line);
  const score =
    nonNegativeNumberField(row.rerank_score) ??
    nonNegativeNumberField(row.score) ??
    nonNegativeNonOrdinalRank(row.rank);
  const label = stringField(row.label) ?? stringField(nested.label);
  const detail = [
    filePath !== null
      ? `${filePath}${startLine !== null ? `:${startLine}` : ""}${endLine !== null && endLine !== startLine ? `-${endLine}` : ""}`
      : null,
    label,
    score !== null ? `score=${formatScore(score)}` : null,
  ].filter((item) => item !== null);
  let line = `- ${name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
  const context = stringField(row.context);
  if (context !== null) {
    const contextLine = context.trim().split(/\r?\n/).find(Boolean);
    if (contextLine !== undefined) {
      line += ` — ${contextLine.trim()}`;
    }
  }
  return [line];
}

/** Detects likely test rows in common Codebase Memory search payload shapes. */
function testLikeSearchRow(value: unknown): boolean {
  const row = recordValue(value);
  const nested = recordValue(row.node);
  const text = [
    stringField(row.name),
    stringField(row.node),
    stringField(row.qualified_name),
    stringField(row.file),
    stringField(row.file_path),
    stringField(nested.name),
    stringField(nested.qualified_name),
    stringField(nested.file_path),
  ]
    .filter((item) => item !== null)
    .join(" ");
  return /(^|[./_-])(__tests__|tests|specs|e2e|test-support|test_support)([./_-]|$)|(^|[./_-])test_[^/]*|[._-](test|spec|suite)\.[cm]?[jt]sx?$|[._-]test-support[._-]|(^|[._-])test[A-Z_]/i.test(
    text,
  );
}

/** Over-fetches backend rows so default test suppression can still fill the limit. */
function backendFetchLimit(
  limit: number,
  { includeTests = false }: CodebaseMemoryRenderOptions,
): number {
  return includeTests ? limit : Math.max(limit, BACKEND_SEARCH_CANDIDATE_LIMIT);
}

/** Renders CodebaseMemory semantic graph search rows. */
function renderCodebaseMemorySemanticSearch(
  value: unknown,
  {
    includeTests = false,
    limit,
  }: CodebaseMemoryRenderOptions & {
    limit: number;
  },
): string {
  const record = recordValue(value);
  const {
    allRows,
    testFilteredRows,
    visibleRows: filteredRows,
  } = searchRowSelection(record.semantic_results, { includeTests });
  const rows = filteredRows.slice(0, limit);
  const hiddenRows = includeTests ? 0 : allRows.length - testFilteredRows.length;
  const visibleRows = filteredRows.length;
  const lines = [
    `mode: ${stringField(record.search_mode) ?? "semantic"}`,
    `semantic results: ${rows.length}`,
  ];
  if (hiddenRows > 0) {
    lines.push(`hidden tests: ${hiddenRows} (use --include-tests)`);
  }
  if (rows.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }
  for (const item of rows) {
    lines.push(...renderSearchRow(item));
  }
  if (record.has_more) {
    lines.push("- ...");
  } else if (visibleRows > rows.length) {
    lines.push("- ...");
  }
  return lines.join("\n");
}

/** Formats backend confidence scores without noisy floating-point tails. */
function formatScore(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Reads a nonnegative numeric score while rejecting backend cost/rank values. */
function nonNegativeNumberField(value: unknown): number | null {
  const parsed = numberField(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/** Reads score-like rank fields without treating ordinal ranks as confidence scores. */
function nonNegativeNonOrdinalRank(value: unknown): number | null {
  const parsed = nonNegativeNumberField(value);
  return parsed !== null && (!Number.isInteger(parsed) || parsed <= 0) ? parsed : null;
}
