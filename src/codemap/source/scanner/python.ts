/** Extracts Python measurements, imports, declarations, and call sites from one file's ast-grep matches. Each rule names one fact, and ownership comes from byte-range nesting. */
import path from "node:path";

import { ancestor, type AstGrepMatch, type AstGrepRule, descendants } from "../../ast-grep.js";
import { ENTRYPOINT_BASENAMES } from "./constants.js";
import {
  addSample,
  addVariableDefinition,
  createFileMetrics,
  type FileMetrics,
  type PythonImport,
  sourceLineCount,
} from "./metrics.js";

type DefinitionScope = {
  name: string;
  kind: "function" | "class";
  end: number;
  bodyStart: number;
};

const IMPORT_PARENT = {
  any: [{ inside: { kind: "import_statement" } }, { inside: { kind: "import_from_statement" } }],
};
const ASSIGNMENT = { any: [{ kind: "assignment" }, { kind: "augmented_assignment" }] };
const DESTRUCTURING_PATTERNS = [
  "pattern_list",
  "tuple_pattern",
  "list_pattern",
  "list_splat_pattern",
];
// Destructuring deeper than this many nested patterns, as in `(a, (b, (c, (d, (e,))))) = x`, loses its innermost names.
const DESTRUCTURING_DEPTH = 4;
// Every expression kind the grammar allows in a class's argument list except keyword arguments and comments, which name no base.
const BASE_KINDS = [
  "identifier",
  "attribute",
  "subscript",
  "call",
  "string",
  "concatenated_string",
  "integer",
  "float",
  "true",
  "false",
  "none",
  "ellipsis",
  "binary_operator",
  "unary_operator",
  "not_operator",
  "boolean_operator",
  "comparison_operator",
  "conditional_expression",
  "lambda",
  "named_expression",
  "await",
  "list",
  "list_comprehension",
  "dictionary",
  "dictionary_comprehension",
  "set",
  "set_comprehension",
  "tuple",
  "parenthesized_expression",
  "generator_expression",
  "list_splat",
  "dictionary_splat",
  "parenthesized_list_splat",
];

/** Matches an identifier bound by an assignment target, directly or through up to `DESTRUCTURING_DEPTH` nested patterns. */
function bindingTarget(): Record<string, unknown> {
  let target: Record<string, unknown> = { inside: { ...ASSIGNMENT, field: "left" } };
  const levels = [target];
  for (let depth = 0; depth < DESTRUCTURING_DEPTH; depth += 1) {
    target = { inside: { any: DESTRUCTURING_PATTERNS.map((kind) => ({ kind })), ...target } };
    levels.push(target);
  }
  return { any: levels };
}

export const PYTHON_SCAN_RULES: AstGrepRule[] = Object.entries({
  import: { kind: "import_statement" },
  import_from: { kind: "import_from_statement", has: { field: "module_name", pattern: "$NAME" } },
  import_name: {
    kind: "dotted_name",
    all: [
      IMPORT_PARENT,
      { not: { inside: { kind: "import_from_statement", field: "module_name" } } },
    ],
  },
  import_alias: {
    kind: "aliased_import",
    all: [IMPORT_PARENT, { has: { field: "name", pattern: "$NAME" } }],
  },
  import_wildcard: { kind: "wildcard_import", inside: { kind: "import_from_statement" } },
  function: { kind: "function_definition", has: { field: "name", pattern: "$NAME" } },
  parameters: { kind: "parameters", inside: { kind: "function_definition", field: "parameters" } },
  return_type: { kind: "type", inside: { kind: "function_definition", field: "return_type" } },
  class: { kind: "class_definition", has: { field: "name", pattern: "$NAME" } },
  base: {
    any: BASE_KINDS.map((kind) => ({ kind })),
    inside: {
      kind: "argument_list",
      inside: { kind: "class_definition", field: "superclasses" },
    },
  },
  decorator: { kind: "decorator", inside: { kind: "decorated_definition" } },
  assignment: ASSIGNMENT,
  binder: { kind: "identifier", ...bindingTarget() },
  export_name: {
    kind: "string",
    inside: {
      any: [{ kind: "list" }, { kind: "tuple" }, { kind: "set" }],
      inside: { ...ASSIGNMENT, field: "right", has: { field: "left", regex: "^__all__$" } },
    },
  },
  callee: { kind: "identifier", inside: { kind: "call", field: "function" } },
  callee_attribute: {
    kind: "attribute",
    inside: { kind: "call", field: "function" },
    has: { field: "attribute", pattern: "$NAME" },
  },
  main_guard: { kind: "comparison_operator", regex: "__main__" },
}).map(([id, rule]) => ({ id: `python.${id}`, language: "python", rule }));

