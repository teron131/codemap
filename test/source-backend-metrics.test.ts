/** Checks how Codebase Memory definition rows become per-file records for languages the working-tree scanner cannot parse. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backendDefinitionsQuery,
  backendFileMetrics,
  backendOnlyLanguages,
} from "../src/codemap/source/extraction/index.js";

let workDir: string;

beforeEach(() => {
  workDir = path.join(
    process.cwd(),
    "test",
    ".work",
    `backend-metrics-${process.pid}-${Date.now()}`,
  );
  for (const file of ["cmd/run.go", "cmd/run_test.go", "src/app.ts", "Cargo.toml"]) {
    mkdirSync(path.dirname(path.join(workDir, file)), { recursive: true });
    writeFileSync(path.join(workDir, file), "\n");
  }
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function row(label: string, name: string, filePath: string, start: number, end: number) {
  return {
    label: `["${label}"]`,
    name,
    file_path: filePath,
    start_line: String(start),
    end_line: String(end),
    is_test: "false",
  };
}

describe("backend file metrics", () => {
  it("keeps definitions only for existing code files the scanner cannot parse", () => {
    const files = backendFileMetrics(
      workDir,
      [
        row("Function", "Run", "cmd/run.go", 3, 9),
        row("Struct", "Options", "cmd/run.go", 11, 14),
        row("Function", "TestRun", "cmd/run_test.go", 5, 8),
        { ...row("Function", "inlineTest", "cmd/run.go", 20, 22), is_test: "true" },
        row("Function", "app", "src/app.ts", 1, 3),
        row("Class", "package", "Cargo.toml", 1, 4),
        row("Function", "len", "<python-builtins>", 1, 1),
      ],
      { includeTests: false },
    );

    expect(files.map((file) => file.relPath)).toEqual(["cmd/run.go"]);
    expect(files[0]?.functionSpans).toEqual([
      { name: "Run", identifier: "cmd/run.go::Run", span: 7, startLine: 3 },
    ]);
    expect(files[0]?.classSpans).toEqual([{ name: "Options", span: 4, startLine: 11 }]);
  });

  it("keeps test definitions when asked, for inspecting a test file", () => {
    const files = backendFileMetrics(
      workDir,
      [row("Function", "TestRun", "cmd/run_test.go", 5, 8)],
      { includeTests: true },
    );

    expect(files.map((file) => file.relPath)).toEqual(["cmd/run_test.go"]);
  });

  it("asks only for definitions outside the scanner's languages, narrowed to one file on request", () => {
    expect(backendDefinitionsQuery(null)).toContain("NOT (d.file_path ENDS WITH '.py' OR");
    expect(backendDefinitionsQuery("cmd/run.go")).toContain('AND d.file_path = "cmd/run.go"');
  });

  it("names the languages of paths the scanner cannot parse", () => {
    expect(backendOnlyLanguages(["src/app.ts", "cmd/run.go", "lib/a.rs", "Makefile"])).toEqual([
      "go",
      "rust",
      "unsuffixed files",
    ]);
  });
});
