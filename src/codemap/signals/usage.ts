/** Builds the `usage` section from mention counts of defined names. Mentions are identifier tokens across every file of the language, not resolved references. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describeNumbers } from "../math-utils.js";
import { type FileMetrics, PYTHON_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import { uniqueFunctionSpans } from "./function-lengths.js";
import type { DefinitionRow, NameFrequencyRow, UsageSection } from "./schema.js";

const IDENTIFIER_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

type UsageLanguageRows = {
  functionRows: NameFrequencyRow[];
  variableRows: NameFrequencyRow[];
  functionDefinitions: DefinitionRow[];
  variableDefinitions: DefinitionRow[];
};

function metricNames(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  attrName: "functionNames" | "variableNames",
): string[] {
  const names: string[] = [];
  for (const metrics of scannedFiles) {
    if (suffixes.has(metrics.suffix)) {
      names.push(...metrics[attrName]);
    }
  }
  return names;
}

export function buildUsageSection(allFiles: string[], scannedFiles: FileMetrics[]): UsageSection {
  const python = buildLanguageUsageRows(allFiles, scannedFiles, PYTHON_SUFFIXES);
  const typescript = buildLanguageUsageRows(allFiles, scannedFiles, TYPESCRIPT_SUFFIXES);
  return {
    bins: {
      typescript_functions: usageBins(typescript.functionRows),
      typescript_variables: usageBins(typescript.variableRows),
      python_functions: usageBins(python.functionRows),
      python_variables: usageBins(python.variableRows),
    },
    tables: {
      typescript_function_definitions: typescript.functionDefinitions,
      typescript_variable_definitions: typescript.variableDefinitions,
      python_function_definitions: python.functionDefinitions,
      python_variable_definitions: python.variableDefinitions,
    },
  };
}

function buildLanguageUsageRows(
  allFiles: string[],
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
): UsageLanguageRows {
  const files = allFiles.filter((filePath) => suffixes.has(path.extname(filePath)));
  const occurrences = countIdentifierOccurrences(files);
  const functionRows = usageRows(metricNames(scannedFiles, suffixes, "functionNames"), occurrences);
  const variableRows = usageRows(metricNames(scannedFiles, suffixes, "variableNames"), occurrences);
  return {
    functionRows,
    variableRows,
    functionDefinitions: functionUsageRows(scannedFiles, suffixes, occurrences),
    variableDefinitions: variableUsageRows(scannedFiles, suffixes, occurrences),
  };
}

export function usageBins(rows: NameFrequencyRow[]): Record<string, number> {
  return describeNumbers(rows.map((row) => row.count)).bins;
}

/** Counts every identifier-shaped token, including those inside comments and strings; unreadable files are skipped. */
function countIdentifierOccurrences(files: string[]): Map<string, number> {
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

export function usageRows(names: string[], occurrences: Map<string, number>): NameFrequencyRow[] {
  const uniqueNames = [...new Set(names.filter(Boolean))].sort();
  return uniqueNames.map((name) => ({
    name,
    count: occurrences.get(name) ?? 0,
  }));
}

/** Sorted fewest mentions first, then by identifier. */
export function functionUsageRows(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  occurrences: Map<string, number>,
): DefinitionRow[] {
  const rows: DefinitionRow[] = [];
  for (const metrics of scannedFiles) {
    if (!suffixes.has(metrics.suffix)) {
      continue;
    }
    const exportedNames = new Set(metrics.exportedNames);
    for (const span of uniqueFunctionSpans(metrics.functionSpans)) {
      const name = span.name;
      const count = occurrences.get(name) ?? 0;
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
    (left, right) => left.count - right.count || compareText(left.identifier, right.identifier),
  );
  return rows;
}

/** Sorted fewest mentions first, then by identifier. */
function variableUsageRows(
  scannedFiles: FileMetrics[],
  suffixes: Set<string>,
  occurrences: Map<string, number>,
): DefinitionRow[] {
  const rows: DefinitionRow[] = [];
  const seen = new Set<string>();
  for (const metrics of scannedFiles) {
    if (!suffixes.has(metrics.suffix)) {
      continue;
    }
    const exportedNames = new Set(metrics.exportedNames);
    for (const variable of metrics.variableDefinitions) {
      const key = `${variable.identifier}\0${variable.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const name = variable.name;
      const count = occurrences.get(name) ?? 0;
      rows.push({
        name,
        identifier: variable.identifier,
        file: metrics.relPath,
        count,
        line: variable.startLine,
        moduleLevel: variable.moduleLevel,
        exported: exportedNames.has(name),
      });
    }
  }
  rows.sort(
    (left, right) => left.count - right.count || compareText(left.identifier, right.identifier),
  );
  return rows;
}
