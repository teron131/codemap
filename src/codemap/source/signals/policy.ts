/** Defines signal output policy, limits, and shared path predicates. */
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

export const SIGNAL_OUTPUT_ROW_LIMIT = 50;
export const SIGNAL_TOP_ROW_LIMIT = 20;

const TEST_DIR_NAMES = new Set([
  "__specs__",
  "__test__",
  "__tests__",
  "spec",
  "specs",
  "test",
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
    name.includes("_spec.") ||
    name.includes(".spec.")
  );
}

/** Checks whether a source path is likely generated or bundled output. */
export function isGeneratedSignalPath(filePath: string): boolean {
  const parts = pathParts(filePath);
  const name = parts.at(-1) ?? "";
  return (
    name.includes(".bundle.") ||
    name.includes(".min.") ||
    name === "import_map.py" ||
    name === "import_map.ts" ||
    parts.some((part) => GENERATED_DIR_NAMES.has(part))
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
    part.endsWith("-test") ||
    part.endsWith("-tests") ||
    part.endsWith("_test") ||
    part.endsWith("_tests")
  );
}
