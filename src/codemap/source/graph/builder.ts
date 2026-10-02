/** Builds graph nodes and edges from scan, import, and structure evidence. */
import path from "node:path";

import { compareText } from "../../text-utils.js";
import type { StructureEntry } from "../extraction/index.js";
import { ENTRYPOINT_BASENAMES } from "../scanner/index.js";
import type { GraphEdge, GraphNode } from "./schema.js";

export type ScanLikeEntry = {
  path: string;
  language?: string;
  fileCategory?: string;
  sizeLines?: number;
};

type DefinitionSpan = { name: string; startLine: number; endLine: number };

/** Classifies a scanned file with language, category, and role tags. */
export function classifyTags(scanEntry: ScanLikeEntry): string[] {
  const filePath = String(scanEntry.path);
  const category = String(scanEntry.fileCategory ?? "code");
  const language = String(scanEntry.language ?? "unknown");
  const tags = new Set([category, language]);
  const lower = filePath.toLowerCase();
  const name = path.basename(filePath);
  const nameLower = name.toLowerCase();
  if (lower.includes("test") || lower.includes("spec")) {
    tags.add("test");
  }
  if (name === "README.md" || name === "readme.md") {
    tags.add("entry-documentation");
  }
  if (
    name === "package.json" ||
    name === "pyproject.toml" ||
    name === "go.mod" ||
    name === "Cargo.toml"
  ) {
    tags.add("project-manifest");
  }
  if (
    name === "Dockerfile" ||
    name === "docker-compose.yml" ||
    lower.includes(".github/workflows/")
  ) {
    tags.add("infrastructure");
  }
  if (ENTRYPOINT_BASENAMES.has(nameLower)) {
    tags.add("entry-candidate");
  }
  return [...tags].filter((tag) => tag && tag !== "unknown").sort();
}

/** Classifies a file graph node type from path and category. */
function nodeTypeForFile(scanEntry: ScanLikeEntry): string {
  const category = String(scanEntry.fileCategory ?? "code");
  const language = String(scanEntry.language ?? "unknown");
  const filePath = String(scanEntry.path).toLowerCase();
  if (category === "docs") {
    return "document";
  }
  if (category === "config") {
    return "config";
  }
  if (category === "infra") {
    if (filePath.includes(".github/workflows/") || filePath.includes("jenkinsfile")) {
      return "pipeline";
    }
    if (filePath.endsWith(".tf") || filePath.endsWith(".tfvars")) {
      return "resource";
    }
    return "service";
  }
  if (category === "data") {
    if (language === "graphql" || language === "protobuf" || language === "prisma") {
      return "schema";
    }
    if (language === "sql") {
      return "table";
    }
  }
  return "file";
}

/** Builds the short file summary used on graph file nodes. */
function fileSummary(
  scanEntry: ScanLikeEntry,
  structure: StructureEntry | null,
  importTargets: string[],
): string {
  const filePath = String(scanEntry.path);
  const language = String(scanEntry.language ?? "unknown");
  const category = String(scanEntry.fileCategory ?? "code");
  const lines = Number(scanEntry.sizeLines ?? 0) || 0;
  const bits = [`${category} file in ${language}`, `${lines} lines`];
  const counts = [
    structure?.functions.length ? `${structure.functions.length} functions` : null,
    structure?.classes.length ? `${structure.classes.length} classes` : null,
  ].filter((count) => count !== null);
  if (counts.length > 0) {
    bits.push(counts.join(", "));
  }
  if (importTargets.length > 0) {
    bits.push(`imports ${importTargets.length} project files`);
  }
  return `${filePath}: ${bits.join("; ")}.`;
}

/** Adds a graph edge while deduplicating source-target-type triples. */
function addEdge(
  edges: GraphEdge[],
  seen: Set<string>,
  source: string,
  target: string,
  edgeType: string,
): void {
  const key = `${source}\0${target}\0${edgeType}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  edges.push({ source, target, type: edgeType });
}

/** Builds a graph node for one source file. */
export function fileNode(
  relPath: string,
  scanEntry: ScanLikeEntry,
  fileStructure: StructureEntry | null,
  importTargets: string[],
): GraphNode {
  const nodeType = nodeTypeForFile(scanEntry);
  return {
    id: `${nodeType}:${relPath}`,
    type: nodeType,
    name: path.basename(relPath),
    filePath: relPath,
    summary: fileSummary(scanEntry, fileStructure, importTargets),
    tags: classifyTags(scanEntry),
  };
}

/** Builds a graph node for one function or class definition. */
function definitionNode(
  kind: "function" | "class",
  relPath: string,
  definition: DefinitionSpan,
): GraphNode {
  return {
    id: `${kind}:${relPath}:${definition.name}`,
    type: kind,
    name: definition.name,
    filePath: relPath,
    lineRange: [definition.startLine, definition.endLine],
    summary:
      kind === "function"
        ? `${definition.name} in ${relPath}.`
        : `${definition.name} class in ${relPath}.`,
    tags: [kind],
  };
}

/**
 * Builds file, definition, import, containment, and same-file call relationships.
 *
 * Every extracted function and class becomes a node so exact symbol inspection can resolve short private definitions as well as large public ones.
 * Structure entries name the emitted files; the complete inventory still resolves import targets outside that emitted set.
 */
export function buildNodesAndEdges(
  files: ScanLikeEntry[],
  structures: StructureEntry[],
  importMap: Record<string, string[]>,
): [GraphNode[], GraphEdge[]] {
  const filesByPath = new Map(files.map((scanEntry) => [scanEntry.path, scanEntry]));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const functionNodeIds = new Set<string>();

  for (const structure of structures.toSorted((left, right) =>
    compareText(left.path, right.path),
  )) {
    const relPath = structure.path;
    const scanEntry = filesByPath.get(relPath);
    if (scanEntry === undefined) {
      continue;
    }
    const importTargets = importMap[relPath] ?? [];
    const node = fileNode(relPath, scanEntry, structure, importTargets);
    nodes.push(node);
    for (const target of importTargets) {
      const targetScanEntry = filesByPath.get(target);
      if (targetScanEntry !== undefined) {
        addEdge(
          edges,
          seenEdges,
          node.id,
          `${nodeTypeForFile(targetScanEntry)}:${target}`,
          "imports",
        );
      }
    }
    for (const [kind, definitions] of [
      ["function", structure.functions],
      ["class", structure.classes],
    ] as const) {
      for (const definition of definitions) {
        const child = definitionNode(kind, relPath, definition);
        if (kind === "function") {
          functionNodeIds.add(child.id);
        }
        nodes.push(child);
        addEdge(edges, seenEdges, node.id, child.id, "contains");
      }
    }
  }

  for (const structure of structures) {
    for (const call of structure.callGraph) {
      const source = `function:${structure.path}:${call.caller}`;
      const target = `function:${structure.path}:${call.callee}`;
      if (functionNodeIds.has(source) && functionNodeIds.has(target)) {
        addEdge(edges, seenEdges, source, target, "calls");
      }
    }
  }
  return [nodes, edges];
}
