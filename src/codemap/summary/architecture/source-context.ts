/** Scans authored source once and resolves source-owned descriptions for summary projections. */

import { statSync } from "node:fs";
import path from "node:path";

import {
  collectReports,
  docstringPreview,
  type FileReport,
  symbolDocstring,
} from "../../source/docstrings/index.js";
import { TypeScriptResolver } from "../../source/extraction/typescript-imports.js";
import {
  discoverFiles,
  type FileMetrics,
  isGeneratedPath,
  isSupportedSourcePath,
  isTestPath,
  scanFile,
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
  resolver: TypeScriptResolver;
};

/** Measures supported authored languages by source bytes, matching GitHub's basic convention. */
export function languageSummaries(source: SourceContext): LanguageSummary[] {
  const bytesByLanguage = new Map<string, number>();
  for (const metrics of source.files) {
    const language = languageName(metrics.suffix);
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

/** Groups syntax variants under the language names GitHub users expect. */
function languageName(suffix: string): string | null {
  if (suffix === ".py") {
    return "Python";
  }
  if ([".ts", ".tsx", ".mts", ".cts"].includes(suffix)) {
    return "TypeScript";
  }
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(suffix)) {
    return "JavaScript";
  }
  return null;
}

/** Discovers the tree once and scans supported production source for exports and symbol descriptions. */
export function buildSourceContext(root: string): SourceContext {
  const discoveredFiles = discoverFiles(root);
  const sourcePaths = discoveredFiles.filter((filePath) => {
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    return isSupportedSourcePath(relative) && !isGeneratedPath(relative) && !isTestPath(relative);
  });
  const files = sourcePaths.map((filePath) => scanFile(filePath, { displayRoot: root }));
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
    resolver: new TypeScriptResolver(root, filePaths),
  };
}

/** Finds one source definition, using backend qualification to disambiguate duplicate names. */
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

/** Converts a source path into the module fragment used in backend qualified names. */
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
  return shortDescription(docstring) ?? filePreview(source, symbol.file);
}

/** Projects the cached report through the established file-preview length and sentence policy. */
export function filePreview(source: SourceContext, file: string): string | null {
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
