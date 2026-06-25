/** Defines CLI behavior for Codebase Memory backend status. */
import type { Command } from "commander";

import { tryPrintCodebaseMemoryStatus } from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import { addProjectRootArgument } from "./options.js";

type SemanticOptions = {
	projectRoot?: string;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers the backend status command for semantic graph search. */
export function addSemanticParsers(program: Command): void {
	const semantic = program
		.command("semantic")
		.description("Show the Codebase Memory backend used for semantic search.");

	const semanticStatus = semantic
		.command("status")
		.description("Print Codebase Memory backend index status.")
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

/** Prints Codebase Memory backend status for the project root. */
export function commandSemanticStatus(
	options: SemanticOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	if (tryPrintCodebaseMemoryStatus(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory index for this project. Run `codebase-memory-mcp` indexing outside Codemap to enable persistent graph search.",
	);
	return 1;
}
