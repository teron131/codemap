/** Function-length sections per language, over each identifier's longest parsed span. */
import { describeNumbers } from "../math-utils.js";
import {
  type FileMetrics,
  type FunctionSpan,
  PYTHON_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import type { FunctionLengthSection, SignalLanguage } from "./schema.js";

export function functionLengthsByLanguage(
  scannedFiles: FileMetrics[],
): Record<SignalLanguage, FunctionLengthSection> {
  return {
    python: functionLengthSection(functionSpans(scannedFiles, PYTHON_SUFFIXES)),
    typescript: functionLengthSection(functionSpans(scannedFiles, TYPESCRIPT_SUFFIXES)),
  };
}

/** Longest first, with statistics over every unique span. */
export function functionLengthSection(items: FunctionSpan[]): FunctionLengthSection {
  const rows = uniqueFunctionSpans(items)
    .map((item) => ({ identifier: item.identifier, count: item.span }))
    .sort(
      (left, right) => right.count - left.count || compareText(left.identifier, right.identifier),
    );
  return {
    ...describeNumbers(rows.map((row) => row.count)),
    items: rows,
  };
}

/** Collapses repeated parser hits for one identifier to the longest span, the earliest on ties. */
export function uniqueFunctionSpans(items: FunctionSpan[]): FunctionSpan[] {
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

function functionSpans(scannedFiles: FileMetrics[], suffixes: Set<string>): FunctionSpan[] {
  return scannedFiles
    .filter((metrics) => suffixes.has(metrics.suffix))
    .flatMap((metrics) => metrics.functionSpans);
}
