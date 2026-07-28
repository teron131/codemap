/** Checks search command handler output and backend search fallback status. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildParser, commandSearch, dispatch } from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.exitCode = undefined;
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `commands-search-${process.pid}-${Date.now()}`,
  );
  mkdirSync(path.join(workDir, "src"), { recursive: true });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  vi.unstubAllEnvs();
  rmSync(workDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 10,
  });
});

describe("search command handler", () => {
  it("infers language for call search from target files", async () => {
    writeFileSync(
      path.join(workDir, "src", "calls.ts"),
      ["helper('one');", "const value = helper('two');", "const untouched = helper;"].join("\n"),
      "utf8",
    );

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "helper",
        "src/calls.ts",
      ]),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("src/calls.ts:1:1: helper('one')");
    expect(output).toContain("src/calls.ts:2:15: helper('two')");
    expect(output).not.toContain("const untouched = helper;");
  });

  it("marks hidden continuation lines in structural-search output", async () => {
    writeFileSync(
      path.join(workDir, "src", "calls.ts"),
      ["const value = 'visible';", "console.log(", "  value,", ");"].join("\n"),
      "utf8",
    );

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "console.log",
        "src/calls.ts",
      ]),
    ).resolves.toBe(0);

    expect(logLines()).toEqual(["src/calls.ts:2:1: console.log( ..."]);
  });

  it("keeps default call-site rows for the shared output boundary", async () => {
    writeFileSync(
      path.join(workDir, "src", "many-calls.ts"),
      Array.from({ length: 25 }, (_, index) => `helper(${index});`).join("\n"),
      "utf8",
    );

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "helper",
        "src/many-calls.ts",
      ]),
    ).resolves.toBe(0);

    const output = logLines();
    expect(output).toHaveLength(25);
    expect(output.at(-1)).toContain("helper(24)");
  });

  it("keeps call-site totals in JSON output", async () => {
    writeFileSync(
      path.join(workDir, "src", "many-calls.ts"),
      Array.from({ length: 25 }, (_, index) => `helper(${index});`).join("\n"),
      "utf8",
    );

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "--json",
        "helper",
        "src/many-calls.ts",
      ]),
    ).resolves.toBe(0);

    const payload = JSON.parse(logLines().join(""));
    expect(payload.total).toBe(25);
    expect(payload.matches).toHaveLength(25);
    expect(payload.matches[0]).toMatchObject({ engine: "ast-grep" });
  });

  it("applies one final text budget after collecting default call sites", () => {
    writeFileSync(
      path.join(workDir, "src", "many-calls.ts"),
      Array.from({ length: 1_200 }, (_, index) => `helper(${index});`).join("\n"),
      "utf8",
    );

    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/codemap/cli.ts",
        "search",
        "calls",
        "--project-root",
        workDir,
        "helper",
        "src/many-calls.ts",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(30_000);
    expect(result.stdout).toContain("helper(20)");
    expect(result.stdout).toContain("... output truncated:");
  });

  it("rejects nonpositive call-site limits", async () => {
    writeFileSync(path.join(workDir, "src", "calls.ts"), "helper('one');\n", "utf8");

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "--limit",
        "0",
        "helper",
        "src/calls.ts",
      ]),
    ).resolves.toBe(2);

    expect(logLines()).toEqual(["Call-site limit must be a positive integer."]);
  });

  it("infers call-search languages for cjs, mts, and cts files", async () => {
    for (const suffix of [".cjs", ".mts", ".cts"]) {
      const relativePath = `src/module${suffix}`;
      writeFileSync(
        path.join(workDir, relativePath),
        "export const value = helper('module');\n",
        "utf8",
      );

      await expect(
        dispatch(buildParser(), [
          "node",
          "codemap",
          "search",
          "calls",
          "--project-root",
          workDir,
          "helper",
          relativePath,
        ]),
      ).resolves.toBe(0);

      expect(logLines().join("\n")).toContain("helper('module')");
      logSpy.mockClear();
    }
  });

  it("labels Python regex fallback and keeps repeated same-line calls", async () => {
    writeFileSync(
      path.join(workDir, "src", "calls.py"),
      "def helper():\n    pass\n\nhelper(); helper()\n",
      "utf8",
    );
    vi.stubEnv("PATH", "");

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "--lang",
        "python",
        "helper",
        "src/calls.py",
      ]),
    ).resolves.toBe(0);

    const output = logLines();
    expect(output).toHaveLength(2);
    expect(output.every((line) => line.includes("[regex]"))).toBe(true);
    expect(output.some((line) => line.includes("def helper"))).toBe(false);
  });

  it("accepts cwd-relative call search target paths when project root is inferred", async () => {
    const cwd = process.cwd();
    const nestedDir = path.join(workDir, "src", "nested");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      path.join(nestedDir, "local.ts"),
      ["helper('one');", "const value = helper('two');", "const untouched = helper;"].join("\n"),
      "utf8",
    );

    try {
      process.chdir(nestedDir);
      await expect(
        dispatch(buildParser(), ["node", "codemap", "search", "calls", "helper", "local.ts"]),
      ).resolves.toBe(0);
    } finally {
      process.chdir(cwd);
    }

    const output = logLines().join("\n");
    expect(output).toContain("local.ts");
    expect(output).toContain("helper('one')");
    expect(output).toContain("helper('two')");
    expect(output).not.toContain("const untouched = helper;");
  });

  it("prints no matches for empty call search results", async () => {
    writeFileSync(path.join(workDir, "src", "calls.ts"), "const value = 1;\n");

    await expect(
      dispatch(buildParser(), [
        "node",
        "codemap",
        "search",
        "calls",
        "--project-root",
        workDir,
        "missingCall",
        "src/calls.ts",
      ]),
    ).resolves.toBe(1);

    expect(logLines()).toEqual(["No matches"]);
  });

  it("prints source matches and backend semantic fallback status", async () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      "export function needle() {\n  return 'needle';\n}\n",
      "utf8",
    );

    await expect(
      commandSearch(["needle"], {
        projectRoot: workDir,
        limit: "2",
        semantic: true,
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("Search: needle");
    expect(output).toContain("\nSource matches:");
    expect(output).toContain("[symbol]");
    expect(output).toContain("\nSemantic graph matches:");
    expect(output).toContain(
      "  unavailable: Codebase Memory semantic search returned no answer; used current-tree search fallback.",
    );
  });

  it("does not treat a bare symbol name as a file-path query", async () => {
    writeFileSync(
      path.join(workDir, "src", "client.ts"),
      "export const unrelated = true;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      "export function client() { return true; }\n",
      "utf8",
    );

    await expect(
      commandSearch(["client"], {
        projectRoot: workDir,
        limit: "2",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("src/app.ts");
    expect(output).toContain("[symbol]");
    expect(output).not.toContain("[file]");
  });

  it("resolves exact symbol intent to definitions before references", async () => {
    writeFileSync(
      path.join(workDir, "src", "consumer.ts"),
      "import { AgentTarget } from './target.js';\nexport const instance = new AgentTarget();\n",
      "utf8",
    );
    writeFileSync(path.join(workDir, "src", "target.ts"), "export class AgentTarget {}\n", "utf8");

    await expect(
      commandSearch(["AgentTarget"], {
        projectRoot: workDir,
        limit: "10",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("src/target.ts");
    expect(output).toContain("[symbol]");
    expect(output).not.toContain("src/consumer.ts");
  });

  it("keeps supported inferred languages when another language is unavailable", async () => {
    writeFileSync(path.join(workDir, "src", "mixed.ts"), "const value = true;\n", "utf8");
    writeFileSync(path.join(workDir, "src", "mixed.py"), "value = True\n", "utf8");
    vi.stubEnv("PATH", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        dispatch(buildParser(), [
          "node",
          "codemap",
          "search",
          "match",
          "--project-root",
          workDir,
          "--pattern",
          "const $A = $B",
          "src",
        ]),
      ).resolves.toBe(0);

      expect(logLines().join("\n")).toContain("src/mixed.ts");
      expect(errorSpy).toHaveBeenCalledWith("Unavailable syntax languages: python.");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports an unavailable rule engine instead of a valid empty result", async () => {
    writeFileSync(
      path.join(workDir, "python-rule.yml"),
      [
        "id: python-functions",
        "language: python",
        "rule:",
        "  any:",
        "    - kind: function_definition",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(path.join(workDir, "src", "rule.py"), "def run():\n    pass\n", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        dispatch(buildParser(), [
          "node",
          "codemap",
          "search",
          "rule",
          "--project-root",
          workDir,
          "--rule",
          "python-rule.yml",
          "src",
        ]),
      ).resolves.toBe(127);

      expect(logLines()).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith("Unavailable: ast-grep cannot run this rule language.");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects conflicting search lanes", async () => {
    await expect(
      commandSearch(["needle"], {
        projectRoot: workDir,
        graph: true,
        semantic: true,
      }),
    ).resolves.toBe(2);

    expect(logLines()).toEqual(["Choose only one search lane: --graph or --semantic."]);
  });

  it("rejects graph filters outside graph search", async () => {
    await expect(
      commandSearch(["needle"], {
        projectRoot: workDir,
        namePattern: "needle",
      }),
    ).resolves.toBe(2);

    expect(logLines()).toEqual(["Graph filters require --graph."]);
  });

  it("ignores browser profile data during default text search", async () => {
    mkdirSync(path.join(workDir, "user-data"), { recursive: true });
    writeFileSync(
      path.join(workDir, "user-data", "Local State"),
      '{"openclaw":"browser profile noise"}\n',
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      "export const openclawSource = 'openclaw source';\n",
      "utf8",
    );

    await expect(
      commandSearch(["openclaw"], {
        projectRoot: workDir,
        limit: "5",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("src/app.ts");
    expect(output).not.toContain("user-data");
    expect(output).not.toContain("Local State");
  });

  it("hides local test matches unless requested while preserving explicit test paths", async () => {
    mkdirSync(path.join(workDir, "test"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "feature.ts"),
      "export const searchPolicyNeedle = 'production';\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "test", "feature.test.ts"),
      "export const searchPolicyNeedle = 'test';\n",
      "utf8",
    );

    await expect(
      commandSearch(["searchPolicyNeedle"], {
        projectRoot: workDir,
        limit: "10",
      }),
    ).resolves.toBe(0);

    const defaultOutput = logLines().join("\n");
    expect(defaultOutput).toContain("src/feature.ts");
    expect(defaultOutput).not.toContain("test/feature.test.ts");

    logSpy.mockClear();

    await expect(
      commandSearch(["searchPolicyNeedle"], {
        includeTests: true,
        projectRoot: workDir,
        limit: "10",
      }),
    ).resolves.toBe(0);

    const includedOutput = logLines().join("\n");
    expect(includedOutput).toContain("src/feature.ts");
    expect(includedOutput).toContain("test/feature.test.ts");

    logSpy.mockClear();

    await expect(
      commandSearch(["test/feature.test.ts"], {
        projectRoot: workDir,
        limit: "10",
      }),
    ).resolves.toBe(0);

    expect(logLines().join("\n")).toContain("test/feature.test.ts [file]");
  });

  it("marks shortened local source excerpts", async () => {
    writeFileSync(
      path.join(workDir, "src", "long.ts"),
      `export const longSearchExcerpt = "${"source-evidence-".repeat(30)}";\n`,
      "utf8",
    );

    await expect(
      commandSearch(["longSearchExcerpt"], {
        projectRoot: workDir,
        limit: "2",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("src/long.ts");
    expect(output).toContain("...");
    expect(output).not.toContain("source-evidence-".repeat(30));
  });

  it("ranks concept matches by useful source-path affinity", async () => {
    mkdirSync(path.join(workDir, "src", "config"), { recursive: true });
    mkdirSync(path.join(workDir, "src", "talk"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "config", "types.ts"),
      "// Select the realtime voice provider.\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "talk", "provider-registry.ts"),
      "// Registry for each realtime voice provider.\n",
      "utf8",
    );

    await expect(
      commandSearch(["realtime", "voice", "provider"], {
        projectRoot: workDir,
        limit: "10",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output.indexOf("src/talk/provider-registry.ts")).toBeLessThan(
      output.indexOf("src/config/types.ts"),
    );
  });

  it("surfaces a concept owner path even when exact phrase matches exist elsewhere", async () => {
    mkdirSync(path.join(workDir, "src", "tools"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "tools", "registry.ts"),
      "export const registeredTools = new Map();\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "bootstrap.ts"),
      "// Initialize the tool registry before startup.\n",
      "utf8",
    );

    await expect(
      commandSearch(["tool", "registry"], {
        projectRoot: workDir,
        limit: "5",
      }),
    ).resolves.toBe(0);

    const output = logLines();
    expect(output).toContain("  - src/tools/registry.ts [file]");
    expect(output.indexOf("  - src/tools/registry.ts [file]")).toBeLessThan(
      output.findIndex((line) => line.includes("Initialize the tool registry")),
    );
  });

  it("ranks current concept matches before deprecated matches", async () => {
    writeFileSync(
      path.join(workDir, "src", "current.ts"),
      "// Current tool calling implementation.\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "legacy.ts"),
      "// Deprecated tool calling implementation.\n",
      "utf8",
    );

    await expect(
      commandSearch(["tool", "calling"], {
        projectRoot: workDir,
        limit: "10",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output.indexOf("src/current.ts")).toBeLessThan(output.indexOf("src/legacy.ts"));
  });

  it("ranks exact paths before suffix matches without expanding a target card", async () => {
    writeFileSync(path.join(workDir, "src", "client.ts"), "export const value = 1;\n", "utf8");
    mkdirSync(path.join(workDir, "nested", "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "nested", "src", "client.ts"),
      "export const nested = 1;\n",
      "utf8",
    );

    await expect(
      commandSearch(["src/client.ts"], {
        projectRoot: workDir,
        limit: "5",
      }),
    ).resolves.toBe(0);

    const outputLines = logLines();
    const output = outputLines.join("\n");
    expect(output).toContain("- src/client.ts [file]");
    expect(output).toContain("- nested/src/client.ts [file]");
    expect(outputLines.indexOf("  - src/client.ts [file]")).toBeLessThan(
      outputLines.indexOf("  - nested/src/client.ts [file]"),
    );
    expect(output).not.toContain("Focused target:");
  });

  it("matches Python's missing query message", async () => {
    await expect(commandSearch([], { projectRoot: workDir })).resolves.toBe(2);
    expect(logLines()).toEqual([
      "Search requires text or a search subcommand: match, calls, or rule.",
    ]);
  });

  it("prints partial fallback matches when the full phrase misses", async () => {
    writeFileSync(path.join(workDir, "package.json"), '{ "manifest": true }\n', "utf8");
    writeFileSync(path.join(workDir, "README.md"), "manifest docs\n", "utf8");
    writeFileSync(
      path.join(workDir, "src", "a-manifest.ts"),
      "export const manifest = true;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "pdf.ts"),
      [
        "export function writeManifest() {",
        "  return 'source path';",
        "}",
        "",
        "export function matchRows() {",
        "  return 'match result rows';",
        "}",
      ].join("\n"),
      "utf8",
    );

    await expect(
      commandSearch(["where", "manifest", "matches", "saved"], {
        projectRoot: workDir,
        limit: "3",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("Search: where manifest matches saved");
    expect(output).not.toContain("\nSource matches:");
    expect(output).toContain("\nNo matches, fallback to partial matches:");
    expect(output).toContain("  manifest:");
    expect(output).toContain("src/pdf.ts");
    expect(output.indexOf("src/pdf.ts")).toBeLessThan(output.indexOf("src/a-manifest.ts"));
    expect(output).not.toContain("package.json");
    expect(output).toContain("writeManifest");
    expect(output).toContain("  match:");
    expect(output).not.toContain("  matche:");
  });

  it("does not let a documentation phrase suppress implementation fallback evidence", async () => {
    writeFileSync(
      path.join(workDir, "README.md"),
      "The command approval policy is documented here.\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "approval-policy.ts"),
      "export const approvalPolicy = 'ask';\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "command.ts"),
      "export const command = 'run';\n",
      "utf8",
    );

    await expect(
      commandSearch(["command", "approval", "policy"], {
        projectRoot: workDir,
        limit: "5",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("No matches, fallback to partial matches:");
    expect(output).toContain("src/approval-policy.ts");
    expect(output).not.toContain("README.md");
  });

  it("does not treat singular words ending in s as plural variants", async () => {
    writeFileSync(path.join(workDir, "src", "registry.ts"), "export class Registry {}\n", "utf8");

    await expect(
      commandSearch(["automatic", "model", "class", "registration"], {
        projectRoot: workDir,
        limit: "5",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("  class:");
    expect(output).not.toContain("  clas:");
  });

  it("prints graph search relationships without internal edge syntax", async () => {
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "import { helper } from './helper';",
        "export function run(value: string) {",
        "  return helper(value);",
        "}",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "helper.ts"),
      "export function helper(value: string) {\n  return value;\n}\n",
      "utf8",
    );

    await expect(
      commandSearch(["helper"], {
        graph: true,
        projectRoot: workDir,
        limit: "2",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain(
      "Graph fallback: Codebase Memory graph search returned no answer; used current-tree relationship graph.",
    );
    expect(output).toContain("\nRelationship matches:");
    expect(output).toContain("src/helper.ts: code file");
    expect(output).not.toContain("src/helper.ts: src/helper.ts:");
    expect(output).toContain("helper in src/helper.ts");
    expect(output).toContain("imported by: src/app.ts");
    expect(output).not.toContain("--imports-->");
    expect(output).not.toContain("function:src/");
  });

  it("hides graph fallback test matches unless requested", async () => {
    const testsDir = path.join(workDir, "tests");
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "helper.ts"),
      "export function helper(value: string) {\n  return value;\n}\n",
      "utf8",
    );
    writeFileSync(
      path.join(testsDir, "helper.test.ts"),
      "export function helperSpec(value: string) {\n  return value;\n}\n",
      "utf8",
    );

    await expect(
      commandSearch(["helper"], {
        graph: true,
        projectRoot: workDir,
        limit: "5",
      }),
    ).resolves.toBe(0);

    const defaultOutput = logLines().join("\n");
    expect(defaultOutput).toContain("helper in src/helper.ts");
    expect(defaultOutput).not.toContain("tests/helper.test.ts");

    logSpy.mockClear();

    await expect(
      commandSearch(["helper"], {
        graph: true,
        projectRoot: workDir,
        limit: "5",
        includeTests: true,
      }),
    ).resolves.toBe(0);

    const includedOutput = logLines().join("\n");
    expect(includedOutput).toContain("tests/helper.test.ts");
  });
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
