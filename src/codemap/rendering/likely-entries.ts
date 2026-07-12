/** Builds likely-entry rows from graph relationship and path evidence. */
import path from "node:path";

import type { GraphEdge, GraphNode } from "../source/graph/index.js";
import { isGeneratedSignalPath } from "../source/signals/index.js";

type Row = Record<string, unknown>;

type LikelyEntryRole = {
	label: string;
	reason: string;
};

/** Builds likely entrypoint rows from graph node centrality. */
export function buildLikelyEntries(
	nodes: GraphNode[],
	edges: GraphEdge[],
): Row[] {
	const candidates = likelyEntryCandidates(nodes);
	const fanIn = countBy(
		edges.filter((edge) => edge.type === "imports"),
		(edge) => edge.target,
	);
	const fanOut = countBy(
		edges.filter((edge) => edge.type === "imports"),
		(edge) => edge.source,
	);
	const scored = candidates.slice().sort((left, right) => {
		const tuple = [
			-likelyEntryScore(left, fanIn, fanOut) -
				-likelyEntryScore(right, fanIn, fanOut),
			pathDepth(left.filePath) - pathDepth(right.filePath),
		];
		for (const diff of tuple) {
			if (diff !== 0) {
				return diff;
			}
		}
		return compareText(left.filePath, right.filePath);
	});
	return selectLikelyEntriesWithSurfaceCap(scored, 8).map((node) =>
		likelyEntryRow(node, {
			description: likelyEntryDescription(node, fanIn, fanOut),
			relationshipCount: (fanIn.get(node.id) ?? 0) + (fanOut.get(node.id) ?? 0),
		}),
	);
}

/** Builds path-ranked likely entrypoint rows when detailed graph edges were skipped. */
export function buildPathRankedLikelyEntries(nodes: GraphNode[]): Row[] {
	const scored = likelyEntryCandidates(nodes)
		.slice()
		.sort((left, right) => {
			const tuple = [
				pathRoleRank(left.filePath) - pathRoleRank(right.filePath),
				entryCandidateRank(left) - entryCandidateRank(right),
				pathDepth(left.filePath) - pathDepth(right.filePath),
			];
			for (const diff of tuple) {
				if (diff !== 0) {
					return diff;
				}
			}
			return compareText(left.filePath, right.filePath);
		});
	return scored.slice(0, 8).map((node) =>
		likelyEntryRow(node, {
			description: "Fallback entry candidate; detailed graph skipped.",
			relationshipCount: 0,
		}),
	);
}

/** Selects source-file candidates while preserving a fallback when filters empty out. */
function likelyEntryCandidates(nodes: GraphNode[]): GraphNode[] {
	const fileNodes = nodes.filter(
		(node) => node.filePath && !["function", "class"].includes(node.type),
	);
	const codeNodes = fileNodes.filter((node) =>
		(node.tags ?? []).includes("code"),
	);
	const productionCodeNodes = codeNodes.filter(
		(node) => !(node.tags ?? []).includes("test"),
	);
	const baseCandidates =
		productionCodeNodes.length > 0
			? productionCodeNodes
			: codeNodes.length > 0
				? codeNodes
				: fileNodes;
	const generatedFilteredCandidates = baseCandidates.filter(
		(node) => !isGeneratedSignalPath(node.filePath),
	);
	return generatedFilteredCandidates.length > 0
		? generatedFilteredCandidates
		: baseCandidates;
}

/** Builds one public likely-entry row. */
function likelyEntryRow(
	node: GraphNode,
	{
		description,
		relationshipCount,
	}: { description: string; relationshipCount?: number },
): Row {
	const role = likelyEntryRole(node, relationshipCount);
	return {
		title: String(node.filePath || node.name || node.id),
		role: role.label,
		reason: role.reason,
		description,
	};
}

/** Describes why a likely-entry candidate was selected. */
function likelyEntryDescription(
	node: GraphNode,
	fanIn: Map<string, number>,
	fanOut: Map<string, number>,
): string {
	const incoming = fanIn.get(node.id) ?? 0;
	const outgoing = fanOut.get(node.id) ?? 0;
	if (incoming === 0 && outgoing === 0) {
		return "Source file selected without import relationship edges.";
	}
	if (incoming + outgoing <= 1) {
		return `Low-relationship source file with ${importEdgeCountText(incoming, "incoming")} and ${importEdgeCountText(outgoing, "outgoing")}.`;
	}
	return `High-signal file with ${incoming} incoming and ${outgoing} outgoing import edges.`;
}

