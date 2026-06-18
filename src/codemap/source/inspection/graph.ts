/** Builds the current-tree graph evidence used by inspection profiles. */
import { runImportMap, runScan, runStructure } from "../extraction/index.js";
import {
	buildGraphPayload,
	type GraphNode,
	type GraphPayload,
} from "../graph/index.js";
import { metricsForFiles } from "./metrics.js";
import { inspectEmitPaths } from "./targets.js";

/** Builds graph evidence for current-tree inspection. */
export function currentTreeInspectGraph(
	root: string,
	rawTarget: string,
	existingScan: ReturnType<typeof runScan> | null = null,
): [GraphPayload, Record<string, unknown>] {
	const scan = existingScan ?? runScan(root, { persist: false });
	const importResult = runImportMap(root, scan.files, { persist: false });
	const importMap = importResult.importMap;
	const pythonTreesByPath = importResult._pythonTrees;
	const fileMetricsByPath = importResult._typescriptMetrics;
	const emitPaths = inspectEmitPaths(
		root,
		rawTarget,
		scan as unknown as Record<string, unknown>,
		importMap,
		pythonTreesByPath,
		fileMetricsByPath,
	);
	let structureFiles = scan.files;
	if (emitPaths !== null) {
		structureFiles = structureFiles.filter((item) => emitPaths.has(item.path));
	}
	const structure = runStructure(root, structureFiles, importMap, {
		label: "current",
		persist: false,
		fileMetricsByPath,
		pythonTreesByPath,
	});
	const graph = buildGraphPayload(root, scan, structure, importResult, {
		includeSignals: false,
		emitPaths,
	});
	return [
		graph,
		metricsForFiles(
			root,
			structureFiles as unknown as Array<Record<string, unknown>>,
			fileMetricsByPath,
		),
	];
}

/** Builds import incoming and outgoing rows for inspection. */
export function importBoundaryRows(
	graph: GraphPayload,
	filePaths: Set<string>,
	{ limit }: { limit: number },
): [string[], string[]] {
	const outgoing: string[] = [];
	const incoming: string[] = [];
	const nodesById = Object.fromEntries(
		(graph.nodes ?? []).map((node) => [String(node.id), node]),
	) as Record<string, GraphNode | undefined>;
	for (const edge of graph.edges ?? []) {
		if (edge.type !== "imports") {
			continue;
		}
		const sourceFile = String(nodesById[String(edge.source)]?.filePath ?? "");
		const targetFile = String(nodesById[String(edge.target)]?.filePath ?? "");
		if (filePaths.has(sourceFile) && targetFile && !filePaths.has(targetFile)) {
			outgoing.push(`${sourceFile} -> ${targetFile}`);
		} else if (
			filePaths.has(targetFile) &&
			sourceFile &&
			!filePaths.has(sourceFile)
		) {
			incoming.push(`${sourceFile} -> ${targetFile}`);
		}
	}
	return [uniqueRows(incoming, limit), uniqueRows(outgoing, limit)];
}

/** Deduplicates inspection rows while keeping their first-seen order. */
export function uniqueRows(rows: string[], limit: number): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const row of rows) {
		if (seen.has(row)) {
			continue;
		}
		seen.add(row);
		unique.push(row);
		if (unique.length >= limit) {
			break;
		}
	}
	return unique;
}
