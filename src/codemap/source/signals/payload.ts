/** Builds JSON signal payload sections for CLI output. */
import { describeNumbers } from "../../math-utils.js";
import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../scanner/index.js";
import { isGeneratedSignalPath, isTestPath } from "./policy.js";
import type { FunctionLengthSection, LanguageRows, SignalRow } from "./schema.js";

const STRUCTURAL_SUFFIXES = new Set([...PY_SUFFIXES, ...TYPESCRIPT_SUFFIXES]);

type SignalExport = {
  sections?: Record<string, unknown>;
};

type Row = SignalRow;

/** Selects and shapes signal sections for JSON output. */
export function buildSignalPayload(
  signalExport: SignalExport,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  const sections = recordValue(signalExport.sections);
  const usage = recordValue(sections.usage_signals);
  const usageTables = recordValue(usage.tables);
  const functionLengths = recordValue(sections.function_lengths);
  const fileRows = fileScopedRows(arrayValue(sections.file_profiles), {
    includeTests,
  }).filter((row) => isStructuralFileRow(row));

  const lengthRows = {
    python: lengthSection(recordValue(functionLengths.python), {
      includeTests,
    }),
    typescript: lengthSection(recordValue(functionLengths.typescript), {
      includeTests,
    }),
  };
  const functions = functionPayload(usageTables, { includeTests });
  const variables = variablePayload(usageTables, { includeTests });
  const payload: Record<string, unknown> = {
    relationships: sections.relationships ?? {},
    files: fileRows,
    lengths: lengthRows,
    usage: { bins: recordValue(usage.bins) },
    functions,
    variables,
  };
  if ("docstring_signals" in sections) {
    payload.docstring_signals = sections.docstring_signals ?? {};
  }

  const functionRows = languageRows(recordValue(functions.byMentions));
  const variableRows = arrayValue(variables.byNameLength);
  const stats = {
    source: "currentTree",
    ...(functionRows.length === 0
      ? {}
      : {
          functions: {
            lines: describeNumbers(functionRows.map((row) => Number(row.lines))),
            mentions: describeNumbers(functionRows.map((row) => Number(row.count))),
          },
        }),
    ...(variableRows.length === 0
      ? {}
      : {
          variables: {
            characters: describeNumbers(variableRows.map((row) => String(row.name ?? "").length)),
            mentions: describeNumbers(variableRows.map((row) => Number(row.count))),
          },
        }),
  };
  return {
    stats,
    top: {
      functionMetrics: compactFunctionMetricRows(languageRows(recordValue(functions.byLength))),
      functionsByMentions: compactFunctionMentionRows(functionRows),
      variablesByNameLength: compactVariableNameLengthRows(variableRows),
    },
    ...payload,
  };
}

/** Builds JSON payload rows for function usage signals. */
function functionPayload(
  usageTables: Record<string, unknown>,
  { includeTests }: { includeTests: boolean },
): Record<string, LanguageRows> {
  const pythonDefinitions = fileScopedRows(arrayValue(usageTables.python_function_definitions), {
    includeTests,
  });
  const typescriptDefinitions = fileScopedRows(
    arrayValue(usageTables.typescript_function_definitions),
    { includeTests },
  );
  return {
    byLength: {
      python: rankFunctionRowsByLength(pythonDefinitions),
      typescript: rankFunctionRowsByLength(typescriptDefinitions),
    },
    byMentions: {
      python: rankDefinitionRowsByMentions(pythonDefinitions),
      typescript: rankDefinitionRowsByMentions(typescriptDefinitions),
    },
  };
}

/** Builds JSON payload rows for variable usage signals. */
function variablePayload(
  usageTables: Record<string, unknown>,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  const pythonDefinitions = fileScopedRows(arrayValue(usageTables.python_variable_definitions), {
    includeTests,
  });
  const typescriptDefinitions = fileScopedRows(
    arrayValue(usageTables.typescript_variable_definitions),
    { includeTests },
  );
  return {
    byMentions: {
      python: rankDefinitionRowsByMentions(pythonDefinitions),
      typescript: rankDefinitionRowsByMentions(typescriptDefinitions),
    },
    byNameLength: variableNameLengthRows([
      ...pythonDefinitions.map((row) => ({ language: "python", ...row })),
      ...typescriptDefinitions.map((row) => ({
        language: "typescript",
        ...row,
      })),
    ]),
  };
}

/** Checks whether a file row belongs to structural source. */
function isStructuralFileRow(row: Row): boolean {
  const filePath = rowFile(row);
  if (!filePath || filePath.endsWith("__init__.py")) {
    return false;
  }
  if (Number(row.total ?? 0) <= 0) {
    return false;
  }
  if (isGeneratedSignalPath(filePath)) {
    return false;
  }
  return [...STRUCTURAL_SUFFIXES].some((suffix) => filePath.endsWith(suffix));
}

