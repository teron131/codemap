/** Shapes the working-tree signal sections into the payload both `--json` and text output render. It filters test and generated rows and fixes each ranking's order. */
import { arrayValue, recordValue } from "../json-utils.js";
import { describeNumbers } from "../math-utils.js";
import {
  isGeneratedPath,
  isTestPath,
  PYTHON_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import type { SignalSections } from "./build.js";
import type { FunctionLengthSection, LanguageRows, SignalRow, UsageSection } from "./schema.js";

const STRUCTURAL_SUFFIXES = new Set([...PYTHON_SUFFIXES, ...TYPESCRIPT_SUFFIXES]);

type Row = SignalRow;

export function buildSignalPayload(
  sections: SignalSections,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  const fileRows = fileScopedRows(sections.fileProfiles ?? [], { includeTests }).filter((row) =>
    isStructuralFileRow(row),
  );
  const functions = functionPayload(sections.usage?.tables, { includeTests });
  const variables = variablePayload(sections.usage?.tables, { includeTests });
  const payload: Record<string, unknown> = {
    relationships: sections.relationships ?? {},
    files: fileRows,
    lengths: {
      python: lengthSection(sections.functionLengths?.python, { includeTests }),
      typescript: lengthSection(sections.functionLengths?.typescript, { includeTests }),
    },
    usage: { bins: sections.usage?.bins ?? {} },
    functions,
    variables,
  };
  if (sections.docstringSignals !== undefined) {
    payload.docstring_signals = sections.docstringSignals;
  }

  const functionRows = languageRows(recordValue(functions.byMentions));
  const variableRows = arrayValue<Row>(variables.byNameLength);
  const stats = {
    source: "workingTree",
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
            nameLength: describeNumbers(variableRows.map((row) => String(row.name ?? "").length)),
            mentions: describeNumbers(variableRows.map((row) => Number(row.count))),
          },
        }),
  };
  return {
    stats,
    top: {
      functionMetrics: compactFunctionRows(
        rankFunctionRowsByLength(languageRows(recordValue(functions.byLength))),
      ),
      functionsByMentions: compactFunctionRows(rankDefinitionRowsByMentions(functionRows)),
      variablesByNameLength: compactVariableNameLengthRows(variableRows),
    },
    ...payload,
  };
}

function functionPayload(
  tables: UsageSection["tables"] | undefined,
  { includeTests }: { includeTests: boolean },
): Record<string, LanguageRows> {
  const pythonDefinitions = fileScopedRows(tables?.python_function_definitions ?? [], {
    includeTests,
  });
  const typescriptDefinitions = fileScopedRows(tables?.typescript_function_definitions ?? [], {
    includeTests,
  });
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

function variablePayload(
  tables: UsageSection["tables"] | undefined,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  const pythonDefinitions = fileScopedRows(tables?.python_variable_definitions ?? [], {
    includeTests,
  });
  const typescriptDefinitions = fileScopedRows(tables?.typescript_variable_definitions ?? [], {
    includeTests,
  });
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

function isStructuralFileRow(row: Row): boolean {
  const filePath = rowFile(row);
  if (!filePath || filePath.endsWith("__init__.py")) {
    return false;
  }
  if (Number(row.total ?? 0) <= 0) {
    return false;
  }
  if (isGeneratedPath(filePath)) {
    return false;
  }
  return [...STRUCTURAL_SUFFIXES].some((suffix) => filePath.endsWith(suffix));
}

/** Recomputes statistics after filtering, so they describe only the rows that survive test and generated filtering. */
function lengthSection(
  section: FunctionLengthSection | undefined,
  { includeTests }: { includeTests: boolean },
): FunctionLengthSection<Row> {
  const rows = fileScopedRows(section?.items ?? [], { includeTests });
  return {
    ...describeNumbers(rows.map((row) => Number(row.count ?? 0))),
    items: rows,
  };
}

function fileScopedRows(rows: Row[], { includeTests }: { includeTests: boolean }): Row[] {
  return rows.filter((row) => {
    const filePath = rowFile(row);
    return !isGeneratedPath(filePath) && (includeTests || !isTestPath(filePath));
  });
}

/** Falls back to the `path::name` identifier: `src/app.ts::run` → `src/app.ts`. */
function rowFile(row: Row): string {
  const filePath = row.file;
  if (filePath) {
    return String(filePath);
  }
  const identifier = String(row.identifier ?? "");
  return identifier.split("::", 1)[0] ?? "";
}

/** Projects either function ranking to the same location and measurement contract. */
function compactFunctionRows(rows: Row[]): Row[] {
  return rows.map((row) => ({
    name: String(row.name ?? ""),
    path: String(row.file ?? ""),
    ...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
    lines: Number(row.lines ?? 0),
    mentions: Number(row.count ?? 0),
    ...(row.exported === true ? { exported: true } : {}),
  }));
}

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

function compactVariableNameLengthRows(rows: Row[]): Row[] {
  return rows.map((row) => ({
    name: String(row.name ?? ""),
    path: String(row.file ?? ""),
    ...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
    nameLength: String(row.name ?? "").length,
    mentions: Number(row.count ?? 0),
  }));
}

/** Flattens `{ python, typescript }` row lists into one list, tagging each row with its language. */
export function languageRows(payload: Record<string, unknown>): Row[] {
  const rows: Row[] = [];
  for (const language of ["python", "typescript"]) {
    for (const row of arrayValue<Row>(payload[language])) {
      rows.push({ language, ...row });
    }
  }
  return rows;
}

/** Longest first, then fewest mentions. */
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

/** Fewest mentions first, then shortest. */
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

/** `top` flattens `stats`, `coverage`, and the top rows into one object, `all` returns everything but `top`, and other sections return `coverage` beside that one section. */
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
  const key = section === "docstring-signals" ? "docstring_signals" : section;
  const coverage = recordValue(payload.coverage);
  return {
    ...(Object.keys(coverage).length === 0 ? {} : { coverage }),
    [key]: payload[key] ?? {},
  };
}