/** Formats an import edge count with singular/plural wording. */
function importEdgeCountText(count: number, direction: string): string {
	return `${count} ${direction} import ${count === 1 ? "edge" : "edges"}`;
}

/** Keeps likely entries from being only package barrels. */
function selectLikelyEntriesWithSurfaceCap(
	nodes: GraphNode[],
	limit: number,
): GraphNode[] {
	const selected: GraphNode[] = [];
	const deferredPackageSurfaces: GraphNode[] = [];
	let packageSurfaces = 0;
	for (const node of nodes) {
		if (isPackageSurfacePath(node.filePath) && packageSurfaces >= 2) {
			deferredPackageSurfaces.push(node);
			continue;
		}
		selected.push(node);
		if (isPackageSurfacePath(node.filePath)) {
			packageSurfaces += 1;
		}
		if (selected.length >= limit) {
			return selected;
		}
	}
	for (const node of deferredPackageSurfaces) {
		selected.push(node);
		if (selected.length >= limit) {
			break;
		}
	}
	return selected;
}

/** Scores normal graph entries for navigation usefulness, not only import volume. */
function likelyEntryScore(
	node: GraphNode,
	fanIn: Map<string, number>,
	fanOut: Map<string, number>,
): number {
	const incoming = fanIn.get(node.id) ?? 0;
	const outgoing = fanOut.get(node.id) ?? 0;
	const filePath = node.filePath;
	const centrality = incoming + outgoing;
	let score = centralityScore(centrality);
	if ((node.tags ?? []).includes("entry-candidate")) {
		score += isShallowEntrypoint(filePath) ? 80 : 12;
	}
	if (isPackageSurfacePath(filePath) && !isSupportApiPath(filePath)) {
		score += 45 + Math.min(centrality, 30);
	}
	if (isImplementationSurfacePath(filePath)) {
		score += 28;
	}
	score -= utilitySurfacePenalty(filePath);
	if (isDeepToolEntrypoint(filePath)) {
		score -= 24;
	}
	if (isSupportApiPath(filePath)) {
		score -= 80;
	}
	return score;
}

/** Caps import centrality so extreme fan-in does not swamp role evidence. */
function centralityScore(centrality: number): number {
	return Math.min(centrality, 120);
}

/** Checks whether an entry-candidate filename is near an actual package/app root. */
function isShallowEntrypoint(filePath: string): boolean {
	const parts = filePath.split("/");
	const name = path.basename(filePath).toLowerCase();
	if (parts.length <= 3) {
		return true;
	}
	if (name === "__main__.py") {
		return parts.length <= 5;
	}
	return parts.includes("src") && parts.length <= 5;
}

/** Checks for public package surfaces that are useful navigation starts. */
function isPackageSurfacePath(filePath: string): boolean {
	const name = path.basename(filePath).toLowerCase();
	return name === "__init__.py" || name === "index.ts" || name === "index.js";
}

/** Checks for implementation files that commonly own important workflows. */
function isImplementationSurfacePath(filePath: string): boolean {
	const name = path.basename(filePath).toLowerCase();
	return [
		"factory.py",
		"main.py",
		"run.py",
		"runner.py",
		"server.py",
		"cli.py",
	].includes(name);
}

/** Penalizes broad support files that are often contracts rather than starts. */
function utilitySurfacePenalty(filePath: string): number {
	const name = path.basename(filePath).toLowerCase();
	if (
		[
			"types.py",
			"types.ts",
			"exceptions.py",
			"constants.py",
			"constants.ts",
			"base.py",
			"base.ts",
			"utils.py",
			"utils.ts",
		].includes(name)
	) {
		return 60;
	}
	if (filePath.includes("/utils/") || filePath.includes("/load/import_map.")) {
		return 120;
	}
	return 0;
}

/** Checks for deep app files that are usually plugin/tool examples. */
function isDeepToolEntrypoint(filePath: string): boolean {
	const name = path.basename(filePath).toLowerCase();
	return name === "app.py" && filePath.split("/").length > 4;
}

