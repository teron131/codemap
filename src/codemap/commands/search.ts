/** Registers CLI commands that search text, graph nodes, symbols, and calls. */
import type { Command } from "commander";

import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import {
  type CodebaseMemoryGraphSearchOptions,
  printCodebaseMemoryGraphSearch,
  printCodebaseMemorySearch,
  printCodebaseMemorySemanticSearch,
} from "../search/codebase-memory.js";
import {
  conceptPathMatches,
  definitionMatches,
  type GraphMatchOptions,
  isImplementationSourceMatch,
  isImplementationSourcePath,
  pathMatches,
  renderGraphMatchLines,
  sourceFallbackMatches,
  type SourceFallbackSearch,
  type SourceMatch,
  sourceMatches,
} from "../search/index.js";
import { currentTreeGraph } from "../source/graph/index.js";
import { discoverFiles } from "../source/scanner/index.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";
import {
  addSearchCallsParser,
  addSearchMatchParser,
  addSearchRuleParser,
} from "./search-structural.js";

type SearchOptions = {
  projectRoot?: string;
  limit?: string | number;
  graph?: boolean;
  semantic?: boolean;
  label?: string;
  namePattern?: string;
  qnPattern?: string;
  filePattern?: string;
  relationship?: string;
  minDegree?: number;
  maxDegree?: number;
  excludeEntryPoints?: boolean;
  offset?: number;
  includeTests?: boolean;
};

type RootOptions = {
  projectRoot?: string;
};

type CurrentTreeSourceSearch = {
  fallback: SourceFallbackSearch | undefined;
  matches: SourceMatch[];
  preferFallback: boolean;
  textOnly: boolean;
};

const EXACT_SOURCE_MATCH_LIMIT = 3;
const DEFAULT_SEARCH_LIMIT = 15;