/** Builds one file's record from its source and the matches of `PYTHON_SCAN_RULES`. */
export function pythonFileMetrics(
  filePath: string,
  { relPath, source, matches }: { relPath: string; source: string; matches: AstGrepMatch[] },
): FileMetrics {
  const metrics = createFileMetrics({ path: filePath, relPath, suffix: path.extname(filePath) });
  metrics.lines = sourceLineCount(source);
  metrics.entrypointHint = ENTRYPOINT_BASENAMES.has(path.basename(filePath));
  // Matches arrive in source preorder, so an open-range stack gives each match its enclosing definitions.
  const scopes: DefinitionScope[] = [];
  for (const match of matches) {
    while (scopes.length && match.start >= scopes.at(-1)!.end) scopes.pop();
    switch (match.rule) {
      case "python.import":
      case "python.import_from":
        collectImport(metrics, match);
        break;
      case "python.function": {
        const name = match.name;
        metrics.functionNames.push(name);
        metrics.functionSpans.push({
          name,
          identifier: `${relPath}::${[...scopes.map((scope) => scope.name), name].join(".")}`,
          span: match.endLine - match.startLine + 1,
          startLine: match.startLine + 1,
        });
        if (scopes.length === 0) metrics.defines += 1;
        scopes.push({
          name,
          kind: "function",
          end: match.end,
          // Parameter defaults and the return annotation run before the body, so calls there belong to an outer function.
          bodyStart: Math.max(
            match.start,
            ...match.children
              .filter(
                (child) =>
                  child.rule === "python.parameters" || child.rule === "python.return_type",
              )
              .map((child) => child.end),
          ),
        });
        addSample(metrics.samples, name);
        break;
      }
      case "python.class": {
        const name = match.name;
        metrics.defines += 1;
        metrics.classSpans.push({
          name,
          span: match.endLine - match.startLine + 1,
          startLine: match.startLine + 1,
        });
        for (const base of match.children.filter((child) => child.rule === "python.base")) {
          metrics.inherits += 1;
          addSample(metrics.samples, base.text);
        }
        scopes.push({ name, kind: "class", end: match.end, bodyStart: match.end });
        addSample(metrics.samples, name);
        break;
      }
      case "python.decorator":
        metrics.decorators += 1;
        break;
      case "python.assignment": {
        const names = ownedBy(match, "python.binder").map((binder) => binder.text);
        metrics.variableNames.push(...names);
        if (scopes.length === 0) {
          for (const name of names)
            addVariableDefinition(metrics, relPath, name, {
              startLine: match.startLine + 1,
              moduleLevel: true,
            });
        }
        metrics.exportedNames.push(...literalExportNames(match));
        break;
      }
      case "python.callee":
      case "python.callee_attribute": {
        const owner = scopes.findLast(
          (scope) =>
            scope.kind === "function" && scope.bodyStart <= match.start && scope.end >= match.end,
        );
        const callee = match.rule === "python.callee" ? match.text : match.name;
        if (owner)
          metrics.callSites.push({
            caller: owner.name,
            callee,
            lineNumber: match.startLine + 1,
          });
        break;
      }
      case "python.main_guard":
        metrics.entrypointHint ||=
          /^(?:__name__\s*==\s*(["'])__main__\1|(["'])__main__\2\s*==\s*__name__)$/.test(
            match.text,
          );
        break;
    }
  }
  return metrics;
}

/** Preserves import names and relative levels before project-specific module resolution. */
function collectImport(metrics: FileMetrics, statement: AstGrepMatch): void {
  const names: string[] = [];
  for (const child of statement.children) {
    if (child.rule === "python.import_name") names.push(child.text);
    else if (child.rule === "python.import_alias") names.push(child.name);
    else if (child.rule === "python.import_wildcard") names.push("*");
  }
  let record: PythonImport;
  if (statement.rule === "python.import") {
    record = { kind: "import", names };
    metrics.pythonImportTargets.push(...names);
  } else {
    const raw = statement.name;
    const level = raw.match(/^\.+/)?.[0].length ?? 0;
    record = { kind: "from", level, module: raw.slice(level), names };
    for (const name of names) {
      const target = raw || name;
      metrics.pythonImportTargets.push(target);
      if (level > 0) {
        metrics.importsLocal += 1;
        addSample(metrics.samples, target);
      }
    }
  }
  metrics.pythonImports.push(record);
}

/** Matches of `rule` whose nearest enclosing assignment is `assignment`, so a chained or nested assignment keeps its own names. */
function ownedBy(assignment: AstGrepMatch, rule: string): AstGrepMatch[] {
  return descendants(assignment, rule).filter(
    (match) => ancestor(match, "python.assignment") === assignment,
  );
}

/** Reads static `__all__` members without evaluating expressions, byte strings, or interpolated values. */
function literalExportNames(assignment: AstGrepMatch): string[] {
  const names: string[] = [];
  for (const item of ownedBy(assignment, "python.export_name")) {
    const quotes = /^([A-Za-z]*)("""|'''|"|')/.exec(item.text);
    if (quotes !== null && !/[bf]/i.test(quotes[1]!) && item.text.endsWith(quotes[2]!)) {
      names.push(item.text.slice(quotes[0].length, -quotes[2]!.length));
    }
  }
  return names;
}
