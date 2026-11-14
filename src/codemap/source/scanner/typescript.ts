/** Extracts TypeScript-family measurements, imports, exports, declarations, and call sites from one file's ast-grep matches. Files above 256 KiB get only their top-level imports and exports. */
import path from "node:path";

import { ancestor, type AstGrepMatch, type AstGrepRule, descendants } from "../../ast-grep.js";
import { ENTRYPOINT_BASENAMES } from "./constants.js";
import {
  addSample,
  addVariableDefinition,
  createFileMetrics,
  definitionIdentifier,
  type FileMetrics,
  sourceLineCount,
  type TypeScriptImport,
  type TypeScriptReexportBinding,
} from "./metrics.js";

/** Bundled and vendored scripts reach this size; past it a full scan's match output would dwarf the file, while its imports and exports still matter. */
export const MAX_FULL_SCAN_BYTES = 256 * 1024;

type Grammar = "typescript" | "tsx" | "javascript";

type FunctionScope = {
  end: number;
  caller: string | null;
};

const GRAMMARS: Grammar[] = ["typescript", "tsx", "javascript"];
const FUNCTION_EXPRESSION = {
  any: [
    { kind: "arrow_function" },
    { kind: "function_expression" },
    { kind: "generator_function" },
  ],
};
const PROPERTY_NAME_RE = /^#?[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

export const TYPESCRIPT_SCAN_RULES: AstGrepRule[] = GRAMMARS.flatMap((grammar) =>
  typescriptRules(grammar, { surface: false }),
);
export const TYPESCRIPT_SURFACE_RULES: AstGrepRule[] = GRAMMARS.flatMap((grammar) =>
  typescriptRules(grammar, { surface: true }),
);

/** Builds one file's record from its source and the matches of `TYPESCRIPT_SCAN_RULES`, or of `TYPESCRIPT_SURFACE_RULES` for a file above `MAX_FULL_SCAN_BYTES`. */
export function typescriptFileMetrics(
  filePath: string,
  { relPath, source, matches }: { relPath: string; source: string; matches: AstGrepMatch[] },
): FileMetrics {
  const metrics = createFileMetrics({ path: filePath, relPath, suffix: path.extname(filePath) });
  metrics.lines = sourceLineCount(source);
  metrics.entrypointHint =
    ENTRYPOINT_BASENAMES.has(path.basename(filePath)) || source.includes("require.main === module");
  const countsJsx = metrics.suffix === ".jsx" || metrics.suffix === ".tsx";
  // Matches arrive in source preorder, so a scope stack gives each call its innermost function.
  const scopes: FunctionScope[] = [];
  for (const match of matches) {
    while (scopes.length && match.start >= scopes.at(-1)!.end) scopes.pop();
    switch (match.rule) {
      case "ts.import":
        addTypescriptImport(metrics, stringValue(match.name));
        break;
      case "ts.require":
        addTypescriptImport(metrics, stringValue(match.name), "require");
        break;
      case "ts.export":
        collectTypescriptExport(metrics, match);
        break;
      case "ts.class":
        metrics.classSpans.push({
          name: match.name,
          span: spanFor(match),
          startLine: match.startLine + 1,
        });
        metrics.defines += 1;
        addSample(metrics.samples, match.name);
        break;
      case "ts.class_heritage":
        metrics.extends += 1;
        addSample(metrics.samples, match.name);
        break;
      case "ts.function":
        scopes.push({ end: match.end, caller: match.name });
        addTypescriptFunction(metrics, relPath, match.name, match);
        break;
      case "ts.method": {
        const name = match.name;
        scopes.push({ end: match.end, caller: name });
        // Computed, string, and numeric method names still own their calls but do not name a function.
        if (PROPERTY_NAME_RE.test(name)) addTypescriptFunction(metrics, relPath, name, match);
        break;
      }
      case "ts.field_function":
        addTypescriptFunction(metrics, relPath, match.name, match);
        break;
      case "ts.variable":
      case "ts.local_variable": {
        const name = match.name;
        metrics.variableNames.push(name);
        addVariableDefinition(metrics, relPath, name, {
          startLine: match.startLine + 1,
          moduleLevel: match.rule === "ts.variable",
        });
        if (match.children.some((child) => child.rule === "ts.bound_function")) {
          addTypescriptFunction(metrics, relPath, name, match);
        }
        break;
      }
      case "ts.bound_function":
        // A function expression initializing a variable or class field takes that binding's name.
        scopes.push({ end: match.end, caller: match.parent?.name ?? null });
        break;
      case "ts.function_expression":
        // An anonymous innermost function owns its calls without a caller name, so they are not attributed to an outer function.
        scopes.push({ end: match.end, caller: match.name || null });
        break;
      case "ts.callee":
      case "ts.callee_member": {
        const caller = scopes.at(-1)?.caller;
        const callee = match.rule === "ts.callee" ? match.text : match.name;
        if (caller) {
          metrics.callSites.push({ caller, callee, lineNumber: match.startLine + 1 });
        }
        break;
      }
      case "ts.jsx":
        if (countsJsx) metrics.jsxComponents += 1;
        break;
    }
  }
  return metrics;
}

