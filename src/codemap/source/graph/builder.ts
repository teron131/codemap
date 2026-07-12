/** Builds graph nodes and edges from scan, import, and structure evidence. */
import path from "node:path";

import { ENTRYPOINT_BASENAMES } from "../scanner/index.js";
import type { GraphEdge, GraphNode } from "./schema.js";

export const SIGNIFICANT_FUNCTION_LINES = 10;
export const SIGNIFICANT_CLASS_LINES = 20;

export type ScanLikeEntry = {
	path: string;
	language?: string;
	fileCategory?: string;
	sizeLines?: number;
};

export type StructureEntry = {
	path: string;
	functions?: Array<Record<string, unknown>>;
	classes?: Array<Record<string, unknown>>;
	exports?: Array<Record<string, unknown>>;
	callGraph?: Array<Record<string, unknown>>;
	[key: string]: unknown;
};

/** Classifies a scanned file with language, category, and role tags. */
export function classifyTags(scanEntry: ScanLikeEntry): string[] {
	const filePath = String(scanEntry.path);
	const category = String(scanEntry.fileCategory ?? "code");
	const language = String(scanEntry.language ?? "unknown");
	const tags = new Set([category, language]);
	const lower = filePath.toLowerCase();
	const name = path.basename(filePath);
	const nameLower = name.toLowerCase();
	if (lower.includes("test") || lower.includes("spec")) {
		tags.add("test");
	}
	if (name === "README.md" || name === "readme.md") {
		tags.add("entry-documentation");
	}
	if (
		name === "package.json" ||
		name === "pyproject.toml" ||
		name === "go.mod" ||
		name === "Cargo.toml"
	) {
		tags.add("project-manifest");
	}
	if (
		name === "Dockerfile" ||
		name === "docker-compose.yml" ||
		lower.includes(".github/workflows/")
	) {
		tags.add("infrastructure");
	}
	if (ENTRYPOINT_BASENAMES.has(nameLower)) {
		tags.add("entry-candidate");
	}
	return [...tags].filter((tag) => tag && tag !== "unknown").sort();
}

/** Classifies a file graph node type from path and category. */
export function nodeTypeForFile(scanEntry: ScanLikeEntry): string {
	const category = String(scanEntry.fileCategory ?? "code");
	const language = String(scanEntry.language ?? "unknown");
	const filePath = String(scanEntry.path).toLowerCase();
	if (category === "docs") {
		return "document";
	}
	if (category === "config") {
		return "config";
	}
	if (category === "infra") {
		if (
			filePath.includes(".github/workflows/") ||
			filePath.includes("jenkinsfile")
		) {
			return "pipeline";
		}
		if (filePath.endsWith(".tf") || filePath.endsWith(".tfvars")) {
			return "resource";
		}
		return "service";
	}
	if (category === "data") {
		if (
			language === "graphql" ||
			language === "protobuf" ||
			language === "prisma"
		) {
			return "schema";
		}
		if (language === "sql") {
			return "table";
		}
	}
	return "file";
}

/** Builds the short file summary used on graph file nodes. */
export function fileSummary(
	scanEntry: ScanLikeEntry,
	structure: StructureEntry | null | undefined,
	importTargets: string[],
): string {
	const filePath = String(scanEntry.path);
	const language = String(scanEntry.language ?? "unknown");
	const category = String(scanEntry.fileCategory ?? "code");
	const lines = Number(scanEntry.sizeLines ?? 0) || 0;
	const bits = [`${category} file in ${language}`, `${lines} lines`];
	if (structure) {
		const counts: string[] = [];
		for (const [key, label] of [
			["functions", "functions"],
			["classes", "classes"],
			["endpoints", "endpoints"],
			["services", "services"],
			["resources", "resources"],
			["definitions", "definitions"],
		] as const) {
			const count = arrayValue(structure[key]).length;
			if (count) {
				counts.push(`${count} ${label}`);
			}
		}
		if (counts.length > 0) {
			bits.push(counts.join(", "));
		}
	}
	if (importTargets.length > 0) {
		bits.push(`imports ${importTargets.length} project files`);
	}
	return `${filePath}: ${bits.join("; ")}.`;
}

