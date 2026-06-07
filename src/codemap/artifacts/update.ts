/** Updates saved artifacts from changed files and refresh plans. */
import { existsSync } from "node:fs";

import {
	fingerprintsPath,
	GRAPH_VERSION,
	gitCommit,
	graphPath,
	readJson,
	utcNow,
} from "../common.js";
import {
	runImportMap,
	runScan,
	runStructure,
} from "../source/extraction/index.js";
import type { StructureEntry } from "../source/graph/builder.js";
import {
	type GraphPayload,
	type GraphStats,
	graphStats,
} from "../source/graph/index.js";
import { runSignalsExport } from "../source/signals/index.js";
import {
	type ArtifactChanges,
	artifactChanges,
	buildRefreshPlan,
	currentContentHashes,
	fillMissingStructure,
	patchArtifactGraph,
	updateFingerprintsForCandidates,
	updateReanalyzedFingerprints,
} from "./patch.js";
import type { ArtifactFingerprints, ArtifactRefreshSummary } from "./schema.js";
import { normalizeCanonicalGraph, writeArtifacts } from "./write.js";

export type ArtifactUpdateResult = {
	message: string;
	returncode: number;
};

type ArtifactUpdateState = {
	graph: GraphPayload;
	fingerprints: ArtifactFingerprints;
	scan: ReturnType<typeof runScan>;
	changes: ArtifactChanges;
};

type ArtifactUpdateAnalysis = {
	importMap: Record<string, string[]>;
	structureByPath: Record<string, StructureEntry>;
	structural: Set<string>;
	cosmetic: Set<string>;
	refreshPlan: Record<string, unknown>;
	reanalyzed: Set<string>;
	patchPaths: Set<string>;
};

/** Writes artifact update outputs from an analyzed refresh. */
export function writeArtifactUpdate(
	root: string,
	state: ArtifactUpdateState,
	analysis: ArtifactUpdateAnalysis,
): void {
	state.graph.stats = graphStats(
		state.graph.nodes,
		state.graph.edges,
		state.scan,
	) as GraphStats;
	state.graph.evidence.codeSignals = runSignalsExport(root);
	const refreshSummary: ArtifactRefreshSummary = {
		added: sorted(state.changes.added),
		deleted: sorted(state.changes.deleted),
		structural: sorted(analysis.structural),
		cosmetic: sorted(analysis.cosmetic),
		plan: analysis.refreshPlan,
	};
	state.fingerprints.generatedAt = utcNow();
	state.fingerprints.gitCommitHash = gitCommit(root);

	writeArtifacts(root, state.graph, state.fingerprints, {
		meta: {
			version: GRAPH_VERSION,
			lastUpdatedAt: utcNow(),
			gitCommitHash: gitCommit(root),
		},
		refreshSummary,
	});
}

/** Runs an incremental artifact refresh and writes updated views. */
export function updateArtifacts(root: string): ArtifactUpdateResult {
	const state = loadUpdateState(root);
	if ("message" in state) {
		return state;
	}
	if (
		changedCandidatePaths(state.changes).length === 0 &&
		state.changes.deleted.size === 0
	) {
		return {
			message: `Artifacts are fresh for ${basename(root)}.`,
			returncode: 0,
		};
	}

	const analysis = analyzeArtifactChanges(root, state);
	applyArtifactUpdate(root, state, analysis);
	writeArtifactUpdate(root, state, analysis);
	return {
		message: refreshMessage(
			root,
			analysis.structural,
			analysis.cosmetic,
			state.changes.deleted,
			analysis.reanalyzed,
		),
		returncode: 0,
	};
}

/** Loads the saved graph and fingerprints needed for artifact updates. */
export function loadUpdateState(
	root: string,
): ArtifactUpdateState | ArtifactUpdateResult {
	const currentGraphPath = graphPath(root);
	const currentFingerprintsPath = fingerprintsPath(root);
	if (!existsSync(currentGraphPath) || !existsSync(currentFingerprintsPath)) {
		return {
			message: `No existing artifacts/fingerprints at ${currentGraphPath}. Run artifacts create first.`,
			returncode: 1,
		};
	}

	const graph = normalizeCanonicalGraph(
		readJson(currentGraphPath) as GraphPayload,
	);
	const fingerprints = readJson(
		currentFingerprintsPath,
	) as ArtifactFingerprints;
	const scan = runScan(root, { persist: true });
	const changes = artifactChanges(
		fingerprints,
		currentContentHashes(root, scan),
	);
	return { graph, fingerprints, scan, changes };
}

