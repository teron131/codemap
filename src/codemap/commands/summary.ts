/** Defines CLI behavior for current-tree summary output. */
import type { Command } from "commander";

import { printCodebaseMemoryArchitectureSummary } from "../codebase-memory/index.js";
import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import { buildSummaryText } from "../rendering/index.js";
import { runScan, type ScanEntry } from "../source/extraction/index.js";
import {
	currentTreeGraph,
	fileNode,
	type GraphPayload,
} from "../source/graph/index.js";
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
	console.log(buildSummaryText(buildSummaryGraph(root), { root }).trim());
	return 0;
}

/** Builds the current-tree graph payload used by summary-style output. */
function buildSummaryGraph(root: string): GraphPayload {
	const scan = runScan(root);
	return buildSummaryGraphFromScan(root, scan);
}

/** Builds a summary graph while reusing an existing inventory scan when possible. */
export function buildSummaryGraphFromScan(
	root: string,
	scan: ReturnType<typeof runScan>,
): GraphPayload {
	return scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT
		? buildLightweightSummaryGraph(scan)
		: currentTreeGraph(root);
}

/** Builds a minimal graph when detailed relationship analysis is too broad. */
function buildLightweightSummaryGraph(scan: {
	files: ScanEntry[];
	stats: {
		byLanguage?: Record<string, number>;
		byCategory?: Record<string, number>;
	};
}): GraphPayload {
	const nodes = scan.files.map((entry) =>
		fileNode(entry.path, entry, null, []),
	);
	return {
		stats: {
			files: scan.files.length,
			nodes: nodes.length,
			edges: 0,
			nodeTypes: countBy(nodes, (node) => node.type),
			edgeTypes: {},
			languages: scan.stats.byLanguage ?? {},
			categories: scan.stats.byCategory ?? {},
		},
		nodes,
		edges: [],
		evidence: {
			importMap: {
				mode: "lightweight-summary",
				reason: `skipped detailed graph above ${DETAILED_ANALYSIS_FILE_LIMIT} files`,
			},
		},
	};
}

/** Counts rows by a derived key. */
function countBy<T>(
	items: T[],
	keyFor: (item: T) => string,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const key = keyFor(item);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}