/** Checks for internal API helper packages that should not dominate entry lists. */
function isSupportApiPath(filePath: string): boolean {
	return filePath.includes("/_api/");
}

/** Names the navigation role and concise rationale for one likely-entry row. */
function likelyEntryRole(
	node: GraphNode,
	relationshipCount?: number,
): LikelyEntryRole {
	const filePath = node.filePath;
	if (isSupportApiPath(filePath)) {
		return {
			label: "support source",
			reason: "support path retained by relationship evidence",
		};
	}
	if (isPackageSurfacePath(filePath)) {
		return {
			label: "package surface",
			reason: "public index or package initializer",
		};
	}
	if (isCliEntryPath(filePath)) {
		return {
			label: "cli entry",
			reason: "conventional CLI path or filename",
		};
	}
	if (isServerEntryPath(filePath)) {
		return {
			label: "server entry",
			reason: "conventional server or gateway filename",
		};
	}
	if (isImplementationSurfacePath(filePath)) {
		return {
			label: "implementation surface",
			reason: "workflow-owning implementation filename",
		};
	}
	if ((node.tags ?? []).includes("entry-candidate")) {
		return {
			label: "entry file",
			reason: "conventional app, main, or index filename",
		};
	}
	if (utilitySurfacePenalty(filePath) > 0) {
		return {
			label: "support source",
			reason: "support path retained by relationship evidence",
		};
	}
	if (relationshipCount !== undefined && relationshipCount <= 1) {
		return {
			label: "source file",
			reason: "selected by source/path evidence",
		};
	}
	return {
		label: "high-centrality source",
		reason: "selected by import relationship evidence",
	};
}

/** Checks for conventional CLI entry files. */
function isCliEntryPath(filePath: string): boolean {
	const name = path.basename(filePath).toLowerCase();
	return (
		["cli.py", "cli.ts", "cli.js", "run-main.ts", "run-main.js"].includes(
			name,
		) || filePath.split("/").includes("cli")
	);
}

/** Checks for conventional server or gateway entry files. */
function isServerEntryPath(filePath: string): boolean {
	const parts = filePath.split("/");
	const name = path.basename(filePath).toLowerCase();
	return (
		["server.py", "server.ts", "server.js"].includes(name) &&
		parts.some((part) => ["server", "gateway"].includes(part))
	);
}

/** Ranks conventional entry filenames before generic code files. */
function entryCandidateRank(node: GraphNode): number {
	return (node.tags ?? []).includes("entry-candidate") ? 0 : 1;
}

/** Ranks likely application roots before broad plugin, extension, and test catalogs. */
function pathRoleRank(filePath: string): number {
	const parts = filePath.split("/");
	const root = parts[0] ?? "";
	if (filePath === "src/index.ts" || filePath === "src/index.js") {
		return 0;
	}
	if (root === "src" && parts.some((part) => part === "cli")) {
		return cliPathRank(filePath);
	}
	if (
		root === "src" &&
		parts.some((part) => ["server", "gateway", "app"].includes(part))
	) {
		return serverPathRank(filePath);
	}
	if (["app", "apps", "ui", "packages", "libs"].includes(root)) {
		return 3;
	}
	if (root === "src") {
		return 4;
	}
	if (["bin", "cli", "server"].includes(root)) {
		return 5;
	}
	if (["extensions", "plugins", "examples", "test", "tests"].includes(root)) {
		return 7;
	}
	return 6;
}

/** Ranks true CLI entry files before ordinary command modules. */
function cliPathRank(filePath: string): number {
	const name = path.basename(filePath).toLowerCase();
	if (
		[
			"cli.ts",
			"cli.js",
			"index.ts",
			"index.js",
			"main.ts",
			"main.js",
			"run-main.ts",
			"run-main.js",
		].includes(name)
	) {
		return 1;
	}
	return 4;
}

/** Ranks true server/app entry files before ordinary server modules. */
function serverPathRank(filePath: string): number {
	const name = path.basename(filePath).toLowerCase();
	if (
		[
			"app.ts",
			"app.js",
			"index.ts",
			"index.js",
			"main.ts",
			"main.js",
			"server.ts",
			"server.js",
		].includes(name)
	) {
		return 2;
	}
	return 4;
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

/** Counts path segments for shallow fallback ordering. */
function pathDepth(filePath: string): number {
	return filePath.split("/").length;
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
