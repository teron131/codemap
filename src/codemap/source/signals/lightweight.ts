/** Builds lightweight signal payloads from scan rows when full analysis is unavailable. */
import path from "node:path";

import { ENTRYPOINT_BASENAMES, scanFile } from "../scanner/index.js";
import { fileProfileRow } from "./analysis.js";
import { isGeneratedSignalPath, isTestPath, SIGNAL_OUTPUT_ROW_LIMIT } from "./policy.js";
import type { DenseFileRow, FunctionLengthSection, SignalRow } from "./schema.js";

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
/** Limits syntax parsing independently from the larger display overflow cap. */
const LIGHTWEIGHT_SIGNAL_ENRICHMENT_LIMIT = 4;
/** Builds a compact signal payload when full analysis is absent. */
export function buildLightweightSignalPayload(
  files: LightweightSignalFile[],
  { includeTests = false, root }: LightweightSignalPayloadOptions = {},
): SignalRow {
  const denseFiles = buildLightweightDenseFiles(files, { includeTests, root });
  const top = {
    functionMetrics: [],
    functionsByMentions: [],
    variablesByNameLength: [],
  };
  return {
    top,
    relationships: {
      counts: {
        python_import_edges: 0,
        typescript_import_edges: 0,
        entrypoint_like_files: countEntrypointLikeFiles(files),
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
      python: emptyFunctionLengthSection(),
      typescript: emptyFunctionLengthSection(),
    },
    usage: {
      distribution: {},
    },
    functions: {
      byLength: { python: [], typescript: [] },
      byMentions: { python: [], typescript: [] },
    },
    variables: {
      byMentions: { python: [], typescript: [] },
      byNameLength: [],
    },
  };
}

/** Builds ranked dense-file rows for lightweight output. */
function buildLightweightDenseFiles(
  files: LightweightSignalFile[],
  {
    includeTests,
    root,
  }: {
    includeTests: boolean;
    root: string | undefined;
  },
): DenseFileRow[] {
  return files
    .filter((entry) => isLightweightSignalFile(entry, { includeTests }))
    .slice()
    .sort(
      (left, right) =>
        -Number(left.sizeLines ?? 0) - -Number(right.sizeLines ?? 0) ||
        compareText(left.path, right.path),
    )
    .slice(0, SIGNAL_OUTPUT_ROW_LIMIT)
    .map((entry, index) =>
      buildLightweightSignalRow(entry, {
        root,
        enrich: index < LIGHTWEIGHT_SIGNAL_ENRICHMENT_LIMIT,
      }),
    );
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
  { root, enrich }: { root?: string | undefined; enrich: boolean },
): DenseFileRow {
  const fallback = buildLightweightFallbackRow(entry);
  if (!root || !enrich) {
    return fallback;
  }
  try {
    const metrics = scanFile(path.join(root, entry.path), {
      displayRoot: root,
    });
    const row = fileProfileRow(metrics);
    const lineCount = entry.sizeLines ?? row.lines;
    return {
      ...row,
      total: lineCount,
      total_label: "lines",
      lines: lineCount,
    };
  } catch {
    return fallback;
  }
}

/** Builds a line-ranked dense-file row without syntax metrics. */
function buildLightweightFallbackRow(entry: LightweightSignalFile): DenseFileRow {
  return {
    file: entry.path,
    total: entry.sizeLines,
    total_label: "lines",
  };
}

/** Builds an empty long-function section for lightweight signals. */
function emptyFunctionLengthSection(): FunctionLengthSection {
  return { count: 0, median: 0, p90: 0, max: 0, items: [] };
}

/** Counts files that look like CLI or app entrypoints. */
function countEntrypointLikeFiles(files: LightweightSignalFile[]): number {
  return files.filter((entry) => ENTRYPOINT_BASENAMES.has(entry.path.split("/").at(-1) ?? ""))
    .length;
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