/**
 * The rules for one grammar. Each rule's direct-parent conditions stand in for a tree walk, so a match never borrows a node from a nested declaration.
 * `surface` keeps only top-level imports and exports with their parts.
 */
function typescriptRules(grammar: Grammar, { surface }: { surface: boolean }): AstGrepRule[] {
  const typed = grammar !== "javascript";
  const fieldKind = typed ? "public_field_definition" : "field_definition";
  const fieldName = typed ? "name" : "property";
  const classKinds = typed
    ? ["class_declaration", "abstract_class_declaration"]
    : ["class_declaration"];
  const namedKinds = typed
    ? [...classKinds, "interface_declaration", "type_alias_declaration", "enum_declaration"]
    : classKinds;
  const exportStatement = surface
    ? { kind: "export_statement", inside: { kind: "program" } }
    : { kind: "export_statement" };
  const identifierKinds = (typed ? ["identifier", "type_identifier"] : ["identifier"]).map(
    (kind) => ({
      kind,
    }),
  );
  const binding = { any: [{ kind: "variable_declarator" }, { kind: fieldKind }], field: "value" };
  const rules: Record<string, Record<string, unknown>> = {
    import: {
      kind: "import_statement",
      has: { field: "source", pattern: "$NAME" },
      ...(surface ? { inside: { kind: "program" } } : {}),
    },
    export: exportStatement,
    export_source: { kind: "string", inside: { ...exportStatement, field: "source" } },
    export_clause: { kind: "export_clause", inside: exportStatement },
    export_specifier: {
      kind: "export_specifier",
      inside: { kind: "export_clause", inside: exportStatement },
    },
    export_specifier_name: {
      kind: "identifier",
      inside: {
        kind: "export_specifier",
        inside: { kind: "export_clause", inside: exportStatement },
      },
    },
    export_namespace_name: {
      kind: "identifier",
      inside: { kind: "namespace_export", inside: exportStatement },
    },
    export_name: {
      all: [
        { any: identifierKinds },
        {
          any: [
            {
              inside: {
                any: [
                  { kind: "function_declaration" },
                  { kind: "generator_function_declaration" },
                  ...namedKinds.map((kind) => ({ kind })),
                ],
                field: "name",
                inside: exportStatement,
              },
            },
            {
              inside: {
                kind: "variable_declarator",
                field: "name",
                inside: {
                  any: [{ kind: "lexical_declaration" }, { kind: "variable_declaration" }],
                  inside: exportStatement,
                },
              },
            },
          ],
        },
      ],
    },
  };
  if (!surface) {
    Object.assign(rules, {
      require: {
        kind: "call_expression",
        all: [
          { has: { field: "function", kind: "identifier", regex: "^require$" } },
          { has: { kind: "string", stopBy: "end", pattern: "$NAME" } },
        ],
      },
      class: {
        any: classKinds.map((kind) => ({ kind })),
        has: { field: "name", pattern: "$NAME" },
      },
      class_heritage: {
        kind: "class_heritage",
        inside: { any: classKinds.map((kind) => ({ kind })) },
        has: {
          any: identifierKinds,
          stopBy: "end",
          pattern: "$NAME",
        },
      },
      function: {
        any: [{ kind: "function_declaration" }, { kind: "generator_function_declaration" }],
        has: { field: "name", pattern: "$NAME" },
      },
      method: { kind: "method_definition", has: { field: "name", pattern: "$NAME" } },
      field_function: {
        kind: fieldKind,
        all: [
          { has: { field: "value", ...FUNCTION_EXPRESSION } },
          { has: { field: fieldName, pattern: "$NAME" } },
        ],
      },
      variable: {
        kind: "variable_declarator",
        all: [
          { has: { field: "name", kind: "identifier", pattern: "$NAME" } },
          { not: { inside: { kind: "statement_block", stopBy: "end" } } },
        ],
      },
      local_variable: {
        kind: "variable_declarator",
        all: [
          { has: { field: "name", kind: "identifier", pattern: "$NAME" } },
          { inside: { kind: "statement_block", stopBy: "end" } },
        ],
      },
      destructured_binding: {
        kind: "variable_declarator",
        all: [
          { has: { field: "name", pattern: "$NAME" } },
          { not: { has: { field: "name", kind: "identifier" } } },
          { has: { field: "value", ...FUNCTION_EXPRESSION } },
        ],
      },
      bound_function: { ...FUNCTION_EXPRESSION, inside: binding },
      function_expression: {
        all: [
          FUNCTION_EXPRESSION,
          { not: { inside: binding } },
          {
            any: [
              { has: { field: "name", pattern: "$NAME" } },
              { not: { has: { field: "name", kind: "identifier" } } },
            ],
          },
        ],
      },
      callee: { kind: "identifier", inside: { kind: "call_expression", field: "function" } },
      callee_member: {
        kind: "member_expression",
        inside: { kind: "call_expression", field: "function" },
        has: { field: "property", pattern: "$NAME" },
      },
      ...(grammar === "typescript"
        ? {}
        : { jsx: { kind: "jsx_opening_element", inside: { kind: "jsx_element" } } }),
    });
  }
  return Object.entries(rules).map(([id, rule]) => ({ id: `ts.${id}`, language: grammar, rule }));
}

