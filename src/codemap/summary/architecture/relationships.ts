/** Acquires internal relationship evidence and projects its hotspots and clusters. */

import {
  callCodebaseMemoryTool,
  withFreshCodebaseMemoryProject,
} from "../../codebase-memory/client.js";
import { codebaseMemoryQueryRows } from "../../codebase-memory/queries.js";
import { arrayValue, numberField, recordValue, stringField } from "../../json-utils.js";
import { isTestPath } from "../../source/scanner/index.js";
import { uniqueStrings } from "../../text-utils.js";
import type { ClusterSummary, HotspotSummary } from "../schema.js";
import { resolveSourceSymbol, type SourceContext, symbolDescription } from "./source-context.js";

export type RelationshipRow = Record<string, unknown>;

export type RelationshipEvidence = {
  architecture: RelationshipRow;
  relationships: RelationshipRow[];
};

const JSON_FORMAT = { format: "json" } as const;
const IMPORT_RELATIONSHIPS_QUERY =
  "MATCH (a:File)-[r:IMPORTS]->(b:Module) RETURN a.file_path AS source, b.file_path AS target, count(r) AS weight";
const CALL_RELATIONSHIPS_QUERY =
  "MATCH (a)-[r:CALLS]->(b) RETURN a.file_path AS source, b.file_path AS target, count(r) AS weight";

/** Requests native architecture facts and relationship rows after a fresh graph index. */
export function relationshipEvidence(
  root: string,
  sourceFileCount: number,
): RelationshipEvidence | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const architectureResult = callCodebaseMemoryTool("get_architecture", {
      project: project.name,
      aspects: ["all"],
      ...JSON_FORMAT,
    });
    if (!architectureResult.ok || !hasRelationshipEvidence(architectureResult.value)) {
      return null;
    }
    const relationships = [IMPORT_RELATIONSHIPS_QUERY, CALL_RELATIONSHIPS_QUERY].flatMap(
      (query) => {
        const result = callCodebaseMemoryTool("query_graph", {
          project: project.name,
          query,
          max_rows: Math.max(1, sourceFileCount ** 2),
          ...JSON_FORMAT,
        });
        return result.ok
          ? (codebaseMemoryQueryRows(result.value, ["source", "target", "weight"]) ?? [])
          : [];
      },
    );
    return { architecture: recordValue(architectureResult.value), relationships };
  });
}

/** Rejects successful-but-empty architecture payloads. */
export function hasRelationshipEvidence(value: unknown): boolean {
  const record = recordValue(value);
  if (stringField(record.project) === null) {
    return false;
  }
  return ["node_labels", "edge_types", "hotspots", "clusters"].some(
    (key) => arrayValue(record[key]).length > 0,
  );
}

const CLUSTER_NODE_CAP = 8_000;
const GENERIC_CLUSTER_LABELS = new Set(["app", "lib", "packages", "src"]);
const GENERIC_BACKEND_NAMES = new Set([
  "all",
  "any",
  "append",
  "arrayValue",
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
  "limitedRows",
  "list",
  "lower",
  "map",
  "max",
  "min",
  "numberField",
  "numberValue",
  "open",
  "pop",
  "print",
  "range",
  "read",
  "read_text",
  "recordValue",
  "reject",
  "reshape",
  "resolve",
  "run",
  "send",
  "set",
  "sleep",
  "str",
  "stringField",
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

/** Converts native call counts into described, non-generic hotspot rows. */
function hotspotSummaries(architecture: RelationshipRow, source: SourceContext): HotspotSummary[] {
  const callEdges = namedCount(architecture.edge_types, "type", "CALLS");
  return arrayValue(architecture.hotspots)
    .map(recordValue)
    .filter((row) => {
      const name = stringField(row.name) ?? stringField(row.qualified_name);
      return name !== null && !genericBackendName(name);
    })
    .map((row) => {
      const name = stringField(row.name) ?? stringField(row.qualified_name) ?? "unknown";
      const fanIn = numberField(row.fan_in);
      const symbol = resolveSourceSymbol(source, name, stringField(row.qualified_name));
      return {
        name,
        file: symbol?.file ?? null,
        description: symbolDescription(source, symbol),
        callShare: fanIn !== null && callEdges > 0 ? fanIn / callEdges : null,
      };
    });
}

/** Converts native communities into source-labelled size and internal-call percentages. */
function clusterSummaries(architecture: RelationshipRow, source: SourceContext): ClusterSummary[] {
  const analyzedSymbols = Math.min(
    CLUSTER_NODE_CAP,
    namedCount(architecture.node_labels, "label", "Function") +
      namedCount(architecture.node_labels, "label", "Method") +
      namedCount(architecture.node_labels, "label", "Class"),
  );
  const clusters = arrayValue(architecture.clusters)
    .map(recordValue)
    .filter((row) => {
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
        codeShare: members !== null && analyzedSymbols > 0 ? members / analyzedSymbols : null,
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

/** Finds the deepest directory shared by resolved cluster symbols. */
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

/** Reads one named count from a backend count-row array. */
function namedCount(value: unknown, nameKey: string, expectedName: string): number {
  for (const item of arrayValue(value)) {
    const row = recordValue(item);
    if ((stringField(row[nameKey]) ?? stringField(row.name)) === expectedName) {
      return numberField(row.count) ?? numberField(row.file_count) ?? 0;
    }
  }
  return 0;
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

/** Detects provider labels derived from the repository path rather than a source owner. */
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

/** Converts internal relationship evidence into the human-facing hotspot and cluster views. */
export function relationshipSummaries(
  architecture: RelationshipRow,
  source: SourceContext,
): {
  hotspots: HotspotSummary[];
  clusters: ClusterSummary[];
} {
  return {
    hotspots: hotspotSummaries(architecture, source),
    clusters: clusterSummaries(architecture, source),
  };
}
