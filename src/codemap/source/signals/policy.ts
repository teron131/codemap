/** Defines signal output policy, limits, and shared path predicates. */
import path from "node:path";

import {
  IGNORED_DIR_NAMES,
  KEPT_HIDDEN_DIR_NAMES,
  PY_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";

export const SIGNAL_SECTION_CHOICES = [
  "all",
  "top",
  "relationships",
  "files",
  "lengths",
  "functions",
  "variables",
  "usage",
  "docstring-signals",
  "docstrings",
] as const;

const TEST_DIR_NAMES = new Set([
  "__specs__",
  "__test__",
  "__tests__",
  "e2e",
  "spec",
  "specs",
  "test",
  "test-support",
  "test_support",
  "tests",
]);
const GENERATED_DIR_NAMES = new Set(["__generated__", ".generated", "generated"]);

/** Checks whether a path looks like test code. */
export function isTestPath(filePath: string): boolean {
  const parts = pathParts(filePath);
  const name = parts.at(-1) ?? filePath;
  return (
    parts.some(isTestDirectoryName) ||
    name.startsWith("test_") ||
    name.includes("_test.") ||
    name.includes(".test.") ||
    name.includes("_test-") ||
    name.includes(".test-") ||
    name.includes("_spec.") ||
    name.includes(".spec.") ||
    name.includes("_suite.") ||
    name.includes(".suite.")
  );
}

/** Checks whether a source path is likely generated or bundled output. */
export function isGeneratedSignalPath(filePath: string): boolean {
  const parts = pathParts(filePath);
  const name = parts.at(-1) ?? "";
  return (
    name.includes(".bundle.") ||
    name.includes(".generated.") ||
    name.includes(".min.") ||
    name === "import_map.py" ||
    name === "import_map.ts" ||
    parts.some((part) => GENERATED_DIR_NAMES.has(part))
  );
}

/** Checks whether a backend path belongs to the same source surface as current-tree signals. */
export function isSupportedSignalPath(filePath: string): boolean {
  const parts = pathParts(filePath);
  const directories = parts.slice(0, -1);
  const suffix = path.extname(parts.at(-1) ?? "").toLowerCase();
  return (
    (PY_SUFFIXES.has(suffix) || TYPESCRIPT_SUFFIXES.has(suffix)) &&
    !directories.some(
      (directory) =>
        IGNORED_DIR_NAMES.has(directory) ||
        (directory.startsWith(".") && !KEPT_HIDDEN_DIR_NAMES.has(directory)),
    )
  );
}

/** Splits a path into lowercase path segments. */
function pathParts(filePath: string): string[] {
  return filePath
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

/** Checks whether one path segment conventionally names a test directory. */
function isTestDirectoryName(part: string): boolean {
  return (
    TEST_DIR_NAMES.has(part) ||
    part.startsWith("test-") ||
    part.startsWith("test_") ||
    part.endsWith("-test") ||
    part.endsWith("-tests") ||
    part.endsWith("_test") ||
    part.endsWith("_tests")
  );
}
