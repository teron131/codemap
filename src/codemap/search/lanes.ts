/** Orders the `search` lanes so direct paths and definitions answer first, and prints the first lane with an answer. */
import { DETAILED_ANALYSIS_FILE_LIMIT, workingTreeGraph } from "../source/graph/index.js";
import { discoverFiles } from "../source/scanner/index.js";
import {
  printCodebaseMemoryGraphSearch,
  printCodebaseMemorySearch,
  printCodebaseMemorySemanticSearch,
} from "./codebase-memory.js";
import type { GraphSearchFilters } from "./filters.js";
import { graphMatchLines } from "./graph.js";
import {
  conceptPathMatches,
  definitionMatches,
  isImplementationSourceMatch,
  isImplementationSourcePath,
  pathMatches,
  type SourceMatch,
  textMatches,
} from "./source.js";
import { type TermCoverageSearch, termCoverageSearch } from "./term-coverage.js";

export type SearchRequest = {
  lane: "source" | "graph" | "semantic";
  limit: number;
  includeTests: boolean;
  /** Read only by the graph lane. */
  graphFilters: GraphSearchFilters;
};

type WorkingTreeSearch = {
  termCoverage: TermCoverageSearch | undefined;
  matches: SourceMatch[];
  preferTermCoverage: boolean;
  largeRepo: boolean;
};

const EXACT_SOURCE_MATCH_LIMIT = 3;

/**
 * Within the requested lane, steps run in order and the first with an answer prints it and returns.
 * - `semantic`: an exact working-tree definition, then backend semantic ranking, then the working-tree search labeled as a fallback.
 * - `graph`: the backend graph, then the working-tree relationship graph.
 * - `source`: direct paths, exact definitions, a decisive term-coverage answer, up to three exact implementation-text matches for multi-term queries, backend code search, then the working-tree search reusing the term-coverage scan.
 */
export function printSearch(root: string, searchText: string, request: SearchRequest): void {
  const { lane, limit, includeTests } = request;
  if (lane === "graph") {
    const options = { ...request.graphFilters, includeTests };
    if (printCodebaseMemoryGraphSearch(root, searchText, limit, options)) {
      return;
    }
    const graph = workingTreeGraph(root);
    console.log(
      "\nGraph fallback: Codebase Memory graph search returned no answer; used working-tree relationship graph.",
    );
    console.log(graphMatchLines(graph, searchText, limit, options).join("\n"));
    return;
  }
  if (lane === "semantic") {
    const definitions = definitionMatches(root, searchText, { includeTests, limit });
    if (definitions.length > 0) {
      printSourceMatches(definitions, {
        note: "Exact working-tree definition found; skipped backend semantic search.",
      });
      return;
    }
    if (printCodebaseMemorySemanticSearch(root, searchText, limit, { includeTests })) {
      return;
    }
    printWorkingTreeSearch(workingTreeSearch(root, searchText, limit, includeTests, undefined));
    console.log("\nSemantic graph matches:");
    console.log(
      "  unavailable: Codebase Memory semantic search returned no answer; used working-tree search fallback.",
    );
    return;
  }
  const paths = pathMatches(root, searchText, { limit });
  if (paths.length > 0) {
    printSourceMatches(paths);
    return;
  }
  const definitions = definitionMatches(root, searchText, { includeTests, limit });
  if (definitions.length > 0) {
    printSourceMatches(definitions);
    return;
  }
  const preflight = termCoverageSearch(root, searchText, { includeTests, limit });
  if (preflight.fullCoverage) {
    printTermCoverage(preflight);
    return;
  }
  if (preflight.queryTerms.length >= 2 && !preflight.hasPathSupplementedCoverage) {
    const exactText = textMatches(root, searchText, {
      includeTests,
      limit: Math.min(limit, EXACT_SOURCE_MATCH_LIMIT),
    }).filter(isImplementationSourceMatch);
    if (exactText.length > 0) {
      printSourceMatches(exactText);
      return;
    }
  }
  if (printCodebaseMemorySearch(root, searchText, limit, { includeTests })) {
    return;
  }
  printWorkingTreeSearch(workingTreeSearch(root, searchText, limit, includeTests, preflight));
}

