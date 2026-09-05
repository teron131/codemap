/** Scans Python source for imports, definitions, variables, and entrypoints. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { ENTRYPOINT_BASENAMES } from "./constants.js";
import {
  addSample,
  addVariableSignal,
  codeSignalIdentifier,
  createFileMetrics,
  type FileMetrics,
  sourceLineCount,
} from "./metrics.js";

type PythonDefinition = {
  kind: "function" | "class";
  name: string;
  indent: number;
  lineIndex: number;
  startLine: number;
  span: number;
  decoratorCount: number;
  bases: string[];
  parents: string[];
};

/** Extracts assignment target names from Python target text. */
export function targetNames(target: string): string[] {
  const cleanTarget = target.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanTarget)) {
    return [cleanTarget];
  }
  if (cleanTarget.includes(",")) {
    return cleanTarget.split(",").flatMap((item) => targetNames(item));
  }
  if (
    (cleanTarget.startsWith("(") && cleanTarget.endsWith(")")) ||
    (cleanTarget.startsWith("[") && cleanTarget.endsWith("]"))
  ) {
    return cleanTarget
      .slice(1, -1)
      .split(",")
      .flatMap((item) => targetNames(item));
  }
  return [];
}

/** Extracts Python string literal contents from a raw expression. */
export function literalStrings(value: string): string[] {
  const cleanValue = value.trim();
  if (
    !(
      (cleanValue.startsWith("[") && cleanValue.endsWith("]")) ||
      (cleanValue.startsWith("(") && cleanValue.endsWith(")")) ||
      (cleanValue.startsWith("{") && cleanValue.endsWith("}"))
    )
  ) {
    return [];
  }
  const strings: string[] = [];
  for (const match of cleanValue.matchAll(/(['"])(.*?)\1/g)) {
    strings.push(match[2] ?? "");
  }
  return strings;
}

/** Builds a stable identifier for a Python function span. */
export function pythonFunctionIdentifier(relPath: string, parents: string[], name: string): string {
  const qualified = parents.length > 0 ? [...parents, name].join(".") : name;
  return `${relPath}::${qualified}`;
}

/** Collects Python imports, definitions, variables, and function spans. */
function collectPythonImportsAndVariables(metrics: FileMetrics, source: string): void {
  const lines = source.split(/\r?\n/);
  let headerBalance = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) {
      continue;
    }
    const uncommented = stripPythonLineComment(line);
    if (headerBalance > 0) {
      headerBalance += bracketBalance(uncommented);
      if (headerBalance < 0) {
        headerBalance = 0;
      }
      continue;
    }
    if (/^(?:async\s+def|def|class)\b/.test(stripped)) {
      const balance = bracketBalance(uncommented);
      if (balance > 0 || !stripped.endsWith(":")) {
        headerBalance = balance;
      }
      continue;
    }
    const importMatch = /^import\s+(.+)$/.exec(stripped);
    if (importMatch) {
      for (const alias of importMatch[1]?.split(",") ?? []) {
        const name = alias
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name) {
          metrics.pyImportTargets.push(name);
        }
      }
      continue;
    }
    const fromMatch = /^from\s+([.\w]*)\s+import\s+(.+)$/.exec(stripped);
    if (fromMatch) {
      const rawModule = fromMatch[1] ?? "";
      const level = rawModule.match(/^\.+/)?.[0]?.length ?? 0;
      const moduleName = rawModule.slice(level);
      const targetName = level > 0 ? `${".".repeat(level)}${moduleName}` : moduleName;
      for (const alias of fromMatch[2]?.split(",") ?? []) {
        const aliasName = alias
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        const target = targetName || aliasName;
        if (target) {
          metrics.pyImportTargets.push(target);
        }
        if (level > 0 && target) {
          metrics.pyLocalImportTargets.push(target);
          metrics.importsLocal += 1;
          addSample(metrics.samples, target);
        }
      }
      continue;
    }
    const assignment = assignmentParts(stripped);
    if (assignment === null) {
      continue;
    }
    const names = targetNames(assignment.target);
    metrics.variableNames.push(...names);
    if (assignment.target.trim() === "__all__") {
      metrics.exportedNames.push(
        ...literalStrings(multilinePythonValue(lines, lineIndex, assignment.value)),
      );
    }
  }
}