/** Registers backend-ranked source, graph, semantic, and structural search commands. */
export function addSearchParser(program: Command): void {
  const search = program
    .command("search")
    .description("Search current code.")
    .argument("[searchText...]", "Text to search for.")
    .option("--limit <count>", "Maximum matches. Defaults to 15.", parseIntegerOption)
    .option("--graph", "Search with derived relationship context instead of the fast source path.")
    .option("--semantic", "Use Codebase Memory semantic graph search.")
    .option("--label <label>", "Filter --graph results by node label.")
    .option("--name-pattern <regex>", "Filter --graph results by node name regex.")
    .option("--qn-pattern <regex>", "Filter --graph results by qualified-name regex.")
    .option("--file-pattern <glob>", "Filter --graph results by source file pattern.")
    .option("--relationship <type>", "Filter --graph results by edge relationship.")
    .option(
      "--min-degree <count>",
      "Filter --graph results by minimum graph degree.",
      parseIntegerOption,
    )
    .option(
      "--max-degree <count>",
      "Filter --graph results by maximum graph degree.",
      parseIntegerOption,
    )
    .option("--exclude-entry-points", "Exclude entry-point nodes from --graph results.")
    .option("--offset <count>", "Page --graph results from an offset.", parseIntegerOption)
    .option("--include-tests", "Include likely test rows in search output.")
    .action(async (searchText: string[], options: SearchOptions) => {
      const exitCode = await commandSearch(searchText, options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(search);
  addSearchMatchParser(search.command("match"));
  addSearchCallsParser(search.command("calls"));
  addSearchRuleParser(search.command("rule"));
}

/** Runs backend-ranked source or graph search with current-tree fallback. */
export async function commandSearch(
  searchArgs: string[],
  options: SearchOptions,
  rootOptions: RootOptions = {},
): Promise<number> {
  if (searchArgs.length === 0) {
    console.log("Search requires text or a search subcommand: match, calls, or rule.");
    return 2;
  }
  if (options.graph && options.semantic) {
    console.log("Choose only one search lane: --graph or --semantic.");
    return 2;
  }
  if (!options.graph && hasGraphOnlyFilters(options)) {
    console.log("Graph filters require --graph.");
    return 2;
  }
  const searchText = searchArgs.join(" ");
  const limit = searchLimit(options.limit);
  const root = resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
  console.log(`Search: ${searchText}`);
  let fallbackPreflight: SourceFallbackSearch | undefined;
  if (options.semantic) {
    const directDefinitions = definitionMatches(root, searchText, {
      includeTests: Boolean(options.includeTests),
      limit,
    });
    if (directDefinitions.length > 0) {
      printSourceMatches(directDefinitions, {
        note: "Exact current-tree definition found; skipped backend semantic search.",
      });
      return 0;
    }
  }
  if (!options.graph && !options.semantic) {
    const directPaths = pathMatches(root, searchText, { limit });
    if (directPaths.length > 0) {
      printSourceMatches(directPaths);
      return 0;
    }
    const directDefinitions = definitionMatches(root, searchText, {
      includeTests: Boolean(options.includeTests),
      limit,
    });
    if (directDefinitions.length > 0) {
      printSourceMatches(directDefinitions);
      return 0;
    }
    fallbackPreflight = sourceFallbackMatches(root, searchText, {
      includeTests: Boolean(options.includeTests),
      limit,
    });
    if (fallbackPreflight.fullCoverage) {
      printSourceFallbackMatches(fallbackPreflight);
      return 0;
    }
    if (
      fallbackPreflight.queryTerms.length >= 2 &&
      !fallbackPreflight.hasPathSupplementedCoverage
    ) {
      const exactTextMatches = sourceMatches(root, searchText, {
        includeTests: Boolean(options.includeTests),
        limit: Math.min(limit, EXACT_SOURCE_MATCH_LIMIT),
        textOnly: true,
      }).filter(isImplementationSourceMatch);
      if (exactTextMatches.length > 0) {
        printSourceMatches(exactTextMatches);
        return 0;
      }
    }
  }
  if (
    options.semantic &&
    printCodebaseMemorySemanticSearch(root, searchText, limit, backendOutputOptions(options))
  ) {
    return 0;
  }
  if (
    options.graph &&
    printCodebaseMemoryGraphSearch(root, searchText, limit, {
      ...graphSearchOptions(options),
      ...backendOutputOptions(options),
    })
  ) {
    return 0;
  }
  if (options.graph) {
    const graph = currentTreeGraph(root);
    console.log(
      "\nGraph fallback: Codebase Memory graph search returned no answer; used current-tree relationship graph.",
    );
    console.log(
      renderGraphMatchLines(graph, searchText, limit, graphMatchOptions(options)).join("\n"),
    );
    return 0;
  }
  if (
    !options.semantic &&
    printCodebaseMemorySearch(root, searchText, limit, backendOutputOptions(options))
  ) {
    return 0;
  }
  const currentTree = currentTreeSourceSearch(root, searchText, limit, options, fallbackPreflight);
  if (options.semantic) {
    printCurrentTreeSourceSearch(currentTree);
    console.log("\nSemantic graph matches:");
    console.log(
      "  unavailable: Codebase Memory semantic search returned no answer; used current-tree search fallback.",
    );
    return 0;
  }
  printCurrentTreeSourceSearch(currentTree);
  return 0;
}

/** Collects one bounded current-tree source result without refreshing the optional backend. */
function currentTreeSourceSearch(
  root: string,
  searchText: string,
  limit: number,
  options: SearchOptions,
  fallbackPreflight: SourceFallbackSearch | undefined,
): CurrentTreeSourceSearch {
  const filePaths = discoverFiles(root);
  const textOnly = filePaths.length > DETAILED_ANALYSIS_FILE_LIMIT;
  const includeTests = Boolean(options.includeTests);
  const conceptPaths = conceptPathMatches(root, searchText, {
    filePaths,
    includeTests,
    limit: Math.min(3, limit),
  });
  const textMatches = sourceMatches(root, searchText, {
    includeTests,
    limit: limit - conceptPaths.length,
    textOnly,
  });
  const matches = [...conceptPaths, ...textMatches];
  const directUseful = matches.some(
    (match) => match.engine === "path" || isImplementationSourceMatch(match),
  );
  const preservePathEvidence = fallbackPreflight?.hasPathSupplementedCoverage ?? false;
  const fallback =
    directUseful && !preservePathEvidence
      ? undefined
      : (fallbackPreflight ??
        sourceFallbackMatches(root, searchText, {
          includeTests,
          limit,
        }));
  const fallbackUseful =
    fallback?.candidates.some((candidate) => isImplementationSourcePath(candidate.filePath)) ??
    false;
  return {
    fallback,
    matches,
    preferFallback: fallbackUseful || matches.length === 0,
    textOnly,
  };
}

/** Prints current-tree source or partial fallback results with large-repository status. */
function printCurrentTreeSourceSearch(result: CurrentTreeSourceSearch): void {
  const notes = [];
  if (result.textOnly) {
    notes.push(
      result.preferFallback && (result.fallback?.candidates.length ?? 0) > 0
        ? "Fallback: large repo; structural partial search skipped."
        : "Fallback: large repo; structural search skipped.",
    );
  }
  if (result.fallback?.scanStatus === "truncated") {
    notes.push("Collection bound reached; ranking uses the available prefix.");
  } else if (result.fallback?.scanStatus === "failed") {
    notes.push("Collection failed; ranking uses the available evidence.");
  }
  if (result.preferFallback && result.fallback && result.fallback.candidates.length > 0) {
    printSourceFallbackMatches(result.fallback, {
      note: notes.join(" "),
    });
    return;
  }
  printSourceMatches(result.matches, {
    note: notes.join(" "),
  });
}

/** Detects filters whose meaning exists only in graph search. */
function hasGraphOnlyFilters(options: SearchOptions): boolean {
  return [
    options.label,
    options.namePattern,
    options.qnPattern,
    options.filePattern,
    options.relationship,
    options.minDegree,
    options.maxDegree,
    options.excludeEntryPoints,
    options.offset,
  ].some((value) => value !== undefined && value !== false);
}

/** Prints source search matches in CLI text format. */
export function printSourceMatches(
  matches: SourceMatch[],
  { note = "" }: { note?: string } = {},
): void {
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

/** Prints file-oriented source candidates with coverage and bounded concrete anchors. */
function printSourceFallbackMatches(
  result: SourceFallbackSearch,
  { note = "" }: { note?: string } = {},
): void {
  if (result.candidates.length === 0) {
    return;
  }
  console.log(
    result.fullCoverage
      ? "\nCurrent-tree source candidates:"
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

/** Builds current-tree graph fallback filters without explicit undefined fields. */
function graphMatchOptions(options: SearchOptions): GraphMatchOptions {
  return {
    ...(options.includeTests !== undefined ? { includeTests: options.includeTests } : {}),
    ...graphSearchOptions(options),
  };
}

/** Builds Codebase Memory graph search options without explicit undefined fields. */
function graphSearchOptions(options: SearchOptions): CodebaseMemoryGraphSearchOptions {
  return {
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.namePattern !== undefined ? { namePattern: options.namePattern } : {}),
    ...(options.qnPattern !== undefined ? { qnPattern: options.qnPattern } : {}),
    ...(options.filePattern !== undefined ? { filePattern: options.filePattern } : {}),
    ...(options.relationship !== undefined ? { relationship: options.relationship } : {}),
    ...(options.minDegree !== undefined ? { minDegree: options.minDegree } : {}),
    ...(options.maxDegree !== undefined ? { maxDegree: options.maxDegree } : {}),
    ...(options.excludeEntryPoints !== undefined
      ? { excludeEntryPoints: options.excludeEntryPoints }
      : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
  };
}

/** Builds backend output options without explicit undefined fields. */
function backendOutputOptions(options: SearchOptions): {
  includeTests?: boolean;
} {
  return options.includeTests !== undefined ? { includeTests: options.includeTests } : {};
}

/** Parses the search result limit option. */
function searchLimit(value: string | number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SEARCH_LIMIT;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? DEFAULT_SEARCH_LIMIT : parsed;
}
