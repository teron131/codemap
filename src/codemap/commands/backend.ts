/** Defines CLI behavior for Codebase Memory backend operations. */
import type { Command } from "commander";

import { canonicalPath } from "../codebase-memory/client.js";
import {
  type CodebaseMemoryChangeOptions,
  codebaseMemoryChanges,
  codebaseMemoryFailureReason,
  codebaseMemoryIndex,
  codebaseMemoryProjects,
  codebaseMemoryQuery,
  codebaseMemorySchema,
  codebaseMemoryStatus,
  type CodebaseMemoryStatusResult,
} from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import { arrayValue, numberField, recordValue, stringField } from "../json-utils.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

type BackendOptions = {
  projectRoot?: string;
};

type BackendQueryOptions = BackendOptions & {
  maxRows?: number;
  json?: boolean;
};

type BackendChangesOptions = BackendOptions & {
  scope?: string;
  depth?: number;
  baseBranch?: string;
  since?: string;
  json?: boolean;
};

type RootOptions = {
  projectRoot?: string;
};

/** Registers Codebase Memory backend commands. */
export function addBackendParsers(program: Command): void {
  const backend = program
    .command("backend")
    .description("Inspect the Codebase Memory backend used by Codemap.");

  const backendProjects = backend
    .command("projects")
    .description("Index this root, then list Codebase Memory projects.")
    .action((options: BackendOptions) => {
      const exitCode = commandBackendProjects(options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(backendProjects);

  const backendStatus = backend
    .command("status")
    .description("Index first, then print Codebase Memory backend status.")
    .action((options: BackendOptions) => {
      const exitCode = commandBackendStatus(options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(backendStatus);

  const backendSchema = backend
    .command("schema")
    .description("Index first, then print Codebase Memory graph schema.")
    .action((options: BackendOptions) => {
      const exitCode = commandBackendSchema(options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(backendSchema);

  const backendQuery = backend
    .command("query")
    .description("Run a read-oriented Codebase Memory Cypher query.")
    .argument("<query...>", "Cypher query text.")
    .option("--max-rows <count>", "Maximum rows returned by Codebase Memory.", parseIntegerOption)
    .option("--json", "Print raw JSON output.")
    .action((query: string[], options: BackendQueryOptions) => {
      const exitCode = commandBackendQuery(query, options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(backendQuery);

  const backendChanges = backend
    .command("changes")
    .description("Run Codebase Memory changed-code impact analysis.")
    .option("--scope <scope>", "Optional project scope for change analysis.")
    .option("--depth <count>", "Impact trace depth.", parseIntegerOption)
    .option("--base-branch <branch>", "Git base branch.", "main")
    .option("--since <ref>", "Git ref or date to compare from.")
    .option("--json", "Print raw JSON output.")
    .action((options: BackendChangesOptions) => {
      const exitCode = commandBackendChanges(options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(backendChanges);
}

/** Registers the top-level Codebase Memory refresh command. */
export function addIndexParser(program: Command): void {
  const index = program
    .command("index")
    .description("Refresh Codebase Memory and print index timing.")
    .action((options: BackendOptions) => {
      const exitCode = commandIndex(options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(index);
}

/** Lists Codebase Memory projects after refreshing the current project root. */
export function commandBackendProjects(
  options: BackendOptions,
  rootOptions: RootOptions = {},
): number {
  const root = resolveBackendRoot(options, rootOptions);
  const result = codebaseMemoryProjects(root);
  if (result !== null) {
    console.log(renderBackendProjects(result, root));
    return 0;
  }
  console.log(backendFailureMessage(root, "No Codebase Memory projects available."));
  return 1;
}

/** Prints Codebase Memory backend status for the project root. */
export function commandBackendStatus(
  options: BackendOptions,
  rootOptions: RootOptions = {},
): number {
  const root = resolveBackendRoot(options, rootOptions);
  const result = codebaseMemoryStatus(root);
  if (result !== null) {
    console.log(renderBackendStatus(result));
    return 0;
  }
  console.log(backendFailureMessage(root, "No Codebase Memory index for this project."));
  return 1;
}

/** Prints Codebase Memory graph schema for the project root. */
export function commandBackendSchema(
  options: BackendOptions,
  rootOptions: RootOptions = {},
): number {
  const root = resolveBackendRoot(options, rootOptions);
  const result = codebaseMemorySchema(root);
  if (result !== null) {
    console.log(renderBackendSchema(result));
    return 0;
  }
  console.log(backendFailureMessage(root, "No Codebase Memory schema for this project."));
  return 1;
}

/** Runs a Codebase Memory Cypher query for the project root. */
export function commandBackendQuery(
  query: string[],
  options: BackendQueryOptions,
  rootOptions: RootOptions = {},
): number {
  const queryText = query.join(" ").trim();
  if (queryText.length === 0) {
    console.log("Backend query requires Cypher text.");
    return 2;
  }
  if (mutatesGraph(queryText)) {
    console.log(
      "Backend query accepts read-oriented Cypher only; refusing a mutating graph query.",
    );
    return 2;
  }
  const root = resolveBackendRoot(options, rootOptions);
  const result = codebaseMemoryQuery(root, queryText, options.maxRows);
  if (result !== null) {
    console.log(options.json ? JSON.stringify(result, null, 2) : renderQueryRows(result));
    return 0;
  }
  console.log(backendFailureMessage(root, "Could not run Codebase Memory query."));
  return 1;
}

/** Runs Codebase Memory changed-code impact analysis. */
export function commandBackendChanges(
  options: BackendChangesOptions,
  rootOptions: RootOptions = {},
): number {
  const root = resolveBackendRoot(options, rootOptions);
  const result = codebaseMemoryChanges(root, backendChangeOptions(options));
  if (result !== null) {
    console.log(options.json ? JSON.stringify(result, null, 2) : renderBackendChanges(result));
    return 0;
  }
  console.log(backendFailureMessage(root, "Could not read Codebase Memory change impact."));
  return 1;
}

/** Explicitly refreshes Codebase Memory and prints timing for diagnostics. */
export function commandIndex(options: BackendOptions, rootOptions: RootOptions = {}): number {
  const root = resolveBackendRoot(options, rootOptions);
  const result = codebaseMemoryIndex(root);
  if (result !== null) {
    const elapsed =
      result.elapsedMs < 1000
        ? `${result.elapsedMs.toFixed(1)} ms`
        : `${(result.elapsedMs / 1000).toFixed(2)} s`;
    console.log(
      ["CodebaseMemory refresh complete", `elapsed: ${elapsed}`, renderBackendStatus(result)].join(
        "\n",
      ),
    );
    return 0;
  }
  console.log(backendFailureMessage(root, "Could not refresh Codebase Memory."));
  return 1;
}

/** Appends the concrete provider failure while keeping the command context visible. */
function backendFailureMessage(root: string, summary: string): string {
  const reason = codebaseMemoryFailureReason(root);
  return reason === null ? summary : `${summary}\nreason: ${reason}`;
}

/** Detects Cypher clauses that can mutate the backend graph. */
function mutatesGraph(query: string): boolean {
  return /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV)\b/i.test(query);
}

/** Builds Codebase Memory change options without explicit undefined fields. */
function backendChangeOptions(options: BackendChangesOptions): CodebaseMemoryChangeOptions {
  return {
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
    ...(options.baseBranch !== undefined ? { baseBranch: options.baseBranch } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
  };
}

/** Resolves command-local or global project-root options for backend commands. */
function resolveBackendRoot(options: BackendOptions, rootOptions: RootOptions): string {
  return resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
}

/** Renders backend status fields for the diagnostic command. */
export function renderBackendStatus(result: CodebaseMemoryStatusResult): string {
  const lines = [
    `CodebaseMemory index: ${result.projectName}`,
    `status: ${result.status}`,
    `nodes: ${result.nodes ?? "unknown"}`,
    `edges: ${result.edges ?? "unknown"}`,
  ];
  if (result.schemaNodeLabels !== null && result.schemaEdgeTypes !== null) {
    lines.push(
      `schema: ${result.schemaNodeLabels} node labels, ${result.schemaEdgeTypes} edge types`,
    );
  }
  return lines.join("\n");
}

/** Renders backend projects with the active root first and stale work roots hidden. */
function renderBackendProjects(value: unknown, currentRoot: string): string {
  const projects = arrayValue(recordValue(value).projects)
    .map(projectRecord)
    .filter((project) => project !== null);
  const currentRootPath = canonicalPath(currentRoot);
  const currentProject = projects.find(
    (project) => project.root !== null && canonicalPath(project.root) === currentRootPath,
  );
  const otherProjects = projects.filter(
    (project) =>
      project !== currentProject &&
      (project.root === null || !/[/\\]test[/\\]\.work[/\\]/.test(project.root)),
  );
  const hiddenEphemeral =
    projects.length - otherProjects.length - (currentProject === undefined ? 0 : 1);
  const lines = [
    `CodebaseMemory projects: ${projects.length}${hiddenEphemeral > 0 ? ` (hidden work: ${hiddenEphemeral})` : ""}`,
  ];
  if (currentProject !== undefined) {
    lines.push(`current: ${projectRow(currentProject)}`);
  }
  if (otherProjects.length > 0) {
    lines.push("other projects:");
    lines.push(...otherProjects.map((project) => `- ${projectRow(project)}`));
  }
  return lines.join("\n");
}

type BackendProject = {
  name: string;
  root: string | null;
  nodes: number | null;
  edges: number | null;
};

/** Normalizes one backend project row for diagnostic presentation. */
function projectRecord(value: unknown): BackendProject | null {
  const project = recordValue(value);
  const name = stringField(project.name);
  if (name === null) {
    return null;
  }
  return {
    name,
    root: stringField(project.root_path),
    nodes: numberField(project.nodes),
    edges: numberField(project.edges),
  };
}

/** Renders one backend project row without raw JSON. */
function projectRow(project: BackendProject): string {
  const detail = [
    project.root,
    project.nodes !== null ? `nodes=${project.nodes}` : null,
    project.edges !== null ? `edges=${project.edges}` : null,
  ].filter((item) => item !== null);
  return `${project.name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
}

/** Renders backend schema labels and edge types. */
function renderBackendSchema(value: unknown): string {
  const record = recordValue(value);
  const nodeLabels = arrayValue(record.node_labels);
  const edgeTypes = arrayValue(record.edge_types);
  return [
    `CodebaseMemory schema: ${nodeLabels.length} node labels, ${edgeTypes.length} edge types`,
    ...nodeLabels.map((item) => `- node: ${schemaRow(item)}`),
    ...edgeTypes.map((item) => `- edge: ${schemaRow(item)}`),
  ].join("\n");
}

/** Renders one schema count row from object or string payloads. */
function schemaRow(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = recordValue(value);
  const name = stringField(record.label) ?? stringField(record.type) ?? "unknown";
  const count = numberField(record.count);
  return count === null ? name : `${name} (${count})`;
}

/** Renders arbitrary backend query rows compactly. */
function renderQueryRows(value: unknown): string {
  const record = recordValue(value);
  const rows =
    arrayValue(record.rows).length > 0 ? arrayValue(record.rows) : arrayValue(record.results);
  const total = numberField(record.total) ?? rows.length;
  const renderedRows = uniqueRenderedRows(rows.map((row) => rowValueText(row)));
  const hiddenDuplicates = rows.length - renderedRows.length;
  const lines = [
    `CodebaseMemory query rows: ${total}${hiddenDuplicates > 0 ? ` (hidden duplicates: ${hiddenDuplicates})` : ""}`,
  ];
  for (const row of renderedRows) {
    lines.push(`- ${row}`);
  }
  if (renderedRows.length === 0) {
    lines.push("  none");
  }
  return lines.join("\n");
}

/** Deduplicates rendered backend query rows while keeping their first order. */
function uniqueRenderedRows(rows: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const row of rows) {
    if (seen.has(row)) {
      continue;
    }
    seen.add(row);
    unique.push(row);
  }
  return unique;
}

/** Renders one backend query row without noisy scalar JSON. */
function rowValueText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return scalarRowText(value);
  }
  const values = arrayValue(value);
  if (values.length === 1) {
    return rowValueText(values[0]);
  }
  if (values.length > 1) {
    return values.map(rowValueText).join(" | ");
  }
  return JSON.stringify(value);
}

/** Decodes JSON-encoded scalar cells before rendering them. */
function scalarRowText(value: string | number | boolean): string {
  if (typeof value !== "string") {
    return String(value);
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return value;
  }
  try {
    return rowValueText(JSON.parse(trimmed));
  } catch {
    return value;
  }
}

/** Renders backend changed-code impact output. */
function renderBackendChanges(value: unknown): string {
  const record = recordValue(value);
  const lines = ["CodebaseMemory changed-code impact:"];
  const changedFiles = arrayValue(record.changed_files).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (changedFiles.length > 0) {
    lines.push(`changed files: ${changedFiles.length}`);
    appendRows(lines, changedFiles, (item) => item);
  }
  const impactedSymbols = arrayValue(record.impacted_symbols);
  if (impactedSymbols.length > 0) {
    lines.push(`impacted symbols: ${impactedSymbols.length}`);
    appendRows(lines, impactedSymbols, symbolImpactRow);
  }
  const rows = [
    ...arrayValue(record.changes),
    ...arrayValue(record.impacts),
    ...arrayValue(record.results),
  ];
  if (rows.length === 0) {
    if (changedFiles.length === 0 && impactedSymbols.length === 0) {
      lines.push("none");
      const depth = numberField(record.depth);
      if (depth !== null) {
        lines.push(`depth: ${depth}`);
      }
    }
    return lines.join("\n");
  }
  appendRows(lines, rows, (row) => JSON.stringify(row));
  return lines.join("\n");
}

/** Appends backend rows for the shared final-output budget. */
function appendRows<T>(lines: string[], rows: T[], render: (row: T) => string): void {
  for (const row of rows) {
    lines.push(`- ${render(row)}`);
  }
}

/** Renders one impacted symbol from changed-code analysis. */
function symbolImpactRow(value: unknown): string {
  const record = recordValue(value);
  const name = stringField(record.name) ?? JSON.stringify(value);
  const label = stringField(record.label);
  const file = stringField(record.file);
  const detail = [label, file].filter((item) => item !== null);
  return `${name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
}
