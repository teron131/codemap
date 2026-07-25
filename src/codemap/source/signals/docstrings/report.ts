/** Builds docstring signal reports and previews for supported source files. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { discoverFiles, relativePath } from "../../scanner/index.js";
import {
  type ClassReport,
  DOCSTRING_SUFFIXES,
  type FileReport,
  type FunctionReport,
  LIKELY_MAIN_FUNCTION_NAMES,
  LIKELY_MAIN_FUNCTION_PREFIXES,
  PYTHON_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "./models.js";
import { buildPythonFileReport } from "./python.js";
import { buildTypescriptFileReport } from "./typescript.js";

type FunctionPayload = {
  name: string;
  qualified_name: string;
  line: number;
  inputs: string;
  outputs: string;
  docstring: string | null;
  docstring_preview: string;
  nested_functions: FunctionPayload[];
};

type ClassPayload = {
  name: string;
  qualified_name: string;
  line: number;
  docstring: string | null;
  docstring_preview: string;
  methods: FunctionPayload[];
  nested_classes: ClassPayload[];
};

type FileReportPayload = {
  file: string;
  suffix: string;
  parse_error: string | null;
  file_docstring: string | null;
  file_docstring_preview: string;
  functions: FunctionPayload[];
  classes: ClassPayload[];
};

export type DocstringsData = {
  files: number;
  python_files: number;
  typescript_files: number;
  functions: number;
  class_methods: number;
  classes: number;
  file_reports: FileReportPayload[];
};

export type FilePreview = {
  file: string;
  preview: string;
};

export type SymbolDocstringKind = "class" | "function";

export type DocstringSignals = {
  files_considered: number;
  python_files_considered: number;
  typescript_files_considered: number;
  file_docstrings: {
    present: number;
    total: number;
  };
  file_docstring_previews: FilePreview[];
  likely_main_function_docstrings: Array<{
    file: string;
    qualified_name: string;
    line: number;
    inputs: string;
    outputs: string;
    docstring_preview: string;
  }>;
};

/** Finds Python and TypeScript-family files supported by docstring reports. */
export function collectSupportedFiles(targetPath: string): string[] {
  if (isFile(targetPath)) {
    return DOCSTRING_SUFFIXES.has(path.extname(targetPath)) ? [targetPath] : [];
  }
  return discoverFiles(targetPath).filter((filePath) =>
    DOCSTRING_SUFFIXES.has(path.extname(filePath)),
  );
}

/** Formats a path for docstring report display. */
export function displayPath(filePath: string, { displayRoot }: { displayRoot: string }): string {
  return relativePath(filePath, { displayRoot });
}

/** Builds a compact preview from one file docstring. */
export function docstringPreview(
  docstring: string | null,
  { fallback = "none", maxLength = 120 }: { fallback?: string; maxLength?: number } = {},
): string {
  if (!docstring) {
    return fallback;
  }
  const firstLine = docstring
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return fallback;
  }
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return `${firstLine.slice(0, maxLength - 3).trimEnd()}...`;
}

/** Orders docstring focus paths before broad report files. */
export function resolveFocusPathsInOrder(
  focusFiles: string[],
  { moduleRoot }: { moduleRoot: string },
): string[] {
  return focusFiles.map((rawFocusPath) =>
    path.isAbsolute(rawFocusPath) ? rawFocusPath : path.resolve(moduleRoot, rawFocusPath),
  );
}

/** Chooses docstring reports matching requested focus paths. */
export function selectReports(
  reports: FileReport[],
  { focusFiles, moduleRoot }: { focusFiles: string[]; moduleRoot: string },
): FileReport[] {
  const focusPaths = resolveFocusPathsInOrder(focusFiles, { moduleRoot });
  if (focusPaths.length === 0) {
    return reports;
  }
  const byPath = new Map(reports.map((report) => [report.path, report]));
  return focusPaths
    .map((focusPath) => byPath.get(focusPath))
    .filter((report): report is FileReport => report !== undefined);
}

/** Ranks functions for docstring signal selection. */
export function functionPriority(report: FunctionReport): [number, number, number] {
  const loweredName = report.name.toLowerCase();
  const hasDocstring = report.docstring ? 0 : 1;
  const isDunder = loweredName.startsWith("__") && loweredName.endsWith("__") ? 1 : 0;
  let publicRank = 2;
  if (LIKELY_MAIN_FUNCTION_NAMES.includes(loweredName as never)) {
    publicRank = 0;
  } else if (LIKELY_MAIN_FUNCTION_PREFIXES.some((prefix) => loweredName.startsWith(prefix))) {
    publicRank = 1;
  } else if (loweredName.startsWith("_")) {
    publicRank = 3;
  }
  return [hasDocstring, isDunder, publicRank];
}

/** Selects functions that need useful docstrings most. */
export function functionSignalCandidates(
  report: FunctionReport,
  { ownerName = null }: { ownerName?: string | null } = {},
): Array<[string, FunctionReport]> {
  const qualifiedName = ownerName === null ? report.name : `${ownerName}.${report.name}`;
  const candidates: Array<[string, FunctionReport]> = [[qualifiedName, report]];
  for (const nestedReport of report.nestedFunctions) {
    candidates.push(
      ...functionSignalCandidates(nestedReport, {
        ownerName: qualifiedName,
      }),
    );
  }
  return candidates;
}

