/** Builds rendered text, HTML, and overview views from graph payloads. */
import path from "node:path";

import type { GraphNode, GraphPayload } from "../source/graph/index.js";
import { signalMetrics } from "../source/signals/index.js";
import {
	buildIntentView,
	buildInventoryView,
	relationshipCountsFromGraph,
} from "./architecture.js";
import { renderHtmlReport } from "./html-report.js";
import {
	buildLikelyEntries,
	buildPathRankedLikelyEntries,
} from "./likely-entries.js";
import {
	renderAgentBrief,
	renderHotspotsText,
	renderSummaryText,
} from "./markdown.js";
import { buildOverviewView } from "./overview.js";

type Row = Record<string, unknown>;

export const FILE_NODE_TYPES = new Set([
	"file",
	"config",
	"document",
	"service",
	"pipeline",
	"schema",
	"resource",
	"table",
]);
export const STRUCTURE_HASH_DESCRIPTION =
	"detects imports, definitions, services, endpoints, and other extracted structural changes";

/** Assigns a path to a top-level architecture group. */
export function topGroup(filePath: string, category: string): string {
	const parts = filePath.split("/");
	const lower = filePath.toLowerCase();
	if (category === "docs" || lower.endsWith(".md") || lower.endsWith(".rst")) {
		return "Documentation";
	}
	if (category === "config" || parts.length === 1) {
		return "Configuration and Root";
	}
	if (
		category === "infra" ||
		lower.startsWith(".github/") ||
		lower.startsWith("deploy/") ||
		lower.startsWith("infra/") ||
		lower.startsWith("infrastructure/")
	) {
		return "Infrastructure";
	}
	if (lower.includes("test") || lower.includes("spec")) {
		return "Tests";
	}
	if (["scripts", "bin", "tools"].includes(parts[0] ?? "")) {
		return "Scripts and Tools";
	}
	return titleCase((parts[0] ?? "").replaceAll("_", " ").replaceAll("-", " "));
}

/** Groups graph nodes into architecture layer rows. */
export function buildLayers(nodes: GraphNode[]): Row[] {
	const groups = new Map<string, string[]>();
	for (const node of nodes) {
		if (!FILE_NODE_TYPES.has(node.type)) {
			continue;
		}
		let category = "code";
		const tags = new Set(node.tags ?? []);
		if (tags.has("docs")) {
			category = "docs";
		} else if (tags.has("config")) {
			category = "config";
		} else if (tags.has("infra")) {
			category = "infra";
		}
		const group = topGroup(String(node.filePath ?? ""), category);
		groups.set(group, [...(groups.get(group) ?? []), node.id]);
	}
	return [...groups.entries()]
		.sort((left, right) => compareText(left[0], right[0]))
		.map(([name, nodeIds], index) => {
			const layerId = `layer:${name.toLowerCase().replaceAll(" and ", "-").replaceAll(" ", "-")}`;
			return {
				id: layerId,
				name,
				description: `${nodeIds.length} files grouped by path/category evidence.`,
				nodeIds: nodeIds.slice().sort(compareText),
				order: index + 1,
			};
		});
}

/** Builds all rendered artifact views from a graph payload. */
export function buildViews(
	graph: GraphPayload,
	{
		includeHtml = true,
		root = null,
		refreshSummary = null,
	}: {
		includeHtml?: boolean;
		root?: string | null;
		refreshSummary?: Row | null;
	} = {},
): Row {
	const nodes = graph.nodes;
	const edges = graph.edges;
	const layers = buildLayers(nodes);
	let likelyEntries = buildLikelyEntries(nodes, edges);
	const metrics = signalMetrics(graph.evidence.codeSignals ?? {});
	const relationships: Row = relationshipCountsFromGraph(nodes, edges);
	const importMapEvidence = recordValue(graph.evidence.importMap);
	if (importMapEvidence.mode === "lightweight-summary") {
		relationships.importCountsUnavailable = true;
		relationships.importCountsNote = importMapEvidence.reason ?? "";
		likelyEntries = buildPathRankedLikelyEntries(nodes);
	}
	const inventory = buildInventoryView(graph.stats, nodes);
	const intent = buildIntentView(root, likelyEntries);
	const refresh = refreshSummary ?? {};
	const refreshPlan = recordValue(refresh.plan);
	const project = { name: root ? path.basename(root) : "project" };
	const architecture = {
		project,
		stats: graph.stats,
		relationships,
		inventory,
		intent,
		layers,
		likelyEntries,
	};
	const update = {
		refresh,
		refreshPlan,
		freshnessModel: {
			contentHash: "detects any file content change",
			structureHash: STRUCTURE_HASH_DESCRIPTION,
			canonicalData: "canonical/graph.json and canonical/fingerprints.json",
			renderedViews: "views/*.json and views/*.md",
		},
	};
	const overview = buildOverviewView(architecture, metrics, update);
	const brief = renderAgentBrief(architecture, metrics, update);
	const summaryText = renderSummaryText(overview, architecture, update);
	const hotspotsText = renderHotspotsText(metrics);
	const htmlReport = includeHtml ? renderHtmlReport(overview, update) : "";
	return {
		architecture,
		metrics,
		update,
		overview,
		agentBrief: brief,
		summaryText,
		hotspotsText,
		htmlReport,
	};
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

/** Formats labels for output headings. */
function titleCase(value: string): string {
	return value.replace(/\S+/g, (word) => {
		const first = word[0] ?? "";
		return first.toUpperCase() + word.slice(1);
	});
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
