/** Builds lightweight signal payloads from scan rows when full analysis is unavailable. */
import path from "node:path";

import {
  ENTRYPOINT_BASENAMES,
  type FileMetrics,
  PY_SUFFIXES,
  scanFile,
  TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import { fileProfileRow, functionLengthSection, functionUsageRows } from "./analysis.js";
import { isGeneratedSignalPath, isTestPath } from "./policy.js";
import type { DenseFileRow, SignalLanguage, SignalRow } from "./schema.js";

export type LightweightSignalFile = {
  path: string;
  language: string;
  fileCategory?: string;
  sizeLines?: number | null;
};

type LightweightSignalPayloadOptions = {
  includeTests?: boolean;
  root?: string;
};

const LIGHTWEIGHT_SIGNAL_LANGUAGES = new Set(["javascript", "jsx", "python", "tsx", "typescript"]);
/** Limits syntax parsing independently from final output budgeting. */
const LIGHTWEIGHT_SIGNAL_PARSE_LIMIT = 100;
/** Builds a compact signal payload when full analysis is absent. */
export function buildLightweightSignalPayload(
  files: LightweightSignalFile[],
  { includeTests = false, root }: LightweightSignalPayloadOptions = {},
): SignalRow {
  const rankedFiles = files
    .filter((entry) => isLightweightSignalFile(entry, { includeTests }))
    .slice()
    .sort(
      (left, right) =>
        Number(right.sizeLines ?? 0) - Number(left.sizeLines ?? 0) ||
        compareText(left.path, right.path),
    );
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
  const pythonFunctions = lightweightFunctionRows(scannedFiles, PY_SUFFIXES, "python");
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
  const top = {
    coverage,
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
    lengths: {
      python: functionLengthSection(
        scannedFiles
          .filter((metrics) => PY_SUFFIXES.has(metrics.suffix))
          .flatMap((metrics) => metrics.functionSpans),
      ),
      typescript: functionLengthSection(
        scannedFiles
          .filter((metrics) => TYPESCRIPT_SUFFIXES.has(metrics.suffix))
          .flatMap((metrics) => metrics.functionSpans),
      ),
    },
    usage: {
      distribution: {},
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

/** Checks whether a file should appear in lightweight signal rows. */
function isLightweightSignalFile(
  entry: LightweightSignalFile,
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
  return !isGeneratedSignalPath(entry.path);
}

/** Builds one lightweight dense-file row, optionally adding bounded syntax details. */
function buildLightweightSignalRow(
  entry: LightweightSignalFile,
  metrics: FileMetrics | undefined,
): DenseFileRow {
  if (!metrics) {
    return {
      file: entry.path,
      total: entry.sizeLines,
      total_label: "lines",
    };
  }
  const row = fileProfileRow(metrics);
  const lineCount = entry.sizeLines ?? row.lines;
  return {
    ...row,
    total: lineCount,
    total_label: "lines",
    lines: lineCount,
  };
}

/** Parses a bounded set of the largest eligible files. */
function scanLightweightFiles(
  files: LightweightSignalFile[],
  root: string | undefined,
): Map<string, FileMetrics> {
  const metricsByPath = new Map<string, FileMetrics>();
  if (!root) {
    return metricsByPath;
  }
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

/** Builds de-duplicated function rows from bounded syntax evidence. */
function lightweightFunctionRows(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  language: SignalLanguage,
): SignalRow[] {
  return functionUsageRows(scannedFiles, suffixes, new Map()).map((row) => ({
    language,
    name: row.name,
    identifier: row.identifier,
    file: row.file,
    line: row.line,
    lines: row.lines,
  }));
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
