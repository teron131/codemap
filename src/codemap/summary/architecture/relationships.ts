/** Acquires internal relationship evidence and projects its most-called symbols and clusters. */

import {
  callCodebaseMemoryTool,
  codebaseMemoryQueryRows,
  symbolName,
  withFreshCodebaseMemoryProject,
} from "../../codebase-memory/index.js";
import { arrayValue, numberField, recordValue, stringField } from "../../json-utils.js";
import {
  BACKEND_DEFINITION_COLUMNS,
  backendDefinitionsQuery,
} from "../../source/extraction/index.js";
import { isTestPath } from "../../source/scanner/index.js";
import { uniqueStrings } from "../../text-utils.js";
import type { ClusterSummary, MostCalledSymbol } from "../schema.js";
import { resolveSourceSymbol, type SourceContext, symbolDescription } from "./source-context.js";

/** One file-to-file relationship: `weight` counts the import or call edges between the two files. */
export type RelationshipRow = {
  source: string;
  target: string;
  weight: number;
};

type Architecture = Record<string, unknown>;

export type RelationshipEvidence = {
  architecture: Architecture;
  relationships: RelationshipRow[];
  /** Definition rows for files the working-tree scanner cannot parse, as `backendFileMetrics` reads them. */
  backendDefinitions: Record<string, unknown>[];
};

// Codebase Memory's names for the languages the working-tree scanner parses.
const SCANNED_LANGUAGES = new Set(["Python", "TypeScript", "JavaScript"]);

// Bounds one query; past it the unparsed languages lose the location of some symbols, never a whole section.
const BACKEND_DEFINITION_LIMIT = 50_000;

const IMPORT_RELATIONSHIPS_QUERY =
  "MATCH (a:File)-[r:IMPORTS]->(b:Module) RETURN a.file_path AS source, b.file_path AS target, count(r) AS weight";
const CALL_RELATIONSHIPS_QUERY =
  "MATCH (a)-[r:CALLS]->(b) RETURN a.file_path AS source, b.file_path AS target, count(r) AS weight";

/** Null when the backend is unavailable or reports an empty architecture; a relationship or definition query that fails contributes no rows. `scannedFileCount` counts the files the working-tree scanner parsed. */
export function fetchRelationshipEvidence(
  root: string,
  scannedFileCount: number,
): RelationshipEvidence | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const architectureResult = callCodebaseMemoryTool("get_architecture", {
      project: project.name,
      aspects: ["all"],
    });
    if (!architectureResult.ok || !hasRelationshipEvidence(architectureResult.value)) {
      return null;
    }
    const definitionsResult = indexesUnscannedLanguage(architectureResult.value)
      ? callCodebaseMemoryTool("query_graph", {
          project: project.name,
          query: backendDefinitionsQuery(null),
          max_rows: BACKEND_DEFINITION_LIMIT,
        })
      : null;
    const backendDefinitions = definitionsResult?.ok
      ? (codebaseMemoryQueryRows(definitionsResult.value, BACKEND_DEFINITION_COLUMNS) ?? [])
      : [];
    const fileCount =
      scannedFileCount + new Set(backendDefinitions.map((row) => row.file_path)).size;
    const relationships = [IMPORT_RELATIONSHIPS_QUERY, CALL_RELATIONSHIPS_QUERY].flatMap(
      (query) => {
        const result = callCodebaseMemoryTool("query_graph", {
          project: project.name,
          query,
          max_rows: Math.max(1, fileCount ** 2),
        });
        const rows = result.ok
          ? (codebaseMemoryQueryRows(result.value, ["source", "target", "weight"]) ?? [])
          : [];
        return rows.flatMap(relationshipRow);
      },
    );
    return {
      architecture: recordValue(architectureResult.value),
      relationships,
      backendDefinitions,
    };
  });
}

/** Drops rows without both file paths; the backend returns `count(r)` as a number or a numeric string, and anything else counts once. */
function relationshipRow(row: Record<string, unknown>): RelationshipRow[] {
  const source = stringField(row.source);
  const target = stringField(row.target);
  if (source === null || target === null) {
    return [];
  }
  const weight =
    typeof row.weight === "string" && row.weight.trim() ? Number(row.weight) : row.weight;
  return [
    { source, target, weight: typeof weight === "number" && Number.isFinite(weight) ? weight : 1 },
  ];
}