/** Builds a table for the longest scanned code blocks. */
function lengthSection(
  section: Record<string, unknown>,
  { includeTests }: { includeTests: boolean },
): FunctionLengthSection<Row> {
  const rows = fileScopedRows(arrayValue(section.items), { includeTests });
  return {
    ...describeNumbers(rows.map((row) => Number(row.count ?? 0))),
    items: rows,
  };
}

/** Filters signal rows to one source file. */
function fileScopedRows(rows: Row[], { includeTests }: { includeTests: boolean }): Row[] {
  return rows.filter((row) => {
    const filePath = rowFile(row);
    return !isGeneratedSignalPath(filePath) && (includeTests || !isTestPath(filePath));
  });
}

/** Reads the source file path from a signal row. */
function rowFile(row: Row): string {
  const filePath = row.file;
  if (filePath) {
    return String(filePath);
  }
  const identifier = String(row.identifier ?? "");
  return identifier.split("::", 1)[0] ?? "";
}

/** Compacts locally ranked function metrics for backend fallback. */
function compactFunctionMetricRows(rows: Row[]): Row[] {
  return rankFunctionRowsByLength(rows).map((row) => ({
    name: String(row.name ?? ""),
    path: String(row.file ?? ""),
    ...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
    lines: Number(row.lines ?? 0),
    mentions: Number(row.count ?? 0),
    ...(row.exported === true ? { exported: true } : {}),
  }));
}

/** Compacts functions already ranked by mentions and then length. */
function compactFunctionMentionRows(rows: Row[]): Row[] {
  return rankDefinitionRowsByMentions(rows).map((row) => ({
    name: String(row.name ?? ""),
    path: String(row.file ?? ""),
    ...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
    lines: Number(row.lines ?? 0),
    mentions: Number(row.count ?? 0),
    ...(row.exported === true ? { exported: true } : {}),
  }));
}

/** Sorts variable definitions by identifier length and then mentions. */
function variableNameLengthRows(rows: Row[]): Row[] {
  return rows
    .slice()
    .sort(
      (left, right) =>
        String(right.name ?? "").length - String(left.name ?? "").length ||
        Number(left.count ?? 0) - Number(right.count ?? 0) ||
        compareText(String(left.identifier ?? ""), String(right.identifier ?? "")),
    );
}

/** Compacts variable-name rows to location and measured facts. */
function compactVariableNameLengthRows(rows: Row[]): Row[] {
  return rows.map((row) => ({
    name: String(row.name ?? ""),
    path: String(row.file ?? ""),
    ...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
    characters: String(row.name ?? "").length,
    mentions: Number(row.count ?? 0),
  }));
}

/** Builds language-specific payload rows from signal sections. */
export function languageRows(payload: Record<string, unknown>): Row[] {
  const rows: Row[] = [];
  for (const language of ["python", "typescript"]) {
    for (const row of arrayValue(payload[language])) {
      rows.push({ language, ...row });
    }
  }
  return rows;
}

/** Orders function definitions by length, mentions, and stable identity. */
export function rankFunctionRowsByLength(rows: Row[]): Row[] {
  return rows
    .slice()
    .sort(
      (left, right) =>
        Number(right.lines ?? 0) - Number(left.lines ?? 0) ||
        Number(left.count ?? 0) - Number(right.count ?? 0) ||
        compareText(
          String(left.identifier ?? left.name ?? ""),
          String(right.identifier ?? right.name ?? ""),
        ),
    );
}

/** Orders definitions by mentions, shorter span, and stable identity. */
export function rankDefinitionRowsByMentions(rows: Row[]): Row[] {
  return rows
    .slice()
    .sort(
      (left, right) =>
        Number(left.count ?? 0) - Number(right.count ?? 0) ||
        Number(left.lines ?? 0) - Number(right.lines ?? 0) ||
        compareText(
          String(left.identifier ?? left.name ?? ""),
          String(right.identifier ?? right.name ?? ""),
        ),
    );
}

/** Selects one signal payload section by CLI section name. */
export function selectPayloadSection(
  payload: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  if (section === "all") {
    return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "top"));
  }
  if (section === "top") {
    const stats = recordValue(payload.stats);
    const coverage = recordValue(payload.coverage);
    return {
      ...(Object.keys(stats).length === 0 ? {} : { stats }),
      ...(Object.keys(coverage).length === 0 ? {} : { coverage }),
      ...recordValue(payload.top),
    };
  }
  const key = payloadKeyForSection(section);
  const coverage = recordValue(payload.coverage);
  return {
    ...(Object.keys(coverage).length === 0 ? {} : { coverage }),
    [key]: payload[key] ?? {},
  };
}

/** Maps CLI section names to payload field names. */
function payloadKeyForSection(section: string): string {
  if (section === "docstring-signals") {
    return "docstring_signals";
  }
  return section;
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