/** Calculates a coarse complexity score from source line count. */
export function complexityForLines(lines: number): string {
	if (lines < 50) {
		return "simple";
	}
	if (lines <= 200) {
		return "moderate";
	}
	return "complex";
}

/** Builds a start and end line range. */
export function lineSpan(item: Record<string, unknown>): number {
	return Number(item.endLine ?? 0) - Number(item.startLine ?? 0) + 1;
}

/** Adds a graph edge while deduplicating source-target-type triples. */
export function addEdge(
	edges: GraphEdge[],
	seen: Set<string>,
	source: string,
	target: string,
	edgeType: string,
	{ evidence = "" }: { evidence?: string } = {},
): void {
	const key = `${source}\0${target}\0${edgeType}`;
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	const edge: GraphEdge = { source, target, type: edgeType };
	if (evidence) {
		edge.evidence = evidence;
	}
	edges.push(edge);
}

/** Builds a graph node for one source file. */
export function fileNode(
	relPath: string,
	scanEntry: ScanLikeEntry,
	fileStructure: StructureEntry | null | undefined,
	importTargets: string[],
): GraphNode {
	const nodeType = nodeTypeForFile(scanEntry);
	const lines = Number(scanEntry.sizeLines ?? 0) || 0;
	return {
		id: `${nodeType}:${relPath}`,
		type: nodeType,
		name: path.basename(relPath),
		filePath: relPath,
		summary: fileSummary(scanEntry, fileStructure, importTargets),
		tags: classifyTags(scanEntry),
		complexity: complexityForLines(lines),
		metrics: {
			lines,
			fanOut: importTargets.length,
		},
	};
}

/** Adds graph edges from a file node to its resolved import targets. */
export function addImportEdges(
	edges: GraphEdge[],
	seenEdges: Set<string>,
	sourceId: string,
	importTargets: string[],
	allFilesByPath: Record<string, ScanLikeEntry>,
): void {
	for (const target of importTargets) {
		const targetScanEntry = allFilesByPath[target];
		if (!targetScanEntry) {
			continue;
		}
		addEdge(
			edges,
			seenEdges,
			sourceId,
			`${nodeTypeForFile(targetScanEntry)}:${target}`,
			"imports",
			{
				evidence: "native-import-map",
			},
		);
	}
}

/** Builds a graph node for a function definition. */
export function functionNode(
	relPath: string,
	functionInfo: Record<string, unknown>,
): GraphNode {
	const functionName = String(functionInfo.name ?? "");
	return {
		id: `function:${relPath}:${functionName}`,
		type: "function",
		name: functionName,
		filePath: relPath,
		lineRange: [
			numberOrNull(functionInfo.startLine),
			numberOrNull(functionInfo.endLine),
		],
		summary: `${functionName} in ${relPath}.`,
		tags: ["function"],
		complexity: complexityForLines(lineSpan(functionInfo)),
	};
}

/** Builds a graph node for a class definition. */
export function classNode(
	relPath: string,
	classInfo: Record<string, unknown>,
): GraphNode {
	const className = String(classInfo.name ?? "");
	return {
		id: `class:${relPath}:${className}`,
		type: "class",
		name: className,
		filePath: relPath,
		lineRange: [
			numberOrNull(classInfo.startLine),
			numberOrNull(classInfo.endLine),
		],
		summary: `${className} class in ${relPath}.`,
		tags: ["class"],
		complexity: complexityForLines(lineSpan(classInfo)),
	};
}

