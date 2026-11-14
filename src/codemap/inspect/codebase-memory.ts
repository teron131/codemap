/** Backend `inspect` lane for exactly one matching graph symbol whose source the backend returns. Other targets fall back to the working tree. */
import path from "node:path";

import {
  callCodebaseMemoryTool,
  codebaseMemoryQueryRows,
  codebaseMemoryQueryWithProject,
  withFreshCodebaseMemoryProject,
} from "../codebase-memory/index.js";
import { arrayValue, numberField, recordValue, stringField } from "../json-utils.js";
import { canonicalPath } from "../path-utils.js";
import {
  BACKEND_DEFINITION_COLUMNS,
  backendDefinitionsQuery,
  backendFileMetrics,
  categoryForPath,
} from "../source/extraction/index.js";
import { type FileMetrics, isSupportedSourcePath } from "../source/scanner/index.js";
import { inspectPathTargetKind, normalizeTarget } from "./targets.js";

export type CodebaseMemoryInspectResult = {
  name: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  metricFacts: string[];
  signature: string | null;
  source: string | null;
  callers: string[];
  callees: string[];
};

const TRACE_DEPTH = 2;
/** The backend's own ceiling; Codemap's `--limit` bounds what is printed. */
const TRACE_ROW_LIMIT = 5_000;
const FILE_DEFINITION_LIMIT = 5_000;
const NODE_PROPERTY_COLUMNS = ["signature", "return_type", "complexity", "cognitive", "lines"];

/** Empty unless the target is one code file the working-tree scanner cannot parse; also empty when the backend is unavailable, so the file still renders without its definitions. */
export function backendFileDefinitions(root: string, rawTarget: string): FileMetrics[] {
  const target = normalizeTarget(root, rawTarget);
  if (
    inspectPathTargetKind(root, target) !== "file" ||
    isSupportedSourcePath(target) ||
    categoryForPath(target) !== "code"
  ) {
    return [];
  }
  const result = codebaseMemoryQueryWithProject(
    root,
    backendDefinitionsQuery(target),
    FILE_DEFINITION_LIMIT,
  );
  const rows =
    result === null ? null : codebaseMemoryQueryRows(result.value, BACKEND_DEFINITION_COLUMNS);
  return backendFileMetrics(root, rows ?? [], { includeTests: true });
}

export function codebaseMemoryInspect(
  root: string,
  target: string,
  limit: number,
): CodebaseMemoryInspectResult | null {
  if (target.includes("/") || target.includes("\\")) {
    return null;
  }
  return withFreshCodebaseMemoryProject(root, (project) => {
    const searchResult = callCodebaseMemoryTool("search_graph", {
      project: project.name,
      query: target,
      limit,
    });
    if (!searchResult.ok) {
      return null;
    }
    const qualifiedName = uniqueQualifiedName(searchResult.value, target);
    if (qualifiedName === null) {
      return null;
    }
    const snippetResult = callCodebaseMemoryTool("get_code_snippet", {
      project: project.name,
      qualified_name: qualifiedName,
      source_mode: "full",
    });
    const snippet = snippetResult.ok ? recordValue(snippetResult.value) : {};
    const source = stringField(snippet.source);
    if (source === null) {
      return null;
    }
    const nodeResult = callCodebaseMemoryTool("query_graph", {
      project: project.name,
      query: nodePropertiesQuery(qualifiedName),
    });
    const nodeRows = nodeResult.ok
      ? codebaseMemoryQueryRows(nodeResult.value, NODE_PROPERTY_COLUMNS)
      : null;
    const node = recordValue(nodeRows?.[0]);
    const traceResult = callCodebaseMemoryTool("trace_path", {
      project: project.name,
      function_name: qualifiedName,
      mode: "calls",
      direction: "both",
      depth: TRACE_DEPTH,
      limit: TRACE_ROW_LIMIT,
      risk_labels: false,
    });
    const trace = traceResult.ok ? recordValue(traceResult.value) : {};
    const name = stringField(snippet.name) ?? target;
    const excludedNames = excludedTraceNames([name, qualifiedName]);
    return {
      name,
      filePath: displayFilePath(stringField(snippet.file_path), root),
      startLine: numberField(snippet.start_line),
      endLine: numberField(snippet.end_line),
      metricFacts: metricFacts({ ...node, callers: snippet.callers, callees: snippet.callees }),
      signature: signatureText(node, name),
      source,
      callers: traceRows(recordValue(trace.callers).rows, excludedNames),
      callees: traceRows(recordValue(trace.callees).rows, excludedNames),
    };
  });
}