/** Reuses the source lane's term-coverage preflight when one ran, so that scan happens at most once. */
function workingTreeSearch(
  root: string,
  searchText: string,
  limit: number,
  includeTests: boolean,
  preflight: TermCoverageSearch | undefined,
): WorkingTreeSearch {
  const filePaths = discoverFiles(root);
  const largeRepo = filePaths.length > DETAILED_ANALYSIS_FILE_LIMIT;
  const conceptPaths = conceptPathMatches(root, searchText, {
    filePaths,
    includeTests,
    limit: Math.min(3, limit),
  });
  const exactText = textMatches(root, searchText, {
    includeTests,
    limit: limit - conceptPaths.length,
  });
  const matches = [...conceptPaths, ...exactText];
  const directUseful = matches.some(
    (match) => match.engine === "path" || isImplementationSourceMatch(match),
  );
  const preservePathEvidence = preflight?.hasPathSupplementedCoverage ?? false;
  const termCoverage =
    directUseful && !preservePathEvidence
      ? undefined
      : (preflight ??
        termCoverageSearch(root, searchText, {
          includeTests,
          limit,
        }));
  const coverageUseful =
    termCoverage?.candidates.some((candidate) => isImplementationSourcePath(candidate.filePath)) ??
    false;
  return {
    termCoverage,
    matches,
    preferTermCoverage: coverageUseful || matches.length === 0,
    largeRepo,
  };
}

function printWorkingTreeSearch(result: WorkingTreeSearch): void {
  const notes = [];
  if (result.largeRepo) {
    notes.push(
      result.preferTermCoverage && (result.termCoverage?.candidates.length ?? 0) > 0
        ? "Fallback: large repo; structural partial search skipped."
        : "Fallback: large repo; structural search skipped.",
    );
  }
  if (result.termCoverage?.scanStatus === "truncated") {
    notes.push("Collection bound reached; ranking uses the available prefix.");
  } else if (result.termCoverage?.scanStatus === "failed") {
    notes.push("Collection failed; ranking uses the available evidence.");
  }
  if (
    result.preferTermCoverage &&
    result.termCoverage &&
    result.termCoverage.candidates.length > 0
  ) {
    printTermCoverage(result.termCoverage, {
      note: notes.join(" "),
    });
    return;
  }
  printSourceMatches(result.matches, {
    note: notes.join(" "),
  });
}

function printSourceMatches(matches: SourceMatch[], { note = "" }: { note?: string } = {}): void {
  console.log("\nSource matches:");
  if (note) {
    console.log(`  ${note}`);
  }
  if (matches.length === 0) {
    console.log("  none");
  }
  for (const item of matches) {
    if (item.engine === "path") {
      console.log(`  - ${item.filePath} [file]`);
      continue;
    }
    console.log(`  - ${item.engine} ${item.filePath}:${item.line}:${item.column} [${item.kind}]`);
    console.log(`      ${item.text}`);
  }
}

function printTermCoverage(
  result: TermCoverageSearch,
  { note = "" }: { note?: string } = {},
): void {
  if (result.candidates.length === 0) {
    return;
  }
  console.log(
    result.fullCoverage
      ? "\nWorking-tree source candidates:"
      : "\nNo whole-query source match; partial candidates:",
  );
  if (note) {
    console.log(`  ${note}`);
  }
  for (const candidate of result.candidates) {
    console.log(
      `  - ${candidate.filePath} [terms ${candidate.matchedTerms.length}/${result.queryTerms.length}: ${candidate.matchedTerms.join(", ")}]`,
    );
    for (const anchor of candidate.anchors) {
      console.log(`      ${anchor.line}:${anchor.column} ${anchor.text}`);
    }
  }
  if (result.totalCandidates > result.candidates.length) {
    console.log(`  ... ${result.totalCandidates - result.candidates.length} more candidates`);
  }
}
