/** Builds the current-tree summary view from graph evidence. */
import path from "node:path";

import type { GraphPayload } from "../source/graph/index.js";
import {
	buildIntentView,
	buildInventoryView,
	relationshipCountsFromGraph,
} from "./architecture.js";
import {
	buildLikelyEntries,
	buildPathRankedLikelyEntries,
} from "./likely-entries.js";
import { renderSummaryText } from "./markdown.js";

type Row = Record<string, unknown>;

/** Builds the readable current-tree summary from graph facts. */
export function buildSummaryText(
	graph: GraphPayload,
	{
		root = null,
	}: {
		root?: string | null;
	} = {},
): string {
	const nodes = graph.nodes;
	const edges = graph.edges;
	let likelyEntries = buildLikelyEntries(nodes, edges);
	const relationships: Row = relationshipCountsFromGraph(nodes, edges);
	const importMapEvidence = recordValue(graph.evidence.importMap);
	if (importMapEvidence.mode === "lightweight-summary") {
		relationships.importCountsUnavailable = true;
		relationships.importCountsNote = importMapEvidence.reason ?? "";
		likelyEntries = buildPathRankedLikelyEntries(nodes);
	}
	const inventory = buildInventoryView(graph.stats, nodes);
	const intent = buildIntentView(root, likelyEntries);
	const project = { name: root ? path.basename(root) : "project" };
	const architecture = {
		project,
		stats: graph.stats,
		relationships,
		inventory,
		intent,
		likelyEntries,
	};
	return renderSummaryText(architecture);
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}
