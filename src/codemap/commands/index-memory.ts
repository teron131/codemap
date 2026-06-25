/** Defines CLI behavior for explicitly refreshing Codebase Memory. */
import type { Command } from "commander";

import { printCodebaseMemoryIndex } from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import { addProjectRootArgument } from "./options.js";

type IndexOptions = {
	projectRoot?: string;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers the top-level Codebase Memory refresh command. */
export function addIndexParser(program: Command): void {
	const index = program
		.command("index")
		.description("Refresh Codebase Memory and print index timing.")
		.action((options: IndexOptions) => {
			const exitCode = commandIndex(options, program.opts<RootOptions>());
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(index);
}

/** Explicitly refreshes Codebase Memory and prints timing for diagnostics. */
export function commandIndex(
	options: IndexOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	if (printCodebaseMemoryIndex(root)) {
		return 0;
	}
	console.log(
		"Could not refresh Codebase Memory. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}
