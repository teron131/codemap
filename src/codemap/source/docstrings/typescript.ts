/** Reads TypeScript-family documentation from one file's ast-grep matches. A declaration's docstring is its adjacent leading comment group, and the file docstring is the first leading comment that is not a tool directive. */
import { type AstGrepMatch, type AstGrepRule } from "../../ast-grep.js";
import type { ClassReport, FileReport, FunctionReport } from "./models.js";

type Grammar = "typescript" | "tsx" | "javascript";

type Declaration = {
  match: AstGrepMatch;
  signature: AstGrepMatch | null;
  kind: "class" | "function";
  docstring: string | null;
  children: Declaration[];
};

const FUNCTION_EXPRESSION_KINDS = ["arrow_function", "function_expression", "generator_function"];
const DECLARATION_RULES = new Set([
  "tsdoc.class",
  "tsdoc.function",
  "tsdoc.variable",
  "tsdoc.variable_function",
  "tsdoc.field_function",
]);

export const TYPESCRIPT_DOCSTRING_RULES: AstGrepRule[] = (
  ["typescript", "tsx", "javascript"] as const
).flatMap((grammar) => docstringRules(grammar));

/** A variable or field reports as a function when it holds one, and a non-function variable reports too when a block comment documents it. Any syntax error yields `parseError` and no declarations. */
export function typescriptFileReport(
  report: FileReport,
  { source, matches }: { source: string; matches: AstGrepMatch[] },
): FileReport {
  if (matches.some((match) => match.rule === "tsdoc.invalid")) {
    return { ...report, parseError: "invalid syntax" };
  }
  const bytes = Buffer.from(source, "utf8");
  const lines = source.split(/\r?\n/);
  const comments = matches.filter((match) => match.rule === "tsdoc.comment");
  const topLevel: Declaration[] = [];
  const declarations = new Map<AstGrepMatch, Declaration>();
  for (const match of matches) {
    if (!DECLARATION_RULES.has(match.rule)) continue;
    const comment = declarationComment(anchorFor(match), { bytes, lines, comments });
    let signature: AstGrepMatch | null = match;
    if (
      match.rule === "tsdoc.variable" ||
      match.rule === "tsdoc.variable_function" ||
      match.rule === "tsdoc.field_function"
    ) {
      signature = match.children.find((child) => child.rule === "tsdoc.value_function") ?? null;
      if (signature === null && !comment?.block) continue;
    }
    const declaration: Declaration = {
      match,
      signature,
      kind: match.rule === "tsdoc.class" ? "class" : "function",
      docstring: comment?.text ?? null,
      children: [],
    };
    declarations.set(match, declaration);
    // Skipped declarations own nothing, so a member nests under the nearest reported ancestor.
    let owner = match.parent;
    while (owner !== null && !declarations.has(owner)) owner = owner.parent;
    (owner === null ? topLevel : declarations.get(owner)!.children).push(declaration);
  }
  return {
    ...report,
    fileDocstring: fileComment(source, { bytes, comments }),
    functions: topLevel.filter((item) => item.kind === "function").map(functionReport),
    classes: topLevel.filter((item) => item.kind === "class").map(classReport),
  };
}

