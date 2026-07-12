/** Builds architecture, inventory, and intent views from graph evidence. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { GraphEdge, GraphNode } from "../source/graph/index.js";
import { buildFilePreviews } from "../source/signals/docstrings/index.js";

type Row = Record<string, unknown>;

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
