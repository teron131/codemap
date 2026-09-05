/** Builds Python documentation reports from bundled syntax evidence without evaluating inspected source. */
import { readFileSync } from "node:fs";

import type { SgNode } from "@ast-grep/napi";

import { astGrepRoot } from "../../ast-grep/adapter.js";
import type { ClassReport, FileReport, FunctionReport } from "./models.js";

type Definition = {
  node: SgNode;
  children: Definition[];
};

/** Reads one current file and reports parser recovery explicitly instead of presenting incomplete documentation as complete. */
export function buildPythonFileReport(
  filePath: string,
  { displayPath }: { displayPath: string },
): FileReport {
  const report: FileReport = {
    path: filePath,
    displayPath,
    fileDocstring: null,
    functions: [],
    classes: [],
    parseError: null,
  };
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (error) {
    report.parseError = error instanceof Error ? error.message : String(error);
    return report;
  }

  const root = astGrepRoot(source, "python");
  if (root === null) {
    report.parseError = "Python syntax parser unavailable";
    return report;
  }
  // Include zero-width recovery tokens and blocks, which may lack an ERROR node.
  const invalid = root.find({
    rule: {
      any: [{ kind: "ERROR" }, { all: [{ regex: "^$" }, { not: { kind: "module" } }] }],
    },
  });
  if (invalid !== null) {
    report.parseError = "invalid syntax";
    return report;
  }

  report.fileDocstring = bodyDocstring(root);
  for (const definition of collectDefinitions(root)) {
    if (definition.node.kind() === "function_definition") {
      report.functions.push(buildFunctionReport(definition));
    } else {
      report.classes.push(buildClassReport(definition));
    }
  }
  return report;
}

/** Keeps declaration ownership tied to syntax parents, including decorated and conditionally defined members. */
function collectDefinitions(root: SgNode): Definition[] {
  const definitions: Definition[] = root
    .findAll({ rule: { any: [{ kind: "function_definition" }, { kind: "class_definition" }] } })
    .map((node) => ({ node, children: [] }));
  const byId = new Map(definitions.map((definition) => [definition.node.id(), definition]));
  const topLevel: Definition[] = [];
  for (const definition of definitions) {
    const owner = definition.node.ancestors().find((ancestor) => byId.has(ancestor.id()));
    if (owner === undefined) {
      topLevel.push(definition);
    } else {
      byId.get(owner.id())!.children.push(definition);
    }
  }
  return topLevel;
}

/** Projects a function's complete signature and immediate nested functions into the established report shape. */
function buildFunctionReport({ node, children }: Definition): FunctionReport {
  const parameters = node.field("parameters")?.namedChildren() ?? [];
  return {
    name: node.field("name")?.text() ?? "",
    lineno: node.range().start.line + 1,
    inputs:
      parameters
        .filter((parameter) => parameter.kind() !== "comment")
        .map(formatParameter)
        .join(", ") || "none",
    outputs: node.field("return_type")?.text() ?? "unannotated",
    docstring: bodyDocstring(node.field("body")),
    nestedFunctions: children
      .filter((child) => child.node.kind() === "function_definition")
      .map(buildFunctionReport),
  };
}

function buildClassReport({ node, children }: Definition): ClassReport {
  return {
    name: node.field("name")?.text() ?? "",
    lineno: node.range().start.line + 1,
    docstring: bodyDocstring(node.field("body")),
    methods: children
      .filter((child) => child.node.kind() === "function_definition")
      .map(buildFunctionReport),
    nestedClasses: children
      .filter((child) => child.node.kind() === "class_definition")
      .map(buildClassReport),
  };
}

/** Formats syntax fields separately so annotation and default delimiters cannot be mistaken for argument separators. */
function formatParameter(parameter: SgNode): string {
  const name =
    parameter.field("name") ??
    (parameter.kind() === "typed_parameter"
      ? parameter
          .namedChildren()
          .find((child) => !["type", "comment"].includes(String(child.kind())))
      : parameter);
  let rendered = name?.text() ?? "";
  const annotation = parameter.field("type");
  if (annotation !== null) {
    rendered += `: ${annotation.text()}`;
  }
  const value = parameter.field("value");
  if (value !== null) {
    rendered += ` = ${value.text()}`;
  }
  return rendered;
}

/** Reads only a leading constant string expression, preserving source text and excluding executable interpolation and bytes. */
function bodyDocstring(body: SgNode | null): string | null {
  const statement = body?.namedChildren().find((node) => node.kind() !== "comment");
  if (statement?.kind() !== "expression_statement") {
    return null;
  }
  const expressions = statement.namedChildren();
  if (expressions.length !== 1) {
    return null;
  }
  const expression = expressions[0]!;
  const literals =
    expression.kind() === "concatenated_string" ? expression.namedChildren() : [expression];
  const parts: string[] = [];
  for (const literal of literals) {
    if (literal.kind() !== "string") {
      return null;
    }
    const children = literal.namedChildren();
    const start = children.find((node) => node.kind() === "string_start")?.text();
    const end = children.find((node) => node.kind() === "string_end")?.text();
    if (!start || !end || !/^(?:r|u)?(?:"""|'''|"|')$/i.test(start)) {
      return null;
    }
    parts.push(literal.text().slice(start.length, -end.length));
  }
  return cleanDocstring(parts.join(""));
}

/** Preserves the existing report's indentation normalization for extracted documentation text. */
function cleanDocstring(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && !(lines[0] ?? "").trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !(lines.at(-1) ?? "").trim()) {
    lines.pop();
  }
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)?.[0]?.length ?? 0);
  const margin = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(margin).trimEnd()).join("\n");
}
