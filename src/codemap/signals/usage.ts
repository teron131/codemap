/** Builds usage-signal tables from scanned source metrics. */
import path from "node:path";

import { type FileMetrics, PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../source/scanner/index.js";
import {
  countIdentifierOccurrences,
  functionUsageRows,
  usageBins,
  usageRows,
  variableUsageRows,
} from "./analysis.js";
import type { DefinitionRow, NameFrequencyRow, SignalRow } from "./schema.js";

type Row = SignalRow;

type UsageLanguageRows = {
  functionRows: NameFrequencyRow[];
  variableRows: NameFrequencyRow[];
  functionDefinitions: DefinitionRow[];
  variableDefinitions: DefinitionRow[];
};

/** Collects metric names for files matching a language suffix set. */
export function metricNames(
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

/** Builds usage bins and measured definition tables. */
export function buildUsageSection(allFiles: string[], scannedFiles: FileMetrics[]): Row {
  const python = buildLanguageUsageRows(allFiles, scannedFiles, PY_SUFFIXES);
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

/** Builds frequency and definition rows for one source language. */
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
