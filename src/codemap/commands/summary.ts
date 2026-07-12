/** Defines CLI behavior for current-tree summary output. */
import type { Command } from "commander";

import { printCodebaseMemoryArchitectureSummary } from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import { buildSummaryText } from "../rendering/index.js";
import { currentTreeSummaryGraph } from "../source/graph/index.js";
import { addProjectRootArgument } from "./options.js";

type SummaryOptions = {
	projectRoot?: string;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers the current-tree summary command. */
export function addSummaryParser(program: Command): void {
	const summary = program
		.command("summary")
		.description("Print the concise Markdown summary view.")
		.action((options: SummaryOptions) => {
			const exitCode = commandSummary(options, program.opts<RootOptions>());
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(summary);
}

/** Builds and prints the current-tree summary output. */
export function commandSummary(
	options: SummaryOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	if (printCodebaseMemoryArchitectureSummary(root)) {
		return 0;
	}
	console.log(buildSummaryText(currentTreeSummaryGraph(root), { root }).trim());
	return 0;
}
