/** Scans authored source once and resolves source-owned descriptions for summary projections. */

import { statSync } from "node:fs";
import path from "node:path";

import {
  collectReports,
  docstringPreview,
  type FileReport,
  symbolDocstring,
} from "../../source/docstrings/index.js";
import { ImportResolver, languageForPath } from "../../source/extraction/index.js";
import {
  discoverFiles,
  type FileMetrics,
  isGeneratedPath,
  isSupportedSourcePath,
  isTestPath,
  scanFiles,
} from "../../source/scanner/index.js";
import { compareText } from "../../text-utils.js";
import type { LanguageSummary } from "../schema.js";

export type SourceSymbol = {
  name: string;
  file: string;
  line: number;
};

export type SourceContext = {
  root: string;
  discoveredFiles: string[];
  files: FileMetrics[];
  filesByPath: Map<string, FileMetrics>;
  filePaths: Set<string>;
  symbolsByName: Map<string, SourceSymbol[]>;
  reports: Map<string, FileReport | null>;
  resolver: ImportResolver;
};

/** Measures authored languages by source bytes, matching GitHub's basic convention; files without a suffix are left out. */
export function languageSummaries(source: SourceContext): LanguageSummary[] {
  const bytesByLanguage = new Map<string, number>();
  for (const metrics of source.files) {
    const language = languageName(metrics.relPath);
    if (language === null) {
      continue;
    }
    bytesByLanguage.set(
      language,
      (bytesByLanguage.get(language) ?? 0) + statSync(metrics.path).size,
    );
  }
  const totalBytes = [...bytesByLanguage.values()].reduce((total, bytes) => total + bytes, 0);
  if (totalBytes === 0) {
    return [];
  }
  return [...bytesByLanguage]
    .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))
    .map(([name, bytes]) => ({ name, share: bytes / totalBytes }));
}

// GitHub's names for the inventory languages whose capitalized identifier is not one; syntax variants and headers join their language.
const GITHUB_LANGUAGE_NAMES: Record<string, string> = {
  javascript: "JavaScript",
  jsx: "JavaScript",
  typescript: "TypeScript",
  tsx: "TypeScript",
  "c-header": "C",
  cpp: "C++",
  "cpp-header": "C++",
  csharp: "C#",
  "erlang-header": "Erlang",
  php: "PHP",
};

/** Groups syntax variants under the language names GitHub users expect. */
function languageName(relPath: string): string | null {
  if (!path.extname(relPath)) {
    return null;
  }
  const language = languageForPath(relPath);
  return (
    GITHUB_LANGUAGE_NAMES[language] ?? `${language[0]?.toUpperCase() ?? ""}${language.slice(1)}`
  );
}

/** Discovers the tree once and scans supported production source for exports and symbol descriptions. */
export function buildSourceContext(root: string): SourceContext {
  const discoveredFiles = discoverFiles(root);
  const sourcePaths = discoveredFiles.filter((filePath) => {
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    return isSupportedSourcePath(relative) && !isGeneratedPath(relative) && !isTestPath(relative);
  });
  const files = scanFiles(sourcePaths, { displayRoot: root });
  const filesByPath = new Map(files.map((metrics) => [metrics.relPath, metrics]));
  const filePaths = new Set(files.map((metrics) => metrics.relPath));
  const symbolsByName = new Map<string, SourceSymbol[]>();
  for (const metrics of files) {
    for (const span of metrics.functionSpans) {
      const symbols = symbolsByName.get(span.name) ?? [];
      symbols.push({ name: span.name, file: metrics.relPath, line: span.startLine });
      symbolsByName.set(span.name, symbols);
    }
  }
  for (const metrics of files) {
    for (const name of metrics.exportedNames) {
      const symbols = symbolsByName.get(name) ?? [];
      if (symbols.some((symbol) => symbol.file === metrics.relPath)) {
        continue;
      }
      symbols.push({ name, file: metrics.relPath, line: 0 });
      symbolsByName.set(name, symbols);
    }
  }
  return {
    root,
    discoveredFiles,
    files,
    filesByPath,
    filePaths,
    symbolsByName,
    reports: new Map(),
    resolver: new ImportResolver(root, filePaths),
  };
}

// Below this share of source bytes a backend-only language stays out of the summary; lower it and incidental scripts and templates add languages and files to a Python or TypeScript project's summary.
const BACKEND_LANGUAGE_MIN_SHARE = 0.01;

/**
 * Keeps the backend-described files that count as project source, decided per suffix without a language list.
 * A suffix needs a function or method somewhere, which drops the sections the backend reports in configuration and markup files, and at least 1% of the source bytes.
 */
