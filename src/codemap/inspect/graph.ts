/** Builds working-tree graph and scanner evidence used by inspection profiles. */
import path from "node:path";

import {
  fileProfileRow,
  type FileProfileRow,
  type FunctionLengthItem,
  functionLengthSection,
} from "../signals/index.js";
import { type InventoryEntry, runImportMap } from "../source/extraction/index.js";
import { buildWorkingTreeGraph, type GraphNode, type GraphPayload } from "../source/graph/index.js";
import { type FileMetrics, scanFiles } from "../source/scanner/index.js";
import { uniqueStrings } from "../text-utils.js";
import { inspectEmitPaths } from "./targets.js";

export type VariableDefinitionRow = {
  name: string;
  identifier: string;
  file: string;
  line: number;
  moduleLevel: boolean;
};

/** Scanner rows for the files one inspection emits, ranked once and filtered per rendered file. */
export type InspectMetrics = {
  functionLengths: FunctionLengthItem[];
  fileProfiles: FileProfileRow[];
  variableDefinitions: VariableDefinitionRow[];
};

/** Takes a normalized target; `backendFiles` stand in for files the scanner cannot parse, and the third element holds every file's metrics by project-relative path. */
export function workingTreeInspectGraph(
  root: string,
  target: string,
  inventory: InventoryEntry[],
  backendFiles: FileMetrics[],
): [GraphPayload, InspectMetrics, Record<string, FileMetrics | undefined>] {
  const importResult = runImportMap(root, inventory);
  const fileMetricsByPath = importResult.fileMetrics;
  for (const metrics of backendFiles) {
    fileMetricsByPath[metrics.relPath] = metrics;
  }
  const emitPaths = inspectEmitPaths(
    root,
    target,
    inventory,
    importResult.importMap,
    fileMetricsByPath,
  );
  const structureFiles =
    emitPaths === null ? inventory : inventory.filter((item) => emitPaths.has(item.path));
  const graph = buildWorkingTreeGraph(root, inventory, importResult, { emitPaths });
  return [graph, metricsForFiles(root, structureFiles, fileMetricsByPath), fileMetricsByPath];
}

/** Returns `[incoming, outgoing]` imports that cross the boundary of `filePaths`, each formatted `source -> target`. */
export function importBoundaryRows(
  graph: GraphPayload,
  filePaths: Set<string>,
  { limit }: { limit: number },
): [string[], string[]] {
  const outgoing: string[] = [];
  const incoming: string[] = [];
  const nodesById = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.type !== "imports") {
      continue;
    }
    const sourceFile = nodesById.get(edge.source)?.filePath ?? "";
    const targetFile = nodesById.get(edge.target)?.filePath ?? "";
    if (filePaths.has(sourceFile) && targetFile && !filePaths.has(targetFile)) {
      outgoing.push(`${sourceFile} -> ${targetFile}`);
    } else if (filePaths.has(targetFile) && sourceFile && !filePaths.has(sourceFile)) {
      incoming.push(`${sourceFile} -> ${targetFile}`);
    }
  }
  return [uniqueStrings(incoming).slice(0, limit), uniqueStrings(outgoing).slice(0, limit)];
}

/** Fills a zero `lines` count from the inventory entry, mutating the cached metrics record. */
export function metricsForFiles(
  root: string,
  files: InventoryEntry[],
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): InspectMetrics {
  const unscanned = files.filter((item) => fileMetricsByPath[item.path] === undefined);
  const scannedNow = new Map(
    scanFiles(
      unscanned.map((item) => path.join(root, item.path)),
      { displayRoot: root },
    ).map((metrics, index) => [unscanned[index]!.path, metrics]),
  );
  const scanned = files.map((item) => {
    const metrics = fileMetricsByPath[item.path] ?? scannedNow.get(item.path)!;
    if (item.sizeLines > 0 && metrics.lines === 0) {
      metrics.lines = item.sizeLines;
    }
    return metrics;
  });
  return {
    functionLengths: functionLengthSection(scanned.flatMap((metrics) => metrics.functionSpans))
      .items,
    fileProfiles: scanned.map((metrics) => fileProfileRow(metrics)),
    variableDefinitions: scanned.flatMap((metrics) =>
      metrics.variableDefinitions.map((variable) => ({
        name: variable.name,
        identifier: variable.identifier,
        file: metrics.relPath,
        line: variable.startLine,
        moduleLevel: variable.moduleLevel,
      })),
    ),
  };
}
