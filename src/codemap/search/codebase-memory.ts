/** Codebase Memory code, graph, and semantic search lanes. Each printer prints nothing when the backend has no usable answer, so the caller can fall back; the graph and semantic printers also return why, for the caller's fallback line. */

import {
  callCodebaseMemoryTool,
  symbolName,
  withFreshCodebaseMemoryProject,
} from "../codebase-memory/index.js";
import {
  arrayValue,
  nonblankString,
  numberField,
  recordValue,
  stringField,
} from "../json-utils.js";
import { type GraphSearchFilters, type GraphSearchOptions, matchesTextFilter } from "./filters.js";

type CodebaseMemoryRenderOptions = {
  includeTests?: boolean;
};

/** One backend match, parsed from a `search_code` or `search_graph` table row. */
type SearchRow = {
  name: string;
  qualifiedName: string;
  label: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  /** Semantic similarity; ranked graph search reports a BM25 cost instead, which is not shown. */
  score: number | null;
  context: string | null;
};

type SearchRowSelection = {
  allRows: SearchRow[];
  visibleRows: SearchRow[];
};

type SearchTable = {
  rows: SearchRow[];
  hasMore: boolean;
};

const MIN_SEMANTIC_SCORE = 0.5;
const BACKEND_SEARCH_CANDIDATE_LIMIT = 100;
/** Ranked graph search ignores these, and its rows carry no degrees or edges to check them against. */
const STRUCTURAL_GRAPH_FILTERS = [
  ["relationship", "--relationship"],
  ["minDegree", "--min-degree"],
  ["maxDegree", "--max-degree"],
  ["excludeEntryPoints", "--exclude-entry-points"],
] as const satisfies readonly (readonly [keyof GraphSearchFilters, string])[];

function codebaseMemorySearch(
  root: string,
  searchText: string,
  limit: number,
): (SearchTable & { grepMatches: number | null }) | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("search_code", {
      project: project.name,
      pattern: searchText,
      limit,
      context: 1,
    });
    if (!result.ok) {
      return null;
    }
    const record = recordValue(result.value);
    return {
      ...searchTable(record),
      grepMatches: numberField(record.total_grep_matches),
    };
  });
}

function codebaseMemoryGraphSearch(
  root: string,
  searchText: string,
  limit: number,
  options: GraphSearchFilters,
): (SearchTable & { mode: string | null }) | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("search_graph", {
      project: project.name,
      query: searchText,
      ...(options.label !== undefined ? { label: options.label } : {}),
      ...(options.filePattern !== undefined ? { file_pattern: options.filePattern } : {}),
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      limit,
    });
    if (!result.ok) {
      return null;
    }
    const record = recordValue(result.value);
    return { ...searchTable(record), mode: stringField(record.search_mode) };
  });
}

function codebaseMemorySemanticSearch(
  root: string,
  searchText: string,
  limit: number,
): SearchTable | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("search_graph", {
      project: project.name,
      semantic_query: semanticTerms(searchText),
      semantic_limit: limit,
    });
    if (!result.ok) {
      return null;
    }
    const record = recordValue(result.value);
    return {
      rows: searchTable(recordValue(record.semantic)).rows.filter(
        (row) => row.score !== null && row.score >= MIN_SEMANTIC_SCORE,
      ),
      hasMore: record.semantic_has_more === true,
    };
  });
}

function searchTable(record: Record<string, unknown>): SearchTable {
  return {
    rows: arrayValue(record.rows)
      .map(searchRow)
      .filter((row) => row !== null),
    hasMore: record.has_more === true,
  };
}

function searchRow(value: unknown): SearchRow | null {
  const row = recordValue(value);
  const qualifiedName = nonblankString(row.qn);
  if (qualifiedName === null) {
    return null;
  }
  const [startLine, endLine] = lineSpan(row.lines);
  return {
    name: symbolName(qualifiedName),
    qualifiedName,
    label: stringField(row.label),
    filePath: stringField(row.file),
    startLine,
    endLine,
    score: numberField(row.score),
    context: stringField(recordValue(row.context).context),
  };
}

/** Reads the backend's inclusive line range: `"212-219"` → `[212, 219]`; anything else is unknown. */
function lineSpan(value: unknown): [number | null, number | null] {
  const match = typeof value === "string" ? /^(\d+)-(\d+)$/.exec(value) : null;
  return match === null ? [null, null] : [Number(match[1]), Number(match[2])];
}

function semanticTerms(searchText: string): string[] {
  const terms = searchText
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 8);
  return terms.length > 0 ? terms : [searchText];
}

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
  const selection = searchRowSelection(result.rows, options);
  if (selection.visibleRows.length === 0) {
    return false;
  }
  const shown = selection.visibleRows.slice(0, limit);
  const lines = [`results: ${shown.length}`, ...hiddenTestLines(selection)];
  if (result.grepMatches !== null) {
    lines.push(`grep matches: ${result.grepMatches}`);
  }
  appendSearchRows(lines, shown, result.hasMore || selection.visibleRows.length > shown.length);
  console.log("\nCodebase Memory code matches:");
  console.log(lines.join("\n"));
  return true;
}

