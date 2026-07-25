/** Provides normalized Codebase Memory operations for backend diagnostics and signal queries. */
import { performance } from "node:perf_hooks";

import {
  arrayValue,
  callCodebaseMemoryTool,
  type CodebaseMemoryReadyProject,
  recordValue,
  withFreshCodebaseMemoryProject,
} from "./client.js";

export type CodebaseMemoryStatusResult = {
  projectName: string;
  status: string;
  nodes: number | null;
  edges: number | null;
  schemaNodeLabels: number | null;
  schemaEdgeTypes: number | null;
};

export type CodebaseMemoryIndexResult = CodebaseMemoryStatusResult & {
  elapsedMs: number;
};

export type CodebaseMemoryChangeOptions = {
  scope?: string;
  depth?: number;
  baseBranch?: string;
  since?: string;
};

type CodebaseMemoryProjectQueryResult = {
  freshness: CodebaseMemoryReadyProject["status"];
  value: unknown;
};

const JSON_FORMAT = { format: "json" } as const;

/** Lists indexed Codebase Memory projects after refreshing the current root. */
export function codebaseMemoryProjects(root: string): unknown | null {
  return withFreshCodebaseMemoryProject(root, () => {
    const result = callCodebaseMemoryTool("list_projects", {});
    return result.ok ? result.value : null;
  });
}

/** Reads Codebase Memory graph schema details for the current project. */
export function codebaseMemorySchema(root: string): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("get_graph_schema", {
      project: project.name,
      ...JSON_FORMAT,
    });
    return result.ok ? result.value : null;
  });
}

/** Executes a read-oriented Codebase Memory Cypher query for advanced graph analysis. */
export function codebaseMemoryQuery(
  root: string,
  query: string,
  maxRows: number | undefined,
): unknown | null {
  return codebaseMemoryQueryWithProject(root, query, maxRows)?.value ?? null;
}

/** Executes a graph query and retains the indexed project freshness metadata. */
export function codebaseMemoryQueryWithProject(
  root: string,
  query: string,
  maxRows: number | undefined,
): CodebaseMemoryProjectQueryResult | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("query_graph", {
      project: project.name,
      query,
      ...(maxRows !== undefined ? { max_rows: maxRows } : {}),
      ...JSON_FORMAT,
    });
    return result.ok ? { freshness: project.status, value: result.value } : null;
  });
}

/** Normalizes query_graph column and row payloads into named records. */
export function codebaseMemoryQueryRows(
  value: unknown,
  requiredColumns: string[] = [],
): Record<string, unknown>[] | null {
  const payload = recordValue(value);
  if (!Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
    return null;
  }
  const columns = arrayValue(payload.columns).filter(
    (column): column is string => typeof column === "string",
  );
  if (requiredColumns.some((column) => !columns.includes(column))) {
    return null;
  }
  return arrayValue(payload.rows)
    .map((row) => {
      if (Array.isArray(row) && columns.length > 0) {
        return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
      }
      return recordValue(row);
    })
    .filter((row) => Object.keys(row).length > 0);
}

/** Reads Codebase Memory changed-code impact for the current project. */
export function codebaseMemoryChanges(
  root: string,
  options: CodebaseMemoryChangeOptions,
): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("detect_changes", {
      project: project.name,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.depth !== undefined ? { depth: options.depth } : {}),
      ...(options.baseBranch !== undefined ? { base_branch: options.baseBranch } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
      ...JSON_FORMAT,
    });
    return result.ok ? result.value : null;
  });
}

/** Reads Codebase Memory index status and schema metadata when available. */
export function codebaseMemoryStatus(root: string): CodebaseMemoryStatusResult | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const schemaResult = callCodebaseMemoryTool("get_graph_schema", {
      project: project.name,
      ...JSON_FORMAT,
    });
    const schema = schemaResult.ok ? recordValue(schemaResult.value) : {};
    return {
      projectName: project.name,
      status: project.status,
      nodes: project.nodes,
      edges: project.edges,
      schemaNodeLabels: schemaResult.ok ? arrayValue(schema.node_labels).length : null,
      schemaEdgeTypes: schemaResult.ok ? arrayValue(schema.edge_types).length : null,
    };
  });
}

/** Explicitly refreshes Codebase Memory and returns timing plus status metadata. */
export function codebaseMemoryIndex(root: string): CodebaseMemoryIndexResult | null {
  const start = performance.now();
  const status = codebaseMemoryStatus(root);
  if (status === null) {
    return null;
  }
  return {
    ...status,
    elapsedMs: performance.now() - start,
  };
}
