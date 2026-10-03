/** Renders file, directory, symbol, and variable inspection profiles. */
import path from "node:path";

import { DETAILED_ANALYSIS_FILE_LIMIT, isDirectory } from "../common.js";
import type { DenseFileRow } from "../signals/index.js";
import { denseFileCounters } from "../signals/render.js";
import { type ScanEntry, structureForFile } from "../source/extraction/index.js";
import type { GraphNode, GraphPayload, LikelyEntry } from "../source/graph/index.js";
import { type FileMetrics, scanFile } from "../source/scanner/index.js";
import { compareText, uniqueStrings } from "../text-utils.js";
import { importBoundaryRows, type InspectMetrics, metricsForFiles } from "./graph.js";

/** Renders one file directly from scanner evidence when full graphing is too broad. */
export function renderLightweightFileInspection(
  root: string,
  target: string,
  files: ScanEntry[],
  { limit, likelyEntries }: { limit: number; likelyEntries: Map<string, LikelyEntry> },
): string | null {
  const relTarget = relativeTargetPath(root, target);
  const scanEntry = files.find((entry) => entry.path === relTarget);
  if (scanEntry === undefined) {
    return null;
  }
  const filePath = path.join(root, relTarget);
  const metrics = scanFile(filePath, { displayRoot: root });
  const structure = structureForFile(root, scanEntry, {
    metricsByPath: { [relTarget]: metrics },
  });
  const functionCount = structure.functions.length;
  const classCount = structure.classes.length;
  const lines = [
    `# ${relTarget}`,
    "",
    `${relTarget}: ${scanEntry.fileCategory} file in ${scanEntry.language}; ${scanEntry.sizeLines} lines; ${functionCount} functions, ${classCount} classes.`,
    `Fallback: detailed graph skipped above ${DETAILED_ANALYSIS_FILE_LIMIT} files; incoming imports not computed.`,
  ];
  appendLikelyEntryContext(lines, likelyEntries.get(relTarget));
  appendListSection(lines, "Imports From File", fileImportSpecs(metrics), limit);
  appendListSection(
    lines,
    "Contains",
    [
      ...structure.functions.map((item) => `${item.name} in ${relTarget}:${item.startLine}`),
      ...structure.classes.map((item) => `${item.name} class in ${relTarget}:${item.startLine}`),
    ],
    limit,
  );
  appendFileProfile(
    lines,
    metricsForFiles(root, [scanEntry], { [relTarget]: metrics }),
    relTarget,
    { limit },
  );
  return lines.join("\n").trim();
}

/** Renders one directory directly from scan rows when full graphing is too broad. */
export function renderLightweightDirectoryInspection(
  root: string,
  target: string,
  files: ScanEntry[],
  { limit }: { limit: number },
): string {
  const relTarget = relativeTargetPath(root, target);
  const rows =
    relTarget === "." ? files : files.filter((entry) => entry.path.startsWith(`${relTarget}/`));
  const title = relTarget === "." ? "." : relTarget.replace(/\/+$/, "");
  const lines = [
    `# ${title}/`,
    "",
    `Directory profile: ${rows.length} scanned files.`,
    `Fallback: detailed graph skipped above ${DETAILED_ANALYSIS_FILE_LIMIT} files.`,
  ];
  appendListSection(
    lines,
    "Largest Files",
    rows
      .toSorted(
        (left, right) => right.sizeLines - left.sizeLines || compareText(left.path, right.path),
      )
      .map(
        (item) => `${item.path}: ${item.sizeLines} lines, ${item.language}, ${item.fileCategory}`,
      ),
    limit,
  );
  return lines.join("\n").trim();
}

/** Appends one titled bullet section, marking rows beyond the display limit. */
export function appendListSection(
  lines: string[],
  title: string,
  rows: string[],
  limit: number,
): void {
  if (rows.length === 0) {
    return;
  }
  lines.push("");
  lines.push(`## ${title}`);
  for (const row of rows.slice(0, limit)) {
    lines.push(`- ${row}`);
  }
  if (rows.length > limit) {
    lines.push("- ...");
  }
}

/** Appends likely-entry navigation context for inspected files. */
export function appendLikelyEntryContext(lines: string[], entry: LikelyEntry | undefined): void {
  if (entry === undefined) {
    return;
  }
  lines.push("");
  lines.push("## Navigation Context");
  lines.push(`- role: ${entry.role}`);
  lines.push(`- why: ${entry.reason}`);
  lines.push(`- evidence: ${entry.description}`);
}

