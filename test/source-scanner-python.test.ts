/** Checks Python scanner edge cases. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runImportMap, scanEntry } from "../src/codemap/source/extraction/index.js";
import { scanFile, scanPythonFile } from "../src/codemap/source/scanner/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `source-scanner-python-${process.pid}-${Date.now()}`,
  );
  mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("Python scanner", () => {
  it("uses syntax for multiline imports, nested binders, and call ownership", () => {
    const file = path.join(workDir, "main.py");
    writeFileSync(
      file,
      [
        "from .helper import (",
        "    helper as execute,",
        ")",
        "left, (middle, right) = values",
        'EXAMPLE = """def fabricated():',
        '    helper()"""',
        "def run(value):",
        '    example = "helper()"',
        "    # helper(value)",
        "    def nested():",
        "        return execute(value)",
        "    return nested()",
      ].join("\n"),
    );
    const helper = path.join(workDir, "helper.py");
    writeFileSync(helper, "def helper(value): return value\n");
    const metrics = scanPythonFile(file, { relPath: "main.py" });
    expect(metrics.functionNames).toEqual(["run", "nested"]);
    expect(metrics.variableNames).toEqual(
      expect.arrayContaining(["left", "middle", "right", "EXAMPLE", "example"]),
    );
    expect(metrics.variableNames).not.toContain("value");
    expect(metrics.callSites).toEqual([
      { caller: "nested", callee: "execute", lineNumber: 11 },
      { caller: "run", callee: "nested", lineNumber: 12 },
    ]);
    expect(
      runImportMap(workDir, [scanEntry(workDir, file), scanEntry(workDir, helper)]).importMap[
        "main.py"
      ],
    ).toEqual(["helper.py"]);
  });
  it("uses supplied source for one scan without caching it across later scans", () => {
    const filePath = path.join(workDir, "api.py");
    writeFileSync(filePath, "def disk_version():\n    pass\n");
    const options = { displayRoot: workDir };

    expect(
      scanFile(filePath, { ...options, source: "def snapshot_version():\n    pass\n" })
        .functionNames,
    ).toEqual(["snapshot_version"]);
    expect(scanFile(filePath, { ...options, source: "" }).functionNames).toEqual([]);
    expect(scanFile(filePath, options).functionNames).toEqual(["disk_version"]);
  });

  it("keeps overload stubs separate from the implementation span", () => {
    const filePath = path.join(workDir, "api.py");
    writeFileSync(
      filePath,
      [
        "from typing import overload",
        "",
        "@overload",
        "def build(value: str) -> str: ...",
        "",
        "@overload",
        "def build(",
        "    value: int,",
        ") -> int: ...",
        "",
        "def build(value):",
        "    marker = ':'",
        "    return value",
      ].join("\n"),
      "utf8",
    );

    const metrics = scanPythonFile(filePath, { relPath: "api.py" });
    const spans = metrics.functionSpans
      .filter((span) => span.name === "build")
      .map((span) => span.span);

    expect(spans).toEqual([1, 3, 3]);
  });
});
