/** Defines CLI behavior for Codebase Memory backend operations. */
import type { Command } from "commander";

import { printCodebaseMemoryStatus } from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import { addProjectRootArgument } from "./options.js";

type MemoryOptions = {
	projectRoot?: string;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers Codebase Memory backend commands. */
export function addMemoryParsers(program: Command): void {
	const memory = program
		.command("memory")
		.description("Inspect the Codebase Memory backend used by Codemap.");

	const memoryStatus = memory
		.command("status")
		.description("Index first, then print Codebase Memory backend status.")
		.action((options: MemoryOptions) => {
			const exitCode = commandMemoryStatus(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(memoryStatus);
}

/** Prints Codebase Memory backend status for the project root. */
export function commandMemoryStatus(
	options: MemoryOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	if (printCodebaseMemoryStatus(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory index for this project. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}
