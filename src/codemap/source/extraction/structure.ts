/** Extracts file-level structure, definitions, inheritance, and call edges. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PY_SUFFIXES, scanFile, TYPESCRIPT_SUFFIXES } from "../scanner/index.js";
import type { FileMetrics } from "../scanner/metrics.js";
import type { ScanEntry } from "./scan.js";

type StructureFunction = {
  name: string;
  startLine: number;
  endLine: number;
};

type StructureClass = {
  name: string;
  startLine: number;
  endLine: number;
  methods: string[];
};

type CallEdge = {
  caller: string;
  callee: string;
  lineNumber: number;
};

type StructureEntry = {
  path: string;
  functions: StructureFunction[];
  classes: StructureClass[];
  exports: Array<{ name: string }>;
  callGraph: CallEdge[];
};

export type StructurePayload = {
  results: StructureEntry[];
};

type Definition = {
  kind: "function" | "class";
  name: string;
  startLine: number;
  lineIndex: number;
  endLine: number;
  indent: number;
};

/** Builds structural definition and call-edge payloads for scanned files. */
export function runStructure(
  root: string,
  files: ScanEntry[],
  _importMap: Record<string, string[]>,
  {
    fileMetricsByPath = null,
    pythonTreesByPath = null,
  }: {
    fileMetricsByPath?: Record<string, FileMetrics> | null;
    pythonTreesByPath?: Record<string, string | null> | null;
  },
): StructurePayload {
  return {
    results: files
      .map((scanEntry) =>
        structureForFile(root, scanEntry, {
          metricsByPath: fileMetricsByPath,
          pythonTreesByPath,
        }),
      )
      .filter((entry): entry is StructureEntry => entry !== null),
  };
}

/** Builds structural entries for one scanned source file. */
export function structureForFile(
  root: string,
  scanEntry: ScanEntry,
  {
    metricsByPath = null,
    pythonTreesByPath = null,
  }: {
    metricsByPath?: Record<string, FileMetrics> | null;
    pythonTreesByPath?: Record<string, string | null> | null;
  } = {},
): StructureEntry | null {
  const relPath = String(scanEntry.path);
  const filePath = path.join(root, relPath);
  const suffix = path.extname(filePath);
  if (PY_SUFFIXES.has(suffix)) {
    return pythonStructure(filePath, relPath, {
      tree: pythonTreesByPath?.[relPath] ?? null,
    });
  }
  if (TYPESCRIPT_SUFFIXES.has(suffix)) {
    return typescriptStructure(filePath, root, relPath, {
      metrics: metricsByPath?.[relPath] ?? null,
    });
  }
  return emptyStructure(relPath);
}

/** Extracts graph structure entries from one Python file. */
export function pythonStructure(
  filePath: string,
  relPath: string,
  { tree = null }: { tree?: string | null } = {},
): StructureEntry {
  let source = tree;
  if (source === null) {
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      return emptyStructure(relPath);
    }
  }
  const lines = splitLines(source);
  const definitions = pythonDefinitions(lines);
  const sortedFunctions = definitions
    .filter((definition) => definition.kind === "function")
    .sort(
      (left, right) =>
        definitionDepth(left, definitions) - definitionDepth(right, definitions) ||
        left.lineIndex - right.lineIndex,
    );
  const sortedClasses = definitions
    .filter((definition) => definition.kind === "class")
    .sort(
      (left, right) =>
        definitionDepth(left, definitions) - definitionDepth(right, definitions) ||
        left.lineIndex - right.lineIndex,
    );
  const functions: StructureFunction[] = [];
  const classes: StructureClass[] = [];
  const callGraph: CallEdge[] = [];
  for (const definition of sortedFunctions) {
    functions.push({
      name: definition.name,
      startLine: definition.startLine,
      endLine: definition.endLine,
    });
    callGraph.push(...callEdgesForFunction(definition, lines));
  }
  for (const definition of sortedClasses) {
    classes.push({
      name: definition.name,
      startLine: definition.startLine,
      endLine: definition.endLine,
      methods: definitions
        .filter(
          (candidate) =>
            candidate.kind === "function" &&
            candidate.lineIndex > definition.lineIndex &&
            candidate.lineIndex < definition.endLine &&
            candidate.indent > definition.indent &&
            directChild(candidate, definition, definitions),
        )
        .map((candidate) => candidate.name),
    });
  }
  return {
    path: relPath,
    functions,
    classes,
    exports: [...functions, ...classes].map((item) => ({ name: item.name })),
    callGraph,
  };
}