/** Appends one file's file-profile counters, preceded by its measured functions unless the caller omits that inventory. */
export function appendFileProfile(
  lines: string[],
  metrics: InspectMetrics,
  relPath: string,
  { limit, includeFunctions = true }: { limit: number; includeFunctions?: boolean },
): void {
  if (includeFunctions) {
    const identifierPrefix = `${relPath}::`;
    appendListSection(
      lines,
      "Functions In File",
      metrics.functionLengths
        .filter((item) => item.identifier.startsWith(identifierPrefix))
        .map((item) => `${item.identifier}: ${item.count} lines`),
      limit,
    );
  }
  appendFileProfileRow(
    lines,
    metrics.fileProfiles.filter((item) => item.file === relPath),
  );
}

/** Appends one file-profile row to inspection output. */
export function appendFileProfileRow(lines: string[], rows: DenseFileRow[]): void {
  const profile = rows[0];
  if (profile === undefined) {
    return;
  }
  const samples = (profile.samples ?? []).slice(0, 6).join(", ");
  lines.push("");
  lines.push("## File Profile");
  lines.push(`- ${denseFileCounters(profile)}`);
  if (samples) {
    lines.push(`- samples: ${samples}`);
  }
}

/** Appends file and line-range facts for a function or class node. */
export function appendSymbolProfile(lines: string[], node: GraphNode): void {
  if (node.type !== "function" && node.type !== "class") {
    return;
  }
  const lineRange = node.lineRange ?? [];
  const parts = [`file: ${node.filePath}`];
  if (lineRange.length > 0) {
    parts.push(`lines: ${String(lineRange[0])}-${String(lineRange.at(-1))}`);
  }
  lines.push("");
  lines.push(`## ${node.type === "function" ? "Function" : "Class"} Profile`);
  lines.push(`- ${parts.join(", ")}`);
}

/** Renders definitions and owning files for a requested variable symbol. */
export function renderVariableProfile(
  target: string,
  metrics: InspectMetrics,
  { limit }: { limit: number },
): string | null {
  const rows = metrics.variableDefinitions.filter(
    (item) => item.name === target || item.identifier.endsWith(`::${target}`),
  );
  if (rows.length === 0) {
    return null;
  }
  const lines = [`# ${target}`, "", "Variable profile."];
  appendListSection(
    lines,
    "Definitions",
    rows.map(
      (item) => `${item.identifier}: line ${item.line}, ${item.moduleLevel ? "module" : "local"}`,
    ),
    limit,
  );
  const rowFiles = new Set(rows.map((item) => item.file));
  appendFileProfileRow(
    lines,
    metrics.fileProfiles.filter((row) => rowFiles.has(row.file)),
  );
  return lines.join("\n").trim();
}

/** Renders file, import, export, and contained-node summaries for a directory. */
export function renderDirectoryProfile(
  root: string,
  graph: GraphPayload,
  metrics: Pick<InspectMetrics, "fileProfiles">,
  target: string,
  { limit }: { limit: number },
): string | null {
  if (!isDirectory(path.join(root, target))) {
    return null;
  }
  const prefix = `${target.replace(/\/+$/, "")}/`;
  const rows =
    target === "" || target === "."
      ? metrics.fileProfiles
      : metrics.fileProfiles.filter((item) => item.file.startsWith(prefix));
  const title = target === "" || target === "." ? "." : target.replace(/\/+$/, "");
  const totalDefines = rows.reduce((sum, item) => sum + (item.defines ?? 0), 0);
  const totalImports = rows.reduce((sum, item) => sum + (item.imports_local ?? 0), 0);
  const lines = [
    `# ${title}/`,
    "",
    `Directory profile: ${rows.length} scanned files; defines ${totalDefines}; local imports ${totalImports}.`,
  ];
  appendListSection(
    lines,
    "Dense Files",
    rows
      .toSorted(
        (left, right) =>
          (right.total ?? 0) - (left.total ?? 0) || compareText(left.file, right.file),
      )
      .map((item) => `${item.file}: ${denseFileCounters(item)}`),
    limit,
  );
  const [incoming, outgoing] = importBoundaryRows(graph, new Set(rows.map((item) => item.file)), {
    limit,
  });
  appendListSection(lines, "Incoming Imports", incoming, limit);
  appendListSection(lines, "Outgoing Imports", outgoing, limit);
  appendListSection(lines, "Files", rows.map((item) => item.file).toSorted(compareText), limit);
  return lines.join("\n").trim();
}

/** Lists raw imports seen in one lightweight file inspection. */
function fileImportSpecs(metrics: FileMetrics): string[] {
  return uniqueStrings([
    ...metrics.pyImportTargets,
    ...metrics.typescriptImports.map((item) => item.target),
    ...metrics.typescriptReexportTargets.map((target) => `re-export ${target}`),
  ]);
}

/** Formats an inspected path relative to the display root. */
function relativeTargetPath(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved).split(path.sep).join("/");
  return relative || ".";
}
