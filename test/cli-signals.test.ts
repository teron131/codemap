/** Checks signals CLI JSON output on a small fixture project. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderSignalText } from "../src/codemap/source/signals/index.js";
import { buildLightweightSignalPayload } from "../src/codemap/source/signals/lightweight.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
  workDir = path.join(workspaceRoot, "test", ".work", `cli-signals-${process.pid}-${Date.now()}`);
  mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("signals CLI", () => {
  it("prints a concise note for sparse top signals", () => {
    const output = renderSignalText(
      {
        functionMetrics: [],
        functionsByMentions: [],
        variablesByNameLength: [],
      },
      "top",
    );

    expect(output).toContain("No ranked source rows.");
    expect(output).not.toContain("## Function Metrics");
    expect(output).not.toContain("## Functions by Mentions");
    expect(output).not.toContain("## Variables by Name Length");
  });

  it("labels local function metrics by the ordering actually available", () => {
    const output = renderSignalText(
      {
        freshness: "degraded",
        functionMetrics: [
          {
            name: "localWorkflow",
            path: "src/app.ts",
            lines: 40,
            mentions: 1,
          },
        ],
        functionsByMentions: [],
        variablesByNameLength: [],
      },
      "top",
    );

    expect(output).toContain("## Function Metrics (length, then fewest mentions)");
    expect(output).not.toContain("cognitive, cyclomatic");
  });

  it("explains when bounded signals skip backend enrichment", () => {
    const output = renderSignalText(
      {
        backendStatus: "skipped",
        backendReason: "eligible source files exceed 10000",
        coverage: {
          mode: "bounded",
          eligibleFiles: 14_071,
          parsedFiles: 100,
        },
        functionMetrics: [],
        functionsByMentions: [],
        variablesByNameLength: [],
      },
      "top",
    );

    expect(output).toContain("backend: skipped");
    expect(output).toContain("backend reason: eligible source files exceed 10000");
    expect(output).toContain("coverage: bounded current tree; parsed=100, eligible=14071");
  });

  it("globally orders detailed function rows across languages", () => {
    const output = renderSignalText(
      {
        functions: {
          byLength: {
            python: [definitionRow("pythonShort", 4, 3)],
            typescript: [definitionRow("typescriptLong", 20, 2)],
          },
          byMentions: {
            python: [definitionRow("pythonFrequent", 4, 5)],
            typescript: [definitionRow("typescriptRare", 20, 1)],
          },
        },
      },
      "functions",
    );
    const byLength = output.slice(
      output.indexOf("## Functions by Length"),
      output.indexOf("## Functions by Mentions"),
    );
    const byMentions = output.slice(output.indexOf("## Functions by Mentions"));

    expect(byLength.indexOf("typescriptLong")).toBeLessThan(byLength.indexOf("pythonShort"));
    expect(byMentions.indexOf("typescriptRare")).toBeLessThan(byMentions.indexOf("pythonFrequent"));
  });

  it("renders complete docstring rows before the shared output boundary", () => {
    const output = renderSignalText(
      {
        docstrings: {
          files: 21,
          typescript_files: 21,
          python_files: 0,
          functions: 9,
          class_methods: 0,
          classes: 0,
          file_reports: Array.from({ length: 21 }, (_, index) => ({
            file: `src/file${index}.ts`,
            file_docstring_preview: `File ${index}.`,
            functions:
              index === 0
                ? Array.from({ length: 9 }, (_, functionIndex) => ({
                    qualified_name: `fn${functionIndex}`,
                    line: functionIndex + 1,
                    docstring_preview: `Function ${functionIndex}.`,
                  }))
                : [],
            classes: [],
          })),
        },
      },
      "docstrings",
    );

    expect(output).toContain("## Docstring Files");
    expect(output).toContain("src/file20.ts");
    expect(output).toContain("fn8");
    expect(output).not.toContain("more files");
    expect(output).not.toContain("more functions");
  });

  it("filters tests, bundles, and non-source files in lightweight signal rows", () => {
    const payload = buildLightweightSignalPayload(
      [
        scanEntry("src/app.ts", "typescript", 30),
        scanEntry("src/app.test.ts", "typescript", 500),
        scanEntry("libs/standard-tests/chat_models.py", "python", 700),
        scanEntry("libs/langchain-core/src/load/import_map.ts", "typescript", 1000),
        scanEntry("src/a2ui.bundle.js", "javascript", 900),
        scanEntry("src/styles.css", "css", 800),
        scanEntry("src/worker.py", "python", 40),
      ],
      { includeTests: false },
    );

    expect(fileRows(payload)).toEqual(["src/worker.py", "src/app.ts"]);
    expect(payload.coverage).toEqual({
      mode: "bounded",
      eligibleFiles: 2,
      parsedFiles: 0,
    });
    expect(firstDenseRow(payload).total_label).toBe("lines");
    const output = renderSignalText(payload.top as Record<string, unknown>, "top");
    expect(output).toContain("coverage: bounded current tree; parsed=0, eligible=2");
    expect(output).toContain("No ranked source rows.");

    const withTests = buildLightweightSignalPayload(
      [scanEntry("src/app.ts", "typescript", 30), scanEntry("src/app.test.ts", "typescript", 500)],
      { includeTests: true },
    );

    expect(fileRows(withTests)).toEqual(["src/app.test.ts", "src/app.ts"]);
  });

  it("enriches top lightweight rows with bounded syntax details", () => {
    writeFileSync(
      path.join(workDir, "src", "large.ts"),
      [
        "import { helper } from './small';",
        "",
        "export function runLarge() {",
        "  return helper();",
        "}",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "small.ts"),
      "export function helper() { return 'ok'; }\n",
      "utf8",
    );

    const payload = buildLightweightSignalPayload(
      [scanEntry("src/large.ts", "typescript", 500), scanEntry("src/small.ts", "typescript", 20)],
      { root: workDir },
    );
    const first = firstDenseRow(payload);

    expect(first).toMatchObject({
      file: "src/large.ts",
      total: 500,
      total_label: "lines",
      lines: 500,
      defines: 1,
      imports_local: 1,
      exports: 1,
    });
    expect(first.samples).toEqual(expect.arrayContaining(["runLarge"]));
    expect(payload.top).toMatchObject({
      coverage: {
        mode: "bounded",
        eligibleFiles: 2,
        parsedFiles: 2,
      },
      functionMetrics: expect.arrayContaining([
        expect.objectContaining({
          name: "runLarge",
          path: "src/large.ts",
        }),
      ]),
    });
    expect(renderSignalText(payload.top as Record<string, unknown>, "top")).toContain(
      "## Function Metrics (length)",
    );
  });

  it("prints selected signal payload JSON", () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "/** App docs. */",
        "export function run(value: string) {",
        "  return helper(value);",
        "}",
        "function helper(value: string) {",
        "  return value;",
        "}",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(path.join(workDir, "src", "load"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "load", "import_map.ts"),
      ["export const importMap = {", "  alpha: () => import('../app'),", "};"].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/codemap/cli.ts",
        "signals",
        "--project-root",
        workDir,
        "--json",
        "files",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      files: [
        {
          file: "src/app.ts",
          total: 3,
          lines: 7,
          defines: 2,
          imports_local: 0,
          exports: 1,
          reexports_local: 0,
          extends: 0,
          inherits: 0,
          jsx_components: 0,
          decorators: 0,
          samples: ["run", "helper"],
        },
      ],
    });
  });

  it("omits duplicate top projections from the all-section payload", () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "export function run(value: string) {",
        "  return helper(value);",
        "}",
        "function helper(value: string) {",
        "  return value;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "src/codemap/cli.ts", "signals", "--project-root", workDir, "--json", "all"],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).not.toHaveProperty("top");
    expect(payload).toHaveProperty("functionMetrics");
    expect(payload.functions.byMentions.typescript).toHaveLength(2);
    expect(payload.variables).toHaveProperty("byNameLength");
  });

  it("prints compact docstring signal text", () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "/** App module docs. */",
        "",
        "/** Runs the command flow. */",
        "export function run(value: string) {",
        "  return value;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/codemap/cli.ts",
        "signals",
        "--project-root",
        workDir,
        "docstring-signals",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("# Docstring Signals");
    expect(result.stdout).toContain("- file docstrings: 1/1");
    expect(result.stdout).toContain("- src/app.ts: App module docs.");
    expect(result.stdout).toContain("- src/app.ts:4 run: Runs the command flow.");
  });

  it("prints full docstring payload JSON", () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "/** App module docs. */",
        "",
        "/** Runs the command flow. */",
        "export function run(value: string) {",
        "  return value;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/codemap/cli.ts",
        "signals",
        "--project-root",
        workDir,
        "--json",
        "docstrings",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload.docstrings).toMatchObject({
      files: 1,
      typescript_files: 1,
      file_reports: [
        {
          file: "src/app.ts",
          file_docstring_preview: "App module docs.",
          functions: [
            {
              name: "run",
              docstring_preview: "Runs the command flow.",
            },
          ],
        },
      ],
    });
  });

  it("ranks all functions by mentions without labeling candidates", () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "/** Exercises neutral function ranking. */",
        "function shortOnce(value: string) {",
        "  return value.trim();",
        "}",
        "export function seriousOnce(value: string) {",
        "  const first = value.trim();",
        "  const second = first.toLowerCase();",
        "  const third = second.replaceAll('-', ' ');",
        "  const fourth = third.split(' ');",
        "  const fifth = fourth.filter(Boolean);",
        "  const sixth = fifth.join(' ');",
        "  return sixth;",
        "}",
        "function shared(value: string) {",
        "  return value;",
        "}",
        "shared('first');",
        "shared('second');",
      ].join("\n"),
      "utf8",
    );

    expect(functionNamesByMentions(signalTopJson())).toEqual([
      "shortOnce",
      "seriousOnce",
      "shared",
    ]);
  });

  it("applies one final JSON budget after building complete top buckets", () => {
    const functionBlocks = Array.from({ length: 400 }, (_, idx) =>
      [`function candidate${idx}(value: string) {`, "  return value.trim();", "}"].join("\n"),
    ).join("\n\n");
    const variableRows = Array.from(
      { length: 400 },
      (_, idx) => `const candidateVariableIdentifierForLengthRanking${idx} = ${idx};`,
    ).join("\n");
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      `${functionBlocks}\n\n${variableRows}`,
      "utf8",
    );
    mkdirSync(path.join(workDir, "src", "load"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "load", "import_map.ts"),
      ["export const importMap = {", "  alpha: () => import('../app'),", "};"].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "src/codemap/cli.ts", "signals", "--project-root", workDir, "--json", "top"],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      freshness: "degraded",
    });
    expect(payload.functionMetrics.length).toBeGreaterThan(20);
    expect(payload.functionsByMentions.length).toBeGreaterThan(20);
    expect(payload.variablesByNameLength.length).toBeGreaterThan(20);
    expect(payload.functionMetrics.length).toBeLessThan(400);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(30_000);
    expect(result.stderr).toContain("codemap: output truncated:");
    expect(
      new Set(payload.functionsByMentions.map((row: Record<string, unknown>) => row.name)).size,
    ).toBe(payload.functionsByMentions.length);
    expect(
      new Set(payload.variablesByNameLength.map((row: Record<string, unknown>) => row.name)).size,
    ).toBe(payload.variablesByNameLength.length);
    const output = renderSignalText(payload, "top");
    expect(output).toContain(payload.functionsByMentions[0].name);
    expect(output).toContain(payload.functionsByMentions.at(-1).name);
    expect(output).toContain(payload.variablesByNameLength[0].name);
    expect(output).toContain(payload.variablesByNameLength.at(-1).name);
    expect(output).not.toContain("should");
  });

  it("ranks all variable names while keeping tests opt-in", () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "export const sourceIdentifierNameForLengthRanking = 1;",
        "export const PORTFOLIO_NEWS_SUMMARY_RESPONSE_TICKER = 1;",
        "export const PortfolioNewsSummaryResponseTickerSchema = 1;",
        "export function readSourceIdentifierName() {",
        "  return sourceIdentifierNameForLengthRanking;",
        "}",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "app.test.ts"),
      [
        "const testOnlyIdentifierNameForLengthRanking = 1;",
        "export function readTestOnlyIdentifierName() {",
        "  return testOnlyIdentifierNameForLengthRanking;",
        "}",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(path.join(workDir, "src", "generated"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "generated", "api.ts"),
      [
        "export const generatedOnlyIdentifierNameForLengthRanking = 1;",
        "export function generatedOnlyFunction() {",
        "  return generatedOnlyIdentifierNameForLengthRanking;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const defaultPayload = signalTopJson();
    const defaultNames = variableNamesByLength(defaultPayload);
    expect(defaultNames).toContain("sourceIdentifierNameForLengthRanking");
    expect(defaultNames).toContain("PORTFOLIO_NEWS_SUMMARY_RESPONSE_TICKER");
    expect(defaultNames).toContain("PortfolioNewsSummaryResponseTickerSchema");
    expect(defaultNames).not.toContain("testOnlyIdentifierNameForLengthRanking");
    expect(defaultNames).not.toContain("generatedOnlyIdentifierNameForLengthRanking");
    expect(functionNamesByMentions(defaultPayload)).not.toContain("generatedOnlyFunction");

    const withTestsNames = variableNamesByLength(signalTopJson("--include-tests"));
    expect(withTestsNames).toContain("testOnlyIdentifierNameForLengthRanking");
  });
});

function scanEntry(pathValue: string, language: string, sizeLines: number) {
  return {
    path: pathValue,
    language,
    fileCategory: "code",
    sizeLines,
  };
}

function definitionRow(name: string, lines: number, count: number) {
  return {
    name,
    identifier: `src/${name}.ts::${name}`,
    file: `src/${name}.ts`,
    lines,
    count,
  };
}

function fileRows(payload: Record<string, unknown>): string[] {
  return (payload.files as Array<Record<string, unknown>>).map((row) => String(row.file));
}

function firstDenseRow(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.files as Array<Record<string, unknown>>)[0] ?? {};
}

function signalTopJson(...args: string[]): Record<string, unknown> {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "src/codemap/cli.ts",
      "signals",
      "--project-root",
      workDir,
      "--json",
      ...args,
      "top",
    ],
    { cwd: workspaceRoot, encoding: "utf8" },
  );

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function variableNamesByLength(payload: Record<string, unknown>): string[] {
  return (payload.variablesByNameLength as Array<Record<string, unknown>>).map((row) =>
    String(row.name),
  );
}

function functionNamesByMentions(payload: Record<string, unknown>): string[] {
  return (payload.functionsByMentions as Array<Record<string, unknown>>).map((row) =>
    String(row.name),
  );
}
