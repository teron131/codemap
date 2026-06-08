/** Defines CLI behavior for current-tree summary reports. */
import type { Command } from "commander";

import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import { buildViews } from "../rendering/index.js";
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

/** Builds and prints the current-tree summary report. */
export function commandSummary(
	options: SummaryOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	const scan = runScan(root, { persist: false });
	const graph =
		scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT
			? lightweightSummaryGraph(scan)
			: currentTreeGraph(root, { includeSignals: false });
	const renderedViews = buildViews(graph, { root });
	console.log(String(renderedViews.summaryText ?? "").trim());
	return 0;
}

/** Builds a minimal graph when summary output has no saved graph yet. */
function lightweightSummaryGraph(scan: {
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
