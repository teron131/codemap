/** Builds current-tree graph and scanner evidence used by inspection profiles. */
import path from "node:path";

import { runImportMap, runScan, runStructure, type ScanEntry } from "../extraction/index.js";
import { buildGraphPayload, type GraphNode, type GraphPayload } from "../graph/index.js";
import { type FileMetrics, PY_SUFFIXES, scanFile, TYPESCRIPT_SUFFIXES } from "../scanner/index.js";
import { fileProfileRow, functionLengthSection } from "../signals/index.js";
import { inspectEmitPaths } from "./targets.js";

type Row = Record<string, unknown>;

/** Builds graph evidence for current-tree inspection. */
export function currentTreeInspectGraph(
  root: string,
  rawTarget: string,
  existingScan: ReturnType<typeof runScan> | null = null,
): [GraphPayload, Record<string, unknown>] {
  const scan = existingScan ?? runScan(root);
  const importResult = runImportMap(root, scan.files);
  const importMap = importResult.importMap;
  const pythonTreesByPath = importResult._pythonTrees;
  const fileMetricsByPath = importResult._typescriptMetrics;
  const emitPaths = inspectEmitPaths(root, rawTarget, scan, importMap, fileMetricsByPath);
  let structureFiles = scan.files;
  if (emitPaths !== null) {
    structureFiles = structureFiles.filter((item) => emitPaths.has(item.path));
  }
  const structure = runStructure(root, structureFiles, importMap, {
    fileMetricsByPath,
    pythonTreesByPath,
  });
  const graph = buildGraphPayload(scan, structure, importResult, { emitPaths });
  return [graph, metricsForFiles(root, structureFiles, fileMetricsByPath)];
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
    } else if (filePaths.has(targetFile) && sourceFile && !filePaths.has(sourceFile)) {
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

/** Creates the empty usage-metric buckets used by inspection output. */
export function emptyUsageMetrics(): Record<string, Record<string, Row[]>> {
  return {
    lowUsageFunctions: { python: [], typescript: [] },
    lowUsageVariables: { python: [], typescript: [] },
  };
}

/** Builds scanner metrics for selected inspection files. */
export function metricsForFiles(
  root: string,
  files: ScanEntry[],
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Record<string, unknown> {
  const scanned: FileMetrics[] = [];
  for (const item of files) {
    const relPath = item.path;
    let metrics = fileMetricsByPath[relPath];
    if (metrics === undefined) {
      metrics = scanFile(path.join(root, relPath), { displayRoot: root });
    }
    const sizeLines = item.sizeLines;
    if (sizeLines > 0 && metrics.lines === 0) {
      metrics.lines = sizeLines;
    }
    scanned.push(metrics);
  }
  const pythonSpans = scanned
    .filter((metrics) => PY_SUFFIXES.has(metrics.suffix))
    .flatMap((metrics) => metrics.functionSpans);
  const typescriptSpans = scanned
    .filter((metrics) => TYPESCRIPT_SUFFIXES.has(metrics.suffix))
    .flatMap((metrics) => metrics.functionSpans);
  return {
    longFunctions: {
      python: functionItems(pythonSpans),
      typescript: functionItems(typescriptSpans),
    },
    usageSignals: emptyUsageMetrics(),
    fileProfiles: scanned.map((metrics) => fileProfileRow(metrics)),
    functionDefinitions: functionDefinitionRows(scanned),
    variableDefinitions: variableDefinitionRows(scanned),
  };
}

/** Flattens scanned function spans into inspection table rows. */
export function functionDefinitionRows(scanned: FileMetrics[]): Row[] {
  return scanned.flatMap((metrics) =>
    metrics.functionSpans.map((span) => ({
      name: span.name,
      identifier: span.identifier,
      file: metrics.relPath,
      line: span.startLine,
      lines: span.span,
    })),
  );
}

/** Flattens scanned variable definitions into inspection table rows. */
export function variableDefinitionRows(scanned: FileMetrics[]): Row[] {
  return scanned.flatMap((metrics) =>
    metrics.variableSignals.map((variable) => ({
      name: variable.name,
      identifier: variable.identifier,
      file: metrics.relPath,
      line: variable.startLine,
      moduleLevel: variable.moduleLevel,
    })),
  );
}

/** Extracts printable function-length rows from scanned function spans. */
function functionItems(functionSpans: FileMetrics["functionSpans"]): Row[] {
  const section = functionLengthSection(functionSpans);
  return Array.isArray(section.items) ? section.items : [];
}
