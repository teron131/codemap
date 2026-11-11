/** Computes only the requested working-tree signal sections from one scan of the discovered files. */
import path from "node:path";

import {
  buildDocstringSignals,
  DOCSTRING_SUFFIXES,
  type DocstringSignals,
} from "../source/docstrings/index.js";
import {
  type FileMetrics,
  PYTHON_SUFFIXES,
  relativePath,
  scanFile,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import {
  fileProfileRow,
  rankSignalFocusFiles,
  topInheritanceHubs,
  topLocalImportHubs,
} from "./file-profile.js";
import { functionLengthsByLanguage } from "./function-lengths.js";
import type {
  FileProfileRow,
  FunctionLengthSection,
  SignalLanguage,
  SignalRow,
  UsageSection,
} from "./schema.js";
import { buildUsageSection } from "./usage.js";

/** A section is absent when it was not requested. */
export type SignalSections = {
  relationships?: SignalRow;
  usage?: UsageSection;
  functionLengths?: Record<SignalLanguage, FunctionLengthSection>;
  fileProfiles?: FileProfileRow[];
  docstringSignals?: DocstringSignals;
};

export type SignalSectionName = keyof SignalSections;

const DOCSTRING_SIGNAL_FILE_LIMIT = 3;
const DOCSTRING_SIGNAL_FUNCTION_LIMIT = 6;

export function buildSignalSections(
  root: string,
  { names, files }: { names: SignalSectionName[]; files: string[] },
): SignalSections {
  const selected = new Set(names);
  const scannedFiles = files.map((filePath) => scanFile(filePath, { displayRoot: root }));
  const needsProfiles =
    selected.has("relationships") ||
    selected.has("fileProfiles") ||
    selected.has("docstringSignals");
  const fileProfileRows = needsProfiles
    ? scannedFiles
        .map(fileProfileRow)
        .sort((left, right) => right.total - left.total || compareText(left.file, right.file))
    : [];
  const entrypoints = new Set(
    scannedFiles.filter((metrics) => metrics.entrypointHint).map((metrics) => metrics.relPath),
  );
  const sections: SignalSections = {};
  if (selected.has("relationships")) {
    sections.relationships = buildRelationshipsSection(
      files.map((filePath) => relativePath(filePath, { displayRoot: root })),
      scannedFiles,
      fileProfileRows,
      entrypoints,
    );
  }
  if (selected.has("docstringSignals")) {
    sections.docstringSignals = buildDocstringSignalSection(
      root,
      rankSignalFocusFiles(fileProfileRows, { entrypoints }).filter((filePath) =>
        DOCSTRING_SUFFIXES.has(path.extname(filePath)),
      ),
    );
  }
  if (selected.has("fileProfiles")) {
    sections.fileProfiles = fileProfileRows;
  }
  if (selected.has("usage")) {
    sections.usage = buildUsageSection(files, scannedFiles);
  }
  if (selected.has("functionLengths")) {
    sections.functionLengths = functionLengthsByLanguage(scannedFiles);
  }
  return sections;
}

function buildRelationshipsSection(
  displayFiles: string[],
  scannedFiles: FileMetrics[],
  fileProfileRows: FileProfileRow[],
  entrypoints: Set<string>,
): SignalRow {
  // Only `importsLocal` needs the language split: `extends` is counted in TypeScript files alone and `inherits` in Python files alone.
  const typescriptFiles = scannedFiles.filter((metrics) => TYPESCRIPT_SUFFIXES.has(metrics.suffix));
  const pythonFiles = scannedFiles.filter((metrics) => PYTHON_SUFFIXES.has(metrics.suffix));
  return {
    counts: {
      module_agents_files: displayFiles.filter((filePath) => filePath.endsWith("AGENTS.md")).length,
      typescript_import_edges: sumOf(scannedFiles, (metrics) => metrics.typescriptImports.length),
      typescript_relative_imports: sumOf(typescriptFiles, (metrics) => metrics.importsLocal),
      typescript_reexport_edges: sumOf(
        scannedFiles,
        (metrics) => metrics.typescriptReexportTargets.length,
      ),
      typescript_local_reexports: sumOf(scannedFiles, (metrics) => metrics.reexportsLocal),
      typescript_extends_edges: sumOf(scannedFiles, (metrics) => metrics.extends),
      python_import_edges: sumOf(scannedFiles, (metrics) => metrics.pythonImportTargets.length),
      python_relative_imports: sumOf(pythonFiles, (metrics) => metrics.importsLocal),
      python_inheritance_edges: sumOf(scannedFiles, (metrics) => metrics.inherits),
      entrypoint_like_files: entrypoints.size,
    },
    entrypoint_like_files: [...entrypoints].sort(),
    top_local_import_hubs: topLocalImportHubs(fileProfileRows),
    top_inheritance_hubs: topInheritanceHubs(fileProfileRows),
  };
}

function buildDocstringSignalSection(root: string, rankedFiles: string[]): DocstringSignals {
  const focusFiles = rankedFiles.slice(0, DOCSTRING_SIGNAL_FILE_LIMIT);
  if (focusFiles.length === 0) {
    return {
      files_considered: 0,
      python_files_considered: 0,
      typescript_files_considered: 0,
      file_docstrings: { present: 0, total: 0 },
      file_docstring_previews: [],
      likely_main_function_docstrings: [],
    };
  }
  return buildDocstringSignals(root, {
    focusFiles,
    maxFiles: DOCSTRING_SIGNAL_FILE_LIMIT,
    maxFunctions: DOCSTRING_SIGNAL_FUNCTION_LIMIT,
  });
}

function sumOf(scannedFiles: FileMetrics[], count: (metrics: FileMetrics) => number): number {
  return scannedFiles.reduce((total, metrics) => total + count(metrics), 0);
}
