/** Backend diagnostics and Cypher queries. Each operation rebuilds the project index first and returns null when the backend fails. */
import { performance } from "node:perf_hooks";

import { arrayValue, recordValue } from "../json-utils.js";
import {
  callCodebaseMemoryTool,
  type CodebaseMemoryReadyProject,
  listCodebaseMemoryProjects,
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

const QUERY_REQUEST_TIMEOUT_MS = 30_000;
/** The backend's ceiling for changed files and impacted symbols, which default to 20 and 200; Codemap's output budget bounds what is printed. */
const CHANGE_ROW_LIMIT = 5_000;

export function codebaseMemoryProjects(root: string): Record<string, unknown>[] | null {
  return withFreshCodebaseMemoryProject(root, () => {
    const listing = listCodebaseMemoryProjects("stats");
    return listing.ok ? listing.projects : null;
  });
}

export function codebaseMemorySchema(root: string): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("get_graph_schema", {
      project: project.name,
    });
    return result.ok ? result.value : null;
  });
}

/** Runs `query` as given; refusing mutating Cypher is left to the `backend query` command. */
export function codebaseMemoryQuery(
  root: string,
  query: string,
  maxRows: number | undefined,
): unknown | null {
  return codebaseMemoryQueryWithProject(root, query, maxRows)?.value ?? null;
}

/** Retries once when the backend times out or returns no response; `freshness` is `partial` when indexing skipped files. */
export function codebaseMemoryQueryWithProject(
  root: string,
  query: string,
  maxRows: number | undefined,
): CodebaseMemoryProjectQueryResult | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const args = {
      project: project.name,
      query,
      ...(maxRows !== undefined ? { max_rows: maxRows } : {}),
    };
    let result = callCodebaseMemoryTool("query_graph", args, {
      timeoutMs: QUERY_REQUEST_TIMEOUT_MS,
    });
    if (
      !result.ok &&
      (result.reason === "missing tool response" ||
        /\b(?:ETIMEDOUT|timed out|timeout)\b/i.test(result.reason))
    ) {
      result = callCodebaseMemoryTool("query_graph", args, {
        timeoutMs: QUERY_REQUEST_TIMEOUT_MS,
      });
    }
    return result.ok ? { freshness: project.status, value: result.value } : null;
  });
}

/** Null when the payload is not tabular or lacks a required column, so callers can tell a backend mismatch from an empty result. */
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

export function codebaseMemoryChanges(
  root: string,
  options: CodebaseMemoryChangeOptions,
): unknown | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const result = callCodebaseMemoryTool("detect_changes", {
      project: project.name,
      changed_limit: CHANGE_ROW_LIMIT,
      limit: CHANGE_ROW_LIMIT,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.depth !== undefined ? { depth: options.depth } : {}),
      ...(options.baseBranch !== undefined ? { base_branch: options.baseBranch } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
    });
    return result.ok ? result.value : null;
  });
}

export function codebaseMemoryStatus(root: string): CodebaseMemoryStatusResult | null {
  return withFreshCodebaseMemoryProject(root, (project) => {
    const schemaResult = callCodebaseMemoryTool("get_graph_schema", {
      project: project.name,
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

/** Times `codebaseMemoryStatus`, whose fresh-index setup is the refresh being measured. */
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
