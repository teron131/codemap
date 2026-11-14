/** Checks Python scanning of multiline imports, nested binders, call ownership, overload stubs, and supplied source. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runImportMap } from "../src/codemap/source/extraction/index.js";
import { inventoryEntry } from "../src/codemap/source/extraction/inventory.js";
import { scanFile } from "../src/codemap/source/scanner/index.js";

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
    const metrics = scanFile(file, { displayRoot: workDir });
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
      runImportMap(workDir, [inventoryEntry(workDir, file), inventoryEntry(workDir, helper)])
        .importMap["main.py"],
    ).toEqual(["helper.py"]);
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

    const metrics = scanFile(filePath, { displayRoot: workDir });
    const spans = metrics.functionSpans
      .filter((span) => span.name === "build")
      .map((span) => span.span);

    expect(spans).toEqual([1, 3, 3]);
  });
});
