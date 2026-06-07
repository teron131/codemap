/** Builds rendered text, HTML, and overview views from graph payloads. */
import path from "node:path";

import type {
	GraphEdge,
	GraphNode,
	GraphPayload,
} from "../source/graph/index.js";
import { signalMetrics } from "../source/signals/index.js";
import {
	buildIntentView,
	buildInventoryView,
	relationshipCountsFromGraph,
} from "./architecture.js";
import { renderHtmlReport } from "./html-report.js";
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

/** Builds likely entrypoint rows from graph node centrality. */
export function buildLikelyEntries(
	nodes: GraphNode[],
	edges: GraphEdge[],
): Row[] {
	const fileNodes = nodes.filter(
		(node) => node.filePath && !["function", "class"].includes(node.type),
	);
	const codeNodes = fileNodes.filter((node) =>
		(node.tags ?? []).includes("code"),
	);
	const candidates = codeNodes.length > 0 ? codeNodes : fileNodes;
	const fanIn = countBy(
		edges.filter((edge) => edge.type === "imports"),
		(edge) => edge.target,
	);
	const fanOut = countBy(
		edges.filter((edge) => edge.type === "imports"),
		(edge) => edge.source,
	);
	const scored = candidates.slice().sort((left, right) => {
		const leftTags = new Set(left.tags ?? []);
		const rightTags = new Set(right.tags ?? []);
		const tuple = [
			Number(!leftTags.has("entry-candidate")) -
				Number(!rightTags.has("entry-candidate")),
			Number(path.basename(left.filePath) === "__init__.py") -
				Number(path.basename(right.filePath) === "__init__.py"),
			-((fanIn.get(left.id) ?? 0) + (fanOut.get(left.id) ?? 0)) -
				-((fanIn.get(right.id) ?? 0) + (fanOut.get(right.id) ?? 0)),
		];
		for (const diff of tuple) {
			if (diff !== 0) {
				return diff;
			}
		}
		return compareText(left.filePath, right.filePath);
	});
	return scored.slice(0, 8).map((node, index) => {
		const incoming = fanIn.get(node.id) ?? 0;
		const outgoing = fanOut.get(node.id) ?? 0;
		return {
			order: index + 1,
			title: String(node.filePath || node.name || node.id),
			description: `High-signal file with ${incoming} incoming and ${outgoing} outgoing import edges.`,
			nodeIds: [node.id],
		};
	});
}

/** Builds all rendered artifact views from a graph payload. */
export function buildViews(
	graph: GraphPayload,
	{
		root = null,
		refreshSummary = null,
	}: { root?: string | null; refreshSummary?: Row | null } = {},
): Row {
	const nodes = graph.nodes;
	const edges = graph.edges;
	const layers = buildLayers(nodes);
	const likelyEntries = buildLikelyEntries(nodes, edges);
	const metrics = signalMetrics(graph.evidence.codeSignals ?? {});
	const relationships = relationshipCountsFromGraph(nodes, edges);
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
	const htmlReport = renderHtmlReport(overview, update);
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

/** Counts rows by a derived key. */
function countBy<T>(
	items: T[],
	keyFor: (item: T) => string,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) {
		const key = keyFor(item);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

/** Formats labels for report headings. */
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