/** Finds paths that should be considered for artifact refresh. */
export function changedCandidatePaths(changes: ArtifactChanges): string[] {
	return sorted(union(changes.added, changes.contentChanged));
}

/** Classifies changed files and builds the artifact refresh plan. */
export function analyzeArtifactChanges(
	root: string,
	state: ArtifactUpdateState,
): ArtifactUpdateAnalysis {
	const importResult = runImportMap(root, state.scan.files, { persist: true });
	const importMap = importResult.importMap;
	const pythonTreesByPath = importResult._pythonTrees;
	const fileMetricsByPath = importResult._typescriptMetrics;
	const filesByPath = Object.fromEntries(
		state.scan.files.map((item) => [item.path, item]),
	);
	const candidatePaths = changedCandidatePaths(state.changes);
	const candidateFiles = candidatePaths
		.map((filePath) => filesByPath[filePath])
		.filter((item): item is NonNullable<typeof item> => item !== undefined);
	const structure =
		candidateFiles.length > 0
			? runStructure(root, candidateFiles, importMap, {
					label: "artifact-update",
					persist: true,
					fileMetricsByPath,
					pythonTreesByPath,
				})
			: { results: [] };
	const structureByPath = Object.fromEntries(
		structure.results.map((structureEntry) => [
			structureEntry.path,
			structureEntry,
		]),
	);
	const [structural, cosmetic] = updateFingerprintsForCandidates(
		root,
		state.fingerprints,
		importMap,
		structureByPath,
		state.changes,
	);

	const refreshPlan = buildRefreshPlan(state.graph, importMap, {
		added: state.changes.added,
		contentChanged: state.changes.contentChanged,
		deleted: state.changes.deleted,
		structural,
		cosmetic,
	});
	const expanded = recordValue(refreshPlan.expanded);
	const reanalyzed = new Set(arrayStrings(expanded.reanalyzed));
	const patchPaths = difference(
		union(reanalyzed, state.changes.added, state.changes.contentChanged),
		state.changes.deleted,
	);
	fillMissingStructure(
		root,
		importMap,
		pythonTreesByPath,
		fileMetricsByPath,
		filesByPath,
		structureByPath,
		patchPaths,
	);
	return {
		importMap,
		structureByPath,
		structural,
		cosmetic,
		refreshPlan,
		reanalyzed,
		patchPaths,
	};
}

/** Writes refreshed artifact graphs, fingerprints, and rendered views. */
export function applyArtifactUpdate(
	root: string,
	state: ArtifactUpdateState,
	analysis: ArtifactUpdateAnalysis,
): void {
	updateReanalyzedFingerprints(
		root,
		state.fingerprints,
		analysis.importMap,
		analysis.structureByPath,
		analysis.reanalyzed,
		state.changes,
	);
	patchArtifactGraph(
		state.graph,
		state.scan,
		analysis.importMap,
		analysis.structureByPath,
		analysis.patchPaths,
		state.changes.deleted,
	);
}

/** Formats the artifact refresh summary message. */
export function refreshMessage(
	root: string,
	structural: Set<string>,
	cosmetic: Set<string>,
	deleted: Set<string>,
	reanalyzed: Set<string>,
): string {
	const counts = [
		`${structural.size} structural`,
		`${cosmetic.size} cosmetic`,
		`${deleted.size} deleted`,
		`${reanalyzed.size} reanalyzed`,
	];
	return `Updated artifacts for ${basename(root)}: ${counts.join(", ")}`;
}

/** Returns the display basename for a changed path. */
function basename(root: string): string {
	return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

/** Combines artifact path sets before writing update payloads. */
function union<T>(...sets: Set<T>[]): Set<T> {
	const result = new Set<T>();
	for (const setValue of sets) {
		for (const item of setValue) {
			result.add(item);
		}
	}
	return result;
}

/** Removes already-handled artifact paths from an update path set. */
function difference<T>(left: Set<T>, right: Set<T>): Set<T> {
	return new Set([...left].filter((item) => !right.has(item)));
}

/** Sorts artifact path keys for deterministic update payloads. */
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

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Reads string values from unknown arrays in refresh metadata. */
function arrayStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