/** One row per resolved import in the working tree, from the source scan summary already holds. */
export function workingTreeRelationshipRows(source: SourceContext): RelationshipRow[] {
  const relationships: RelationshipRow[] = [];
  for (const metrics of source.files) {
    for (const target of source.resolver.targets(metrics)) {
      relationships.push({ source: metrics.relPath, target, weight: 1 });
    }
  }
  return relationships;
}

/** Rejects successful-but-empty architecture payloads. */
export function hasRelationshipEvidence(value: unknown): boolean {
  const record = recordValue(value);
  if (stringField(record.project) === null) {
    return false;
  }
  return ["node_labels", "edge_types", "hotspots", "clusters"].some(
    (key) => tableRows(record[key]).length > 0,
  );
}

const CLUSTER_NODE_CAP = 8_000;
const GENERIC_CLUSTER_LABELS = new Set(["app", "lib", "packages", "src"]);
const GENERIC_BACKEND_NAMES = new Set([
  "all",
  "any",
  "append",
  "cat",
  "bool",
  "clear",
  "close",
  "connect",
  "concat",
  "describe",
  "dict",
  "eval",
  "execute",
  "expect",
  "exists",
  "fetch",
  "filter",
  "float",
  "from",
  "get",
  "handler",
  "html",
  "int",
  "isInstance",
  "items",
  "it",
  "json",
  "keys",
  "len",
  "list",
  "lower",
  "map",
  "max",
  "min",
  "open",
  "pop",
  "print",
  "range",
  "read",
  "read_text",
  "reject",
  "reshape",
  "resolve",
  "run",
  "send",
  "set",
  "sleep",
  "str",
  "sum",
  "test",
  "to",
  "transpose",
  "tuple",
  "unsqueeze",
  "update",
  "upper",
  "values",
  "write",
  "write_text",
  "yield",
]);

/** Reads the backend's `hotspots`, dropping generic names; `callShare` is a symbol's fan-in as a fraction of all call edges. */
function mostCalledSymbols(architecture: Architecture, source: SourceContext): MostCalledSymbol[] {
  const callEdges = namedCount(architecture.edge_types, "type", "CALLS");
  return tableRows(architecture.hotspots).flatMap((row) => {
    const qualifiedName = stringField(row.qn);
    const name = qualifiedName === null ? null : symbolName(qualifiedName);
    if (name === null || genericBackendName(name)) {
      return [];
    }
    const fanIn = numberField(row.fan_in);
    const symbol = resolveSourceSymbol(source, name, qualifiedName);
    return [
      {
        name,
        file: symbol?.file ?? null,
        description: symbolDescription(source, symbol),
        callShare: fanIn !== null && callEdges > 0 ? fanIn / callEdges : null,
      },
    ];
  });
}

