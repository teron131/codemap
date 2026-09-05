/** Checks TypeScript-family scanner edge cases. */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectReports } from "../src/codemap/source/docstrings/index.js";
import { runImportMap, scanEntry } from "../src/codemap/source/extraction/index.js";
import { classifyTags } from "../src/codemap/source/graph/index.js";
import { scanFile, scanTypescriptFile } from "../src/codemap/source/scanner/index.js";

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
  it("uses supplied source for one scan without caching it across later scans", () => {
    const filePath = path.join(workDir, "api.ts");
    writeFileSync(filePath, "export function diskVersion() {}\n");
    const options = { displayRoot: workDir };

    expect(
      scanFile(filePath, { ...options, source: "export function snapshotVersion() {}\n" })
        .functionNames,
    ).toEqual(["snapshotVersion"]);
    expect(scanFile(filePath, { ...options, source: "" }).functionNames).toEqual([]);
    expect(scanFile(filePath, options).functionNames).toEqual(["diskVersion"]);
  });

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
    const files = writeResolutionSources([
      ["src/main.mts", "import './worker.js';\n"],
      ["src/worker.cts", "export const worker = true;\n"],
      ["src/loader.cjs", "import './feature';\n"],
      ["src/feature.mjs", "export const feature = true;\n"],
    ]);

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

  it("resolves inherited JSONC aliases relative to their declaring config", () => {
    const files = writeResolutionSources([
      ["src/main.ts", "import { value } from '@/feature.js';"],
      ["src/feature.ts", "export const value = true;"],
    ]);
    mkdirSync(path.join(workDir, "config"));
    writeFileSync(
      path.join(workDir, "config", "base.json"),
      '{"compilerOptions":{"baseUrl":"..","paths":{"@/*":["src/*"]}}}',
    );
    writeFileSync(
      path.join(workDir, "tsconfig.json"),
      '{\n// project configuration\n"extends":"./config/base.json",\n}',
    );
    expect(runImportMap(workDir, files).importMap["src/main.ts"]).toEqual(["src/feature.ts"]);
  });

  it("uses nested project configs and refreshes their aliases on the next operation", () => {
    const files = writeResolutionSources([
      ["packages/app/src/main.ts", "import '@/value';"],
      ["packages/app/src/first.ts", "export const value = 1;"],
      ["packages/app/src/second.ts", "export const value = 2;"],
    ]);
    const config = path.join(workDir, "packages", "app", "tsconfig.json");
    writeFileSync(
      config,
      '{"compilerOptions":{"baseUrl":".","paths":{"@/value":["src/first.ts"]}}}',
    );
    expect(runImportMap(workDir, files).importMap["packages/app/src/main.ts"]).toEqual([
      "packages/app/src/first.ts",
    ]);
    writeFileSync(
      config,
      '{"compilerOptions":{"baseUrl":".","paths":{"@/value":["src/second.ts"]}}}',
    );
    expect(runImportMap(workDir, files).importMap["packages/app/src/main.ts"]).toEqual([
      "packages/app/src/second.ts",
    ]);
  });

  it("resolves import and require exports of the same workspace package separately", () => {
    const files = writeResolutionSources([
      [
        "src/main.ts",
        "import value from 'library';\nconst other = require('library');\nimport 'external';",
      ],
      ["packages/library/import.ts", "export default true;"],
      ["packages/library/require.cts", "module.exports = true;"],
    ]);
    writeFileSync(
      path.join(workDir, "packages", "library", "package.json"),
      '{"name":"library","exports":{"import":"./import.ts","require":"./require.cts"}}',
    );
    mkdirSync(path.join(workDir, "node_modules", "external"), { recursive: true });
    symlinkSync(
      path.join(workDir, "packages", "library"),
      path.join(workDir, "node_modules", "library"),
    );
    writeFileSync(
      path.join(workDir, "node_modules", "external", "index.js"),
      "module.exports = true;",
    );
    expect(runImportMap(workDir, files).importMap["src/main.ts"]).toEqual([
      "packages/library/import.ts",
      "packages/library/require.cts",
    ]);
  });

  it("keeps relative source edges when an inherited config is unavailable", () => {
    const files = writeResolutionSources([
      ["src/main.ts", "import './feature.js';"],
      ["src/feature.ts", "export const feature = true;"],
    ]);
    writeFileSync(path.join(workDir, "tsconfig.json"), '{"extends":"missing-config/base.json"}');
    expect(runImportMap(workDir, files).importMap["src/main.ts"]).toEqual(["src/feature.ts"]);
  });
});

/** Creates a source inventory without treating dependency files as inspected project code. */
function writeResolutionSources(rows: Array<[string, string]>) {
  return rows.map(([relative, source]) => {
    const file = path.join(workDir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
    return scanEntry(workDir, file);
  });
}
