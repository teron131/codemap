/** Signals payload for trees above the detailed-analysis limit, parsing only the 100 largest eligible files. Coverage reports parsed versus eligible counts instead of claiming relationship or mention coverage. */
import path from "node:path";

import { describeNumbers } from "../math-utils.js";
import type { InventoryEntry } from "../source/extraction/index.js";
import {
  ENTRYPOINT_BASENAMES,
  type FileMetrics,
  isGeneratedPath,
  isTestPath,
  PYTHON_SUFFIXES,
  scanFile,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import { fileProfileRow } from "./file-profile.js";
import { functionLengthsByLanguage } from "./function-lengths.js";
import { rankFunctionRowsByLength } from "./payload.js";
import type { DenseFileRow, SignalLanguage, SignalRow } from "./schema.js";
import { functionUsageRows } from "./usage.js";

const LIGHTWEIGHT_SIGNAL_LANGUAGES = new Set(["javascript", "jsx", "python", "tsx", "typescript"]);
/** Limits syntax parsing independently from final output budgeting. */
const LIGHTWEIGHT_SIGNAL_PARSE_LIMIT = 100;

export function buildLightweightSignalPayload(
  files: InventoryEntry[],
  { includeTests, root }: { includeTests: boolean; root: string },
): SignalRow {
  const rankedFiles = files
    .filter((entry) => isLightweightSignalFile(entry, { includeTests }))
    .sort((left, right) => right.sizeLines - left.sizeLines || compareText(left.path, right.path));
  const metricsByPath = scanLightweightFiles(rankedFiles, root);
  const coverage = {
    mode: "bounded",
    eligibleFiles: rankedFiles.length,
    parsedFiles: metricsByPath.size,
  };
  const denseFiles = rankedFiles.map((entry) =>
    buildLightweightSignalRow(entry, metricsByPath.get(entry.path)),
  );
  const scannedFiles = [...metricsByPath.values()];
  const pythonFunctions = lightweightFunctionRows(scannedFiles, PYTHON_SUFFIXES, "python");
  const typescriptFunctions = lightweightFunctionRows(
    scannedFiles,
    TYPESCRIPT_SUFFIXES,
    "typescript",
  );
  const functionRows = [...pythonFunctions, ...typescriptFunctions].sort(
    (left, right) =>
      Number(right.lines ?? 0) - Number(left.lines ?? 0) ||
      compareText(String(left.identifier ?? ""), String(right.identifier ?? "")),
  );
  const stats = {
    source: "workingTree",
    ...(functionRows.length === 0
      ? {}
      : {
          functions: {
            lines: describeNumbers(functionRows.map((row) => Number(row.lines))),
          },
        }),
  };
  const top = {
    functionMetrics: functionRows.map((row) => ({
      name: row.name,
      path: row.file,
      line: row.line,
      lines: row.lines,
    })),
    functionsByMentions: [],
    variablesByNameLength: [],
  };
  return {
    stats,
    coverage,
    top,
    relationships: {
      counts: {
        python_import_edges: 0,
        typescript_import_edges: 0,
        entrypoint_like_files: rankedFiles.filter((entry) =>
          ENTRYPOINT_BASENAMES.has(entry.path.split("/").at(-1) ?? ""),
        ).length,
        typescript_relative_imports: 0,
        python_relative_imports: 0,
        typescript_reexport_edges: 0,
        python_inheritance_edges: 0,
      },
      top_local_import_hubs: [],
      top_inheritance_hubs: [],
    },
    files: denseFiles,
    lengths: functionLengthsByLanguage(scannedFiles),
    usage: {
      bins: {},
    },
    functions: {
      byLength: { python: pythonFunctions, typescript: typescriptFunctions },
      byMentions: { python: [], typescript: [] },
    },
    variables: {
      byMentions: { python: [], typescript: [] },
      byNameLength: [],
    },
  };
}

function isLightweightSignalFile(
  entry: InventoryEntry,
  { includeTests }: { includeTests: boolean },
): boolean {
  if (entry.fileCategory !== "code") {
    return false;
  }
  if (!LIGHTWEIGHT_SIGNAL_LANGUAGES.has(entry.language)) {
    return false;
  }
  if (!includeTests && isTestPath(entry.path)) {
    return false;
  }
  return !isGeneratedPath(entry.path);
}

/** `total` counts lines here rather than declarations, as `total_label` records. */
function buildLightweightSignalRow(
  entry: InventoryEntry,
  metrics: FileMetrics | undefined,
): DenseFileRow {
  if (!metrics) {
    return {
      file: entry.path,
      total: entry.sizeLines,
      total_label: "lines",
    };
  }
  return {
    ...fileProfileRow(metrics),
    total: entry.sizeLines,
    total_label: "lines",
    lines: entry.sizeLines,
  };
}

/** Parses only the leading files, so callers pass them largest first; a file whose parse throws keeps its line-count row. */
function scanLightweightFiles(files: InventoryEntry[], root: string): Map<string, FileMetrics> {
  const metricsByPath = new Map<string, FileMetrics>();
  for (const entry of files.slice(0, LIGHTWEIGHT_SIGNAL_PARSE_LIMIT)) {
    try {
      metricsByPath.set(
        entry.path,
        scanFile(path.join(root, entry.path), {
          displayRoot: root,
        }),
      );
    } catch {
      continue;
    }
  }
  return metricsByPath;
}

function lightweightFunctionRows(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  language: SignalLanguage,
): SignalRow[] {
  // No mentions are counted on this path, so an empty count map leaves the ranking to length alone.
  return rankFunctionRowsByLength(functionUsageRows(scannedFiles, suffixes, new Map())).map(
    (row) => ({
      language,
      name: row.name,
      identifier: row.identifier,
      file: row.file,
      line: row.line,
      lines: row.lines,
    }),
  );
}
