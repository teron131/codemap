/** Extracts Python measurements, imports, declarations, and call sites from one operation-local syntax tree. */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SgNode } from "@ast-grep/napi";

import { astGrepRoot } from "../../ast-grep/adapter.js";
import { ENTRYPOINT_BASENAMES } from "./constants.js";
import {
  addSample,
  addVariableSignal,
  createFileMetrics,
  type FileMetrics,
  type PythonImport,
  sourceLineCount,
} from "./metrics.js";

type DefinitionScope = {
  name: string;
  kind: "function" | "class";
  endIndex: number;
  bodyStart: number;
  bodyEnd: number;
  methods: string[];
};

/** Scans supplied or current source without retaining native trees between files or commands. */
export function scanPythonFile(
  filePath: string,
  { relPath, source: supplied }: { relPath: string; source?: string | undefined },
): FileMetrics {
  const metrics = createFileMetrics({ path: filePath, relPath, suffix: path.extname(filePath) });
  let source: string;
  try {
    source = supplied ?? readFileSync(filePath, "utf8");
  } catch {
    return metrics;
  }
  metrics.lines = sourceLineCount(source);
  metrics.entrypointHint = ENTRYPOINT_BASENAMES.has(path.basename(filePath));
  const root = astGrepRoot(source, "python");
  if (root === null) {
    return metrics;
  }
  const nodes = root.findAll({
    rule: {
      any: [
        "import_statement",
        "import_from_statement",
        "function_definition",
        "class_definition",
        "assignment",
        "augmented_assignment",
        "call",
        "comparison_operator",
      ].map((kind) => ({ kind })),
    },
  });
  // Native matches arrive in source preorder, so scalar scopes replace repeated ancestor walks.
  const scopes: DefinitionScope[] = [];
  for (const node of nodes) {
    const range = node.range();
    while (scopes.length && range.start.index >= scopes.at(-1)!.endIndex) scopes.pop();
    const kind = node.kind();
    if (kind === "import_statement" || kind === "import_from_statement") {
      collectImport(metrics, node);
    } else if (kind === "function_definition" || kind === "class_definition") {
      const name = node.field("name")?.text();
      if (!name) continue;
      const span = range.end.line - range.start.line + 1;
      const startLine = range.start.line + 1;
      const methods: string[] = [];
      if (kind === "function_definition") {
        metrics.functionNames.push(name);
        metrics.functionSpans.push({
          name,
          identifier: `${relPath}::${[...scopes.map((scope) => scope.name), name].join(".")}`,
          span,
          startLine,
        });
        if (scopes.length === 0) metrics.defines += 1;
        const owner = scopes.at(-1);
        if (owner?.kind === "class") owner.methods.push(name);
      } else {
        metrics.defines += 1;
        metrics.classSpans.push({
          name,
          span,
          startLine,
          methods,
        });
        const bases =
          node
            .field("superclasses")
            ?.namedChildren()
            .filter((base) => !["keyword_argument", "comment"].includes(String(base.kind()))) ?? [];
        for (const base of bases) {
          metrics.inherits += 1;
          metrics.pyBases.push(base.text());
          addSample(metrics.samples, base.text());
        }
      }
      const body = node.field("body")?.range();
      scopes.push({
        name,
        kind: kind === "function_definition" ? "function" : "class",
        endIndex: range.end.index,
        bodyStart: body?.start.index ?? range.end.index,
        bodyEnd: body?.end.index ?? range.end.index,
        methods,
      });
      const decorated = node.parent();
      if (decorated?.kind() === "decorated_definition") {
        metrics.decorators += decorated
          .namedChildren()
          .filter((child) => child.kind() === "decorator").length;
      }
      addSample(metrics.samples, name);
    } else if (kind === "assignment" || kind === "augmented_assignment") {
      const names = assignmentNames(node.field("left"));
      metrics.variableNames.push(...names);
      const moduleLevel = scopes.length === 0;
      if (moduleLevel) {
        for (const name of names)
          addVariableSignal(metrics, relPath, name, {
            startLine: range.start.line + 1,
            moduleLevel,
          });
      }
      if (node.field("left")?.text() === "__all__") {
        metrics.exportedNames.push(...literalExportNames(node.field("right")));
      }
    } else if (kind === "call") {
      const owner = scopes.findLast(
        (scope) =>
          scope.kind === "function" &&
          scope.bodyStart <= range.start.index &&
          scope.bodyEnd >= range.end.index,
      );
      const target = node.field("function");
      const callee =
        target?.kind() === "identifier"
          ? target.text()
          : target?.kind() === "attribute"
            ? target.field("attribute")?.text()
            : null;
      if (owner && callee)
        metrics.callSites.push({
          caller: owner.name,
          callee,
          lineNumber: range.start.line + 1,
        });
    } else if (kind === "comparison_operator") {
      const children = node.namedChildren();
      metrics.entrypointHint ||=
        children.length === 2 &&
        children.some((child) => child.kind() === "identifier" && child.text() === "__name__") &&
        children.some(
          (child) => child.kind() === "string" && /^(['"])__main__\1$/.test(child.text()),
        ) &&
        node.children().some((child) => child.text() === "==");
    }
  }
  return metrics;
}

/** Preserves import names and relative levels before project-specific module resolution. */
function collectImport(metrics: FileMetrics, node: SgNode): void {
  const names = node
    .fieldChildren("name")
    .map((name) =>
      name.kind() === "aliased_import" ? (name.field("name")?.text() ?? "") : name.text(),
    );
  if (node.namedChildren().some((child) => child.kind() === "wildcard_import")) names.push("*");
  let statement: PythonImport;
  if (node.kind() === "import_statement") {
    statement = { kind: "import", names };
    metrics.pyImportTargets.push(...names);
  } else {
    const raw = node.field("module_name")?.text() ?? "";
    const level = raw.match(/^\.+/)?.[0].length ?? 0;
    statement = { kind: "from", level, module: raw.slice(level), names };
    for (const name of names) {
      const target = raw || name;
      metrics.pyImportTargets.push(target);
      if (level > 0) {
        metrics.pyLocalImportTargets.push(target);
        metrics.importsLocal += 1;
        addSample(metrics.samples, target);
      }
    }
  }
  metrics.pythonImports.push(statement);
}

/** Reads assignment binders without confusing attribute writes, annotations, or default parameters with new variables. */
function assignmentNames(node: SgNode | null): string[] {
  if (node === null) return [];
  if (node.kind() === "identifier") return [node.text()];
  if (
    ["pattern_list", "tuple_pattern", "list_pattern", "list_splat_pattern"].includes(
      String(node.kind()),
    )
  ) {
    return node.namedChildren().flatMap(assignmentNames);
  }
  return [];
}

/** Reads static __all__ members without evaluating expressions, byte strings, or interpolated values. */
function literalExportNames(value: SgNode | null): string[] {
  if (value === null || !["list", "tuple", "set"].includes(String(value.kind()))) return [];
  const names: string[] = [];
  for (const item of value.namedChildren()) {
    if (item.kind() !== "string") continue;
    const children = item.namedChildren();
    const start = children.find((child) => child.kind() === "string_start")?.text() ?? "";
    const end = children.find((child) => child.kind() === "string_end")?.text() ?? "";
    if (start && end && !/[bf]/i.test(start))
      names.push(item.text().slice(start.length, -end.length));
  }
  return names;
}
