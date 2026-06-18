/** Defines CLI behavior for refactor signal output. */
import type { Command } from "commander";

import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import { runScan } from "../source/extraction/index.js";
import {
	buildSignalPayload,
	renderSignalText,
	runSignalsExport,
	SIGNAL_OUTPUT_ROW_LIMIT,
	SIGNAL_SECTION_CHOICES,
	selectPayloadSection,
} from "../source/signals/index.js";
import { buildLightweightSignalPayload } from "../source/signals/lightweight.js";
import { addProjectRootArgument } from "./options.js";

type SignalOptions = {
	projectRoot?: string;
	includeTests?: boolean;
	json?: boolean;
};

type SignalPayloadOptions = {
	includeTests?: boolean;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers refactor signal commands and output modes. */
export function addSignalsParser(program: Command): void {
	const signals = program
		.command("signals")
		.description(
			"Print current-tree relationship, usage, function length, variable pool, and file profile tables.",
		)
		.argument("[section]", "Signal section to print.", "all")
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
		selected = buildCurrentTreeSignalPayload(root, section, {
			includeTests: Boolean(options.includeTests),
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	if (options.json) {
		console.log(JSON.stringify(selected, null, 2));
	} else {
		console.log(renderSignalText(selected, section).trim());
	}
	return 0;
}

/** Builds the selected current-tree signal payload for CLI output. */
export function buildCurrentTreeSignalPayload(
	root: string,
	section: string,
	options: SignalPayloadOptions = {},
): Record<string, unknown> {
	const scan = runScan(root, { persist: false });
	if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
		const payload = buildLightweightSignalPayload(scan.files, {
			includeTests: Boolean(options.includeTests),
			root,
		});
		return selectPayloadSection(payload, section);
	}
	const signalExport = runSignalsExport(root);
	if (signalExport.status !== "ok") {
		throw new Error(
			`Signals unavailable: ${String(signalExport.message ?? "unknown error")}`,
		);
	}
	const payload = buildSignalPayload(signalExport, {
		limit: SIGNAL_OUTPUT_ROW_LIMIT,
		includeTests: Boolean(options.includeTests),
	});
	return selectPayloadSection(payload, section);
}
