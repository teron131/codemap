/** Plans and applies incremental artifact graph refreshes. */
import { existsSync } from "node:fs";
import path from "node:path";

import { fileHash } from "../common.js";
import { runStructure, type ScanEntry } from "../source/extraction/index.js";
import type { StructureEntry } from "../source/graph/builder.js";
import {
	buildGraphFragment,
	type GraphEdge,
	type GraphPayload,
} from "../source/graph/index.js";
import { buildFileFingerprint } from "./fingerprints.js";
import type { ArtifactFingerprints } from "./schema.js";

export const REFRESH_POLICY_PARTS = [
	"Direct structural changes plus one-hop import dependents are reanalyzed;",
	"import dependencies are recorded for context.",
] as const;

export type ArtifactChanges = {
	added: Set<string>;
	deleted: Set<string>;
	contentChanged: Set<string>;
};

/** Finds retained files whose content hash changed. */
export function changedContentPaths(
	retainedFiles: Set<string>,
	fingerprints: ArtifactFingerprints,
	currentHashes: Record<string, string>,
): Set<string> {
	const changed = new Set<string>();
	for (const filePath of retainedFiles) {
		if (fingerprints.files[filePath]?.contentHash !== currentHashes[filePath]) {
			changed.add(filePath);
		}
	}
	return changed;
}

/** Compares saved fingerprints with current content hashes. */
export function artifactChanges(
	fingerprints: ArtifactFingerprints,
	currentHashes: Record<string, string>,
): ArtifactChanges {
	const oldFiles = new Set(Object.keys(fingerprints.files ?? {}));
	const currentFiles = new Set(Object.keys(currentHashes));
	const retained = intersection(currentFiles, oldFiles);
	return {
		added: difference(currentFiles, oldFiles),
		deleted: difference(oldFiles, currentFiles),
		contentChanged: changedContentPaths(retained, fingerprints, currentHashes),
	};
}

/** Builds current content hashes for scanned artifact files. */
export function currentContentHashes(
	root: string,
	scan: { files?: Array<Record<string, unknown>> },
): Record<string, string> {
	const hashes: Record<string, string> = {};
	for (const scanEntry of arrayRows(scan.files)) {
		const relPath = String(scanEntry.path);
		const absPath = path.join(root, relPath);
		if (existsSync(absPath)) {
			hashes[relPath] = fileHash(absPath);
		}
	}
	return hashes;
}

/** Removes graph nodes and edges for deleted or refreshed files. */
export function removeFileNodes(
	graph: GraphPayload,
	relPaths: Set<string>,
	{ removeIncoming = true }: { removeIncoming?: boolean } = {},
): void {
	const removedIds = new Set<string>();
	const remainingNodes = [];
	for (const node of graph.nodes ?? []) {
		if (relPaths.has(String(node.filePath ?? ""))) {
			removedIds.add(String(node.id));
		} else {
			remainingNodes.push(node);
		}
	}
	graph.nodes = remainingNodes;

	const remainingEdges = [];
	for (const edge of graph.edges ?? []) {
		const sourceRemoved = removedIds.has(String(edge.source));
		const targetRemoved = removeIncoming && removedIds.has(String(edge.target));
		if (!sourceRemoved && !targetRemoved) {
			remainingEdges.push(edge);
		}
	}
	graph.edges = remainingEdges;
}

/** Replaces graph nodes for refreshed files while retaining safe edges. */
export function patchGraphNodes(
	graph: GraphPayload,
	graphPatch: { nodes: GraphPayload["nodes"]; edges: GraphEdge[] },
	relPaths: Set<string>,
): void {
	removeFileNodes(graph, relPaths, { removeIncoming: false });
	graph.nodes.push(...graphPatch.nodes);
	const existing = new Set(
		(graph.edges ?? []).map((edge) =>
			edgeKey(edge.source, edge.target, edge.type),
		),
	);
	for (const edge of graphPatch.edges) {
		const key = edgeKey(edge.source, edge.target, edge.type);
		if (!existing.has(key)) {
			existing.add(key);
			graph.edges.push(edge);
		}
	}
}

