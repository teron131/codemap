/** Builds Python documentation reports from one file's ast-grep matches without evaluating inspected source. */
import { type AstGrepMatch, type AstGrepRule } from "../../ast-grep.js";
import type { ClassReport, FileReport, FunctionReport } from "./models.js";

const DEFINITION = { any: [{ kind: "function_definition" }, { kind: "class_definition" }] };
const PARAMETER_PARENT = {
  inside: { kind: "parameters", inside: { kind: "function_definition", field: "parameters" } },
};

export const PYTHON_DOCSTRING_RULES: AstGrepRule[] = Object.entries({
  // Error recovery can insert a missing token without an ERROR node. A missing named token is a zero-width node, and a missing closing bracket leaves its bracketed node unclosed; other missing anonymous tokens, such as `:`, go unnoticed because kind matchers cannot name them.
  invalid: {
    rule: {
      any: [
        { kind: "ERROR" },
        {
          any: ["block", "identifier", "string_start", "string_end"].map((kind) => ({ kind })),
          regex: "^$",
        },
        {
          any: [
            "parameters",
            "argument_list",
            "parenthesized_expression",
            "generator_expression",
            "tuple",
            "list",
            "list_comprehension",
            "subscript",
            "dictionary",
            "dictionary_comprehension",
            "set",
            "set_comprehension",
          ].map((kind) => ({ kind })),
          not: { regex: "[)\\]}]$" },
        },
      ],
    },
  },
  function: { rule: { kind: "function_definition", has: { field: "name", pattern: "$NAME" } } },
  class: { rule: { kind: "class_definition", has: { field: "name", pattern: "$NAME" } } },
  parameter: {
    rule: {
      any: [
        "identifier",
        "list_splat_pattern",
        "dictionary_splat_pattern",
        "keyword_separator",
        "positional_separator",
        "tuple_pattern",
      ].map((kind) => ({ kind })),
      ...PARAMETER_PARENT,
    },
  },
  typed_parameter: { rule: { kind: "typed_parameter", ...PARAMETER_PARENT } },
  default_parameter: { rule: { kind: "default_parameter", ...PARAMETER_PARENT } },
  typed_default_parameter: { rule: { kind: "typed_default_parameter", ...PARAMETER_PARENT } },
  parameter_name: {
    rule: {
      any: [
        {
          any: ["identifier", "list_splat_pattern", "dictionary_splat_pattern"].map((kind) => ({
            kind,
          })),
          inside: { kind: "typed_parameter" },
        },
        {
          kind: "identifier",
          inside: {
            any: [{ kind: "default_parameter" }, { kind: "typed_default_parameter" }],
            field: "name",
          },
        },
      ],
    },
  },
  parameter_type: {
    rule: {
      kind: "type",
      inside: {
        any: [{ kind: "typed_parameter" }, { kind: "typed_default_parameter" }],
        field: "type",
      },
    },
  },
  return_type: {
    rule: { kind: "type", inside: { kind: "function_definition", field: "return_type" } },
  },
  docstring_part: {
    utils: {
      docstring_statement: {
        kind: "expression_statement",
        nthChild: { position: 1, ofRule: { not: { kind: "comment" } } },
        not: { has: { nthChild: 2 } },
        any: [
          { inside: { kind: "block", inside: { ...DEFINITION, field: "body" } } },
          { inside: { kind: "module" } },
        ],
      },
    },
    rule: {
      kind: "string",
      any: [
        { inside: { matches: "docstring_statement" } },
        { inside: { kind: "concatenated_string", inside: { matches: "docstring_statement" } } },
      ],
    },
  },
}).map(([id, config]) => ({ id: `pydoc.${id}`, language: "python", ...config }));

/** Reports parser recovery explicitly instead of presenting incomplete documentation as complete. */
export function pythonFileReport(report: FileReport, matches: AstGrepMatch[]): FileReport {
  if (matches.some((match) => match.rule === "pydoc.invalid")) {
    return { ...report, parseError: "invalid syntax" };
  }
  const topLevel = matches.filter((match) => match.parent === null);
  return {
    ...report,
    fileDocstring: docstring(topLevel),
    functions: topLevel.filter((match) => match.rule === "pydoc.function").map(functionReport),
    classes: topLevel.filter((match) => match.rule === "pydoc.class").map(classReport),
  };
}

/** Definitions nest by range, which keeps declaration ownership tied to syntax parents, including decorated and conditionally defined members. */
function functionReport(definition: AstGrepMatch): FunctionReport {
  const children = definition.children;
  return {
    name: definition.name,
    lineno: definition.startLine + 1,
    inputs:
      children
        .map(formatParameter)
        .filter((parameter) => parameter !== null)
        .join(", ") || "none",
    outputs: children.find((child) => child.rule === "pydoc.return_type")?.text ?? "unannotated",
    docstring: docstring(children),
    nestedFunctions: children
      .filter((child) => child.rule === "pydoc.function")
      .map(functionReport),
  };
}

function classReport(definition: AstGrepMatch): ClassReport {
  const children = definition.children;
  return {
    name: definition.name,
    lineno: definition.startLine + 1,
    docstring: docstring(children),
    methods: children.filter((child) => child.rule === "pydoc.function").map(functionReport),
    nestedClasses: children.filter((child) => child.rule === "pydoc.class").map(classReport),
  };
}

/** Formats syntax fields separately so annotation and default delimiters cannot be mistaken for argument separators; null for a match that is not a parameter. */
function formatParameter(parameter: AstGrepMatch): string | null {
  const part = (rule: string) => parameter.children.find((child) => child.rule === rule);
  switch (parameter.rule) {
    case "pydoc.parameter":
      return parameter.text;
    case "pydoc.typed_parameter":
      return `${part("pydoc.parameter_name")?.text ?? ""}: ${part("pydoc.parameter_type")?.text ?? ""}`;
    case "pydoc.default_parameter": {
      const name = part("pydoc.parameter_name");
      return `${name?.text ?? ""} = ${defaultValue(parameter, name)}`;
    }
    case "pydoc.typed_default_parameter": {
      const annotation = part("pydoc.parameter_type");
      return `${part("pydoc.parameter_name")?.text ?? ""}: ${annotation?.text ?? ""} = ${defaultValue(parameter, annotation)}`;
    }
    default:
      return null;
  }
}

/** The default is the parameter's text after the part before `=`: `a: int = 1` with the annotation `int` → `1`. Offsets are bytes, so the slice runs on UTF-8. */
function defaultValue(parameter: AstGrepMatch, before: AstGrepMatch | undefined): string {
  const tail = Buffer.from(parameter.text, "utf8")
    .subarray((before?.end ?? parameter.start) - parameter.start)
    .toString("utf8");
  return tail.replace(/^\s*=\s*/, "");
}

/** Reads only a leading constant string expression, preserving source text and excluding executable interpolation and bytes; null without one. */
function docstring(siblings: AstGrepMatch[]): string | null {
  const literals = siblings.filter((match) => match.rule === "pydoc.docstring_part");
  if (literals.length === 0) {
    return null;
  }
  const parts: string[] = [];
  for (const literal of literals) {
    const quotes = /^([A-Za-z]*)("""|'''|"|')/.exec(literal.text);
    if (quotes === null || !/^[ru]?$/i.test(quotes[1]!) || !literal.text.endsWith(quotes[2]!)) {
      return null;
    }
    parts.push(literal.text.slice(quotes[0].length, -quotes[2]!.length));
  }
  return cleanDocstring(parts.join(""));
}

/** Trims blank edge lines and the indentation shared by every non-blank line: `"\n    a\n      b\n"` → `"a\n  b"`. */
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
