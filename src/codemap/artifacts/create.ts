/** Creates saved .context-graph artifacts from current source evidence. */
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
	canonicalDir,
	GRAPH_VERSION,
	gitCommit,
	intermediateDir,
	utcNow,
} from "../common.js";
import {
	runImportMap,
	runScan,
	runStructure,
} from "../source/extraction/index.js";
import { buildGraphPayload } from "../source/graph/index.js";
import { buildFingerprints } from "./fingerprints.js";
import { writeArtifacts } from "./write.js";

export type ArtifactCreateResult = {
	message: string;
	graphPath: string;
};

/** Creates canonical graph artifacts and rendered views. */
export function createArtifacts(root: string): ArtifactCreateResult {
	mkdirSync(intermediateDir(root), { recursive: true });
	const scan = runScan(root, { persist: true });
	const importResult = runImportMap(root, scan.files, { persist: true });
	const importMap = importResult.importMap;
	const structure = runStructure(root, scan.files, importMap, {
		label: "all",
		persist: true,
		fileMetricsByPath: importResult._typescriptMetrics,
		pythonTreesByPath: importResult._pythonTrees,
	});
	const graph = buildGraphPayload(root, scan, structure, importResult);
	const fingerprints = buildFingerprints(
		root,
		scan as unknown as Record<string, unknown>,
		structure as unknown as Record<string, unknown>,
		importMap,
	);
	writeArtifacts(root, graph, fingerprints, {
		meta: {
			version: GRAPH_VERSION,
			lastBuiltAt: utcNow(),
			gitCommitHash: gitCommit(root),
		},
	});
	const stats = graph.stats;
	return {
		message: `Created artifacts for ${path.basename(root)}: ${stats.nodes} nodes, ${stats.edges} edges`,
		graphPath: path.join(canonicalDir(root), "graph.json"),
	};
}