export function backendSourceFiles(
  scannedFiles: FileMetrics[],
  backendFiles: FileMetrics[],
): FileMetrics[] {
  const callableSuffixes = new Set(
    backendFiles
      .filter((metrics) => metrics.functionSpans.length > 0)
      .map((metrics) => metrics.suffix),
  );
  const candidates = backendFiles.filter((metrics) => callableSuffixes.has(metrics.suffix));
  if (candidates.length === 0) {
    return [];
  }
  const bytesBySuffix = new Map<string, number>();
  for (const metrics of candidates) {
    bytesBySuffix.set(
      metrics.suffix,
      (bytesBySuffix.get(metrics.suffix) ?? 0) + statSync(metrics.path).size,
    );
  }
  const totalBytes =
    scannedFiles.reduce((total, metrics) => total + statSync(metrics.path).size, 0) +
    [...bytesBySuffix.values()].reduce((total, bytes) => total + bytes, 0);
  return candidates.filter(
    (metrics) =>
      (bytesBySuffix.get(metrics.suffix) ?? 0) >= totalBytes * BACKEND_LANGUAGE_MIN_SHARE,
  );
}

/** Adds the files only Codebase Memory can describe, with their definitions as resolvable symbols; the import resolver keeps covering scanned files alone. */
export function withBackendFiles(
  source: SourceContext,
  backendFiles: FileMetrics[],
): SourceContext {
  if (backendFiles.length === 0) {
    return source;
  }
  const files = [...source.files, ...backendFiles];
  const symbolsByName = new Map(
    [...source.symbolsByName].map(([name, symbols]) => [name, symbols.slice()]),
  );
  for (const metrics of backendFiles) {
    for (const span of [...metrics.functionSpans, ...metrics.classSpans]) {
      const symbols = symbolsByName.get(span.name) ?? [];
      symbols.push({ name: span.name, file: metrics.relPath, line: span.startLine });
      symbolsByName.set(span.name, symbols);
    }
  }
  return {
    ...source,
    files,
    filesByPath: new Map(files.map((metrics) => [metrics.relPath, metrics])),
    filePaths: new Set(files.map((metrics) => metrics.relPath)),
    symbolsByName,
  };
}

/** Finds one source definition, using backend qualification to disambiguate duplicate names; null while the name stays ambiguous. */
export function resolveSourceSymbol(
  source: SourceContext,
  name: string,
  qualifiedName: string | null,
): SourceSymbol | null {
  const candidates = source.symbolsByName.get(name) ?? [];
  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }
  if (qualifiedName !== null) {
    const qualified = candidates.filter((candidate) =>
      qualifiedName.includes(sourceModuleName(candidate.file)),
    );
    if (qualified.length === 1) {
      return qualified[0] ?? null;
    }
  }
  return null;
}

/** Converts a source path into the module fragment used in backend qualified names: `src/app/main.ts` → `src.app.main`. */
function sourceModuleName(filePath: string): string {
  return filePath
    .replace(/\.d\.ts$/, "")
    .replace(/\.[^.]+$/, "")
    .split("/")
    .join(".");
}

/** Reads a symbol docstring, then falls back to its owning file overview. */
export function symbolDescription(
  source: SourceContext,
  symbol: SourceSymbol | null,
): string | null {
  if (symbol === null || !source.root) {
    return null;
  }
  const report = fileReport(source, symbol.file);
  if (report === null) {
    return null;
  }
  const docstring =
    symbolDocstring(report, {
      kind: "function",
      name: symbol.name,
      line: symbol.line,
    }) ??
    symbolDocstring(report, {
      kind: "class",
      name: symbol.name,
      line: symbol.line,
    });
  return shortDescription(docstring) ?? fileDescription(source, symbol.file);
}

/** The first sentence of the file overview's first line; null without an overview. */
export function fileDescription(source: SourceContext, file: string): string | null {
  const report = fileReport(source, file);
  const preview = report === null ? null : docstringPreview(report.fileDocstring);
  return preview === "none" ? null : shortDescription(preview);
}

/** Parses each file's documentation at most once within this summary, including failed or missing reports. */
function fileReport(source: SourceContext, file: string): FileReport | null {
  if (!source.root) {
    return null;
  }
  if (!source.reports.has(file)) {
    const [, reports] = collectReports(source.root, { focusFiles: [file] });
    source.reports.set(file, reports[0] ?? null);
  }
  return source.reports.get(file) ?? null;
}

/** Keeps descriptions to their first meaningful prose sentence. */
function shortDescription(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const paragraph = value
    .split(/\n\s*\n/, 1)[0]
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!paragraph) {
    return null;
  }
  return /^.*?[.!?](?:\s|$)/.exec(paragraph)?.[0]?.trim() ?? paragraph;
}
