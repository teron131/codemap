/** Builds architecture, inventory, and intent views from graph evidence. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	callCodebaseMemoryTool,
	withFreshCodebaseMemoryProject,
} from "../codebase-memory/client.js";
import type {
	GraphEdge,
	GraphNode,
	GraphPayload,
} from "../source/graph/index.js";
import { buildFilePreviews } from "../source/signals/docstrings/index.js";
import {
	buildLikelyEntries,
	buildPathRankedLikelyEntries,
} from "./likely-entries.js";
import { renderSummaryText } from "./markdown.js";

type Row = Record<string, unknown>;

const GENERIC_BACKEND_NAMES = new Set([
	"append",
	"clear",
	"close",
	"connect",
	"exists",
	"get",
	"items",
	"json",
	"keys",
	"limitedRows",
	"open",
	"read",
	"read_text",
	"recordValue",
	"run",
	"set",
	"send",
	"stringField",
	"update",
	"values",
	"write",
	"write_text",
	"arrayValue",
	"numberField",
	"numberValue",
]);
const JSON_FORMAT = { format: "json" } as const;

/** Builds a rendered backend architecture summary when usable evidence exists. */
export function codebaseMemoryArchitectureSummary(root: string): string | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("get_architecture", {
			project: project.name,
			aspects: ["all"],
			...JSON_FORMAT,
		});
		if (!result.ok || !hasArchitectureAnswer(result.value)) {
			return null;
		}
		return renderCodebaseMemoryArchitectureSummary(result.value);
	});
}

/** Rejects successful-but-unknown architecture payloads so summary can fall back. */
function hasArchitectureAnswer(value: unknown): boolean {
	const record = recordValue(value);
	if (stringField(record.project) === null) {
		return false;
	}
	return (
		numberField(record.total_nodes) !== null ||
		numberField(record.total_edges) !== null ||
		["languages", "node_labels", "edge_types", "hotspots", "clusters"].some(
			(key) => arrayValue(record[key]).length > 0,
		)
	);
}

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

/** Builds language, category, and root inventory rows. */
export function buildInventoryView(
	stats: Record<string, unknown>,
	nodes: GraphNode[],
): Record<string, unknown> {
	const fileNodes = nodes.filter(
		(node) => node.filePath && !["function", "class"].includes(node.type),
	);
	const roots = new Map<string, number>();
	for (const node of fileNodes) {
		const rootName = node.filePath.includes("/")
			? (node.filePath.split("/", 1)[0] ?? ".")
			: ".";
		roots.set(rootName, (roots.get(rootName) ?? 0) + 1);
	}
	return {
		languages: topCountItems(recordValue(stats.languages)),
		categories: topCountItems(recordValue(stats.categories)),
		rootHotspots: [...roots.entries()]
			.sort(
				(left, right) => -left[1] - -right[1] || compareText(left[0], right[0]),
			)
			.slice(0, 8)
			.map(([name, count]) => ({ name, count })),
	};
}

/** Selects the highest-count rows from a counter map. */
export function topCountItems(counts: Record<string, unknown>): Row[] {
	return Object.entries(counts)
		.map(([name, count]) => ({ name, count: Number(count ?? 0) }))
		.sort(
			(left, right) =>
				-Number(left.count ?? 0) - -Number(right.count ?? 0) ||
				compareText(String(left.name), String(right.name)),
		)
		.slice(0, 8);
}

/** Builds README-derived intent lines for architecture output. */
export function buildIntentView(
	root: string | null,
	likelyEntries: Row[],
): Record<string, unknown> {
	const focusFiles = likelyEntries
		.map((entry) => String(entry.title ?? ""))
		.filter(Boolean)
		.slice(0, 5);
	const previews =
		root && existsSync(root) && focusFiles.length > 0
			? buildFilePreviews(root, { focusFiles, maxFiles: 5 })
			: [];
	return {
		readmePreview: readmeFirstLine(root),
		filePreviews: previews.filter((item) =>
			isUsefulIntentPreview(item.preview),
		),
	};
}

/** Checks whether a file preview carries real intent evidence. */
function isUsefulIntentPreview(preview: string): boolean {
	return Boolean(preview) && preview !== "none";
}