/** Collects functions that should appear in docstring signal output. */
export function collectSignalFunctions(report: FileReport): Array<[string, FunctionReport]> {
  const candidates: Array<[string, FunctionReport]> = [];
  for (const functionReport of report.functions) {
    candidates.push(...functionSignalCandidates(functionReport));
  }
  for (const classReport of report.classes) {
    for (const methodReport of classReport.methods) {
      candidates.push(
        ...functionSignalCandidates(methodReport, {
          ownerName: classReport.name,
        }),
      );
    }
  }
  return candidates.sort((left, right) => {
    const leftPriority = functionPriority(left[1]);
    const rightPriority = functionPriority(right[1]);
    for (let index = 0; index < leftPriority.length; index += 1) {
      const diff = (leftPriority[index] ?? 0) - (rightPriority[index] ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return left[1].lineno - right[1].lineno;
  });
}

/** Serializes a function docstring report for JSON output. */
export function functionToDict(
  report: FunctionReport,
  { qualifiedName = null }: { qualifiedName?: string | null } = {},
): FunctionPayload {
  const currentName = qualifiedName ?? report.name;
  return {
    name: report.name,
    qualified_name: currentName,
    line: report.lineno,
    inputs: report.inputs,
    outputs: report.outputs,
    docstring: report.docstring,
    docstring_preview: docstringPreview(report.docstring),
    nested_functions: report.nestedFunctions.map((nestedReport) =>
      functionToDict(nestedReport, {
        qualifiedName: `${currentName}.${nestedReport.name}`,
      }),
    ),
  };
}

/** Serializes a class docstring report for JSON output. */
export function classToDict(
  report: ClassReport,
  { qualifiedName = null }: { qualifiedName?: string | null } = {},
): ClassPayload {
  const currentName = qualifiedName ?? report.name;
  return {
    name: report.name,
    qualified_name: currentName,
    line: report.lineno,
    docstring: report.docstring,
    docstring_preview: docstringPreview(report.docstring),
    methods: report.methods.map((methodReport) =>
      functionToDict(methodReport, {
        qualifiedName: `${currentName}.${methodReport.name}`,
      }),
    ),
    nested_classes: report.nestedClasses.map((nestedClass) =>
      classToDict(nestedClass, {
        qualifiedName: `${currentName}.${nestedClass.name}`,
      }),
    ),
  };
}

/** Counts function reports including nested functions. */
export function countFunctions(functions: FunctionReport[]): number {
  return functions.reduce((total, report) => total + 1 + countFunctions(report.nestedFunctions), 0);
}

/** Counts methods nested under class docstring reports. */
export function countClassMethods(classes: ClassReport[]): number {
  return classes.reduce(
    (total, classReport) =>
      total + countFunctions(classReport.methods) + countClassMethods(classReport.nestedClasses),
    0,
  );
}

/** Counts class reports including nested classes. */
export function countClasses(classes: ClassReport[]): number {
  return classes.reduce(
    (total, classReport) => total + 1 + countClasses(classReport.nestedClasses),
    0,
  );
}

/** Filters requested docstring focus paths to supported source files. */
export function supportedFocusPaths(paths: string[]): string[] {
  return paths.filter(
    (filePath) => isFile(filePath) && DOCSTRING_SUFFIXES.has(path.extname(filePath)),
  );
}

/** Builds docstring file reports for supported source files. */
export function collectReports(
  targetPath: string,
  { focusFiles = null }: { focusFiles?: string[] | null } = {},
): [string, FileReport[]] {
  const moduleRoot = isDir(targetPath) ? targetPath : path.dirname(targetPath);
  const supportedFiles =
    focusFiles !== null && focusFiles.length > 0
      ? supportedFocusPaths(resolveFocusPathsInOrder(focusFiles, { moduleRoot }))
      : collectSupportedFiles(targetPath);

  const reports: FileReport[] = [];
  for (const filePath of supportedFiles) {
    const shownPath = displayPath(filePath, { displayRoot: moduleRoot });
    if (PYTHON_SUFFIXES.has(path.extname(filePath))) {
      reports.push(buildPythonFileReport(filePath, { displayPath: shownPath }));
    } else {
      reports.push(buildTypescriptFileReport(filePath, { displayPath: shownPath }));
    }
  }
  return [moduleRoot, reports];
}

/** Finds one symbol docstring in a supported source file report. */
export function docstringForSymbol(
  filePath: string,
  {
    displayPath,
    kind,
    name,
    line = 0,
  }: {
    displayPath: string;
    kind: SymbolDocstringKind;
    name: string;
    line?: number;
  },
): string | null {
  const suffix = path.extname(filePath);
  if (!DOCSTRING_SUFFIXES.has(suffix)) {
    return null;
  }
  const report = PYTHON_SUFFIXES.has(suffix)
    ? buildPythonFileReport(filePath, { displayPath })
    : buildTypescriptFileReport(filePath, { displayPath });
  if (kind === "class") {
    return matchingClassDocstring(report.classes, name, line);
  }
  return matchingFunctionDocstring(report.functions, name, line);
}

/** Finds a function docstring by name with line-number disambiguation. */
function matchingFunctionDocstring(
  reports: FunctionReport[],
  name: string,
  line: number,
): string | null {
  for (const report of reports) {
    if (report.name === name && (line <= 0 || report.lineno === line)) {
      return report.docstring;
    }
    const nested = matchingFunctionDocstring(report.nestedFunctions, name, line);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

/** Finds a class or method docstring by name with line-number disambiguation. */
function matchingClassDocstring(reports: ClassReport[], name: string, line: number): string | null {
  for (const report of reports) {
    if (report.name === name && (line <= 0 || report.lineno === line)) {
      return report.docstring;
    }
    const nested = matchingClassDocstring(report.nestedClasses, name, line);
    if (nested !== null) {
      return nested;
    }
    const method = matchingFunctionDocstring(report.methods, name, line);
    if (method !== null) {
      return method;
    }
  }
  return null;
}

/** Collects full docstring report data for a target path. */
export function buildDocstringsData(targetPath: string): DocstringsData {
  const [, reports] = collectReports(targetPath);
  const pythonFiles = reports.filter((report) =>
    PYTHON_SUFFIXES.has(path.extname(report.path)),
  ).length;
  const typescriptFiles = reports.filter((report) =>
    TYPESCRIPT_SUFFIXES.has(path.extname(report.path)),
  ).length;
  return {
    files: reports.length,
    python_files: pythonFiles,
    typescript_files: typescriptFiles,
    functions: reports.reduce((total, report) => total + countFunctions(report.functions), 0),
    class_methods: reports.reduce((total, report) => total + countClassMethods(report.classes), 0),
    classes: reports.reduce((total, report) => total + countClasses(report.classes), 0),
    file_reports: reports.map((report) => ({
      file: report.displayPath,
      suffix: path.extname(report.path),
      parse_error: report.parseError,
      file_docstring: report.fileDocstring,
      file_docstring_preview: docstringPreview(report.fileDocstring),
      functions: report.functions.map((functionReport) => functionToDict(functionReport)),
      classes: report.classes.map((classReport) => classToDict(classReport)),
    })),
  };
}

/** Builds docstring preview text keyed by display file path. */
export function buildFilePreviews(
  targetPath: string,
  { focusFiles, maxFiles = 0 }: { focusFiles: string[]; maxFiles?: number },
): FilePreview[] {
  const [moduleRoot, reports] = collectReports(targetPath, { focusFiles });
  const focusedReports = selectReports(reports, { focusFiles, moduleRoot });
  const shownReports = maxFiles <= 0 ? focusedReports : focusedReports.slice(0, maxFiles);
  return shownReports.map((report) => ({
    file: report.displayPath,
    preview: docstringPreview(report.fileDocstring),
  }));
}

/** Builds docstring coverage summaries for selected source files. */
export function buildDocstringSignals(
  targetPath: string,
  {
    focusFiles,
    maxFiles = 3,
    maxFunctions = 6,
  }: { focusFiles: string[]; maxFiles?: number; maxFunctions?: number },
): DocstringSignals {
  const [moduleRoot, reports] = collectReports(targetPath, { focusFiles });
  const focusedReports = selectReports(reports, { focusFiles, moduleRoot });
  const pythonFiles = focusedReports.filter((report) =>
    PYTHON_SUFFIXES.has(path.extname(report.path)),
  ).length;
  const typescriptFiles = focusedReports.filter((report) =>
    TYPESCRIPT_SUFFIXES.has(path.extname(report.path)),
  ).length;
  const fileDocstringCount = focusedReports.filter((report) => report.fileDocstring).length;
  const shownReports = maxFiles <= 0 ? focusedReports : focusedReports.slice(0, maxFiles);

  const functionItems: DocstringSignals["likely_main_function_docstrings"] = [];
  let remainingFunctionSlots = maxFunctions;
  for (const report of shownReports) {
    for (const [qualifiedName, functionReport] of collectSignalFunctions(report)) {
      if (remainingFunctionSlots === 0) {
        break;
      }
      functionItems.push({
        file: report.displayPath,
        qualified_name: qualifiedName,
        line: functionReport.lineno,
        inputs: functionReport.inputs,
        outputs: functionReport.outputs,
        docstring_preview: docstringPreview(functionReport.docstring),
      });
      remainingFunctionSlots -= 1;
    }
    if (remainingFunctionSlots === 0) {
      break;
    }
  }

  return {
    files_considered: focusedReports.length,
    python_files_considered: pythonFiles,
    typescript_files_considered: typescriptFiles,
    file_docstrings: {
      present: fileDocstringCount,
      total: focusedReports.length,
    },
    file_docstring_previews: shownReports.map((report) => ({
      file: report.displayPath,
      preview: docstringPreview(report.fileDocstring),
    })),
    likely_main_function_docstrings: functionItems,
  };
}

/** Checks whether a path exists and is a file. */
function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}

/** Checks whether a path exists and is a directory. */
function isDir(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}