/** Collects module-level Python variable assignment names. */
export function collectPythonModuleVariables(
  metrics: FileMetrics,
  relPath: string,
  source: string,
): void {
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (indentOf(line) !== 0) {
      continue;
    }
    const assignment = assignmentParts(line.trim());
    if (assignment === null) {
      continue;
    }
    for (const name of targetNames(assignment.target)) {
      addVariableSignal(metrics, relPath, name, {
        startLine: index + 1,
        moduleLevel: true,
      });
    }
  }
}

/** Collects top-level Python function and class names. */
export function collectPythonTopLevelDefinitions(
  metrics: FileMetrics,
  relPath: string,
  source: string,
): void {
  for (const definition of pythonDefinitions(source)) {
    if (definition.kind === "function") {
      metrics.functionNames.push(definition.name);
      metrics.functionSpans.push({
        name: definition.name,
        identifier:
          definition.parents.length === 0
            ? codeSignalIdentifier(relPath, definition.name)
            : pythonFunctionIdentifier(relPath, definition.parents, definition.name),
        span: definition.span,
        startLine: definition.startLine,
      });
      if (definition.parents.length === 0) {
        metrics.defines += 1;
      }
    } else {
      metrics.defines += 1;
      addSample(metrics.samples, definition.name);
      for (const base of definition.bases) {
        metrics.inherits += 1;
        metrics.pyBases.push(base);
        addSample(metrics.samples, base);
      }
    }
    metrics.decorators += definition.decoratorCount;
    if (definition.kind === "function") {
      addSample(metrics.samples, definition.name);
    }
  }
}

/** Scans one Python file into import, definition, and variable metrics. */
export function scanPythonFile(
  filePath: string,
  { relPath, source: existingSource }: { relPath: string; source?: string | undefined },
): FileMetrics {
  const metrics = createFileMetrics({
    path: filePath,
    relPath,
    suffix: path.extname(filePath),
  });
  let source: string;
  try {
    source = existingSource ?? readFileSync(filePath, "utf8");
  } catch {
    return metrics;
  }

  metrics.lines = sourceLineCount(source);
  metrics.entrypointHint = isPythonEntrypoint(filePath, source);
  collectPythonImportsAndVariables(metrics, source);
  collectPythonModuleVariables(metrics, relPath, source);
  collectPythonTopLevelDefinitions(metrics, relPath, source);
  return metrics;
}

/** Checks whether Python source is likely executable as an entrypoint. */
export function isPythonEntrypoint(filePath: string, source: string): boolean {
  return (
    ENTRYPOINT_BASENAMES.has(path.basename(filePath)) ||
    source.includes('__name__ == "__main__"') ||
    source.includes("__name__ == '__main__'")
  );
}

/** Parses Python definitions and nested structure from source lines. */
function pythonDefinitions(source: string): PythonDefinition[] {
  const lines = source.split(/\r?\n/);
  const definitions: Array<Omit<PythonDefinition, "parents">> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const stripped = line.trim();
    const indent = indentOf(line);
    const functionMatch = /^(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(stripped);
    const classMatch = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*?)\))?\s*:/.exec(stripped);
    if (functionMatch) {
      definitions.push({
        kind: "function",
        name: functionMatch[1] ?? "",
        indent,
        lineIndex: index,
        startLine: index + 1,
        span: blockSpan(lines, index, indent),
        decoratorCount: decoratorCount(lines, index, indent),
        bases: [],
      });
    } else if (classMatch) {
      definitions.push({
        kind: "class",
        name: classMatch[1] ?? "",
        indent,
        lineIndex: index,
        startLine: index + 1,
        span: blockSpan(lines, index, indent),
        decoratorCount: decoratorCount(lines, index, indent),
        bases: classBases(classMatch[2] ?? ""),
      });
    }
  }
  return definitions.map((definition, index) => ({
    ...definition,
    parents: parentNames(definitions, index),
  }));
}

/** Finds containing parent names for nested Python definitions. */
function parentNames(
  definitions: Array<Omit<PythonDefinition, "parents">>,
  index: number,
): string[] {
  const child = definitions[index];
  if (child === undefined) {
    return [];
  }
  const parents: string[] = [];
  let currentIndent = child.indent;
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = definitions[candidateIndex];
    if (
      candidate !== undefined &&
      candidate.indent < currentIndent &&
      candidate.lineIndex + candidate.span > child.lineIndex
    ) {
      parents.unshift(candidate.name);
      currentIndent = candidate.indent;
    }
  }
  return parents;
}