/** Reads the first useful README line for intent clues. */
export function readmeFirstLine(root: string | null): string {
	if (root === null) {
		return "";
	}
	for (const name of ["README.md", "README.rst", "readme.md"]) {
		const readmePath = path.join(root, name);
		if (!existsSync(readmePath)) {
			continue;
		}
		const text = readFileSync(readmePath, "utf8");
		return text.split(/\r?\n/).map(readmeIntentLine).find(Boolean) ?? "";
	}
	return "";
}

/** Extracts useful README intent text while ignoring decorative markup. */
export function readmeIntentLine(line: string): string {
	const stripped = line.trim();
	if (!stripped) {
		return "";
	}
	if (/^!\[[^\]]*\]\(/.test(stripped)) {
		return "";
	}
	if (/^<\/?(a|div|p|picture|source|img)\b/i.test(stripped)) {
		return "";
	}
	const withoutTags = stripped.replace(/<[^>]+>/g, " ");
	const normalized = withoutTags.split(/\s+/).filter(Boolean).join(" ");
	if (!normalized || normalized.startsWith("[!")) {
		return "";
	}
	return normalized;
}

/** Counts imports, contains edges, and inheritance relationships. */
export function relationshipCountsFromGraph(
	nodes: GraphNode[],
	edges: GraphEdge[],
): Record<string, number> {
	const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
	const counts = {
		pythonImportEdges: 0,
		typescriptImportEdges: 0,
		entrypointLikeFiles: 0,
	};
	for (const node of nodes) {
		const tags = new Set(node.tags ?? []);
		if (tags.has("entry-candidate")) {
			counts.entrypointLikeFiles += 1;
		}
	}
	for (const edge of edges) {
		if (edge.type !== "imports") {
			continue;
		}
		const source = nodesById.get(String(edge.source));
		const tags = new Set(source?.tags ?? []);
		if (tags.has("python")) {
			counts.pythonImportEdges += 1;
		}
		if (
			tags.has("typescript") ||
			tags.has("tsx") ||
			tags.has("javascript") ||
			tags.has("jsx")
		) {
			counts.typescriptImportEdges += 1;
		}
	}
	return counts;
}

/** Renders CodebaseMemory architecture output as compact source orientation. */
export function renderCodebaseMemoryArchitectureSummary(
	value: unknown,
): string {
	const record = recordValue(value);
	const countFacts = [
		countFact("nodes", record.total_nodes),
		countFact("edges", record.total_edges),
	].filter((item) => item !== null);
	const lines = ["# CodebaseMemory Architecture", ""];
	lines.push(`project: ${stringField(record.project) ?? "unknown"}`);
	if (countFacts.length > 0) {
		lines.push(countFacts.join(", "));
	}
	appendNamedCountLine(lines, "languages", record.languages, "language");
	appendNamedCountLine(lines, "node labels", record.node_labels, "label");
	appendNamedCountLine(lines, "edge types", record.edge_types, "type");
	appendSparseSymbolNote(lines, record.node_labels);
	appendHotspots(lines, record.hotspots);
	appendClusters(lines, record.clusters);
	return lines.join("\n");
}

/** Adds one comma-separated named count line when backend rows exist. */
function appendNamedCountLine(
	lines: string[],
	label: string,
	value: unknown,
	nameKey: string,
): void {
	const facts = arrayValue(value)
		.slice(0, 6)
		.map((item) => namedCountFact(item, nameKey))
		.filter((item) => item !== null);
	if (facts.length > 0) {
		lines.push(`${label}: ${facts.join(", ")}`);
	}
}

/** Adds the highest fan-in backend hotspots. */
function appendHotspots(lines: string[], value: unknown): void {
	const allRows = arrayValue(value);
	const genericCount = allRows.filter((item) => {
		const row = recordValue(item);
		const name = stringField(row.name) ?? stringField(row.qualified_name);
		return name !== null && genericBackendName(name);
	}).length;
	const hotspots = allRows
		.filter((item) => {
			const row = recordValue(item);
			const name = stringField(row.name) ?? stringField(row.qualified_name);
			return name !== null && !genericBackendName(name);
		})
		.slice(0, 4)
		.map((item) => {
			const row = recordValue(item);
			const name = stringField(row.name) ?? stringField(row.qualified_name);
			if (name === null) {
				return null;
			}
			const fanIn = numberField(row.fan_in);
			const file = stringField(row.file);
			const qualifiedName = stringField(row.qualified_name);
			const location = file ?? qualifiedNameSuffix(qualifiedName, name);
			const facts = [
				fanIn !== null ? `fan-in ${fanIn}` : null,
				location,
			].filter((fact) => fact !== null);
			return `- ${name}${facts.length > 0 ? ` (${facts.join(", ")})` : ""}`;
		})
		.filter((item) => item !== null);
	if (hotspots.length === 0) {
		return;
	}
	lines.push("");
	lines.push(
		`## Hotspots${genericCount > 0 ? ` (hidden generic: ${genericCount})` : ""}`,
	);
	lines.push(...hotspots);
}

