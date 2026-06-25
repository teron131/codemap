/** Registers CLI commands that search text, graph nodes, symbols, and calls. */
import type { Command } from "commander";

import {
	type CodebaseMemoryGraphSearchOptions,
	printCodebaseMemoryGraphSearch,
	printCodebaseMemorySearch,
	printCodebaseMemorySemanticSearch,
} from "../codebase-memory/index.js";
import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import {
	type GraphMatchOptions,
	renderGraphMatchLines,
	type SourceFallbackGroup,
	type SourceMatch,
	searchTargetCard,
	sourceFallbackMatches,
	sourceMatches,
} from "../search/index.js";
import { runScan } from "../source/extraction/index.js";
import { currentTreeGraph } from "../source/graph/index.js";
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

/** Registers backend-ranked source, graph, semantic, and structural search commands. */
export function addSearchParser(program: Command): void {
	const search = program
		.command("search")
		.description("Search current code.")
		.argument("[searchText...]", "Text to search for.")
		.option("--limit <count>", "Maximum matches.", parseIntegerOption)
		.option(
			"--graph",
			"Search with derived relationship context instead of the fast source path.",
		)
		.option("--semantic", "Use Codebase Memory semantic graph search.")
		.option("--label <label>", "Filter --graph results by node label.")
		.option(
			"--name-pattern <regex>",
			"Filter --graph results by node name regex.",
		)
		.option(
			"--qn-pattern <regex>",
			"Filter --graph results by qualified-name regex.",
		)
		.option(
			"--file-pattern <glob>",
			"Filter --graph results by source file pattern.",
		)
		.option(
			"--relationship <type>",
			"Filter --graph results by edge relationship.",
		)
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
		.option(
			"--exclude-entry-points",
			"Exclude entry-point nodes from --graph results.",
		)
		.option(
			"--offset <count>",
			"Page --graph results from an offset.",
			parseIntegerOption,
		)
		.option("--include-tests", "Include backend test rows in search output.")
		.action(async (searchText: string[], options: SearchOptions) => {
			const exitCode = await commandSearch(
				searchText,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(search);
	addSearchMatchParser(search.command("match"));
	addSearchCallsParser(search.command("calls"));
	addSearchRuleParser(search.command("rule"));
}

/** Runs backend-ranked source or graph search with local fallback. */
export async function commandSearch(
	searchArgs: string[],
	options: SearchOptions,
	rootOptions: RootOptions = {},
): Promise<number> {
	if (searchArgs.length === 0) {
		console.log(
			"Search requires text or a search subcommand: match, calls, or rule.",
		);
		return 2;
	}
	const searchText = searchArgs.join(" ");
	const limit = searchLimit(options.limit);
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	console.log(`Search: ${searchText}`);
	if (
		options.semantic &&
		printCodebaseMemorySemanticSearch(
			root,
			searchText,
			limit,
			backendOutputOptions(options),
		)
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
	if (
		!options.graph &&
		printCodebaseMemorySearch(
			root,
			searchText,
			limit,
			backendOutputOptions(options),
		)
	) {
		return 0;
	}
	if (options.graph) {
		const graph = currentTreeGraph(root, { includeSignals: false });
		console.log(
			"\nGraph fallback: Codebase Memory graph search returned no answer; used current-tree relationship graph.",
		);
		console.log(
			renderGraphMatchLines(
				graph,
				searchText,
				limit,
				graphMatchOptions(options),
			).join("\n"),
		);
	} else {
		const textOnlySearch = shouldUseTextOnlySourceSearch(root);
		const matches = sourceMatches(root, searchText, {
			limit,
			textOnly: textOnlySearch,
		});
		const searchNote = textOnlySearch
			? "Fallback: large repo; structural search skipped."
			: "";
		if (matches.length === 0) {
			const fallbackGroups = sourceFallbackMatches(root, searchText, {
				limit,
				textOnly: textOnlySearch,
			});
			if (fallbackGroups.length > 0) {
				printSourceFallbackMatches(fallbackGroups, {
					note: textOnlySearch
						? "Fallback: large repo; structural partial search skipped."
						: "",
				});
			} else {
				printSourceMatches(matches, { note: searchNote });
			}
		} else {
			printSourceMatches(matches, { note: searchNote });
		}
		const card = searchTargetCard(root, searchText, matches, { limit });
		if (card !== null) {
			console.log("");
			console.log(card);
		}
	}
	if (options.semantic) {
		console.log("\nSemantic graph matches:");
		console.log(
			"  unavailable: Codebase Memory semantic search returned no answer; used current-tree search fallback.",
		);
	}
	return 0;
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
		console.log(
			`  - ${item.engine} ${item.filePath}:${item.line}:${item.column} [${item.kind}]`,
		);
		console.log(`      ${item.text}`);
	}
}

/** Prints partial source matches for a no-hit phrase query. */
export function printSourceFallbackMatches(
	groups: SourceFallbackGroup[],
	{ note = "" }: { note?: string } = {},
): void {
	if (groups.length === 0) {
		return;
	}
	console.log("\nNo matches, fallback to partial matches:");
	if (note) {
		console.log(`  ${note}`);
	}
	for (const group of groups) {
		console.log(`  ${group.term}:`);
		for (const item of group.matches) {
			console.log(
				`    - ${item.engine} ${item.filePath}:${item.line}:${item.column} [${item.kind}]`,
			);
			console.log(`        ${item.text}`);
		}
		if (group.truncated) {
			console.log("    ...");
		}
	}
}

/** Uses text-only source search when detailed structural work is too broad. */
function shouldUseTextOnlySourceSearch(root: string): boolean {
	return runScan(root).files.length > DETAILED_ANALYSIS_FILE_LIMIT;
}

/** Builds current-tree graph fallback filters without explicit undefined fields. */
function graphMatchOptions(options: SearchOptions): GraphMatchOptions {
	return {
		...(options.includeTests !== undefined
			? { includeTests: options.includeTests }
			: {}),
		...graphSearchOptions(options),
	};
}

/** Builds Codebase Memory graph search options without explicit undefined fields. */
function graphSearchOptions(
	options: SearchOptions,
): CodebaseMemoryGraphSearchOptions {
	return {
		...(options.label !== undefined ? { label: options.label } : {}),
		...(options.namePattern !== undefined
			? { namePattern: options.namePattern }
			: {}),
		...(options.qnPattern !== undefined
			? { qnPattern: options.qnPattern }
			: {}),
		...(options.filePattern !== undefined
			? { filePattern: options.filePattern }
			: {}),
		...(options.relationship !== undefined
			? { relationship: options.relationship }
			: {}),
		...(options.minDegree !== undefined
			? { minDegree: options.minDegree }
			: {}),
		...(options.maxDegree !== undefined
			? { maxDegree: options.maxDegree }
			: {}),
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
	return {
		...(options.includeTests !== undefined
			? { includeTests: options.includeTests }
			: {}),
	};
}

/** Parses the search result limit option. */
function searchLimit(value: string | number | undefined): number {
	if (value === undefined) {
		return 5;
	}
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? 5 : parsed;
}
