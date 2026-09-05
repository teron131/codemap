/** Scans TypeScript-family source with ast-grep for imports and definitions. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { type NapiConfig, type SgNode } from "@ast-grep/napi";

import { astGrepRoot } from "../../ast-grep/adapter.js";
import { ENTRYPOINT_BASENAMES, TYPESCRIPT_LANG_BY_SUFFIX } from "./constants.js";
import {
  addSample,
  addVariableSignal,
  codeSignalIdentifier,
  createFileMetrics,
  type FileMetrics,
  sourceLineCount,
  type TypeScriptImport,
  type TypeScriptReexportBinding,
} from "./metrics.js";

/** Keeps native AST extraction below the large-script teardown failure boundary. */
const MAX_AST_SOURCE_BYTES = 256 * 1024;
const TYPESCRIPT_SCAN_KINDS = [
  "import_statement",
  "call_expression",
  "export_statement",
  "class_declaration",
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "variable_declarator",
];
const FUNCTION_EXPRESSION_KINDS = ["arrow_function", "function_expression", "generator_function"];

/** Finds a direct ast-grep child node by kind. */
function directChild(node: SgNode, ...kinds: string[]): SgNode | null {
  return node.children().find((child) => kinds.includes(String(child.kind()))) ?? null;
}

/** Finds a descendant ast-grep node by kind. */
function descendant(node: SgNode | null, ...kinds: string[]): SgNode | null {
  if (node === null) {
    return null;
  }
  for (const child of node.children()) {
    if (kinds.includes(String(child.kind()))) {
      return child;
    }
    const nested = descendant(child, ...kinds);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

/** Reads string text from an ast-grep node. */
function stringValue(node: SgNode | null): string {
  if (node === null) {
    return "";
  }
  const text = node.text();
  if (text.length >= 2 && ["'", '"', "`"].includes(text[0] ?? "") && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  const fragment = descendant(node, "string_fragment");
  return fragment?.text() ?? text;
}

/** Builds a function span from an ast-grep node range. */
function spanFor(node: SgNode): number {
  const nodeRange = node.range();
  return Math.max(1, nodeRange.end.line - nodeRange.start.line + 1);
}

/** Finds the one-based start line for an ast-grep node. */
function startLineFor(node: SgNode): number {
  return node.range().start.line + 1;
}

/** Records TypeScript import specifiers on file metrics. */
function addTypescriptImport(
  metrics: FileMetrics,
  target: string,
  kind: TypeScriptImport["kind"] = "import",
): void {
  if (!target) {
    return;
  }
  metrics.typescriptImports.push({ target, kind });
  if (target.startsWith("./") || target.startsWith("../")) {
    metrics.typescriptLocalImportTargets.push(target);
    metrics.importsLocal += 1;
    addSample(metrics.samples, target);
  }
}

/** Records TypeScript re-export specifiers and their public name bindings. */
function addTypescriptReexport(
  metrics: FileMetrics,
  target: string,
  bindings: TypeScriptReexportBinding[] | null,
): void {
  if (!target) {
    return;
  }
  metrics.typescriptReexportTargets.push(target);
  metrics.typescriptReexports.push({ target, bindings });
  if (target.startsWith("./") || target.startsWith("../")) {
    metrics.typescriptLocalReexportTargets.push(target);
    metrics.reexportsLocal += 1;
    addSample(metrics.samples, target);
  }
}

/** Extracts named, aliased, namespace, or star re-export bindings. */
function typescriptReexportBindings(node: SgNode): TypeScriptReexportBinding[] | null {
  const clause = directChild(node, "export_clause");
  if (clause !== null) {
    return clause
      .children()
      .filter((child) => child.kind() === "export_specifier")
      .flatMap((specifier) => {
        const identifiers = specifier
          .children()
          .filter((child) => child.kind() === "identifier")
          .map((child) => child.text());
        const imported = identifiers[0];
        const exported = identifiers.at(-1);
        return imported === undefined || exported === undefined ? [] : [{ imported, exported }];
      });
  }
  const namespace = directChild(node, "namespace_export");
  const exported = directChild(namespace ?? node, "identifier");
  return namespace === null || exported === null
    ? null
    : [{ imported: null, exported: exported.text() }];
}

/** Records a TypeScript exported symbol on file metrics. */
function addExportedName(metrics: FileMetrics, name: string): void {
  if (name && !metrics.exportedNames.includes(name)) {
    metrics.exportedNames.push(name);
  }
}

/** Records a TypeScript function-like definition span on file metrics. */
function addTypescriptFunction(
  metrics: FileMetrics,
  relPath: string,
  name: string,
  node: SgNode,
): void {
  if (!name) {
    return;
  }
  metrics.functionNames.push(name);
  metrics.functionSpans.push({
    name,
    identifier: codeSignalIdentifier(relPath, name),
    span: spanFor(node),
    startLine: startLineFor(node),
  });
  metrics.defines += 1;
  addSample(metrics.samples, name);
}

/** Checks whether a TypeScript declaration is module-level state. */
function isTypescriptModuleLevelVariable(node: SgNode): boolean {
  let parent = node.parent();
  while (parent !== null) {
    const kind = parent.kind();
    if (kind === "statement_block") {
      return false;
    }
    if (kind === "program") {
      return true;
    }
    parent = parent.parent();
  }
  return false;
}

/** Collects declaration and re-export names from one export syntax node. */
function collectTypescriptExportNames(
  metrics: FileMetrics,
  node: SgNode,
  bindings: TypeScriptReexportBinding[] | null,
): void {
  for (const child of node.children()) {
    const kind = child.kind();
    if (kind === "function_declaration" || kind === "generator_function_declaration") {
      const name = directChild(child, "identifier");
      if (name !== null) {
        addExportedName(metrics, name.text());
      }
    } else if (
      kind === "class_declaration" ||
      kind === "abstract_class_declaration" ||
      kind === "interface_declaration" ||
      kind === "type_alias_declaration" ||
      kind === "enum_declaration"
    ) {
      const name = directChild(child, "type_identifier", "identifier");
      if (name !== null) {
        addExportedName(metrics, name.text());
      }
    } else if (kind === "lexical_declaration" || kind === "variable_declaration") {
      for (const declarator of child
        .children()
        .filter((candidate) => candidate.kind() === "variable_declarator")) {
        const name = directChild(declarator, "identifier");
        if (name !== null) {
          addExportedName(metrics, name.text());
        }
      }
    }
  }
  for (const binding of bindings ?? []) {
    addExportedName(metrics, binding.exported);
  }
}

/** Records one export statement without duplicating binding extraction across scan modes. */
function collectTypescriptExport(metrics: FileMetrics, node: SgNode): void {
  const bindings = typescriptReexportBindings(node);
  metrics.exports += 1;
  addTypescriptReexport(metrics, stringValue(directChild(node, "string")), bindings);
  collectTypescriptExportNames(metrics, node, bindings);
}

/** Scans TypeScript-family source with ast-grep syntax nodes. */
function scanTypescriptWithAstGrep({
  source,
  filePath,
  relPath,
  metrics,
}: {
  source: string;
  filePath: string;
  relPath: string;
  metrics: FileMetrics;
}): void {
  const root = parseTypescriptRoot(filePath, source);
  if (root === null) {
    return;
  }

  for (const node of root.findAll(typescriptScanRule(filePath))) {
    const kind = node.kind();
    if (kind === "import_statement") {
      addTypescriptImport(metrics, stringValue(directChild(node, "string")));
    } else if (kind === "call_expression") {
      addTypescriptCall(metrics, node);
      const callee = directChild(node, "identifier");
      if (callee !== null && callee.text() === "require") {
        addTypescriptImport(metrics, stringValue(descendant(node, "string")), "require");
      }
    } else if (kind === "export_statement") {
      collectTypescriptExport(metrics, node);
    } else if (kind === "class_declaration" || kind === "abstract_class_declaration") {
      const name = directChild(node, "type_identifier", "identifier");
      if (name !== null) {
        const methods = directChild(node, "class_body")?.children() ?? [];
        metrics.classSpans.push({
          name: name.text(),
          span: spanFor(node),
          startLine: startLineFor(node),
          methods: methods
            .filter((method) =>
              ["method_definition", "abstract_method_signature"].includes(String(method.kind())),
            )
            .flatMap((method) => {
              const methodName = directChild(
                method,
                "property_identifier",
                "private_property_identifier",
              );
              return methodName === null ? [] : [methodName.text()];
            }),
        });
        metrics.defines += 1;
        addSample(metrics.samples, name.text());
      }
      const heritage = directChild(node, "class_heritage");
      const base = heritage === null ? null : descendant(heritage, "identifier", "type_identifier");
      if (base !== null) {
        metrics.extends += 1;
        metrics.typescriptExtendsBases.push(base.text());
        addSample(metrics.samples, base.text());
      }
    } else if (kind === "function_declaration" || kind === "generator_function_declaration") {
      const name = directChild(node, "identifier");
      if (name !== null) {
        addTypescriptFunction(metrics, relPath, name.text(), node);
      }
    } else if (kind === "method_definition") {
      const name = directChild(node, "property_identifier", "private_property_identifier");
      if (name !== null) {
        addTypescriptFunction(metrics, relPath, name.text(), node);
      }
    } else if (kind === "public_field_definition" || kind === "field_definition") {
      const name = node.field("name") ?? node.field("property");
      const value = node.field("value");
      if (name && value && FUNCTION_EXPRESSION_KINDS.includes(String(value.kind()))) {
        addTypescriptFunction(metrics, relPath, name.text(), node);
      }
    } else if (kind === "variable_declarator") {
      const name = directChild(node, "identifier");
      if (name !== null) {
        metrics.variableNames.push(name.text());
        addVariableSignal(metrics, relPath, name.text(), {
          startLine: startLineFor(node),
          moduleLevel: isTypescriptModuleLevelVariable(node),
        });
        const initializer = directChild(node, ...FUNCTION_EXPRESSION_KINDS);
        if (initializer !== null) {
          addTypescriptFunction(metrics, relPath, name.text(), node);
        }
      }
    } else if (kind === "jsx_element") {
      metrics.jsxComponents += 1;
    }
  }
}

/** Selects relevant syntax nodes in native code instead of materializing the whole tree in JS. */
function typescriptScanRule(filePath: string): NapiConfig {
  const suffix = path.extname(filePath);
  const kinds = [...TYPESCRIPT_SCAN_KINDS];
  if (["typescript", "tsx"].includes(TYPESCRIPT_LANG_BY_SUFFIX[suffix] ?? "")) {
    kinds.push("abstract_class_declaration", "public_field_definition");
  } else {
    kinds.push("field_definition");
  }
  if (suffix === ".jsx" || suffix === ".tsx") {
    kinds.push("jsx_element");
  }
  return { rule: { any: kinds.map((kind) => ({ kind })) } };
}

/** Keeps imports and public exports for large files without deep native AST traversal. */
function scanTypescriptSurfaceWithAstGrep({
  source,
  filePath,
  metrics,
}: {
  source: string;
  filePath: string;
  metrics: FileMetrics;
}): void {
  const root = parseTypescriptRoot(filePath, source);
  if (root === null) {
    return;
  }
  for (const node of root.children()) {
    if (node.kind() === "import_statement") {
      addTypescriptImport(metrics, stringValue(directChild(node, "string")));
    } else if (node.kind() === "export_statement") {
      collectTypescriptExport(metrics, node);
    }
  }
}

/** Parses one TypeScript-family source while treating native parser failures as no AST data. */
function parseTypescriptRoot(filePath: string, source: string): SgNode | null {
  return astGrepRoot(source, TYPESCRIPT_LANG_BY_SUFFIX[path.extname(filePath)] ?? "typescript");
}

/** Scans one TypeScript-family file into source metrics. */
export function scanTypescriptFile(
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
  metrics.entrypointHint =
    ENTRYPOINT_BASENAMES.has(path.basename(filePath)) || source.includes("require.main === module");
  if (Buffer.byteLength(source, "utf8") <= MAX_AST_SOURCE_BYTES) {
    scanTypescriptWithAstGrep({ source, filePath, relPath, metrics });
  } else {
    scanTypescriptSurfaceWithAstGrep({ source, filePath, metrics });
  }
  return metrics;
}

/** Attributes real call expressions to their nearest named function or method, excluding comments and string examples. */
function addTypescriptCall(metrics: FileMetrics, node: SgNode): void {
  const owner = node
    .ancestors()
    .find((ancestor) =>
      [
        "function_declaration",
        "generator_function_declaration",
        "method_definition",
        ...FUNCTION_EXPRESSION_KINDS,
      ].includes(String(ancestor.kind())),
    );
  if (owner === undefined) return;
  const parent = owner.parent();
  const binding = ["variable_declarator", "public_field_definition", "field_definition"].includes(
    String(parent?.kind()),
  )
    ? parent
    : owner;
  const caller = (binding?.field("name") ?? binding?.field("property"))?.text();
  const target = node.field("function");
  const callee =
    target?.kind() === "identifier"
      ? target.text()
      : target?.kind() === "member_expression"
        ? target.field("property")?.text()
        : null;
  if (caller && callee)
    metrics.callSites.push({ caller, callee, lineNumber: node.range().start.line + 1 });
}