/** Prints backend graph matches and returns null, or prints nothing and returns why the working-tree graph answers instead. */
export function printCodebaseMemoryGraphSearch(
  root: string,
  searchText: string,
  limit: number,
  options: GraphSearchOptions = {},
): string | null {
  const { includeTests = false, ...filters } = options;
  const structuralFlags = STRUCTURAL_GRAPH_FILTERS.filter(
    ([key]) => filters[key] !== undefined && filters[key] !== false,
  ).map(([, flag]) => flag);
  if (structuralFlags.length > 0) {
    return `Codebase Memory ranked graph search cannot apply ${structuralFlags.join(", ")}`;
  }
  const result = codebaseMemoryGraphSearch(
    root,
    searchText,
    backendFetchLimit(limit, { includeTests }),
    filters,
  );
  if (result === null) {
    return "Codebase Memory is unavailable";
  }
  const selection = searchRowSelection(result.rows, { includeTests });
  const filteredRows = selection.visibleRows.filter(
    (row) =>
      matchesTextFilter(row.name, filters.namePattern) &&
      matchesTextFilter(row.qualifiedName, filters.qnPattern),
  );
  if (filteredRows.length === 0) {
    return noAnswerReason("graph", selection);
  }
  const shown = filteredRows.slice(0, limit);
  const lines = [
    `mode: ${result.mode ?? "graph"}`,
    `results: ${shown.length}`,
    ...hiddenTestLines(selection),
  ];
  const hiddenFilterRows = selection.visibleRows.length - filteredRows.length;
  if (hiddenFilterRows > 0) {
    lines.push(`hidden filtered: ${hiddenFilterRows}`);
  }
  appendSearchRows(lines, shown, result.hasMore || filteredRows.length > shown.length);
  console.log("\nCodebase Memory graph matches:");
  console.log(lines.join("\n"));
  return null;
}

/** Prints backend semantic matches and returns null, or prints nothing and returns why the working-tree search answers instead. */
export function printCodebaseMemorySemanticSearch(
  root: string,
  searchText: string,
  limit: number,
  options: CodebaseMemoryRenderOptions = {},
): string | null {
  const result = codebaseMemorySemanticSearch(root, searchText, backendFetchLimit(limit, options));
  if (result === null) {
    return "Codebase Memory is unavailable";
  }
  const selection = searchRowSelection(result.rows, options);
  if (selection.visibleRows.length === 0) {
    return noAnswerReason("semantic", selection);
  }
  const shown = selection.visibleRows.slice(0, limit);
  const lines = [
    "mode: semantic",
    `semantic results: ${shown.length}`,
    ...hiddenTestLines(selection),
  ];
  appendSearchRows(lines, shown, result.hasMore || selection.visibleRows.length > shown.length);
  console.log("\nCodebase Memory semantic matches:");
  console.log(lines.join("\n"));
  return null;
}

/** Names an answer made only of hidden test rows, since `--include-tests` would show it. */
function noAnswerReason(lane: "graph" | "semantic", selection: SearchRowSelection): string {
  return selection.visibleRows.length === 0 && selection.allRows.length > 0
    ? `Codebase Memory ${lane} search matched only tests, which are hidden (use --include-tests)`
    : `Codebase Memory ${lane} search returned no answer`;
}

function hiddenTestLines(selection: SearchRowSelection): string[] {
  const hiddenRows = selection.allRows.length - selection.visibleRows.length;
  return hiddenRows > 0 ? [`hidden tests: ${hiddenRows} (use --include-tests)`] : [];
}

function appendSearchRows(lines: string[], shown: SearchRow[], hasMore: boolean): void {
  for (const row of shown) {
    lines.push(renderSearchRow(row));
  }
  if (hasMore) {
    lines.push("- ...");
  }
}

function searchRowSelection(
  rows: SearchRow[],
  options: CodebaseMemoryRenderOptions,
): SearchRowSelection {
  return {
    allRows: rows,
    visibleRows: rows.filter((row) => options.includeTests === true || !testLikeSearchRow(row)),
  };
}

function renderSearchRow(row: SearchRow): string {
  const detail = [
    row.filePath !== null
      ? `${row.filePath}${row.startLine !== null ? `:${row.startLine}` : ""}${row.endLine !== null && row.endLine !== row.startLine ? `-${row.endLine}` : ""}`
      : null,
    row.label,
    row.score !== null ? `score=${formatScore(row.score)}` : null,
  ].filter((item) => item !== null);
  const line = `- ${row.name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
  const contextLine = row.context?.trim().split(/\r?\n/).find(Boolean);
  return contextLine === undefined ? line : `${line} — ${contextLine.trim()}`;
}

/** Tests the name, qualified name, and path together: `tests/test_cli.py` and `src/app.spec.ts` count, while `src/latest.ts` does not. */
function testLikeSearchRow(row: SearchRow): boolean {
  const text = [row.name, row.qualifiedName, row.filePath]
    .filter((item) => item !== null)
    .join(" ");
  return (
    /(^|[./_-])(__tests__|tests|specs|e2e|test-support|test_support)([./_-]|$)|(^|[./_-])test_[^/]*|[._-](test|spec|suite)\.[cm]?[jt]sx?$|[._-]test-support[._-]/i.test(
      text,
    ) ||
    // Case-sensitive so camelCase `testParser` counts while words like `testament` do not.
    /(^|[._-])[Tt]est[A-Z_]/.test(text)
  );
}

/** Over-fetches backend rows so default test suppression can still fill the limit. */
function backendFetchLimit(
  limit: number,
  { includeTests = false }: CodebaseMemoryRenderOptions,
): number {
  return includeTests ? limit : Math.max(limit, BACKEND_SEARCH_CANDIDATE_LIMIT);
}

/** Trims three decimals of trailing zeros: `0.5` → `0.5`, `0.123456` → `0.123`, `1` → `1`. */
function formatScore(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
