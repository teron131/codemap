/** Defines CLI behavior for semantic index creation and status. */
import type { Command } from "commander";

import { resolveProjectRoot, semanticIndexPath } from "../common.js";
import {
	buildSemanticIndex,
	DEFAULT_SEMANTIC_INDEX_CARD_LIMIT,
	EmbeddingSearchError,
	loadEmbeddingConfig,
	loadSemanticIndex,
	semanticIndexExists,
} from "../search/semantic/index.js";
import { currentTreeGraph } from "../source/graph/index.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

type SemanticOptions = {
	projectRoot?: string;
	cardLimit?: string | number;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers semantic index init and status commands. */
export function addSemanticParsers(program: Command): void {
	const semantic = program
		.command("semantic")
		.description("Create or show saved embedding indexes for semantic search.");

	const semanticInit = semantic
		.command("init")
		.description("Create a saved embedding-backed semantic search index.")
		.option(
			"--card-limit <count>",
			"Maximum structure cards to embed into the index.",
			parseIntegerOption,
			DEFAULT_SEMANTIC_INDEX_CARD_LIMIT,
		)
		.action(async (options: SemanticOptions) => {
			const exitCode = await commandSemanticInit(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(semanticInit);

	const semanticStatus = semantic
		.command("status")
		.description("Print saved semantic index status.")
		.action((options: SemanticOptions) => {
			const exitCode = commandSemanticStatus(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(semanticStatus);
}

/** Builds and saves the semantic index for a project. */
export async function commandSemanticInit(
	options: SemanticOptions,
	rootOptions: RootOptions = {},
): Promise<number> {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot ?? ".",
	);
	try {
		const config = loadEmbeddingConfig(root);
		if (config === null) {
			console.log(
				"Semantic index requires embedding setup. Set GEMINI_API_KEY in the environment or project .env.",
			);
			return 1;
		}
		const graph = currentTreeGraph(root, { includeSignals: false });
		const index = await buildSemanticIndex(root, graph, {
			config,
			cardLimit: semanticCardLimit(options.cardLimit),
		});
		console.log(
			`Created semantic index for ${rootName(root)}: ${index.cardCount ?? 0} cards`,
		);
		console.log(semanticIndexPath(root));
		return 0;
	} catch (error) {
		if (error instanceof EmbeddingSearchError) {
			console.log(`Semantic index unavailable: ${error.message}`);
			return 1;
		}
		throw error;
	}
}

/** Prints saved semantic index status and model configuration. */
export function commandSemanticStatus(
	options: SemanticOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot ?? ".",
	);
	if (!semanticIndexExists(root)) {
		console.log(`No semantic index at ${semanticIndexPath(root)}`);
		return 1;
	}
	const index = loadSemanticIndex(root);
	console.log(`${rootName(root)}: ${index.cardCount ?? 0} semantic cards`);
	console.log(
		`model: ${index.model ?? "unknown"} (${index.outputDimensionality ?? "unknown"} dimensions)`,
	);
	console.log(`generated: ${index.generatedAt ?? "unknown"}`);
	console.log(`index: ${semanticIndexPath(root)}`);
	return 0;
}

/** Parses the semantic-card limit and falls back to the default size. */
function semanticCardLimit(value: string | number | undefined): number {
	if (value === undefined) {
		return DEFAULT_SEMANTIC_INDEX_CARD_LIMIT;
	}
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? DEFAULT_SEMANTIC_INDEX_CARD_LIMIT : parsed;
}

/** Returns the display name for a project root path. */
function rootName(root: string): string {
	const parts = root.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? root;
}
