/** Adapts Codebase Memory symbol evidence into normalized inspection reports. */
import path from "node:path";

import {
  callCodebaseMemoryTool,
  canonicalPath,
  withFreshCodebaseMemoryProject,
} from "../codebase-memory/client.js";
import { arrayValue, numberField, recordValue, stringField } from "../json-utils.js";

export type CodebaseMemoryInspectResult = {
  name: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  signalFacts: string[];
  signature: string | null;
  source: string | null;
  callers: string[];
  callees: string[];
};

const JSON_FORMAT = { format: "json" } as const;

/** Reads and normalizes a backend symbol inspection when one exact match exists. */
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
      include_connected: true,
      ...JSON_FORMAT,
    });
    if (!searchResult.ok) {
      return null;
    }
    const match = firstGraphMatch(searchResult.value, target);
    const qualifiedName = stringField(match.qualified_name);
    if (qualifiedName === null) {
      return null;
    }
    const snippetResult = callCodebaseMemoryTool("get_code_snippet", {
      project: project.name,
      qualified_name: qualifiedName,
      include_neighbors: true,
      ...JSON_FORMAT,
    });
    if (!snippetResult.ok || !hasSnippetAnswer(snippetResult.value)) {
      return null;
    }
    const traceResult = callCodebaseMemoryTool("trace_path", {
      project: project.name,
      function_name: qualifiedName,
      mode: "calls",
      direction: "both",
      depth: 2,
      risk_labels: false,
      ...JSON_FORMAT,
    });
    return inspectResultFromPayloads(
      target,
      root,
      match,
      snippetResult.value,
      traceResult.ok ? traceResult.value : null,
    );
  });
}

/** Requires source-owned snippet data before backend inspect can replace local output. */
function hasSnippetAnswer(value: unknown): boolean {
  return stringField(recordValue(value).source) !== null;
}

/** Normalizes inspect search, snippet, and trace payloads into one view object. */
function inspectResultFromPayloads(
  target: string,
  root: string,
  match: Record<string, unknown>,
  snippetValue: unknown,
  traceValue: unknown,
): CodebaseMemoryInspectResult {
  const snippet = recordValue(snippetValue);
  const trace = recordValue(traceValue);
  const name = stringField(snippet.name) ?? stringField(match.name) ?? target;
  const qualifiedName =
    stringField(snippet.qualified_name) ?? stringField(match.qualified_name) ?? target;
  const excludedNames = excludedTraceNames([name, qualifiedName]);
  const filePath = displayFilePath(
    stringField(snippet.file_path) ?? stringField(match.file_path),
    root,
  );
  return {
    name,
    filePath,
    startLine: numberField(snippet.start_line) ?? numberField(match.start_line),
    endLine: numberField(snippet.end_line) ?? numberField(match.end_line),
    signalFacts: signalFacts({ ...match, ...snippet }),
    signature: signatureText(snippet, name),
    source: stringField(snippet.source),
    callers: traceRows(trace.callers, excludedNames),
    callees: traceRows(trace.callees, excludedNames),
  };
}

/** Extracts one unambiguous exact graph result for a symbol target. */
function firstGraphMatch(value: unknown, target: string): Record<string, unknown> {
  const record = recordValue(value);
  const candidates: Record<string, unknown>[] = [];
  for (const key of ["results", "semantic_results"]) {
    for (const item of arrayValue(record[key])) {
      const itemRecord = recordValue(item);
      if (stringField(itemRecord.qualified_name) !== null) {
        candidates.push(itemRecord);
      }
      const nested = recordValue(itemRecord.node);
      if (stringField(nested.qualified_name) !== null) {
        candidates.push(nested);
      }
    }
  }
  const exact = new Map<string, Record<string, unknown>>();
  for (const candidate of candidates) {
    const name = stringField(candidate.name);
    const qualifiedName = stringField(candidate.qualified_name);
    if (
      qualifiedName !== null &&
      (name === target || qualifiedName === target || qualifiedName.endsWith(`.${target}`))
    ) {
      exact.set(qualifiedName, candidate);
    }
  }
  return exact.size === 1 ? ([...exact.values()][0] ?? {}) : {};
}

/** Builds compact complexity and graph degree facts from a snippet payload. */
function signalFacts(snippet: Record<string, unknown>): string[] {
  return [
    ["complexity", numberField(snippet.complexity)],
    ["cognitive", numberField(snippet.cognitive)],
    ["lines", numberField(snippet.lines)],
    ["callers", numberField(snippet.callers)],
    ["callees", numberField(snippet.callees)],
  ]
    .filter((item): item is [string, number] => item[1] !== null)
    .map(([name, value]) => `${name}=${value}`);
}

/** Builds a compact signature row from backend snippet fields. */
function signatureText(snippet: Record<string, unknown>, name: string): string | null {
  const signature = stringField(snippet.signature);
  const returnType = stringField(snippet.return_type);
  if (signature === null) {
    return null;
  }
  if (returnType === null || signatureAlreadyIncludesReturnType(signature, returnType)) {
    return compactSignature(signature, name);
  }
  const separator = returnType.startsWith(":") ? "" : returnType.startsWith("->") ? " " : " -> ";
  return compactSignature(`${signature}${separator}${returnType}`, name);
}

/** Compacts backend signature fragments into a readable one-line signature. */
function compactSignature(signature: string, name: string): string {
  const text = signature
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*\)/g, ")")
    .trim();
  return text.startsWith("(") ? `${name}${text}` : text;
}

/** Detects return types already attached to the end of a backend signature. */
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

/** Builds readable trace rows from Codebase Memory trace arrays. */
function traceRows(value: unknown, excluded: Set<string> = new Set()): string[] {
  return uniqueTraceRows(
    arrayValue(value)
      .map((item) => {
        const record = recordValue(item);
        const name = stringField(record.name) ?? stringField(record.qualified_name);
        if (name === null) {
          return null;
        }
        const qualifiedName = stringField(record.qualified_name);
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

/** Shortens absolute paths when Codebase Memory returns them. */
function displayFilePath(value: string | null, root: string): string | null {
  if (value === null) {
    return null;
  }
  if (path.isAbsolute(value)) {
    return path.relative(canonicalPath(root), canonicalPath(value)).split(path.sep).join("/");
  }
  return value;
}

/** Renders a compact backend-first inspect report. */
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
  if (result.signalFacts.length > 0) {
    lines.push(`Signals: ${result.signalFacts.join(", ")}`);
  }
  appendCode(lines, result, { limit });
  appendTrace(lines, result, { limit });
  return lines.join("\n").trim();
}

/** Adds a concise source section from a normalized backend inspection. */
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

/** Adds compact caller and callee rows from a normalized backend inspection. */
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
    lines.push(`Inbound: ${callers.length}`);
    for (const item of callers) {
      lines.push(`- ${item}`);
    }
  }
  if (callees.length > 0) {
    lines.push(`Outbound: ${callees.length}`);
    for (const item of callees) {
      lines.push(`- ${item}`);
    }
  }
}

/** Chooses a compact Markdown code fence hint from a source path. */
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