/** Strips matching quotes, as in `'./a.js'` → `./a.js`. */
function stringValue(text: string): string {
  if (text.length >= 2 && ["'", '"', "`"].includes(text[0] ?? "") && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  return text;
}

function spanFor(match: AstGrepMatch): number {
  return Math.max(1, match.endLine - match.startLine + 1);
}

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
    metrics.importsLocal += 1;
    addSample(metrics.samples, target);
  }
}

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
    metrics.reexportsLocal += 1;
    addSample(metrics.samples, target);
  }
}

/** Null when the statement names no bindings, as with `export * from`; an empty clause gives an empty list. */
function typescriptReexportBindings(statement: AstGrepMatch): TypeScriptReexportBinding[] | null {
  const clause = statement.children.find((child) => child.rule === "ts.export_clause");
  if (clause !== undefined) {
    return clause.children
      .filter((child) => child.rule === "ts.export_specifier")
      .flatMap((specifier) => {
        const identifiers = specifier.children
          .filter((child) => child.rule === "ts.export_specifier_name")
          .map((child) => child.text);
        const imported = identifiers[0];
        const exported = identifiers.at(-1);
        return imported === undefined || exported === undefined ? [] : [{ imported, exported }];
      });
  }
  const exported = statement.children.find((child) => child.rule === "ts.export_namespace_name");
  return exported === undefined ? null : [{ imported: null, exported: exported.text }];
}

function addExportedName(metrics: FileMetrics, name: string): void {
  if (name && !metrics.exportedNames.includes(name)) {
    metrics.exportedNames.push(name);
  }
}

function addTypescriptFunction(
  metrics: FileMetrics,
  relPath: string,
  name: string,
  match: AstGrepMatch,
): void {
  if (!name) {
    return;
  }
  metrics.functionNames.push(name);
  metrics.functionSpans.push({
    name,
    identifier: definitionIdentifier(relPath, name),
    span: spanFor(match),
    startLine: match.startLine + 1,
  });
  metrics.defines += 1;
  addSample(metrics.samples, name);
}

function collectTypescriptExport(metrics: FileMetrics, statement: AstGrepMatch): void {
  const bindings = typescriptReexportBindings(statement);
  metrics.exports += 1;
  const source = statement.children.find((child) => child.rule === "ts.export_source");
  addTypescriptReexport(metrics, stringValue(source?.text ?? ""), bindings);
  for (const name of descendants(statement, "ts.export_name")) {
    if (ancestor(name, "ts.export") === statement) {
      addExportedName(metrics, name.text);
    }
  }
  for (const binding of bindings ?? []) {
    addExportedName(metrics, binding.exported);
  }
}