/** Node properties the snippet leaves out; the qualified name is quoted as a Cypher string literal, whose escapes match JSON's. */
function nodePropertiesQuery(qualifiedName: string): string {
  return `MATCH (n) WHERE n.qualified_name = ${JSON.stringify(qualifiedName)} RETURN n.signature AS signature, n.return_type AS return_type, n.complexity AS complexity, n.cognitive AS cognitive, n.lines AS lines`;
}

/** Null unless exactly one qualified name matches the target by full name or `.target` suffix. */
function uniqueQualifiedName(value: unknown, target: string): string | null {
  const matches = new Set(
    arrayValue(recordValue(value).rows)
      .map((row) => stringField(recordValue(row).qn))
      .filter(
        (qualifiedName) =>
          qualifiedName !== null &&
          (qualifiedName === target || qualifiedName.endsWith(`.${target}`)),
      ),
  );
  return matches.size === 1 ? ([...matches][0] ?? null) : null;
}

/** The backend stores cyclomatic complexity as `complexity` and returns metrics as numeric strings. */
function metricFacts(node: Record<string, unknown>): string[] {
  return [
    ["cyclomatic", node.complexity],
    ["cognitive", node.cognitive],
    ["lines", node.lines],
    ["callers", node.callers],
    ["callees", node.callees],
  ]
    .map(([name, value]) => [
      name,
      typeof value === "string" && value !== "" ? Number(value) : value,
    ])
    .filter((item): item is [string, number] => Number.isFinite(item[1]))
    .map(([name, value]) => `${name}=${value}`);
}

/** Appends the return type unless the signature already ends with it, as in `(root)` with `str` → `run(root) -> str`. */
function signatureText(node: Record<string, unknown>, name: string): string | null {
  const signature = stringField(node.signature);
  const returnType = stringField(node.return_type);
  if (signature === null) {
    return null;
  }
  if (returnType === null || signatureAlreadyIncludesReturnType(signature, returnType)) {
    return compactSignature(signature, name);
  }
  const separator = returnType.startsWith(":") ? "" : returnType.startsWith("->") ? " " : " -> ";
  return compactSignature(`${signature}${separator}${returnType}`, name);
}

/** Collapses whitespace, including the escaped `\n` the backend stores, and a trailing comma, and prepends a missing name, as in `(\n  a,\n  b,\n)` → `run(a, b)`. */
function compactSignature(signature: string, name: string): string {
  const text = signature
    .replace(/(?:\\n|\s)+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*\)/g, ")")
    .trim();
  return text.startsWith("(") ? `${name}${text}` : text;
}

function signatureAlreadyIncludesReturnType(signature: string, returnType: string): boolean {
  const normalized = signature.replace(/\s+/g, " ").trim();
  const normalizedReturn = returnType.replace(/\s+/g, " ").trim();
  if (normalizedReturn.startsWith(":") || normalizedReturn.startsWith("->")) {
    return normalized.endsWith(normalizedReturn);
  }
  return (
    normalized.endsWith(`-> ${normalizedReturn}`) || normalized.endsWith(`: ${normalizedReturn}`)
  );
}