function docstringRules(grammar: Grammar): AstGrepRule[] {
  const typed = grammar !== "javascript";
  const fieldKind = typed ? "public_field_definition" : "field_definition";
  const fieldName = typed ? "name" : "property";
  const classKinds = typed
    ? ["class_declaration", "abstract_class_declaration"]
    : ["class_declaration"];
  const functionKinds = [
    "function_declaration",
    "generator_function_declaration",
    "method_definition",
    ...(typed ? ["function_signature", "abstract_method_signature"] : []),
  ];
  const functionValue = {
    has: { field: "value", any: FUNCTION_EXPRESSION_KINDS.map((kind) => ({ kind })) },
  };
  const signatureKinds = [
    ...functionKinds,
    ...FUNCTION_EXPRESSION_KINDS,
    ...(typed ? ["method_signature"] : []),
  ];
  const signatureParent = (field: string) => ({
    inside: { any: signatureKinds.map((kind) => ({ kind })), field },
  });
  const named = (field: string) => ({ has: { field, pattern: "$NAME" } });
  const rules: Record<string, Record<string, unknown>> = {
    // Error recovery can insert a missing token without an ERROR node. A missing named token is a zero-width node, and a missing closing delimiter leaves its node unclosed; other missing anonymous tokens, such as `;`, go unnoticed because kind matchers cannot name them.
    invalid: {
      any: [
        { kind: "ERROR" },
        {
          any: [
            "identifier",
            "property_identifier",
            "statement_block",
            "optional_chain",
            "empty_statement",
            ...(typed ? ["type_identifier"] : []),
          ].map((kind) => ({ kind })),
          regex: "^$",
        },
        {
          any: [
            "statement_block",
            "class_body",
            "object",
            "object_pattern",
            "array",
            "array_pattern",
            "arguments",
            "formal_parameters",
            "parenthesized_expression",
            "switch_body",
            "named_imports",
            "export_clause",
            ...(typed
              ? ["object_type", "interface_body", "enum_body", "type_arguments", "type_parameters"]
              : ["jsx_expression"]),
          ].map((kind) => ({ kind })),
          not: { regex: "[)\\]}>]$" },
        },
        { kind: "template_string", not: { regex: "`$" } },
        { kind: "string", not: { regex: "[\"']$" } },
      ],
    },
    comment: { kind: "comment" },
    class: { any: classKinds.map((kind) => ({ kind })), ...named("name") },
    function: {
      any: [
        ...functionKinds.map((kind) => ({ kind })),
        ...(typed ? [{ kind: "method_signature", inside: { kind: "class_body" } }] : []),
      ],
      ...named("name"),
    },
    variable: { kind: "variable_declarator", all: [named("name"), { not: functionValue }] },
    variable_function: { kind: "variable_declarator", all: [named("name"), functionValue] },
    field_function: { kind: fieldKind, all: [named(fieldName), functionValue] },
    value_function: {
      any: FUNCTION_EXPRESSION_KINDS.map((kind) => ({ kind })),
      inside: { any: [{ kind: "variable_declarator" }, { kind: fieldKind }], field: "value" },
    },
    // Callbacks and other unbound functions report nothing, but holding their own parameters and return types keeps those off the enclosing declaration.
    nested_function: {
      any: FUNCTION_EXPRESSION_KINDS.map((kind) => ({ kind })),
      not: {
        inside: { any: [{ kind: "variable_declarator" }, { kind: fieldKind }], field: "value" },
      },
    },
    parameters: { kind: "formal_parameters", ...signatureParent("parameters") },
    parameter: { kind: "identifier", inside: { kind: "arrow_function", field: "parameter" } },
    // The export or declaration list that a documenting comment precedes instead of the declaration itself.
    declaration_list: {
      any: [{ kind: "lexical_declaration" }, { kind: "variable_declaration" }],
    },
    export: {
      kind: "export_statement",
      has: {
        any: [
          ...[...classKinds, ...functionKinds].map((kind) => ({ kind })),
          { kind: "lexical_declaration" },
          { kind: "variable_declaration" },
        ],
      },
    },
    ...(typed
      ? {
          return_type: {
            any: ["type_annotation", "asserts_annotation", "type_predicate_annotation"].map(
              (kind) => ({ kind }),
            ),
            ...signatureParent("return_type"),
          },
        }
      : {}),
  };
  return Object.entries(rules).map(([id, rule]) => ({
    id: `tsdoc.${id}`,
    language: grammar,
    rule,
  }));
}

/** Climbs from a declaration through the declaration list and export that directly hold it, where a leading comment sits. */
function anchorFor(match: AstGrepMatch): AstGrepMatch {
  let anchor = match;
  while (
    anchor.parent !== null &&
    (anchor.parent.rule === "tsdoc.declaration_list" || anchor.parent.rule === "tsdoc.export")
  ) {
    anchor = anchor.parent;
  }
  return anchor;
}