/** Builds call edges emitted by one structured function entry. */
export function callEdgesForFunction(functionDefinition: Definition, lines: string[]): CallEdge[] {
  const edges: CallEdge[] = [];
  for (
    let lineIndex = functionDefinition.lineIndex;
    lineIndex < functionDefinition.endLine;
    lineIndex += 1
  ) {
    const line = lines[lineIndex] ?? "";
    const stripped = line.trim();
    if (
      !stripped ||
      stripped.startsWith("class ") ||
      stripped.startsWith("import ") ||
      stripped.startsWith("from ")
    ) {
      continue;
    }
    const callees = callNames(line);
    if (lineIndex === functionDefinition.lineIndex) {
      const declarationIndex = callees.indexOf(functionDefinition.name);
      if (declarationIndex >= 0) {
        callees.splice(declarationIndex, 1);
      }
    }
    for (const callee of callees) {
      edges.push({
        caller: functionDefinition.name,
        callee,
        lineNumber: lineIndex + 1,
      });
    }
  }
  return edges;
}

/** Extracts called symbol names from a source line. */
export function callNames(line: string): string[] {
  const names: string[] = [];
  for (const match of line.matchAll(/(?:^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1] ?? "";
    if (name && !["if", "for", "while", "return"].includes(name)) {
      names.push(name);
    }
  }
  for (const match of line.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1] ?? "";
    if (name) {
      names.push(name);
    }
  }
  return names;
}

/** Extracts graph structure entries from one TypeScript-family file. */
export function typescriptStructure(
  filePath: string,
  root: string,
  relPath: string,
  { metrics = null }: { metrics?: FileMetrics | null } = {},
): StructureEntry {
  const fileMetrics = metrics ?? scanFile(filePath, { displayRoot: root });
  const functions = fileMetrics.functionSpans.map((span) => ({
    name: span.name,
    startLine: span.startLine,
    endLine: span.startLine + span.span - 1,
  }));
  let lines: string[] = [];
  try {
    lines = splitLines(readFileSync(filePath, "utf8"));
  } catch {
    lines = [];
  }
  const callGraph =
    lines.length === 0
      ? []
      : functions.flatMap((span) =>
          callEdgesForFunction(
            {
              kind: "function",
              name: span.name,
              startLine: span.startLine,
              lineIndex: span.startLine - 1,
              endLine: span.endLine,
              indent: 0,
            },
            lines,
          ),
        );
  return {
    path: relPath,
    functions,
    classes: [],
    exports: fileMetrics.functionNames.map((name) => ({ name })),
    callGraph,
  };
}

/** Parses Python definitions and nested structure from source lines. */
function pythonDefinitions(lines: string[]): Definition[] {
  const definitions: Definition[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const stripped = line.trim();
    const indent = indentOf(line);
    const functionMatch = /^(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(stripped);
    const classMatch = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(stripped);
    if (functionMatch) {
      definitions.push({
        kind: "function",
        name: functionMatch[1] ?? "",
        startLine: index + 1,
        lineIndex: index,
        endLine: blockEnd(lines, index, indent),
        indent,
      });
    } else if (classMatch) {
      definitions.push({
        kind: "class",
        name: classMatch[1] ?? "",
        startLine: index + 1,
        lineIndex: index,
        endLine: blockEnd(lines, index, indent),
        indent,
      });
    }
  }
  return definitions;
}

/** Finds a direct ast-grep child node by kind. */
function directChild(child: Definition, parent: Definition, definitions: Definition[]): boolean {
  for (const candidate of definitions) {
    if (
      candidate === child ||
      candidate === parent ||
      candidate.lineIndex <= parent.lineIndex ||
      candidate.lineIndex >= child.lineIndex ||
      candidate.endLine <= child.lineIndex
    ) {
      continue;
    }
    if (candidate.indent > parent.indent && candidate.indent < child.indent) {
      return false;
    }
  }
  return true;
}

/** Counts containing definitions to identify nested source structure. */
function definitionDepth(definition: Definition, definitions: Definition[]): number {
  return definitions.filter(
    (candidate) =>
      candidate !== definition &&
      candidate.lineIndex < definition.lineIndex &&
      candidate.endLine >= definition.endLine &&
      candidate.indent < definition.indent,
  ).length;
}

/** Finds the last line belonging to an indented Python block. */
function blockEnd(lines: string[], startIndex: number, indent: number): number {
  let endLine = startIndex + 1;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      continue;
    }
    const currentIndent = indentOf(line);
    if (currentIndent <= indent) {
      break;
    }
    endLine = index + 1;
  }
  return endLine;
}

/** Counts leading spaces for Python indentation-sensitive parsing. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Normalizes source text to newline-delimited lines. */
function splitLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  if (source.endsWith("\n") || source.endsWith("\r\n")) {
    lines.pop();
  }
  return lines;
}

/** Creates a structure record for files with no detected symbols. */
function emptyStructure(relPath: string): StructureEntry {
  return {
    path: relPath,
    functions: [],
    classes: [],
    exports: [],
    callGraph: [],
  };
}
