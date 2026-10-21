/** Builds ranked source rows from file metrics and identifier usage. */
import { readFileSync } from "node:fs";

import { numberValue } from "../json-utils.js";
import { describeNumbers } from "../math-utils.js";
import type { FileMetrics, FunctionSpan } from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import type {
  DefinitionRow,
  DenseFileRow,
  FileCountRow,
  FileProfileRow,
  FunctionLengthSection,
  NameFrequencyRow,
} from "./schema.js";

export const IDENTIFIER_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

type OccurrenceCounts = Map<string, number> | Record<string, unknown>;

export function fileProfileRow(metrics: FileMetrics): FileProfileRow {
  const total =
    metrics.defines +
    metrics.importsLocal +
    metrics.exports +
    metrics.reexportsLocal +
    metrics.extends +
    metrics.inherits +
    metrics.decorators;
  return {
    file: metrics.relPath,
    total,
    lines: metrics.lines,
    defines: metrics.defines,
    imports_local: metrics.importsLocal,
    exports: metrics.exports,
    reexports_local: metrics.reexportsLocal,
    extends: metrics.extends,
    inherits: metrics.inherits,
    jsx_components: metrics.jsxComponents,
    decorators: metrics.decorators,
    samples: metrics.samples.slice(0, 5),
  };
}

function fileSignalRole(
  filePath: string,
  row: DenseFileRow,
  { entrypoints }: { entrypoints: Set<string> },
): string {
  const defines = numberValue(row.defines);
  const importsLocal = numberValue(row.imports_local);
  const exports = numberValue(row.exports);
  const reexportsLocal = numberValue(row.reexports_local);
  const decorators = numberValue(row.decorators);
  if (entrypoints.has(filePath)) {
    return "likely entrypoint";
  }
  if (/(^|\/)(test_|.*\.test\.|.*_test\.)/.test(filePath)) {
    return "likely test/support";
  }
  if (filePath.endsWith(".py") && defines >= 8) {
    return "likely script hub";
  }
  if (reexportsLocal > 0 && defines === 0 && importsLocal === 0) {
    return "likely barrel";
  }
  if (/(types|schema|schemas)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    return "likely contracts";
  }
  if (defines >= 6 || (defines >= 3 && importsLocal >= 2) || decorators >= 2) {
    return "likely hub";
  }
  if (exports >= 5 && importsLocal === 0 && defines <= 1) {
    return "likely contracts";
  }
  if (importsLocal >= 3) {
    return "likely integration";
  }
  return "likely module";
}

function fileSignalScore(
  filePath: string,
  row: DenseFileRow,
  { entrypoints }: { entrypoints: Set<string> },
): number {
  const defines = numberValue(row.defines);
  const importsLocal = numberValue(row.imports_local);
  const exports = numberValue(row.exports);
  const extendsCount = numberValue(row.extends);
  const inherits = numberValue(row.inherits);
  const decorators = numberValue(row.decorators);
  let score =
    defines * 5 + importsLocal * 6 + extendsCount * 3 + inherits * 3 + decorators * 2 + exports;
  const role = fileSignalRole(filePath, row, { entrypoints });
  if (entrypoints.has(filePath)) {
    score += 30;
  }
  if (role === "likely contracts") {
    score -= 8;
  }
  if (role === "likely barrel") {
    score -= 12;
  }
  if (role === "likely test/support") {
    score -= 10;
  }
  return score;
}

/** Orders files for the docstring-signals focus by a structural score, dropping files that score zero or below. */
export function rankSignalFocusFiles(
  fileProfileRows: DenseFileRow[],
  { entrypoints }: { entrypoints: Set<string> },
): string[] {
  const entries: Array<{ file: string; score: number }> = [];
  for (const row of fileProfileRows) {
    const filePath = String(row.file);
    const score = fileSignalScore(filePath, row, { entrypoints });
    if (score <= 0) {
      continue;
    }
    entries.push({
      score,
      file: filePath,
    });
  }
  entries.sort((left, right) => right.score - left.score || compareText(left.file, right.file));
  return entries.map((entry) => entry.file);
}

export function usageBins(rows: DefinitionRow[]): Record<string, number> {
  return describeNumbers(rows.map((row) => numberValue(row.count))).bins;
}

/** Counts every identifier-shaped token, including those inside comments and strings; unreadable files are skipped. */
export function countIdentifierOccurrences(files: string[]): Map<string, number> {
  const counter = new Map<string, number>();
  for (const filePath of files) {
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(IDENTIFIER_RE)) {
      const name = match[0];
      counter.set(name, (counter.get(name) ?? 0) + 1);
    }
  }
  return counter;
}

