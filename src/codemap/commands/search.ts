/** `search` command: validates the lane flags and hands the query to the search lanes. It also mounts the structural `match`, `calls`, and `rule` subcommands. */
import type { Command } from "commander";

import {
  type GraphSearchFilters,
  hasGraphFilters,
  printSearch,
  type SearchRequest,
} from "../search/index.js";
import {
  addProjectRootArgument,
  limitOption,
  parseIntegerOption,
  type ProjectRootOptions,
  resolveProjectRoot,
} from "./options.js";
import {
  addSearchCallsParser,
  addSearchMatchParser,
  addSearchRuleParser,
} from "./search-structural.js";

type SearchOptions = GraphSearchFilters & {
  projectRoot?: string;
  limit?: string | number;
  graph?: boolean;
  semantic?: boolean;
  includeTests?: boolean;
};

const DEFAULT_SEARCH_LIMIT = 15;

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
      process.exitCode = await commandSearch(
        searchText,
        options,
        program.opts<ProjectRootOptions>(),
      );
    });
  addProjectRootArgument(search);
  addSearchMatchParser(search.command("match"));
  addSearchCallsParser(search.command("calls"));
  addSearchRuleParser(search.command("rule"));
}

export async function commandSearch(
  searchArgs: string[],
  options: SearchOptions,
  rootOptions: ProjectRootOptions = {},
): Promise<number> {
  const { projectRoot, limit, graph, semantic, includeTests, ...graphFilters } = options;
  if (searchArgs.length === 0) {
    console.log("Search requires text or a search subcommand: match, calls, or rule.");
    return 2;
  }
  if (graph && semantic) {
    console.log("Choose only one search lane: --graph or --semantic.");
    return 2;
  }
  if (!graph && hasGraphFilters(graphFilters)) {
    console.log("Graph filters require --graph.");
    return 2;
  }
  const searchText = searchArgs.join(" ");
  const request: SearchRequest = {
    lane: graph ? "graph" : semantic ? "semantic" : "source",
    limit: limitOption(limit, DEFAULT_SEARCH_LIMIT),
    includeTests: Boolean(includeTests),
    graphFilters,
  };
  const root = resolveProjectRoot({ projectRoot }, rootOptions);
  console.log(`Search: ${searchText}`);
  printSearch(root, searchText, request);
  return 0;
}