/** Adds compact backend cluster summaries without member dumps. */
function appendClusters(lines: string[], value: unknown): void {
	const records = arrayValue(value).slice(0, 4).map(recordValue);
	const labelCounts = new Map<string, number>();
	for (const row of records) {
		const label = stringField(row.label);
		if (label !== null) {
			labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
		}
	}
	const clusters = records
		.map((item) => {
			const row = recordValue(item);
			const rawLabel = stringField(row.label);
			const label =
				rawLabel !== null && labelCounts.get(rawLabel) === 1 ? rawLabel : null;
			const members = numberField(row.members);
			const cohesion = numberField(row.cohesion);
			const topNodes = uniqueStrings(
				arrayValue(row.top_nodes)
					.map((node) => stringField(node))
					.filter(
						(node): node is string =>
							node !== null && !genericBackendName(node),
					),
			).slice(0, 4);
			const facts = [
				members !== null ? `${members} nodes` : null,
				cohesion !== null ? `cohesion=${formatScore(cohesion)}` : null,
				label !== null && topNodes.length > 0
					? `top: ${topNodes.join(", ")}`
					: null,
			].filter((fact) => fact !== null);
			const title = label ?? topNodes.join(", ");
			return title
				? `- ${title}${facts.length > 0 ? ` (${facts.join("; ")})` : ""}`
				: null;
		})
		.filter((item) => item !== null);
	if (clusters.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Clusters");
	lines.push(...clusters);
}

/** Adds a note when Codebase Memory indexed only coarse file/module nodes. */
function appendSparseSymbolNote(lines: string[], nodeLabels: unknown): void {
	const labels = new Map(
		arrayValue(nodeLabels).map((item) => {
			const row = recordValue(item);
			return [stringField(row.label), numberField(row.count) ?? 0] as const;
		}),
	);
	const symbolCount =
		(labels.get("Function") ?? 0) +
		(labels.get("Class") ?? 0) +
		(labels.get("Method") ?? 0);
	if (symbolCount > 0) {
		return;
	}
	lines.push(
		"note: no function/class/method nodes; summary is file-level only.",
	);
}

/** Renders a backend named count row. */
function namedCountFact(value: unknown, nameKey: string): string | null {
	const row = recordValue(value);
	const name = stringField(row[nameKey]) ?? stringField(row.name);
	if (name === null) {
		return null;
	}
	const count = numberField(row.count) ?? numberField(row.file_count);
	return count === null ? name : `${name} ${count}`;
}

/** Renders a numeric count field. */
function countFact(label: string, value: unknown): string | null {
	const count = numberField(value);
	return count === null ? null : `${label}: ${count}`;
}

/** Builds a short disambiguating suffix from a backend qualified name. */
function qualifiedNameSuffix(
	qualifiedName: string | null,
	name: string,
): string | null {
	if (qualifiedName === null || qualifiedName === name) {
		return null;
	}
	const parts = qualifiedName.split(".").filter(Boolean);
	return parts.length > 1 ? parts.slice(-4).join(".") : qualifiedName;
}

/** Deduplicates strings while preserving backend rank order. */
function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		unique.push(value);
	}
	return unique;
}

/** Detects generic backend names that should not dominate summary slots. */
function genericBackendName(value: string): boolean {
	const name =
		value
			.replace(/\s+\(.*/, "")
			.split(".")
			.pop() ?? value;
	return GENERIC_BACKEND_NAMES.has(name);
}

/** Formats backend confidence scores without noisy floating-point tails. */
function formatScore(value: number): string {
	return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Reads arrays while rejecting other values. */
function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Reads string fields while rejecting empty values. */
function stringField(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads number fields while rejecting other values. */
function numberField(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
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
