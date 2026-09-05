/** Extracts TypeScript-family documentation from syntax nodes while preserving Codemap's comment and report policies. */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SgNode } from "@ast-grep/napi";

import { astGrepRoot } from "../../ast-grep/adapter.js";
import { TYPESCRIPT_LANG_BY_SUFFIX } from "../scanner/constants.js";
import type { ClassReport, FileReport, FunctionReport } from "./models.js";

type Declaration = {
  node: SgNode;
  signature: SgNode | null;
  name: string;
  kind: "class" | "function";
  docstring: string | null;
  children: Declaration[];
};

/** Builds current documentation without treating code examples or multiline types as declarations. */
export function buildTypescriptFileReport(
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
  const language = TYPESCRIPT_LANG_BY_SUFFIX[path.extname(filePath)] ?? "typescript";
  const root = astGrepRoot(source, language);
  if (root === null) {
    report.parseError = "TypeScript syntax parser unavailable";
    return report;
  }
  if (
    root.find({
      rule: { any: [{ kind: "ERROR" }, { all: [{ regex: "^$" }, { not: { kind: "program" } }] }] },
    })
  ) {
    report.parseError = "invalid syntax";
    return report;
  }
  const lines = source.split(/\r?\n/);
  report.fileDocstring = fileComment(root);
  const kinds = [
    "function_declaration",
    "generator_function_declaration",
    "method_definition",
    "variable_declarator",
    "class_declaration",
  ];
  if (language === "typescript" || language === "tsx")
    kinds.push(
      "abstract_class_declaration",
      "function_signature",
      "method_signature",
      "abstract_method_signature",
      "public_field_definition",
    );
  else kinds.push("field_definition");
  const declarations: Declaration[] = [];
  for (const node of root.findAll({ rule: { any: kinds.map((kind) => ({ kind })) } })) {
    const name = (node.field("name") ?? node.field("property"))?.text();
    if (!name) continue;
    const kind = String(node.kind());
    if (kind === "method_signature" && node.parent()?.kind() !== "class_body") continue;
    const variable = kind === "variable_declarator";
    const field = kind === "public_field_definition" || kind === "field_definition";
    let signature: SgNode | null = node;
    let anchor = node;
    while (
      ["export_statement", "lexical_declaration", "variable_declaration"].includes(
        String(anchor.parent()?.kind()),
      )
    )
      anchor = anchor.parent()!;
    const comment = declarationComment(anchor, lines);
    if (variable || field) {
      const value = node.field("value");
      signature =
        value &&
        ["arrow_function", "function_expression", "generator_function"].includes(
          String(value.kind()),
        )
          ? value
          : null;
      if (signature === null && (field || !comment?.block)) continue;
    }
    declarations.push({
      node,
      signature,
      name,
      kind: kind.includes("class_declaration") ? "class" : "function",
      docstring: comment?.text ?? null,
      children: [],
    });
  }
  const byId = new Map(declarations.map((declaration) => [declaration.node.id(), declaration]));
  const topLevel: Declaration[] = [];
  for (const declaration of declarations) {
    const owner = declaration.node.ancestors().find((ancestor) => byId.has(ancestor.id()));
    if (owner) byId.get(owner.id())!.children.push(declaration);
    else topLevel.push(declaration);
  }
  for (const declaration of topLevel) {
    if (declaration.kind === "class") report.classes.push(classReport(declaration));
    else report.functions.push(functionReport(declaration));
  }
  return report;
}

function functionReport(declaration: Declaration): FunctionReport {
  const parameters = declaration.signature?.field("parameters");
  const single = declaration.signature?.field("parameter");
  const params = parameters?.text().slice(1, -1) ?? single?.text() ?? "";
  return {
    name: declaration.name,
    lineno: declaration.node.range().start.line + 1,
    inputs: params.replace(/\s+/g, " ").trim() || "none",
    outputs:
      declaration.signature?.field("return_type")?.text().replace(/^:\s*/, "") ?? "unannotated",
    docstring: declaration.docstring,
    nestedFunctions: declaration.children
      .filter((child) => child.kind === "function")
      .map(functionReport),
  };
}

function classReport(declaration: Declaration): ClassReport {
  return {
    name: declaration.name,
    lineno: declaration.node.range().start.line + 1,
    docstring: declaration.docstring,
    methods: declaration.children.filter((child) => child.kind === "function").map(functionReport),
    nestedClasses: declaration.children.filter((child) => child.kind === "class").map(classReport),
  };
}

/** Associates adjacent leading comments with their declaration without borrowing a previous statement's trailing comment. */
function declarationComment(
  anchor: SgNode,
  lines: string[],
): { text: string; block: boolean } | null {
  let previous = anchor.prev();
  let nextLine = anchor.range().start.line;
  const comments: SgNode[] = [];
  while (previous?.kind() === "comment" && nextLine - previous.range().end.line <= 1) {
    if (
      !(lines[previous.range().start.line] ?? "")
        .trimStart()
        .startsWith(previous.text().split(/\r?\n/)[0] ?? "")
    )
      break;
    comments.unshift(previous);
    nextLine = previous.range().start.line;
    if (previous.text().startsWith("/*")) break;
    previous = previous.prev();
  }
  return comments.length === 0
    ? null
    : {
        text: comments.map((comment) => cleanComment(comment.text())).join("\n"),
        block: comments.some((comment) => comment.text().startsWith("/*")),
      };
}

/** Keeps tool directives out of file intent while preserving the first meaningful comment group. */
function fileComment(root: SgNode): string | null {
  const nodes = root.namedChildren();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.kind() === "hash_bang_line") continue;
    if (node.kind() !== "comment") return null;
    const group = [node];
    if (node.text().startsWith("//")) {
      while (
        nodes[index + 1]?.kind() === "comment" &&
        nodes[index + 1]!.text().startsWith("//") &&
        nodes[index + 1]!.range().start.line === nodes[index]!.range().end.line + 1
      )
        group.push(nodes[++index]!);
    }
    const comment = group.map((item) => cleanComment(item.text())).join("\n");
    if (comment && !isIgnorableFileComment(comment)) return comment;
  }
  return null;
}

/** Normalizes comment delimiters while retaining the established readable documentation projection. */
function cleanComment(text: string): string {
  return text
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:\/\/|\*)\s?/, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Identifies tooling directives that do not describe source intent. */
export function isIgnorableFileComment(comment: string): boolean {
  const lowered = comment.trim().toLowerCase();
  return (
    lowered.startsWith("eslint-") ||
    lowered.startsWith("@ts-") ||
    lowered.startsWith("biome-ignore") ||
    /^\/?\s*<reference\b/.test(lowered) ||
    lowered.startsWith("oxlint-")
  );
}
