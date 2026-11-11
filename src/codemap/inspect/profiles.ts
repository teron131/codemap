/** Markdown sections shared by every inspect profile, plus the lightweight file and directory profiles. */
import path from "node:path";

import { isDirectory, isWithinDirectory } from "../path-utils.js";
import { denseFileCounters, type FileProfileRow } from "../signals/index.js";
import type { InventoryEntry } from "../source/extraction/index.js";
import {
  DETAILED_ANALYSIS_FILE_LIMIT,
  type GraphNode,
  type GraphPayload,
  structureForFile,
} from "../source/graph/index.js";
import { type FileMetrics, scanFile } from "../source/scanner/index.js";
import { compareText, uniqueStrings } from "../text-utils.js";
import { importBoundaryRows, type InspectMetrics, metricsForFiles } from "./graph.js";
import type { LikelyEntry } from "./likely-entries.js";

/** Takes a normalized file target; null when the inventory does not hold it. */
export function renderLightweightFileInspection(
  root: string,
  relTarget: string,
  files: InventoryEntry[],
  { limit, likelyEntries }: { limit: number; likelyEntries: Map<string, LikelyEntry> },
): string | null {
  const inventoryEntry = files.find((entry) => entry.path === relTarget);
  if (inventoryEntry === undefined) {
    return null;
  }
  const filePath = path.join(root, relTarget);
  const metrics = scanFile(filePath, { displayRoot: root });
  const structure = structureForFile(root, inventoryEntry, {
    metricsByPath: { [relTarget]: metrics },
  });
  const functionCount = structure.functions.length;
  const classCount = structure.classes.length;
  const lines = [
    `# ${relTarget}`,
    "",
    `${relTarget}: ${inventoryEntry.fileCategory} file in ${inventoryEntry.language}; ${inventoryEntry.sizeLines} lines; ${functionCount} functions, ${classCount} classes.`,
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
    metricsForFiles(root, [inventoryEntry], { [relTarget]: metrics }),
    relTarget,
    { limit },
  );
  return lines.join("\n").trim();
}

/** Takes a normalized directory target. */
export function renderLightweightDirectoryInspection(
  relTarget: string,
  files: InventoryEntry[],
  { limit }: { limit: number },
): string {
  const rows = files.filter((entry) => isWithinDirectory(entry.path, relTarget));
  const lines = [
    `# ${relTarget || "."}/`,
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

/** Omits the section entirely when `rows` is empty and marks rows beyond `limit` with `- ...`. */
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
    metrics.fileProfiles.find((item) => item.file === relPath),
  );
}

export function appendFileProfileRow(lines: string[], profile: FileProfileRow | undefined): void {
  if (profile === undefined) {
    return;
  }
  const samples = profile.samples.join(", ");
  lines.push("");
  lines.push("## File Profile");
  lines.push(`- ${denseFileCounters(profile)}`);
  if (samples) {
    lines.push(`- samples: ${samples}`);
  }
}

export function appendSymbolProfile(lines: string[], node: GraphNode): void {
  if (node.type !== "function" && node.type !== "class") {
    return;
  }
  const parts = [`file: ${node.filePath}`];
  if (node.lineRange !== undefined) {
    parts.push(`lines: ${node.lineRange[0]}-${node.lineRange[1]}`);
  }
  lines.push("");
  lines.push(`## ${node.type === "function" ? "Function" : "Class"} Profile`);
  lines.push(`- ${parts.join(", ")}`);
}

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
    metrics.fileProfiles.find((row) => rowFiles.has(row.file)),
  );
  return lines.join("\n").trim();
}

/** Takes a normalized target; null when it is not a directory, so the caller can try symbol profiles. */
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
  const rows = metrics.fileProfiles.filter((item) => isWithinDirectory(item.file, target));
  const totalDefines = rows.reduce((sum, item) => sum + item.defines, 0);
  const totalImports = rows.reduce((sum, item) => sum + item.imports_local, 0);
  const lines = [
    `# ${target || "."}/`,
    "",
    `Directory profile: ${rows.length} scanned files; defines ${totalDefines}; local imports ${totalImports}.`,
  ];
  appendListSection(
    lines,
    "Dense Files",
    rows
      .toSorted((left, right) => right.total - left.total || compareText(left.file, right.file))
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

/** Unresolved import specifiers, since the lightweight profile skips import resolution. */
function fileImportSpecs(metrics: FileMetrics): string[] {
  return uniqueStrings([
    ...metrics.pythonImportTargets,
    ...metrics.typescriptImports.map((item) => item.target),
    ...metrics.typescriptReexportTargets.map((target) => `re-export ${target}`),
  ]);
}