function functionReport(declaration: Declaration): FunctionReport {
  const parts = declaration.signature?.children ?? [];
  const parameters = parts.find((child) => child.rule === "tsdoc.parameters");
  const single = parts.find((child) => child.rule === "tsdoc.parameter");
  const params = parameters?.text.slice(1, -1) ?? single?.text ?? "";
  return {
    name: declaration.match.name,
    lineno: declaration.match.startLine + 1,
    inputs: params.replace(/\s+/g, " ").trim() || "none",
    outputs:
      parts.find((child) => child.rule === "tsdoc.return_type")?.text.replace(/^:\s*/, "") ??
      "unannotated",
    docstring: declaration.docstring,
    nestedFunctions: declaration.children
      .filter((child) => child.kind === "function")
      .map(functionReport),
  };
}

function classReport(declaration: Declaration): ClassReport {
  return {
    name: declaration.match.name,
    lineno: declaration.match.startLine + 1,
    docstring: declaration.docstring,
    methods: declaration.children.filter((child) => child.kind === "function").map(functionReport),
    nestedClasses: declaration.children.filter((child) => child.kind === "class").map(classReport),
  };
}

/**
 * Associates adjacent leading comments with their declaration without borrowing a previous statement's trailing comment.
 * A comment is adjacent when only whitespace separates it from what follows, which is what makes it that node's previous sibling.
 */
function declarationComment(
  anchor: AstGrepMatch,
  { bytes, lines, comments }: { bytes: Buffer; lines: string[]; comments: AstGrepMatch[] },
): { text: string; block: boolean } | null {
  const group: AstGrepMatch[] = [];
  let next = anchor;
  let index = comments.findLastIndex((comment) => comment.end <= anchor.start);
  while (index >= 0) {
    const previous = comments[index]!;
    if (
      !whitespaceBetween(bytes, previous.end, next.start) ||
      next.startLine - previous.endLine > 1
    )
      break;
    if (
      !(lines[previous.startLine] ?? "")
        .trimStart()
        .startsWith(previous.text.split(/\r?\n/)[0] ?? "")
    )
      break;
    group.unshift(previous);
    if (previous.text.startsWith("/*")) break;
    next = previous;
    index -= 1;
  }
  return group.length === 0
    ? null
    : {
        text: group.map((comment) => cleanComment(comment.text)).join("\n"),
        block: group.some((comment) => comment.text.startsWith("/*")),
      };
}

/** Keeps tool directives out of file intent while preserving the first meaningful comment group; only comments before the first statement count. */
function fileComment(
  source: string,
  { bytes, comments }: { bytes: Buffer; comments: AstGrepMatch[] },
): string | null {
  const hashBang = /^#![^\r\n]*/.exec(source)?.[0];
  let cursor = hashBang === undefined ? 0 : Buffer.byteLength(hashBang, "utf8");
  for (let index = 0; index < comments.length; index += 1) {
    const node = comments[index]!;
    if (!whitespaceBetween(bytes, cursor, node.start)) return null;
    const group = [node];
    if (node.text.startsWith("//")) {
      while (
        comments[index + 1]?.text.startsWith("//") &&
        comments[index + 1]!.startLine === comments[index]!.endLine + 1 &&
        whitespaceBetween(bytes, comments[index]!.end, comments[index + 1]!.start)
      )
        group.push(comments[++index]!);
    }
    const comment = group.map((item) => cleanComment(item.text)).join("\n");
    if (comment && !isIgnorableFileComment(comment)) return comment;
    cursor = comments[index]!.end;
  }
  return null;
}

function whitespaceBetween(bytes: Buffer, start: number, end: number): boolean {
  return start <= end && !/\S/.test(bytes.toString("utf8", start, end));
}

/** Strips comment markers and drops blank lines, so paragraph breaks do not survive. */
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