/** Measures a Python definition block using headers, indentation, and strings. */
function blockSpan(lines: string[], startIndex: number, indent: number): number {
  const headerEndIndex = pythonHeaderEndIndex(lines, startIndex);
  let endIndex = headerEndIndex;
  let inTripleString = false;
  for (let index = headerEndIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (inTripleString) {
      endIndex = index;
      inTripleString = updateTripleStringState(inTripleString, line);
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    if (indentOf(line) <= indent) {
      break;
    }
    endIndex = index;
    inTripleString = updateTripleStringState(inTripleString, line);
  }
  return Math.max(1, endIndex - startIndex + 1);
}

/** Finds the final physical line of a Python definition header. */
function pythonHeaderEndIndex(lines: string[], startIndex: number): number {
  let balance = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const stripped = stripPythonLineComment(lines[index] ?? "").trim();
    const state = pythonHeaderLineState(stripped, balance);
    balance = state.balance;
    if (balance <= 0 && state.terminated) {
      return index;
    }
  }
  return startIndex;
}

/** Tracks bracket balance and top-level colon state for one header line. */
function pythonHeaderLineState(
  line: string,
  initialBalance: number,
): { balance: number; terminated: boolean } {
  let balance = initialBalance;
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
      continue;
    }
    if (quote !== null) {
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      balance += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      balance -= 1;
    } else if (char === ":" && balance === 0) {
      return { balance, terminated: true };
    }
  }
  return { balance, terminated: false };
}

/** Removes Python line comments outside strings. */
function stripPythonLineComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

/** Reads a continued Python assignment value. */
function multilinePythonValue(lines: string[], startIndex: number, initialValue: string): string {
  const collected = [initialValue];
  let balance = bracketBalance(stripPythonLineComment(initialValue));
  for (let index = startIndex + 1; index < lines.length && balance > 0; index += 1) {
    const line = lines[index] ?? "";
    collected.push(line.trim());
    balance += bracketBalance(stripPythonLineComment(line));
  }
  return collected.join("\n");
}

/** Calculates bracket balance for continued Python assignments. */
function bracketBalance(value: string): number {
  let balance = 0;
  for (const char of value) {
    if (char === "[" || char === "(" || char === "{") {
      balance += 1;
    } else if (char === "]" || char === ")" || char === "}") {
      balance -= 1;
    }
  }
  return balance;
}

/** Tracks Python triple-quoted string state while scanning lines. */
function updateTripleStringState(inTripleString: boolean, line: string): boolean {
  let state = inTripleString;
  for (const delimiter of ['"""', "'''"]) {
    const matchCount = [...line.matchAll(new RegExp(delimiter, "g"))].length;
    if (matchCount % 2 !== 0) {
      state = !state;
    }
  }
  return state;
}

/** Counts decorators immediately above a Python definition. */
function decoratorCount(lines: string[], startIndex: number, indent: number): number {
  let count = 0;
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      break;
    }
    if (indentOf(line) !== indent || !line.trim().startsWith("@")) {
      break;
    }
    count += 1;
  }
  return count;
}

/** Extracts Python class base names from a class header. */
function classBases(rawBases: string): string[] {
  if (!rawBases.trim()) {
    return [];
  }
  return rawBases
    .split(",")
    .map((base) => base.trim())
    .filter(Boolean);
}

/** Extracts a Python assignment target name and declaration kind. */
function assignmentParts(stripped: string): { target: string; value: string } | null {
  if (
    !stripped ||
    stripped.startsWith("#") ||
    stripped.startsWith("return ") ||
    stripped.endsWith(",") ||
    stripped.includes("==") ||
    stripped.includes("!=") ||
    stripped.includes("<=") ||
    stripped.includes(">=")
  ) {
    return null;
  }
  const augAssign = /^(.+?)\s*(?:\+=|-=|\*=|\/=|%=)\s*(.*)$/.exec(stripped);
  if (augAssign) {
    return { target: augAssign[1] ?? "", value: augAssign[2] ?? "" };
  }
  const assign = /^(.+?)\s*=\s*(.*)$/.exec(stripped);
  if (assign) {
    const rawTarget = assign[1] ?? "";
    if (rawTarget.includes(":=")) {
      return null;
    }
    const target = rawTarget.includes(":") ? (rawTarget.split(":", 1)[0] ?? "") : rawTarget;
    return { target, value: assign[2] ?? "" };
  }
  const annAssign = /^(.+?)\s*:\s*[^=]+$/.exec(stripped);
  if (annAssign) {
    return { target: annAssign[1] ?? "", value: "" };
  }
  return null;
}

/** Counts leading spaces for Python indentation-sensitive parsing. */
function indentOf(line: string): number {
  return line.match(/^[ \t]*/)?.[0]?.length ?? 0;
}
