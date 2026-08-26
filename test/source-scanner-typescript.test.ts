/** Checks TypeScript-family scanner edge cases. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectReports } from "../src/codemap/source/docstrings/index.js";
import { runImportMap, scanEntry } from "../src/codemap/source/extraction/index.js";
import { classifyTags } from "../src/codemap/source/graph/index.js";
import { scanTypescriptFile } from "../src/codemap/source/scanner/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `source-scanner-typescript-${process.pid}-${Date.now()}`,
  );
  mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("TypeScript-family scanner", () => {
  it("labels JavaScript and TypeScript module suffixes", () => {
    for (const [suffix, language] of [
      [".mjs", "javascript"],
      [".cjs", "javascript"],
      [".mts", "typescript"],
      [".cts", "typescript"],
    ] as const) {
      const filePath = path.join(workDir, `module${suffix}`);
      writeFileSync(filePath, "export const value = 1;\n", "utf8");

      expect(scanEntry(workDir, filePath)).toMatchObject({
        path: `module${suffix}`,
        language,
        fileCategory: "code",
        sizeLines: 1,
      });
    }
  });

  it("tags module-suffix app entrypoints consistently", () => {
    for (const suffix of [".mjs", ".cjs", ".mts", ".cts"]) {
      expect(
        classifyTags({
          path: `src/app${suffix}`,
          language: "typescript",
          fileCategory: "code",
        }),
      ).toContain("entry-candidate");
    }
  });

  it("parses JavaScript and TypeScript module suffixes", () => {
    for (const suffix of [".mjs", ".cjs", ".mts", ".cts"]) {
      const filePath = path.join(workDir, `module${suffix}`);
      writeFileSync(
        filePath,
        [
          "import fs from 'node:fs';",
          "",
          "export function run(value) {",
          "  const normalized = String(value).trim();",
          "  return fs.existsSync(normalized);",
          "}",
        ].join("\n"),
        "utf8",
      );

      const metrics = scanTypescriptFile(filePath, {
        relPath: `module${suffix}`,
      });

      expect(metrics.lines).toBe(6);
      expect(metrics.importsLocal).toBe(0);
      expect(metrics.exports).toBe(1);
      expect(metrics.functionSpans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "run",
          }),
        ]),
      );
    }
  });

  it("records class methods as function-like definitions", () => {
    const filePath = path.join(workDir, "service.ts");
    writeFileSync(
      filePath,
      [
        "export class Service {",
        "  async createPinnedTarget() {",
        "    return true;",
        "  }",
        "}",
      ].join("\n"),
      "utf8",
    );

    const metrics = scanTypescriptFile(filePath, { relPath: "service.ts" });

    expect(metrics.functionNames).toContain("createPinnedTarget");
    expect(metrics.functionSpans).toContainEqual(
      expect.objectContaining({
        name: "createPinnedTarget",
        span: 3,
        startLine: 2,
      }),
    );
  });

  it("collects value, type, and aliased public export names", () => {
    const filePath = path.join(workDir, "surface.ts");
    writeFileSync(
      filePath,
      [
        "const internal = true;",
        "export interface Options { enabled: boolean }",
        "export type Result = { ok: boolean };",
        "export enum Mode { Fast }",
        "export class Runner {}",
        "export function run() { return internal; }",
        "export const version = '1';",
        "export const api = { run() { const nestedLocal = true; return nestedLocal; } };",
        "export { internal as publicFlag };",
      ].join("\n"),
      "utf8",
    );

    expect(scanTypescriptFile(filePath, { relPath: "surface.ts" }).exportedNames).toEqual([
      "Options",
      "Result",
      "Mode",
      "Runner",
      "run",
      "version",
      "api",
      "publicFlag",
    ]);
  });

  it("keeps public exports when a large source skips detailed AST metrics", () => {
    const filePath = path.join(workDir, "large-surface.ts");
    writeFileSync(
      filePath,
      `export const publicApi = true;\n/*${"x".repeat(256 * 1024)}*/\n`,
      "utf8",
    );

    expect(scanTypescriptFile(filePath, { relPath: "large-surface.ts" }).exportedNames).toEqual([
      "publicApi",
    ]);
  });

  it("resolves imports across JavaScript and TypeScript module suffixes", () => {
    const rows = [
      ["src/main.mts", "import './worker.js';\n"],
      ["src/worker.cts", "export const worker = true;\n"],
      ["src/loader.cjs", "import './feature';\n"],
      ["src/feature.mjs", "export const feature = true;\n"],
    ] as const;
    for (const [relativePath, source] of rows) {
      const filePath = path.join(workDir, relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source, "utf8");
    }
    const files = rows.map(([relativePath]) =>
      scanEntry(workDir, path.join(workDir, relativePath)),
    );

    expect(runImportMap(workDir, files).importMap).toMatchObject({
      "src/main.mts": ["src/worker.cts"],
      "src/loader.cjs": ["src/feature.mjs"],
    });
  });

  it("includes module suffixes in docstring reports", () => {
    const focusFiles = [".mjs", ".cjs", ".mts", ".cts"].map((suffix) => {
      const filePath = path.join(workDir, `documented${suffix}`);
      writeFileSync(
        filePath,
        "/** Module purpose. */\nexport function run() { return true; }\n",
        "utf8",
      );
      return filePath;
    });

    const [, reports] = collectReports(workDir, { focusFiles });
    expect(reports.map((report) => report.displayPath).sort()).toEqual(
      focusFiles.map((filePath) => path.basename(filePath)).sort(),
    );
  });
});
