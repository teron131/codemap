/** Resolves inspection target strings to files, symbols, and emit paths. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { expandUser } from "../../common.js";
import type { GraphNode } from "../graph/index.js";
import { type FileMetrics, scanFile } from "../scanner/index.js";

/** Converts inspect targets into normalized slash-separated paths. */
export function normalizeTarget(root: string, target: string): string {
	const expanded = expandUser(target);
	if (path.isAbsolute(expanded)) {
		const relative = path.relative(root, expanded);
		if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
			return relative;
		}
		if (expanded === root) {
			return "";
		}
		return target;
	}
	return target;
}

/** Selects scan entries that belong to an inspect target path. */
export function targetFilePaths(
	root: string,
	rawTarget: string,
	scan: Record<string, unknown>,
	_pythonTreesByPath: Record<string, unknown>,
	fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> {
	const target = normalizeTarget(root, rawTarget);
	const files = scanFiles(scan);
	const filesByPath = new Set(files.map((entry) => String(entry.path ?? "")));
	if (isDirectory(path.join(root, target))) {
		return directoryFilePaths(target, filesByPath);
	}
	if (filesByPath.has(target)) {
		return new Set([target]);
	}
	return symbolFilePaths(root, target, files, fileMetricsByPath);
}

/** Lists files under a directory inspection target. */
export function directoryFilePaths(
	target: string,
	filesByPath: Set<string>,
): Set<string> {
	if (target === "" || target === ".") {
		return new Set(filesByPath);
	}
	const prefix = `${target.replace(/\/+$/, "")}/`;
	return new Set(
		[...filesByPath].filter((filePath) => filePath.startsWith(prefix)),
	);
}

/** Finds files that define a requested symbol name. */
export function symbolFilePaths(
	root: string,
	target: string,
	files: Array<Record<string, unknown>>,
	fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> {
	const paths = new Set<string>();
	for (const scanEntry of files) {
		const relPath = String(scanEntry.path ?? "");
		let metrics = fileMetricsByPath[relPath];
		if (metrics === undefined && relPath) {
			metrics = scanFile(path.join(root, relPath), { displayRoot: root });
		}
		if (
			metrics &&
			(metrics.functionNames.includes(target) ||
				metrics.variableNames.includes(target) ||
				metrics.exportedNames.includes(target))
		) {
			paths.add(relPath);
		}
	}
	return paths;
}

/** Resolves files whose source should be emitted for inspection. */
export function inspectEmitPaths(
	root: string,
	rawTarget: string,
	scan: Record<string, unknown>,
	importMap: Record<string, string[] | undefined>,
	pythonTreesByPath: Record<string, unknown>,
	fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> | null {
	const paths = targetFilePaths(
		root,
		rawTarget,
		scan,
		pythonTreesByPath,
		fileMetricsByPath,
	);
	if (paths.size === 0) {
		return null;
	}
	const basePaths = new Set(paths);
	for (const sourcePath of basePaths) {
		for (const targetPath of importMap[sourcePath] ?? []) {
			paths.add(targetPath);
		}
	}
	for (const [sourcePath, targets] of Object.entries(importMap)) {
		if ((targets ?? []).some((targetPath) => basePaths.has(targetPath))) {
			paths.add(sourcePath);
		}
	}
	return paths;
}

/** Lists graph nodes that can satisfy an inspect target. */
export function inspectCandidates(
	graphNodes: GraphNode[],
	target: string,
): GraphNode[] {
	const lowered = target.toLowerCase();
	const exact: GraphNode[] = [];
	const partial: GraphNode[] = [];
	for (const node of graphNodes) {
		const values = [
			String(node.id ?? ""),
			String(node.filePath ?? ""),
			String(node.name ?? ""),
		];
		if (values.some((value) => value.toLowerCase() === lowered)) {
			exact.push(node);
		} else if (values.some((value) => value.toLowerCase().includes(lowered))) {
			partial.push(node);
		}
	}
	return [...exact, ...partial];
}

/** Builds the human-readable label for a graph node candidate. */
export function nodeLabel(
	node: Partial<GraphNode> | Record<string, unknown>,
): string {
	const filePath = String(node.filePath ?? "");
	if (node.type === "function" || node.type === "class") {
		const lineRange = Array.isArray(node.lineRange) ? node.lineRange : [];
		const suffix = lineRange.length > 0 ? `:${String(lineRange[0])}` : "";
		return `${String(node.name ?? "")} in ${filePath}${suffix}`;
	}
	return filePath || String(node.id ?? "");
}

/** Filters scan entries down to files under an inspect target. */
function scanFiles(
	scan: Record<string, unknown>,
): Array<Record<string, unknown>> {
	return Array.isArray(scan.files)
		? scan.files.filter(
				(entry): entry is Record<string, unknown> =>
					entry !== null && typeof entry === "object" && !Array.isArray(entry),
			)
		: [];
}

/** Checks the directory condition used by source inspection targets. */
function isDirectory(filePath: string): boolean {
	try {
		return existsSync(filePath) && statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}