/** `symbolShare` is members over analyzed functions, methods, and classes, and `internalCallShare` is the backend's cohesion; both are fractions. */
function clusterSummaries(architecture: Architecture, source: SourceContext): ClusterSummary[] {
  const analyzedSymbols = Math.min(
    CLUSTER_NODE_CAP,
    namedCount(architecture.node_labels, "label", "Function") +
      namedCount(architecture.node_labels, "label", "Method") +
      namedCount(architecture.node_labels, "label", "Class"),
  );
  const clusters = tableRows(architecture.clusters).filter((row) => {
    const label = stringField(row.label);
    return label === null || !isTestPath(label);
  });
  const clusterCandidates = clusters.flatMap((row) => {
    const topNodes = uniqueStrings(
      arrayValue(row.top_nodes)
        .map((value) => stringField(value))
        .filter((value): value is string => value !== null && !genericBackendName(value)),
    );
    const resolvedNodes = topNodes.flatMap((name) => {
      const symbol = resolveSourceSymbol(source, name, null);
      return symbol === null
        ? []
        : [{ name, symbol, description: symbolDescription(source, symbol) }];
    });
    if (source.root && resolvedNodes.length === 0) {
      return [];
    }
    const anchor =
      resolvedNodes.find((item) => item.description !== null) ?? resolvedNodes[0] ?? null;
    const members = numberField(row.members);
    const cohesion = numberField(row.cohesion);
    const sharedOwner = commonOwnerPath(resolvedNodes.map((item) => item.symbol.file));
    const backendLabel = stringField(row.label);
    return [
      {
        label:
          sharedOwner ??
          (backendLabel !== null && !projectWideClusterLabel(backendLabel, source.root)
            ? backendLabel
            : null) ??
          anchor?.name ??
          topNodes[0] ??
          "cluster",
        anchorName: anchor?.name ?? topNodes[0] ?? null,
        description: anchor?.description ?? null,
        symbolShare: members !== null && analyzedSymbols > 0 ? members / analyzedSymbols : null,
        internalCallShare: cohesion,
        topNodes: source.root ? resolvedNodes.map((item) => item.name) : topNodes,
      } satisfies ClusterSummary & { anchorName: string | null },
    ];
  });
  const labelCounts = new Map<string, number>();
  for (const cluster of clusterCandidates) {
    labelCounts.set(cluster.label, (labelCounts.get(cluster.label) ?? 0) + 1);
  }
  return clusterCandidates.map(({ anchorName, ...cluster }) => ({
    ...cluster,
    label:
      anchorName !== null &&
      ((labelCounts.get(cluster.label) ?? 0) > 1 ||
        GENERIC_CLUSTER_LABELS.has(cluster.label.toLowerCase()))
        ? `${cluster.label} — ${anchorName}`
        : cluster.label,
  }));
}

/** Finds the deepest directory shared by resolved cluster symbols; null unless it is at least two segments deep, so a bare `src` never labels a cluster. */
function commonOwnerPath(files: string[]): string | null {
  if (files.length === 0) {
    return null;
  }
  const directories = files.map((file) => file.split("/").slice(0, -1));
  const commonParts: string[] = [];
  for (let index = 0; ; index += 1) {
    const part = directories[0]?.[index];
    if (part === undefined || directories.some((directory) => directory[index] !== part)) {
      break;
    }
    commonParts.push(part);
  }
  return commonParts.length > 1 ? commonParts.join("/") : null;
}

/** False only when the backend lists its indexed languages and the scanner parses all of them: each backend call starts a process, so such a project skips the definitions query. */
function indexesUnscannedLanguage(architecture: unknown): boolean {
  const languages = tableRows(recordValue(architecture).languages);
  return (
    languages.length === 0 ||
    languages.some((row) => !SCANNED_LANGUAGES.has(stringField(row.language) ?? ""))
  );
}

function namedCount(value: unknown, nameKey: string, expectedName: string): number {
  const row = tableRows(value).find((item) => stringField(item[nameKey]) === expectedName);
  return numberField(row?.count) ?? 0;
}

/** Rows of an architecture table, which the transport has expanded into records. */
function tableRows(value: unknown): Record<string, unknown>[] {
  return arrayValue(recordValue(value).rows).map(recordValue);
}

/** Detects generic backend names that do not explain repository structure. */
function genericBackendName(value: string): boolean {
  const name =
    value
      .replace(/\s+\(.*/, "")
      .split(".")
      .pop() ?? value;
  return name.startsWith("#") || GENERIC_BACKEND_NAMES.has(name);
}

/** Detects backend labels derived from the repository path rather than a source owner; under `/work/acme/api` those are `api`, `acme-api`, and `work-acme-api`. */
function projectWideClusterLabel(label: string, root: string): boolean {
  if (!root) {
    return false;
  }
  const parts = root
    .split(/[\\/]+/)
    .map((part) => part.toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
  return parts.some((_, index) => parts.slice(index).join("-") === label.toLowerCase());
}

export function relationshipSummaries(
  architecture: Architecture,
  source: SourceContext,
): {
  mostCalled: MostCalledSymbol[];
  clusters: ClusterSummary[];
} {
  return {
    mostCalled: mostCalledSymbols(architecture, source),
    clusters: clusterSummaries(architecture, source),
  };
}
