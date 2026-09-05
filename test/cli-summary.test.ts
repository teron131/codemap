/** Checks focused summary CLI output on small fixture projects. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandSummary, main } from "../src/codemap/commands/index.js";
import { buildRepositorySummary, renderSummaryText } from "../src/codemap/summary/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
  workDir = path.join(workspaceRoot, "test", ".work", `cli-summary-${process.pid}-${Date.now()}`);
  mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
  process.chdir(workspaceRoot);
  rmSync(workDir, { recursive: true, force: true });
});

describe("summary CLI", () => {
  it("prints README context and a directly exposed public module layer", () => {
    writeFileSync(
      path.join(workDir, "README.md"),
      [
        "# Example Project",
        "",
        "Fixture docs.",
        "",
        "## Design",
        "",
        "The tool has one public operation.",
        "",
        "### Details",
        "Internal details.",
        "",
        "## Installation",
        "npm install example",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "tool.ts"),
      [
        "/** Runs the fixture operation. */",
        "export function tool() {",
        "  return 'ok';",
        "}",
        "export function hiddenTool() {",
        "  return 'hidden';",
        "}",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "index.ts"),
      [
        "export const direct = true;",
        "export { tool as publicTool } from './tool.js';",
        "export * as nested from './nested/index.js';",
        "export { ExternalClient as PublicClient } from '@fixture/external';",
      ].join("\n"),
    );
    mkdirSync(path.join(workDir, "src", "nested"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "nested", "operation.ts"),
      "export function nestedOperation() { return 'nested'; }\n",
    );
    writeFileSync(
      path.join(workDir, "src", "nested", "index.ts"),
      "export { nestedOperation } from './operation.js';\n",
    );
    mkdirSync(path.join(workDir, "src", "_generated"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "_generated", "index.js"),
      "export function generatedClient() { return 'skip me'; }\n",
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/codemap/cli.ts", "summary", "--project-root", workDir],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`# ${path.basename(workDir)}`);
    expect(result.stdout).toContain("## Overview");
    expect(result.stdout).toContain("Fixture docs.");
    expect(result.stdout).toContain("### Languages");
    expect(result.stdout).toContain("TypeScript 100%");
    expect(result.stdout).not.toContain("JavaScript");
    expect(result.stdout).toContain("### README Outline");
    expect(result.stdout).toContain("  - Design");
    expect(result.stdout).toContain("    - Details");
    expect(result.stdout).not.toContain("Installation");
    expect(result.stdout).toContain(
      "## Public API — entry position · import reach · implementation breadth",
    );
    expect(result.stdout).toContain("Defining exports shown where clear.");
    expect(result.stdout).toContain("src/index.ts");
    expect(result.stdout).toContain("├─ tool: publicTool");
    expect(result.stdout).not.toContain("hiddenTool");
    expect(result.stdout).toContain("└─ nested");
    expect(result.stdout).toContain("   └─ operation: nestedOperation");
    expect(result.stdout).not.toContain("generatedClient");
    expect(result.stdout).toContain("Codebase Memory unavailable");
    expect(result.stdout.indexOf("Codebase Memory unavailable")).toBeLessThan(
      result.stdout.indexOf("## Public API —"),
    );
  });

  it("selects entry, central, and broad public surfaces instead of every manifest export", () => {
    writeFileSync(
      path.join(workDir, "package.json"),
      JSON.stringify({
        exports: {
          ".": "./src/index.ts",
          "./central": "./src/central.ts",
          "./noise-a": "./src/noise-a.ts",
          "./noise-b": "./src/noise-b.ts",
          "./wide": "./src/wide.ts",
        },
      }),
    );
    writeFileSync(
      path.join(workDir, "src", "index.ts"),
      "/** Public entry. */\nexport const entry = true;\n",
    );
    writeFileSync(
      path.join(workDir, "src", "central.ts"),
      "/** Shared operation. */\nexport const central = true;\n",
    );
    writeFileSync(path.join(workDir, "src", "noise-a.ts"), "export const noiseA = true;\n");
    writeFileSync(path.join(workDir, "src", "noise-b.ts"), "export const noiseB = true;\n");
    mkdirSync(path.join(workDir, "src", "internal", "deep"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "internal", "deep", "index.ts"),
      Array.from({ length: 12 }, (_, index) => `export const internal${index} = true;`).join("\n"),
    );
    writeFileSync(
      path.join(workDir, "src", "wide.ts"),
      [
        "/** Feature exports. */",
        "export const wideAlpha = true;",
        "export const wideBravo = true;",
        "export const wideCharlie = true;",
        "export const wideDelta = true;",
        "export const wideEcho = true;",
        "export const wideFoxtrot = true;",
        "export const wideGolf = true;",
      ].join("\n"),
    );
    writeFileSync(path.join(workDir, "src", "consumer-a.ts"), "import './central.js';\n");
    writeFileSync(path.join(workDir, "src", "consumer-b.ts"), "import './central.js';\n");

    const summary = buildRepositorySummary(workDir);
    const output = renderSummaryText(summary);

    expect(summary.exportSurfaces.map((surface) => surface.file)).toEqual([
      "src/index.ts",
      "src/central.ts",
      "src/wide.ts",
    ]);
    expect(output).toContain("└─ wide — Feature exports.");
    expect(output.match(/wide/g)).toHaveLength(1);
    expect(output).not.toContain("noiseA");
    expect(output).not.toContain("noiseB");
    expect(output).not.toContain("internal11");
  });

  it("stops a barrel at its directly exposed module groups", () => {
    writeFileSync(
      path.join(workDir, "package.json"),
      JSON.stringify({ name: "barrel-fixture", exports: "." }),
    );
    for (const [suffix, name] of [
      ["a", "alpha"],
      ["b", "bravo"],
      ["c", "charlie"],
      ["d", "delta"],
      ["e", "echo"],
    ]) {
      writeFileSync(
        path.join(workDir, "src", `module-${suffix}.ts`),
        `export const ${name} = true;\n`,
      );
    }
    writeFileSync(
      path.join(workDir, "src", "index.ts"),
      ["a", "b", "c", "d", "e"]
        .map((suffix) => `export * from './module-${suffix}.js';`)
        .join("\n"),
    );

    const output = renderSummaryText(buildRepositorySummary(workDir));

    expect(output).toContain("├─ module-a: alpha");
    expect(output).toContain("└─ module-e: echo");
    expect(output).not.toContain("src/module-a.ts");
    expect(output).not.toContain("defining modules");
  });

  it("retains defining names from selected Python package exports", () => {
    mkdirSync(path.join(workDir, "src", "fixture"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "fixture", "__init__.py"),
      ["from .trainer import Trainer as Trainer", "from .noise import noise as noise"].join("\n"),
    );
    writeFileSync(path.join(workDir, "src", "fixture", "trainer.py"), "class Trainer:\n    pass\n");
    writeFileSync(path.join(workDir, "src", "fixture", "noise.py"), "noise = True\n");
    writeFileSync(path.join(workDir, "src", "consumer_a.py"), "from fixture import trainer\n");
    writeFileSync(path.join(workDir, "src", "consumer_b.py"), "from fixture import trainer\n");

    const output = renderSummaryText(buildRepositorySummary(workDir));

    expect(output).toContain("└─ trainer: Trainer");
    expect(output).not.toContain("noise:");
  });

  it("keeps complementary central and broad modules without exhaustive siblings", () => {
    writeFileSync(
      path.join(workDir, "package.json"),
      JSON.stringify({ name: "capability-fixture", exports: "." }),
    );
    mkdirSync(path.join(workDir, "src", "broad"), { recursive: true });
    writeFileSync(path.join(workDir, "src", "popular.ts"), "export function popular() {}\n");
    writeFileSync(path.join(workDir, "src", "noise.ts"), "export const noise = true;\n");
    writeFileSync(path.join(workDir, "src", "broad", "a.ts"), "export const a = true;\n");
    writeFileSync(path.join(workDir, "src", "broad", "b.ts"), "export const b = true;\n");
    writeFileSync(
      path.join(workDir, "src", "index.ts"),
      [
        "export * from './popular.js';",
        "export * from './noise.js';",
        "export * from './broad/a.js';",
        "export * from './broad/b.js';",
      ].join("\n"),
    );
    writeFileSync(path.join(workDir, "src", "consumer-a.ts"), "import './popular.js';\n");
    writeFileSync(path.join(workDir, "src", "consumer-b.ts"), "import './popular.js';\n");

    const output = renderSummaryText(buildRepositorySummary(workDir));

    expect(output).toContain("├─ popular: popular");
    expect(output).toContain("└─ broad");
    expect(output).not.toContain("noise:");
  });

  it("defaults to the nearest git root and uses project-root as an explicit scope", () => {
    writeFileSync(
      path.join(workDir, "README.md"),
      ["# Root Project", "", "Fixture docs."].join("\n"),
      "utf8",
    );
    writeFileSync(path.join(workDir, "src", "app.ts"), "export function app() { return 'ok'; }\n");
    expect(spawnSync("git", ["init"], { cwd: workDir }).status).toBe(0);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      process.chdir(path.join(workDir, "src"));
      expect(commandSummary({})).toBe(0);
      const defaultOutput = logLines(logSpy).join("\n");
      expect(defaultOutput).toContain(`# ${path.basename(workDir)}`);
      expect(defaultOutput).toContain("### Root Project");
      expect(defaultOutput).toContain("Fixture docs.");

      logSpy.mockClear();
      expect(commandSummary({ projectRoot: "." })).toBe(0);
      const scopedOutput = logLines(logSpy).join("\n");
      expect(scopedOutput).toContain("# src");
      expect(scopedOutput).not.toContain("Root Project");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("parses argv when a launcher omits the script placeholder", async () => {
    writeFileSync(path.join(workDir, "src", "app.ts"), "export function app() { return 'ok'; }\n");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(main(["node", "summary", "--project-root", workDir])).resolves.toBe(0);
      expect(logLines(logSpy).join("\n")).toContain(`# ${path.basename(workDir)}`);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("derives a compact workspace foundation from package dependencies", () => {
    for (const [root, name, dependencies] of [
      ["packages/core", "@fixture/core", {}],
      ["apps/cli", "@fixture/cli", { "@fixture/core": "workspace:*" }],
      ["extensions/plugin", "@fixture/plugin", { "@fixture/core": "workspace:*" }],
    ] as const) {
      mkdirSync(path.join(workDir, root), { recursive: true });
      writeFileSync(
        path.join(workDir, root, "package.json"),
        JSON.stringify({ name, dependencies }),
      );
      writeFileSync(path.join(workDir, root, "index.ts"), "export const value = true;\n");
    }

    const summary = buildRepositorySummary(workDir);

    expect(summary.structuralSignals).toContainEqual({
      kind: "foundation",
      source: "packages/core",
      targets: [
        { label: "apps/cli", count: null, examples: [] },
        { label: "extensions/plugin", count: null, examples: [] },
      ],
      share: 1,
    });
    expect(summary.structuralSignals).not.toContainEqual(
      expect.objectContaining({ kind: "entry" }),
    );
  });

  it("shows counted extent samples for compressed relationship families", () => {
    for (const [root, name, dependencies] of [
      ["packages/core", "@fixture/core", {}],
      ["partners/anthropic", "@fixture/anthropic", { "@fixture/core": "workspace:*" }],
      ["partners/google", "@fixture/google", { "@fixture/core": "workspace:*" }],
      ["partners/mistral", "@fixture/mistral", { "@fixture/core": "workspace:*" }],
      ["partners/openai", "@fixture/openai", { "@fixture/core": "workspace:*" }],
      ["partners/xai", "@fixture/xai", { "@fixture/core": "workspace:*" }],
    ] as const) {
      mkdirSync(path.join(workDir, root), { recursive: true });
      writeFileSync(
        path.join(workDir, root, "package.json"),
        JSON.stringify({ name, dependencies }),
      );
      writeFileSync(path.join(workDir, root, "index.ts"), "export const value = true;\n");
    }

    const foundation = buildRepositorySummary(workDir).structuralSignals.find(
      (signal) => signal.kind === "foundation",
    );

    expect(foundation).toMatchObject({
      source: "packages/core",
      targets: [
        {
          label: "partners/*",
          count: 5,
          examples: ["anthropic", "mistral", "xai"],
        },
      ],
    });
  });

  it("keeps direct items explicit around a compressed nested directory", () => {
    for (const file of [
      "src/fixture/__init__.py",
      "src/fixture/commands/__init__.py",
      "src/fixture/core/__init__.py",
      "src/fixture/providers/__init__.py",
      "src/fixture/providers/common.py",
      "src/fixture/providers/utils.py",
      "src/fixture/providers/integrations/__init__.py",
      "src/fixture/providers/integrations/anthropic.py",
      "src/fixture/providers/integrations/google.py",
      "src/fixture/providers/integrations/mistral.py",
      "src/fixture/providers/integrations/openai.py",
      "src/fixture/providers/integrations/xai.py",
    ]) {
      mkdirSync(path.dirname(path.join(workDir, file)), { recursive: true });
      const imports = file.endsWith("src/fixture/__init__.py")
        ? "from . import providers\n"
        : file.endsWith("commands/__init__.py")
          ? "from fixture import providers\n"
          : file.includes("providers/integrations/") && !file.endsWith("__init__.py")
            ? "from fixture import core\n"
            : "";
      writeFileSync(path.join(workDir, file), imports);
    }

    expect(buildRepositorySummary(workDir).structuralOutlines).toContainEqual({
      source: "src/fixture/providers",
      items: [
        { label: "common.py", count: null, examples: [] },
        {
          label: "integrations/*",
          count: 5,
          examples: ["anthropic.py", "mistral.py", "xai.py"],
        },
        { label: "utils.py", count: null, examples: [] },
      ],
    });
  });

  it("collapses a wide shallow directory before expanding every child", () => {
    for (const file of [
      "src/fixture/__init__.py",
      "src/fixture/commands/__init__.py",
      "src/fixture/core/__init__.py",
      "src/fixture/providers/__init__.py",
      "src/fixture/providers/common.py",
      "src/fixture/providers/utils.py",
      ...["anthropic", "google", "mistral", "openai", "xai"].flatMap((provider) => [
        `src/fixture/providers/${provider}/__init__.py`,
        `src/fixture/providers/${provider}/client.py`,
        `src/fixture/providers/${provider}/types.py`,
      ]),
    ]) {
      mkdirSync(path.dirname(path.join(workDir, file)), { recursive: true });
      const imports = file.endsWith("src/fixture/__init__.py")
        ? "from . import providers\n"
        : file.endsWith("commands/__init__.py")
          ? "from fixture import providers\n"
          : file.endsWith("client.py")
            ? "from fixture import core\n"
            : "";
      writeFileSync(path.join(workDir, file), imports);
    }

    expect(buildRepositorySummary(workDir).structuralOutlines).toContainEqual({
      source: "src/fixture/providers",
      items: [
        { label: "common.py", count: null, examples: [] },
        { label: "utils.py", count: null, examples: [] },
        {
          label: "*/",
          count: 5,
          examples: ["anthropic", "mistral", "xai"],
        },
      ],
    });
  });

  it("renders the focused section contract without raw graph inventory", () => {
    const output = renderSummaryText({
      project: "large-repo",
      readme: [{ level: 1, outline: true, title: "Large Repo", content: ["Coordinates work."] }],
      languages: [
        { name: "TypeScript", share: 0.75 },
        { name: "JavaScript", share: 0.25 },
      ],
      exportSurfaces: [
        {
          file: "src/index.ts",
          description: "Public API.",
          capabilities: [{ label: "workflow", exports: ["Workflow"] }],
        },
        {
          file: "src/workflow/index.ts",
          description: "Workflow surface.",
          capabilities: [{ label: "execution", exports: ["execute"] }],
        },
        {
          file: "src/workflow/plugins/index.ts",
          description: null,
          capabilities: [],
        },
      ],
      structuralSignals: [
        {
          kind: "entry",
          source: "src/cli.ts",
          targets: [{ label: "src/commands", count: null, examples: [] }],
          share: null,
        },
        {
          kind: "coordination",
          source: "src/commands",
          targets: [
            { label: "src/search", count: null, examples: [] },
            { label: "src/workflow", count: null, examples: [] },
          ],
          share: null,
        },
        {
          kind: "foundation",
          source: "src/core",
          targets: [
            { label: "src/search", count: null, examples: [] },
            { label: "src/workflow", count: null, examples: [] },
          ],
          share: 0.5,
        },
        {
          kind: "core",
          source: "src/runtime",
          targets: [
            { label: "src/api", count: null, examples: [] },
            { label: "src/storage", count: null, examples: [] },
          ],
          share: 0.75,
        },
      ],
      structuralOutlines: [
        {
          source: "src/providers",
          items: [
            { label: "common.ts", count: null, examples: [] },
            {
              label: "integrations/*",
              count: 5,
              examples: ["anthropic.ts", "mistral.ts", "xai.ts"],
            },
            {
              label: "processors/*",
              count: 4,
              examples: ["glue.ts", "squad.ts", "xnli.ts"],
            },
            { label: "utils.ts", count: null, examples: [] },
          ],
        },
      ],
      hotspots: [
        {
          name: "run",
          file: "src/run.ts",
          description: "Runs the workflow.",
          callShare: 0.25,
        },
      ],
      clusters: [
        {
          label: "src/workflow",
          description: "Owns workflow execution.",
          codeShare: 0.4,
          internalCallShare: 0.75,
          topNodes: ["run", "stop"],
        },
      ],
      relationshipEvidenceAvailable: true,
      relationshipEvidenceFailureReason: null,
    });

    expect(output).toContain("## Overview");
    expect(output).toContain("TypeScript 75% · JavaScript 25%");
    expect(output.indexOf("### README Outline")).toBeLessThan(output.indexOf("### Large Repo"));
    expect(output.indexOf("### Large Repo")).toBeLessThan(output.indexOf("### Languages"));
    expect(output).toContain("## Structural Signals — role · flow · peer reach");
    expect(output).toContain("entry · src/cli.ts → src/commands");
    expect(output).toContain("coordination · src/commands → src/search, src/workflow");
    expect(output).toContain("foundation · src/search, src/workflow → src/core · 50%");
    expect(output).toContain("core · src/runtime → src/api, src/storage · 75%");
    expect(output).toContain(
      [
        "inside src/providers",
        "  ├─ common.ts, utils.ts",
        "  ├─ integrations/* [5]: anthropic.ts, …, mistral.ts, …, xai.ts",
        "  └─ processors/* [4]: glue.ts, squad.ts, …, xnli.ts",
      ].join("\n"),
    );
    expect(output).toContain("## Public API — entry position · import reach");
    expect(output).toContain(
      [
        "src/index.ts — Public API.",
        "└─ workflow: Workflow — Workflow surface.",
        "   ├─ execution: execute",
        "   └─ plugins",
      ].join("\n"),
    );
    expect(output).toContain("## Hotspots");
    expect(output).toContain("run · src/run.ts · 25%");
    expect(output).toContain("## Clusters");
    expect(output).toContain("src/workflow · 40% · 75%");
    expect(output.indexOf("## Hotspots")).toBeLessThan(output.indexOf("## Public API —"));
    expect(output.indexOf("## Clusters")).toBeLessThan(output.indexOf("## Public API —"));
    expect(output.indexOf("## Structural Signals")).toBeLessThan(output.indexOf("## Hotspots"));
    expect(output).not.toContain("Inventory");
    expect(output).not.toContain("nodes:");
  });
});

/** Collects mocked console output as printable test lines. */
function logLines(logSpy: ReturnType<typeof vi.spyOn>): string[] {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
