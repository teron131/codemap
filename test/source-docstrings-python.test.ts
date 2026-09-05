/** Verifies Python documentation as consumed by inspection and normalized report output. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDocstringsData,
  collectReports,
  docstringForSymbol,
} from "../src/codemap/source/docstrings/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `python-docstrings-${process.pid}-${Date.now()}`,
  );
  mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("Python documentation reports", () => {
  it("retains multiline async signatures and documentation around comments and delimiters", () => {
    const report = reportFor(
      [
        "@decorator",
        "async def execute(",
        "    value: str,  # caller input",
        "    /,",
        '    mode: Literal["a:=b"] = "):#",',
        "    *args: str,",
        "    **kwargs: int,",
        ") -> tuple[str, int]:",
        "    # Documentation is still the first statement.",
        '    """Execute one registered tool."""',
        "    return value, len(args)",
      ].join("\n"),
    );

    expect(report.parseError).toBeNull();
    expect(report.functions).toMatchObject([
      {
        name: "execute",
        lineno: 2,
        inputs: 'value: str, /, mode: Literal["a:=b"] = "):#", *args: str, **kwargs: int',
        outputs: "tuple[str, int]",
        docstring: "Execute one registered tool.",
      },
    ]);
  });

  it("keeps methods, nested functions, and nested classes with their lexical owner", () => {
    const report = reportFor(
      [
        "class Runner(",
        "    object,",
        "):",
        '    """Run registered tools."""',
        "    @staticmethod",
        "    def run(",
        "        value: str,",
        "    ) -> str:",
        '        """Run one value."""',
        "        def normalize(",
        "            text: str,",
        "        ):",
        '            """Normalize input."""',
        "            return text.strip()",
        "        return normalize(value)",
        "    class Options:",
        '        """Configure a run."""',
        "        def enabled(self):",
        '            """Check availability."""',
        "            return True",
        "",
        "def outside():",
        '    """Remain at module scope."""',
        "    return True",
      ].join("\n"),
    );

    expect(report.parseError).toBeNull();
    expect(report.functions.map((item) => item.name)).toEqual(["outside"]);
    expect(report.classes).toMatchObject([
      {
        name: "Runner",
        lineno: 1,
        docstring: "Run registered tools.",
        methods: [
          {
            name: "run",
            lineno: 6,
            docstring: "Run one value.",
            nestedFunctions: [{ name: "normalize", lineno: 10, docstring: "Normalize input." }],
          },
        ],
        nestedClasses: [
          {
            name: "Options",
            methods: [{ name: "enabled", docstring: "Check availability." }],
          },
        ],
      },
    ]);
    const payload = buildDocstringsData(path.join(workDir, "sample.py"));
    expect(
      payload.file_reports[0]?.classes[0]?.methods[0]?.nested_functions[0]?.qualified_name,
    ).toBe("Runner.run.normalize");
    expect(
      docstringForSymbol(report.path, {
        displayPath: "sample.py",
        kind: "function",
        name: "run",
        line: 6,
      }),
    ).toBe("Run one value.");
    expect(
      docstringForSymbol(report.path, {
        displayPath: "sample.py",
        kind: "function",
        name: "enabled",
        line: 18,
      }),
    ).toBe("Check availability.");
  });

  it("does not turn examples inside strings into declarations or syntax errors", () => {
    const report = reportFor(
      [
        "#!/usr/bin/env python",
        "# Module preamble.",
        '"""Explain syntax examples.',
        "def not_python(:",
        '"""',
        'EXAMPLE = """',
        "class Fake:",
        "    def fabricated(): pass",
        '"""',
        "def actual():",
        '    """The actual function."""',
        "    return EXAMPLE",
      ].join("\n"),
    );

    expect(report.parseError).toBeNull();
    expect(report.fileDocstring).toContain("Explain syntax examples.");
    expect(report.functions.map((item) => item.name)).toEqual(["actual"]);
    expect(report.classes).toEqual([]);
  });

  it.each([
    ['"One line."', "One line."],
    ['r"""Raw documentation."""', "Raw documentation."],
    ['"Joined " "documentation."', "Joined documentation."],
    ['f"Not a docstring."', null],
    ['b"Not a docstring."', null],
    ['value = 1; "Not the first statement."', null],
  ])("recognizes documentation only from a leading constant string: %s", (body, expected) => {
    const report = reportFor(`def run(): ${body}; return True\n`);
    expect(report.parseError).toBeNull();
    expect(report.functions[0]?.docstring).toBe(expected);
  });

  it.each([
    "def broken(:\n    pass",
    "def missing_body():",
    "def missing_colon()\n    pass",
    "def broken_body():\n    return (1 +",
  ])("reports syntax recovery instead of claiming a complete report: %s", (source) => {
    const report = reportFor(source);
    expect(report.parseError).toBe("invalid syntax");
    expect(report.functions).toEqual([]);
    expect(report.classes).toEqual([]);
  });

  it.each(["", "\n", "# Only a comment.\n"])("accepts an empty module: %j", (source) => {
    const report = reportFor(source);
    expect(report.parseError).toBeNull();
    expect(report.functions).toEqual([]);
  });
});

/** Exercises the supported report collection boundary for one current source file. */
function reportFor(source: string) {
  const filePath = path.join(workDir, "sample.py");
  writeFileSync(filePath, source);
  const [, reports] = collectReports(filePath);
  expect(reports).toHaveLength(1);
  return reports[0]!;
}