export function usageRows(names: string[], occurrences: OccurrenceCounts): NameFrequencyRow[] {
  const uniqueNames = [...new Set(names.filter(Boolean))].sort();
  return uniqueNames.map((name) => ({
    name,
    count: occurrenceCount(occurrences, name),
  }));
}

/** Sorted fewest mentions first, then by identifier. */
export function functionUsageRows(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  occurrences: OccurrenceCounts,
): DefinitionRow[] {
  const rows: DefinitionRow[] = [];
  for (const metrics of scannedFiles) {
    if (!suffixes.has(metrics.suffix)) {
      continue;
    }
    const exportedNames = new Set(metrics.exportedNames);
    for (const span of uniqueFunctionSpans(metrics.functionSpans)) {
      const name = span.name;
      const count = occurrenceCount(occurrences, name);
      rows.push({
        name,
        identifier: span.identifier,
        file: metrics.relPath,
        count,
        line: span.startLine,
        lines: span.span,
        exported: exportedNames.has(name),
      });
    }
  }
  rows.sort(
    (left, right) =>
      numberValue(left.count) - numberValue(right.count) ||
      compareText(String(left.identifier), String(right.identifier)),
  );
  return rows;
}

/** Sorted fewest mentions first, then by identifier. */
export function variableUsageRows(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  occurrences: OccurrenceCounts,
): DefinitionRow[] {
  const rows: DefinitionRow[] = [];
  const seen = new Set<string>();
  for (const metrics of scannedFiles) {
    if (!suffixes.has(metrics.suffix)) {
      continue;
    }
    const exportedNames = new Set(metrics.exportedNames);
    for (const signal of metrics.variableSignals) {
      const key = `${signal.identifier}\0${signal.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const name = signal.name;
      const count = occurrenceCount(occurrences, name);
      rows.push({
        name,
        identifier: signal.identifier,
        file: metrics.relPath,
        count,
        line: signal.startLine,
        moduleLevel: signal.moduleLevel,
        exported: exportedNames.has(name),
      });
    }
  }
  rows.sort(
    (left, right) =>
      numberValue(left.count) - numberValue(right.count) ||
      compareText(String(left.identifier), String(right.identifier)),
  );
  return rows;
}

/** Longest first, with statistics over every unique span. */
export function functionLengthSection(items: FunctionSpan[]): FunctionLengthSection {
  const rows = uniqueFunctionSpans(items).map((item) => ({
    identifier: item.identifier,
    count: item.span,
  }));
  rows.sort(
    (left, right) =>
      -numberValue(left.count) - -numberValue(right.count) ||
      compareText(String(left.identifier), String(right.identifier)),
  );
  const counts = rows.map((row) => numberValue(row.count));
  return {
    ...describeNumbers(counts),
    items: rows,
  };
}

/** Collapses repeated parser hits for one identifier to the longest span, the earliest on ties. */
function uniqueFunctionSpans(items: FunctionSpan[]): FunctionSpan[] {
  const byIdentifier = new Map<string, FunctionSpan>();
  for (const item of items) {
    const current = byIdentifier.get(item.identifier);
    if (
      !current ||
      item.span > current.span ||
      (item.span === current.span && item.startLine < current.startLine)
    ) {
      byIdentifier.set(item.identifier, item);
    }
  }
  return [...byIdentifier.values()];
}

export function topHubs(
  fileProfileRows: DenseFileRow[],
  { key, limit = 3 }: { key: string; limit?: number },
): FileCountRow[] {
  const rows = fileProfileRows.filter((row) => numberValue(row[key]) > 0);
  rows.sort(
    (left, right) =>
      -numberValue(left[key]) - -numberValue(right[key]) ||
      compareText(String(left.file), String(right.file)),
  );
  return rows.slice(0, limit).map((row) => ({
    file: row.file,
    count: numberValue(row[key]),
  }));
}

export function topInheritanceHubs(fileProfileRows: DenseFileRow[], limit = 3): FileCountRow[] {
  const rows: FileCountRow[] = [];
  for (const row of fileProfileRows) {
    const count = numberValue(row.extends) + numberValue(row.inherits);
    if (count > 0) {
      rows.push({ file: row.file, count });
    }
  }
  rows.sort(
    (left, right) =>
      -numberValue(left.count) - -numberValue(right.count) ||
      compareText(String(left.file), String(right.file)),
  );
  return rows.slice(0, limit);
}

function occurrenceCount(occurrences: OccurrenceCounts, name: string): number {
  if (occurrences instanceof Map) {
    return occurrences.get(name) ?? 0;
  }
  return numberValue(occurrences[name]);
}