/** Finds files that import selected target files. */
export function importDependents(
	importMap: Record<string, string[]>,
	targets: Set<string>,
): Set<string> {
	if (targets.size === 0) {
		return new Set();
	}
	const dependents = new Set<string>();
	for (const [source, imports] of Object.entries(importMap)) {
		if (!targets.has(source) && imports.some((target) => targets.has(target))) {
			dependents.add(source);
		}
	}
	return dependents;
}

/** Finds direct import dependencies for selected source files. */
export function importDependencies(
	importMap: Record<string, string[]>,
	sources: Set<string>,
): Set<string> {
	const dependencies = new Set<string>();
	for (const source of sources) {
		for (const dependency of importMap[source] ?? []) {
			dependencies.add(dependency);
		}
	}
	return dependencies;
}

/** Finds import dependents from existing graph import edges. */
export function graphImportDependents(
	graph: GraphPayload,
	targets: Set<string>,
): Set<string> {
	if (targets.size === 0) {
		return new Set();
	}
	const nodePaths = Object.fromEntries(
		(graph.nodes ?? []).map((node) => [
			String(node.id),
			String(node.filePath ?? ""),
		]),
	);
	const targetIds = new Set(
		Object.entries(nodePaths)
			.filter(([, relPath]) => targets.has(relPath))
			.map(([nodeId]) => nodeId),
	);
	const dependents = new Set<string>();
	for (const edge of graph.edges ?? []) {
		if (edge.type !== "imports" || !targetIds.has(String(edge.target))) {
			continue;
		}
		const sourcePath = nodePaths[String(edge.source)] ?? "";
		if (sourcePath && !targets.has(sourcePath)) {
			dependents.add(sourcePath);
		}
	}
	return dependents;
}

/** Builds the incremental artifact refresh plan and impact summary. */
export function buildRefreshPlan(
	graph: GraphPayload,
	importMap: Record<string, string[]>,
	{
		added,
		contentChanged,
		deleted,
		structural,
		cosmetic,
	}: {
		added: Set<string>;
		contentChanged: Set<string>;
		deleted: Set<string>;
		structural: Set<string>;
		cosmetic: Set<string>;
	},
): Record<string, unknown> {
	const impactedTargets = union(structural, added, deleted);
	const importDependentsFromMap = importDependents(importMap, impactedTargets);
	const importDependentsFromGraph = graphImportDependents(
		graph,
		impactedTargets,
	);
	const dependents = difference(
		difference(
			union(importDependentsFromMap, importDependentsFromGraph),
			impactedTargets,
		),
		deleted,
	);
	const dependencies = difference(
		importDependencies(importMap, union(structural, added, contentChanged)),
		deleted,
	);
	const reanalyzed = difference(union(structural, dependents), deleted);
	const policy = REFRESH_POLICY_PARTS.join(" ");
	return {
		policy,
		direct: {
			added: sorted(added),
			changed: sorted(contentChanged),
			deleted: sorted(deleted),
		},
		classified: {
			structural: sorted(structural),
			cosmetic: sorted(cosmetic),
		},
		expanded: {
			importDependents: sorted(dependents),
			importDependencies: sorted(dependencies),
			reanalyzed: sorted(reanalyzed),
		},
		summary: {
			added: added.size,
			changed: contentChanged.size,
			deleted: deleted.size,
			structural: structural.size,
			cosmetic: cosmetic.size,
			importDependents: dependents.size,
			importDependencies: dependencies.size,
			reanalyzed: reanalyzed.size,
		},
	};
}

/** Refreshes fingerprints for files selected by the refresh plan. */
export function updateFingerprintsForCandidates(
	root: string,
	fingerprints: ArtifactFingerprints,
	importMap: Record<string, string[]>,
	structureByPath: Record<string, StructureEntry>,
	changes: ArtifactChanges,
): [Set<string>, Set<string>] {
	const cosmetic = new Set<string>();
	const structural = new Set(changes.added);
	for (const relPath of changes.contentChanged) {
		const newFingerprint = buildFileFingerprint(
			relPath,
			root,
			structureByPath[relPath],
			importMap[relPath] ?? [],
		);
		if (
			newFingerprint.structureHash ===
			fingerprints.files[relPath]?.structureHash
		) {
			cosmetic.add(relPath);
		} else {
			structural.add(relPath);
		}
		fingerprints.files[relPath] = newFingerprint;
	}

	for (const relPath of changes.added) {
		fingerprints.files[relPath] = buildFileFingerprint(
			relPath,
			root,
			structureByPath[relPath],
			importMap[relPath] ?? [],
		);
	}
	for (const relPath of changes.deleted) {
		delete fingerprints.files[relPath];
	}
	return [structural, cosmetic];
}