/** Adds graph nodes and containment edges for file-level symbols. */
export function addStructureNodes(
	nodes: GraphNode[],
	edges: GraphEdge[],
	seenEdges: Set<string>,
	fileNodeId: string,
	relPath: string,
	fileStructure: StructureEntry,
): Set<string> {
	const exports = new Set(
		arrayValue(fileStructure.exports).map((exportInfo) =>
			String(exportInfo.name),
		),
	);
	const functionNodeIds = new Set<string>();
	for (const functionInfo of arrayValue(fileStructure.functions)) {
		const functionName = String(functionInfo.name ?? "");
		if (
			lineSpan(functionInfo) < SIGNIFICANT_FUNCTION_LINES &&
			!exports.has(functionName)
		) {
			continue;
		}
		const node = functionNode(relPath, functionInfo);
		functionNodeIds.add(String(node.id));
		nodes.push(node);
		addEdge(edges, seenEdges, fileNodeId, String(node.id), "contains", {
			evidence: "native-structure",
		});
	}
	for (const classInfo of arrayValue(fileStructure.classes)) {
		const className = String(classInfo.name ?? "");
		const methodCount = arrayValue(classInfo.methods).length;
		if (
			lineSpan(classInfo) < SIGNIFICANT_CLASS_LINES &&
			methodCount < 2 &&
			!exports.has(className)
		) {
			continue;
		}
		const node = classNode(relPath, classInfo);
		nodes.push(node);
		addEdge(edges, seenEdges, fileNodeId, String(node.id), "contains", {
			evidence: "native-structure",
		});
	}
	return functionNodeIds;
}

/** Adds call graph edges from function structure into graph payloads. */
export function addCallEdges(
	edges: GraphEdge[],
	seenEdges: Set<string>,
	structure: { results?: StructureEntry[] },
	functionNodeIds: Set<string>,
): void {
	for (const structureEntry of structure.results ?? []) {
		const relPath = structureEntry.path;
		for (const call of arrayValue(structureEntry.callGraph)) {
			const source = `function:${relPath}:${String(call.caller)}`;
			const target = `function:${relPath}:${String(call.callee)}`;
			if (functionNodeIds.has(source) && functionNodeIds.has(target)) {
				addEdge(edges, seenEdges, source, target, "calls", {
					evidence: `line ${String(call.lineNumber)}`,
				});
			}
		}
	}
}

/** Builds the full graph node and edge set from source evidence. */
export function buildNodesAndEdges(
	scan: { files?: ScanLikeEntry[] },
	structure: { results?: StructureEntry[] },
	importMap: Record<string, string[]>,
	{ emitPaths }: { emitPaths?: Set<string> | null } = {},
): [GraphNode[], GraphEdge[]] {
	const allFilesByPath = Object.fromEntries(
		(scan.files ?? []).map((scanEntry) => [scanEntry.path, scanEntry]),
	);
	const filesByPath =
		emitPaths === undefined || emitPaths === null
			? allFilesByPath
			: Object.fromEntries(
					Object.entries(allFilesByPath).filter(([filePath]) =>
						emitPaths.has(filePath),
					),
				);
	const structureByPath = Object.fromEntries(
		(structure.results ?? []).map((structureEntry) => [
			structureEntry.path,
			structureEntry,
		]),
	);
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const seenEdges = new Set<string>();
	const functionNodeIds = new Set<string>();

	for (const [relPath, scanEntry] of Object.entries(filesByPath).sort(
		([left], [right]) => left.localeCompare(right),
	)) {
		const fileStructure = structureByPath[relPath];
		const importTargets = importMap[relPath] ?? [];
		const node = fileNode(relPath, scanEntry, fileStructure, importTargets);
		const nodeId = String(node.id);
		nodes.push(node);
		addImportEdges(edges, seenEdges, nodeId, importTargets, allFilesByPath);
		if (!fileStructure) {
			continue;
		}
		for (const functionNodeId of addStructureNodes(
			nodes,
			edges,
			seenEdges,
			nodeId,
			relPath,
			fileStructure,
		)) {
			functionNodeIds.add(functionNodeId);
		}
	}

	addCallEdges(edges, seenEdges, structure, functionNodeIds);
	return [nodes, edges];
}

/** Builds a graph fragment for reanalyzed files only. */
export function buildGraphFragment(
	scan: { files?: ScanLikeEntry[] },
	structure: { results?: StructureEntry[] },
	importMap: Record<string, string[]>,
	relPaths: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const [nodes, edges] = buildNodesAndEdges(scan, structure, importMap, {
		emitPaths: relPaths,
	});
	return { nodes, edges };
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/** Preserves numeric metric fields and drops non-numeric values. */
function numberOrNull(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}
