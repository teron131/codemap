/** Defines CLI behavior for refactor signal output. */
import type { Command } from "commander";

import { resolveProjectRoot } from "../common.js";
import {
	buildSignalView,
	renderSignalText,
	SIGNAL_SECTION_CHOICES,
} from "../source/signals/index.js";
import { addProjectRootArgument } from "./options.js";

type SignalOptions = {
	projectRoot?: string;
	includeTests?: boolean;
	json?: boolean;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers refactor signal commands and output modes. */
export function addSignalsParser(program: Command): void {
	const signals = program
		.command("signals")
		.description(
			"Print compact refactor evidence from the backend and current tree.",
		)
		.argument("[section]", "Signal section to print.", "top")
		.option(
			"--include-tests",
			"Include likely test files in file-specific signal rows.",
		)
		.option(
			"--json",
			"Print signal tables as JSON for jq, scripts, and agent pipelines.",
		)
		.action((section: string, options: SignalOptions) => {
			const exitCode = commandSignals(
				section,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(signals);
}

/** Runs refactor signal analysis and prints text or JSON output. */
export function commandSignals(
	section: string,
	options: SignalOptions,
	rootOptions: RootOptions = {},
): number {
	if (!SIGNAL_SECTION_CHOICES.includes(section as never)) {
		console.error(
			`error: argument section: invalid choice: '${section}' (choose from ${SIGNAL_SECTION_CHOICES.map((choice) => `'${choice}'`).join(", ")})`,
		);
		return 2;
	}
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	let selected: Record<string, unknown>;
	try {
		selected = buildSignalView(root, section, {
			includeTests: Boolean(options.includeTests),
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	if (options.json) {
		console.log(JSON.stringify(selected));
	} else {
		console.log(renderSignalText(selected, section).trim());
	}
	return 0;
}
