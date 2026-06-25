/** Registers CLI commands that search text, graph nodes, symbols, and calls. */
import type { Command } from "commander";

import {
	tryPrintCodebaseMemoryGraphSearch,
	tryPrintCodebaseMemorySearch,
	tryPrintCodebaseMemorySemanticSearch,
} from "../codebaseMemory/index.js";
import {
	DETAILED_ANALYSIS_FILE_LIMIT,
	resolveProjectRoot,
	semanticIndexPath,
} from "../common.js";
import {
	renderGraphMatchLines,
	type SourceFallbackGroup,
	type SourceMatch,
	searchTargetCard,
	sourceFallbackMatches,
	sourceMatches,
} from "../search/index.js";
import {
	EmbeddingSearchError,
	loadEmbeddingConfig,
	loadSemanticIndex,
	semanticIndexExists,
	semanticMatches,
} from "../search/semantic/index.js";
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
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers source, graph, semantic, and structural search commands. */
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
		.option(
			"--semantic",
			"Also search a saved semantic index. Run `codemap semantic init` first.",
		)
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

/** Runs source or graph search and optional semantic ranking. */
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
		tryPrintCodebaseMemorySemanticSearch(root, searchText, limit)
	) {
		return 0;
	}
	if (
		options.graph &&
		tryPrintCodebaseMemoryGraphSearch(root, searchText, limit)
	) {
		return 0;
	}
	if (!options.graph && tryPrintCodebaseMemorySearch(root, searchText, limit)) {
		return 0;
	}
	if (options.graph) {
		const graph = currentTreeGraph(root, { includeSignals: false });
		console.log(renderGraphMatchLines(graph, searchText, limit).join("\n"));
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
		return printSemanticMatches(root, searchText, limit);
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
	return (
		runScan(root, { persist: false }).files.length >
		DETAILED_ANALYSIS_FILE_LIMIT
	);
}

/** Prints semantic search results or setup guidance. */
export async function printSemanticMatches(
	root: string,
	searchText: string,
	limit: number,
): Promise<number> {
	try {
		if (!semanticIndexExists(root)) {
			console.log("\nSemantic card matches:");
			console.log(
				`  unavailable: no semantic index: ${semanticIndexPath(root)}`,
			);
			console.log(`  run: codemap semantic init --project-root ${root}`);
			return 1;
		}
		const config = loadEmbeddingConfig(root);
		if (config === null) {
			console.log("\nSemantic card matches:");
			console.log(
				"  unavailable: no embedding setup found; set GEMINI_API_KEY in the environment or .env",
			);
			return 1;
		}
		const index = loadSemanticIndex(root);
		const cardMatches = await semanticMatches(index, searchText, {
			config,
			limit,
		});
		console.log("\nSemantic card matches:");
		if (cardMatches.length === 0) {
			console.log("  none");
		}
		for (const item of cardMatches) {
			const lineRange = item.lineRange.length > 0 ? item.lineRange : ["?", "?"];
			console.log(
				`  - ${item.kind} ${item.filePath}:${lineRange[0]}-${lineRange[1]} score=${item.score.toFixed(3)}`,
			);
			console.log(`      ${item.title}`);
		}
		return 0;
	} catch (error) {
		if (error instanceof EmbeddingSearchError || error instanceof Error) {
			console.log("\nSemantic card matches:");
			console.log(`  unavailable: ${error.message}`);
			return 1;
		}
		throw error;
	}
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
