/** Defines CLI behavior for refactor signal reports. */
import type { Command } from "commander";

import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import { runScan, type ScanEntry } from "../source/extraction/index.js";
import {
	buildSignalPayload,
	renderSignalText,
	runSignalsExport,
	SIGNAL_OUTPUT_ROW_LIMIT,
	SIGNAL_SECTION_CHOICES,
	selectPayloadSection,
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

/** Registers refactor signal report commands and output modes. */
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
		options.projectRoot ?? rootOptions.projectRoot ?? ".",
	);
	const scan = runScan(root, { persist: false });
	if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
		const payload = lightweightSignalPayload(scan.files);
		const selected = selectPayloadSection(payload, section);
		if (options.json) {
			console.log(JSON.stringify(selected, null, 2));
		} else {
			console.log(renderSignalText(selected, section).trim());
		}
		return 0;
	}
	const signalExport = runSignalsExport(root);
	if (signalExport.status !== "ok") {
		console.log(
			`Signals unavailable: ${String(signalExport.message ?? "unknown error")}`,
		);
		return 1;
	}
	const payload = buildSignalPayload(signalExport, {
		limit: SIGNAL_OUTPUT_ROW_LIMIT,
		includeTests: Boolean(options.includeTests),
	});
	const selected = selectPayloadSection(payload, section);
	if (options.json) {
		console.log(JSON.stringify(selected, null, 2));
	} else {
		console.log(renderSignalText(selected, section).trim());
	}
	return 0;
}

/** Builds a compact signal summary when full analysis artifacts are absent. */
function lightweightSignalPayload(files: ScanEntry[]): Record<string, unknown> {
	const denseFiles = files
		.filter((entry) => entry.fileCategory === "code")
		.slice()
		.sort(
			(left, right) =>
				-Number(left.sizeLines ?? 0) - -Number(right.sizeLines ?? 0) ||
				compareText(left.path, right.path),
		)
		.slice(0, SIGNAL_OUTPUT_ROW_LIMIT)
		.map((entry) => ({
			file: entry.path,
			total: entry.sizeLines,
			defines: 0,
			imports_local: 0,
			exports: 0,
			reexports_local: 0,
			decorators: 0,
			samples: [],
		}));
	const top = {
		functions: {
			longFunctions: [],
			lowUseDefinitions: [],
		},
		variables: {
			leastUsedDefinitions: [],
			broadNamePools: [],
		},
		files: {
			denseFiles,
		},
	};
	return {
		top,
		relationships: {
			counts: {
				python_import_edges: 0,
				typescript_import_edges: 0,
				entrypoint_like_files: entrypointLikeFiles(files),
				typescript_relative_imports: 0,
				python_relative_imports: 0,
				typescript_reexport_edges: 0,
				python_inheritance_edges: 0,
			},
			top_local_import_hubs: [],
			top_inheritance_hubs: [],
		},
		files: denseFiles,
		lengths: {
			python: emptyLengthSection(),
			typescript: emptyLengthSection(),
		},
		usage: {
			distribution: {},
		},
		functions: {
			frequency: { python: [], typescript: [] },
			definitions: { python: [], typescript: [] },
			lowUseDefinitions: { python: [], typescript: [] },
		},
		variables: {
			frequency: { python: [], typescript: [] },
			definitions: { python: [], typescript: [] },
			lowUseDefinitions: { python: [], typescript: [] },
		},
	};
}

/** Builds an empty long-function section for lightweight signals. */
function emptyLengthSection(): Record<string, unknown> {
	return { count: 0, median: 0, p90: 0, max: 0, items: [] };
}

/** Finds files that look like CLI or app entrypoints. */
function entrypointLikeFiles(files: ScanEntry[]): number {
	const entryNames = new Set([
		"app.js",
		"app.jsx",
		"app.py",
		"app.ts",
		"app.tsx",
		"index.js",
		"index.jsx",
		"index.ts",
		"index.tsx",
		"main.js",
		"main.jsx",
		"main.py",
		"main.ts",
		"main.tsx",
	]);
	return files.filter((entry) =>
		entryNames.has(entry.path.split("/").at(-1) ?? ""),
	).length;
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