function traceRows(value: unknown, excluded: Set<string> = new Set()): string[] {
  return uniqueTraceRows(
    arrayValue(value)
      .map((item) => {
        const record = recordValue(item);
        const name = stringField(record.name);
        if (name === null) {
          return null;
        }
        const qualifiedName = stringField(record.qn);
        if (excluded.has(name) || (qualifiedName !== null && excluded.has(qualifiedName))) {
          return null;
        }
        const hop = numberField(record.hop);
        return hop !== null && hop > 1 ? `${name} (hop ${hop})` : name;
      })
      .filter((item) => item !== null),
  );
}

/** Deduplicates trace rows by symbol name while preserving nearest-hop order. */
function uniqueTraceRows(rows: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const row of rows) {
    const key = row.replace(/\s+\(.*/, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

/** Builds an exact-name exclusion set for target/self trace rows. */
function excludedTraceNames(names: string[]): Set<string> {
  const excluded = new Set<string>();
  for (const name of names) {
    excluded.add(name);
    const short = name.split(".").pop();
    if (short !== undefined && short.length > 0) {
      excluded.add(short);
    }
  }
  return excluded;
}

function displayFilePath(value: string | null, root: string): string | null {
  if (value === null) {
    return null;
  }
  if (path.isAbsolute(value)) {
    return path.relative(canonicalPath(root), canonicalPath(value)).split(path.sep).join("/");
  }
  return value;
}

export function renderCodebaseMemoryInspect(
  result: CodebaseMemoryInspectResult,
  { limit }: { limit: number },
): string {
  const lines = [`# Inspect: ${result.name}`, ""];
  if (result.filePath !== null) {
    lines.push(
      `Source: ${result.filePath}${result.startLine !== null ? `:${result.startLine}` : ""}${result.endLine !== null && result.endLine !== result.startLine ? `-${result.endLine}` : ""}`,
    );
  }
  if (result.metricFacts.length > 0) {
    lines.push(`Metrics: ${result.metricFacts.join(", ")}`);
  }
  appendCode(lines, result, { limit });
  appendTrace(lines, result, { limit });
  return lines.join("\n").trim();
}

function appendCode(
  lines: string[],
  result: CodebaseMemoryInspectResult,
  { limit }: { limit: number },
): void {
  if (result.signature === null && result.source === null) {
    return;
  }
  lines.push("", "## Code");
  if (result.signature !== null) {
    lines.push(`Signature: ${result.signature}`);
  }
  if (result.source === null) {
    return;
  }
  const sourceLines = result.source.trimEnd().split("\n");
  const shownLines = sourceLines.slice(0, Math.max(limit * 4, 12));
  lines.push("", `\`\`\`${codeFenceLanguage(result.filePath)}`, ...shownLines);
  if (sourceLines.length > shownLines.length) {
    lines.push(`// ... ${sourceLines.length - shownLines.length} more lines`);
  }
  lines.push("```");
}

function appendTrace(
  lines: string[],
  result: CodebaseMemoryInspectResult,
  { limit }: { limit: number },
): void {
  const callers = result.callers.slice(0, limit);
  const callees = result.callees.slice(0, limit);
  if (callers.length === 0 && callees.length === 0) {
    return;
  }
  lines.push("", "## Calls");
  if (callers.length > 0) {
    lines.push(`Callers within ${TRACE_DEPTH} hops: ${result.callers.length}`);
    for (const item of callers) {
      lines.push(`- ${item}`);
    }
  }
  if (callees.length > 0) {
    lines.push(`Callees within ${TRACE_DEPTH} hops: ${result.callees.length}`);
    for (const item of callees) {
      lines.push(`- ${item}`);
    }
  }
}

function codeFenceLanguage(filePath: string | null): string {
  if (filePath === null) {
    return "";
  }
  if (/\.[cm]?tsx?$/.test(filePath)) {
    return "ts";
  }
  if (filePath.endsWith(".py")) {
    return "py";
  }
  if (filePath.endsWith(".json")) {
    return "json";
  }
  return "";
}
