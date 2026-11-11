/** The per-file declaration profile: its row, the counter text `signals` and `inspect` both print, and the rankings read from profile rows. */
import { numberValue } from "../json-utils.js";
import type { FileMetrics } from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import type { DenseFileRow, FileCountRow, FileProfileRow, FileSignalCounters } from "./schema.js";

const HUB_LIMIT = 3;

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

/** Formats the dense-file counters shared by signals and inspect output. */
export function denseFileCounters(item: DenseFileRow): string {
  const counters = [`${denseFileScoreText(item)}${sourceLineDetail(item)}`];
  appendKnownCounter(counters, item, "defines", "defines");
  appendKnownCounter(counters, item, "imports_local", "local_imports");
  appendKnownCounter(counters, item, "exports", "exports");
  appendKnownCounter(counters, item, "reexports_local", "reexports");
  appendKnownCounter(counters, item, "decorators", "decorators");
  return counters.join(", ");
}

/** Absent counters, as in unparsed lightweight rows, are omitted rather than shown as zero. */
function appendKnownCounter(
  counters: string[],
  item: DenseFileRow,
  key: keyof FileSignalCounters,
  label: string,
): void {
  if (key in item) {
    counters.push(`${label}=${numberValue(item[key])}`);
  }
}

function denseFileScoreText(item: DenseFileRow): string {
  const label = item.total_label === "lines" ? "lines" : "declarations";
  return `${label}=${numberValue(item.total)}`;
}

function sourceLineDetail(item: DenseFileRow): string {
  const lines = Number(item.lines ?? 0);
  return lines > 0 ? `, lines=${lines}` : "";
}

/** Orders files for the docstring-signals focus by a structural score, dropping files that score zero or below. */
export function rankSignalFocusFiles(
  fileProfileRows: FileProfileRow[],
  { entrypoints }: { entrypoints: Set<string> },
): string[] {
  return fileProfileRows
    .map((row) => ({ file: row.file, score: fileSignalScore(row, { entrypoints }) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || compareText(left.file, right.file))
    .map((entry) => entry.file);
}

export function topLocalImportHubs(fileProfileRows: FileProfileRow[]): FileCountRow[] {
  return topFileCounts(fileProfileRows, (row) => row.imports_local);
}

export function topInheritanceHubs(fileProfileRows: FileProfileRow[]): FileCountRow[] {
  return topFileCounts(fileProfileRows, (row) => row.extends + row.inherits);
}

function topFileCounts(
  fileProfileRows: FileProfileRow[],
  count: (row: FileProfileRow) => number,
): FileCountRow[] {
  return fileProfileRows
    .map((row) => ({ file: row.file, count: count(row) }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count || compareText(left.file, right.file))
    .slice(0, HUB_LIMIT);
}

function fileSignalRole(
  row: FileProfileRow,
  { entrypoints }: { entrypoints: Set<string> },
): string {
  const filePath = row.file;
  const defines = row.defines;
  const importsLocal = row.imports_local;
  const exports = row.exports;
  const reexportsLocal = row.reexports_local;
  const decorators = row.decorators;
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
  row: FileProfileRow,
  { entrypoints }: { entrypoints: Set<string> },
): number {
  const defines = row.defines;
  const importsLocal = row.imports_local;
  const exports = row.exports;
  const extendsCount = row.extends;
  const inherits = row.inherits;
  const decorators = row.decorators;
  let score =
    defines * 5 + importsLocal * 6 + extendsCount * 3 + inherits * 3 + decorators * 2 + exports;
  const role = fileSignalRole(row, { entrypoints });
  if (entrypoints.has(row.file)) {
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