/** Reconstructs structure entries for changed files missing from the cache. */
export function fillMissingStructure(
	root: string,
	importMap: Record<string, string[]>,
	pythonTreesByPath: Record<string, string | null>,
	fileMetricsByPath: Record<string, unknown>,
	filesByPath: Record<string, ScanEntry>,
	structureByPath: Record<string, StructureEntry>,
	patchPaths: Set<string>,
): void {
	const missingPaths = sorted(
		new Set(
			[...patchPaths].filter(
				(relPath) => filesByPath[relPath] && !structureByPath[relPath],
			),
		),
	);
	if (missingPaths.length === 0) {
		return;
	}
	const impactFiles = missingPaths
		.map((relPath) => filesByPath[relPath])
		.filter((item): item is ScanEntry => item !== undefined);
	const impactStructure = runStructure(root, impactFiles, importMap, {
		label: "impact",
		persist: true,
		fileMetricsByPath: fileMetricsByPath as never,
		pythonTreesByPath,
	});
	for (const structureEntry of arrayRows(impactStructure.results)) {
		structureByPath[String(structureEntry.path)] =
			structureEntry as StructureEntry;
	}
}

/** Updates structure hashes for files that were reanalyzed. */
export function updateReanalyzedFingerprints(
	root: string,
	fingerprints: ArtifactFingerprints,
	importMap: Record<string, string[]>,
	structureByPath: Record<string, StructureEntry>,
	reanalyzed: Set<string>,
	changes: ArtifactChanges,
): void {
	const skipped = union(changes.added, changes.contentChanged, changes.deleted);
	for (const relPath of difference(reanalyzed, skipped)) {
		fingerprints.files[relPath] = buildFileFingerprint(
			relPath,
			root,
			structureByPath[relPath],
			importMap[relPath] ?? [],
		);
	}
}

/** Patches an artifact graph with changed file structure. */
export function patchArtifactGraph(
	graph: GraphPayload,
	scan: { files?: ScanEntry[] },
	importMap: Record<string, string[]>,
	structureByPath: Record<string, StructureEntry>,
	patchPaths: Set<string>,
	deleted: Set<string>,
): void {
	if (deleted.size > 0) {
		removeFileNodes(graph, deleted);
	}
	if (patchPaths.size === 0) {
		return;
	}
	const miniResults = sorted(patchPaths)
		.map((relPath) => structureByPath[relPath])
		.filter((item): item is NonNullable<typeof item> => item !== undefined);
	const graphPatch = buildGraphFragment(
		scan,
		{ results: miniResults },
		importMap,
		patchPaths,
	);
	patchGraphNodes(graph, graphPatch, patchPaths);
}

/** Combines artifact path sets before applying patch updates. */
function union<T>(...sets: Set<T>[]): Set<T> {
	const result = new Set<T>();
	for (const setValue of sets) {
		for (const item of setValue) {
			result.add(item);
		}
	}
	return result;
}

/** Keeps only artifact paths present in both patch path sets. */
function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
	return new Set([...left].filter((item) => right.has(item)));
}

/** Removes already-handled artifact paths from a patch path set. */
function difference<T>(left: Set<T>, right: Set<T>): Set<T> {
	return new Set([...left].filter((item) => !right.has(item)));
}

/** Sorts artifact path keys for deterministic patch payloads. */
function sorted(values: Set<string>): string[] {
	return [...values].sort(compareText);
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

/** Builds a stable key for graph edge deduplication. */
function edgeKey(source: string, target: string, edgeType: string): string {
	return `${source}\0${target}\0${edgeType}`;
}

/** Reads an array of record rows from JSON-like payload data. */
function arrayRows(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}
