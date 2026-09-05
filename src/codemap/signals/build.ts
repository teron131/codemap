/** Builds full signal exports from scanned files and selected sections. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  buildDocstringsData,
  buildDocstringSignals,
  DOCSTRING_SUFFIXES,
} from "../source/docstrings/index.js";
import {
  discoverFiles,
  type FileMetrics,
  type FunctionSpan,
  PY_SUFFIXES,
  relativePath,
  scanFile,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import {
  buildSignalFocusEntries,
  fileProfileRow,
  functionLengthSection,
  topHubs,
  topInheritanceHubs,
} from "./analysis.js";
import type { DenseFileRow, SignalRow } from "./schema.js";
import { buildUsageSection } from "./usage.js";

type Row = SignalRow;

export type SignalExportSection =
  | "relationships"
  | "usage"
  | "function-lengths"
  | "file-profiles"
  | "docstring-signals"
  | "docstrings";

/** Summarizes import, entrypoint, AGENTS, and source relationship counts. */
function buildRelationshipsSection(
  displayFiles: string[],
  scannedFiles: FileMetrics[],
  fileProfileRows: DenseFileRow[],
  entrypoints: Set<string>,
): Row {
  return {
    counts: {
      module_agents_files: displayFiles.filter((filePath) => filePath.endsWith("AGENTS.md")).length,
      typescript_import_edges: sumLengths(scannedFiles, "typescriptImports"),
      typescript_relative_imports: sumLengths(scannedFiles, "typescriptLocalImportTargets"),
      typescript_reexport_edges: sumLengths(scannedFiles, "typescriptReexportTargets"),
      typescript_local_reexports: sumLengths(scannedFiles, "typescriptLocalReexportTargets"),
      typescript_extends_edges: sumLengths(scannedFiles, "typescriptExtendsBases"),
      python_import_edges: sumLengths(scannedFiles, "pyImportTargets"),
      python_relative_imports: sumLengths(scannedFiles, "pyLocalImportTargets"),
      python_inheritance_edges: sumLengths(scannedFiles, "pyBases"),
      entrypoint_like_files: entrypoints.size,
    },
    entrypoint_like_files: [...entrypoints].sort(),
    top_local_import_hubs: topHubs(fileProfileRows, { key: "imports_local" }),
    top_inheritance_hubs: topInheritanceHubs(fileProfileRows),
  };
}

/** Builds the empty docstring signal payload shape. */
function buildEmptyDocstringSignals(): Row {
  return {
    files_considered: 0,
    python_files_considered: 0,
    typescript_files_considered: 0,
    file_docstrings: { present: 0, total: 0 },
    file_docstring_previews: [],
    likely_main_function_docstrings: [],
  };
}

/** Collects function spans for files matching a language suffix set. */
function functionSpans(scannedFiles: FileMetrics[], suffixes: Set<string>): FunctionSpan[] {
  const spans: FunctionSpan[] = [];
  for (const metrics of scannedFiles) {
    if (suffixes.has(metrics.suffix)) {
      spans.push(...metrics.functionSpans);
    }
  }
  return spans;
}

/** Separates TypeScript and Python function-length hotspots. */
function buildFunctionLengthsSection(scannedFiles: FileMetrics[]): Row {
  return {
    typescript: functionLengthSection(functionSpans(scannedFiles, TYPESCRIPT_SUFFIXES)),
    python: functionLengthSection(functionSpans(scannedFiles, PY_SUFFIXES)),
  };
}

/** Finds README-like files that explain signal focus entries. */
function signalFocusDocFilesFor(
  targetPath: string,
  displayRoot: string,
  signalFocusEntries: ReturnType<typeof buildSignalFocusEntries>,
): string[] {
  if (isFile(targetPath) && DOCSTRING_SUFFIXES.has(path.extname(targetPath))) {
    return [relativePath(targetPath, { displayRoot })];
  }
  const docFiles: string[] = [];
  for (const entry of signalFocusEntries) {
    const filePath = String(entry.file);
    if (DOCSTRING_SUFFIXES.has(path.extname(filePath))) {
      docFiles.push(filePath);
    }
  }
  return docFiles;
}

/** Builds the compact docstring signal section for signal focus files. */
function buildDocstringSignalSection(targetPath: string, signalFocusDocFiles: string[]): Row {
  const signalFocus = signalFocusDocFiles.slice(0, 3);
  if (signalFocus.length === 0) {
    return buildEmptyDocstringSignals();
  }
  return buildDocstringSignals(targetPath, {
    focusFiles: signalFocus,
    maxFiles: 3,
    maxFunctions: 6,
  });
}

/** Builds the selected signal sections for a target path. */
export function buildSignalExport(
  targetPath: string,
  {
    sectionMode,
    files,
  }: { sectionMode: SignalExportSection | SignalExportSection[]; files?: string[] },
): Row {
  const selected = new Set(Array.isArray(sectionMode) ? sectionMode : [sectionMode]);
  if (selected.size === 1 && selected.has("docstrings")) {
    return { sections: { docstrings: buildDocstringsData(targetPath) } };
  }
  const displayRoot = isDirectory(targetPath) ? targetPath : path.dirname(targetPath);
  const allFiles = files ?? discoverFiles(targetPath);
  const displayFiles = allFiles.map((filePath) => relativePath(filePath, { displayRoot }));
  const scannedFiles = allFiles.map((filePath) => scanFile(filePath, { displayRoot }));
  const needsProfiles =
    selected.has("relationships") ||
    selected.has("file-profiles") ||
    selected.has("docstring-signals");
  const fileProfileRows = needsProfiles ? scannedFiles.map(fileProfileRow) : [];
  fileProfileRows.sort(
    (left, right) =>
      Number(right.total ?? 0) - Number(left.total ?? 0) ||
      compareText(String(left.file), String(right.file)),
  );
  const entrypoints = new Set(
    scannedFiles.filter((metrics) => metrics.entrypointHint).map((metrics) => metrics.relPath),
  );
  const sections: Row = {};
  if (selected.has("relationships")) {
    sections.relationships = buildRelationshipsSection(
      displayFiles,
      scannedFiles,
      fileProfileRows,
      entrypoints,
    );
  }
  if (selected.has("docstring-signals")) {
    const signalFocusEntries = buildSignalFocusEntries(fileProfileRows, {
      entrypoints,
    });
    sections.docstring_signals = buildDocstringSignalSection(
      targetPath,
      signalFocusDocFilesFor(targetPath, displayRoot, signalFocusEntries),
    );
  }
  if (selected.has("file-profiles")) {
    sections.file_profiles = fileProfileRows;
  }
  if (selected.has("usage")) {
    sections.usage_signals = buildUsageSection(allFiles, scannedFiles);
  }
  if (selected.has("function-lengths")) {
    sections.function_lengths = buildFunctionLengthsSection(scannedFiles);
  }
  if (selected.has("docstrings")) {
    sections.docstrings = buildDocstringsData(targetPath);
  }
  return { sections };
}

/** Totals line counts from rows that expose a numeric length field. */
function sumLengths(
  scannedFiles: FileMetrics[],
  key:
    | "typescriptImports"
    | "typescriptLocalImportTargets"
    | "typescriptReexportTargets"
    | "typescriptLocalReexportTargets"
    | "typescriptExtendsBases"
    | "pyImportTargets"
    | "pyLocalImportTargets"
    | "pyBases",
): number {
  return scannedFiles.reduce((total, metrics) => total + metrics[key].length, 0);
}

/** Checks whether a path exists and is a file. */
function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}

/** Checks whether a path exists and is a directory. */
function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}
