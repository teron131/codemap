/** Defines CLI behavior for refactor signal output. */
import type { Command } from "commander";

import { codebaseMemoryStatus } from "../codebase-memory/index.js";
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

type BackendSignalContext = {
	backend: "Codebase Memory";
	project: string;
	status: string;
	nodes: number | null;
	edges: number | null;
	schemaNodeLabels: number | null;
	schemaEdgeTypes: number | null;
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
	const backendContext = codebaseMemorySignalContext(root);
	if (options.json) {
		console.log(
			JSON.stringify(
				backendContext === null
					? selected
					: { backend: backendContext, ...selected },
				null,
				2,
			),
		);
	} else {
		console.log(renderSignalTextWithBackend(selected, section, backendContext));
	}
	return 0;
}

/** Renders signal text with backend context below the main title. */
function renderSignalTextWithBackend(
	payload: Record<string, unknown>,
	section: string,
	backendContext: BackendSignalContext | null,
): string {
	const signalText = renderSignalText(payload, section).trim();
	const backendText = renderBackendSignalContext(backendContext);
	if (!backendText) {
		return signalText;
	}
	const [title = "", ...body] = signalText.split("\n");
	return [title, "", backendText, ...body].join("\n").trim();
}

/** Reads backend context for signal output without making it mandatory. */
function codebaseMemorySignalContext(
	root: string,
): BackendSignalContext | null {
	const status = codebaseMemoryStatus(root);
	if (status === null) {
		return null;
	}
	return {
		backend: "Codebase Memory",
		project: status.projectName,
		status: status.status,
		nodes: status.nodes,
		edges: status.edges,
		schemaNodeLabels: status.schemaNodeLabels,
		schemaEdgeTypes: status.schemaEdgeTypes,
	};
}

/** Renders optional backend graph context for signal text output. */
function renderBackendSignalContext(
	context: BackendSignalContext | null,
): string {
	if (context === null) {
		return "";
	}
	const lines = [
		"## Backend Graph",
		`- backend: ${context.backend}`,
		`- project: ${context.project}`,
		`- status: ${context.status}`,
		`- nodes: ${context.nodes ?? "unknown"}`,
		`- edges: ${context.edges ?? "unknown"}`,
	];
	if (context.schemaNodeLabels !== null && context.schemaEdgeTypes !== null) {
		lines.push(
			`- schema: ${context.schemaNodeLabels} node labels, ${context.schemaEdgeTypes} edge types`,
		);
	}
	return lines.join("\n");
}

/** Builds the selected current-tree signal payload for CLI output. */
export function buildCurrentTreeSignalPayload(
	root: string,
	section: string,
	options: SignalPayloadOptions = {},
): Record<string, unknown> {
	const scan = runScan(root);
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
