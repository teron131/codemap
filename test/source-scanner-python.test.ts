/** Checks Python scanner edge cases. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanPythonFile } from "../src/codemap/source/scanner/index.js";

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
