/** Checks Codebase Memory transport and feature integration with a shared mock backend. */
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectLockPath } from "../src/codemap/codebase-memory/cache.js";
import {
  callCodebaseMemoryTool,
  codebaseMemoryFailureReason,
  codebaseMemoryQueryRows,
  codebaseMemorySchema,
  codebaseMemoryStatus,
  withFreshCodebaseMemoryProject,
} from "../src/codemap/codebase-memory/index.js";
import {
  buildParser,
  commandBackendChanges,
  commandBackendProjects,
  commandBackendQuery,
  commandBackendSchema,
  commandBackendStatus,
  commandIndex,
  commandInspect,
  commandSearch,
  commandSignals,
  commandSummary,
} from "../src/codemap/commands/index.js";
import {
  codebaseMemoryInspect,
  renderCodebaseMemoryInspect,
} from "../src/codemap/inspect/index.js";
import { canonicalPath } from "../src/codemap/path-utils.js";
import {
  printCodebaseMemoryGraphSearch,
  printCodebaseMemorySearch,
  printCodebaseMemorySemanticSearch,
} from "../src/codemap/search/codebase-memory.js";

const workspaceRoot = process.cwd();
/** The transport adds these to every tool call. */
const responseArguments = { format: "json", max_output_tokens: 1_000_000 };
let workDir: string;
let serverPath: string;

beforeEach(() => {
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `codebase-memory-integration-${process.pid}-${Date.now()}`,
  );
  mkdirSync(workDir, { recursive: true });
  serverPath = path.join(workDir, "mock-codebase-memory-mcp.cjs");
  writeFileSync(serverPath, mockServerSource(), "utf8");
  chmodSync(serverPath, 0o755);
  vi.stubEnv("CODEMAP_CODEBASE_MEMORY", "1");
  vi.stubEnv("CODEMAP_CODEBASE_MEMORY_COMMAND", serverPath);
  vi.stubEnv("CBM_CACHE_DIR", path.join(workDir, "cbm-cache"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(workDir, { recursive: true, force: true });
  rmSync(toolLogPath(), { force: true });
});

describe("Codebase Memory integration", () => {
  it("exposes the backend namespace without a memory alias", () => {
    const commandNames = buildParser().commands.map((command) => command.name());

    expect(commandNames).toContain("backend");
    expect(commandNames).not.toContain("memory");
  });

  it("normalizes query columns and rows into records", () => {
    expect(
      codebaseMemoryQueryRows({
        columns: ["name", "count"],
        rows: [["needle", "2"], { name: "other", count: 1 }],
      }),
    ).toEqual([
      { name: "needle", count: "2" },
      { name: "other", count: 1 },
    ]);
    expect(codebaseMemoryQueryRows({ message: "ok" })).toBeNull();
  });

  it("reads tool payloads outside backend session discovery", () => {
    const result = callCodebaseMemoryTool("list_projects", {});
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.value).toMatchObject({
      projects: expect.arrayContaining([
        expect.objectContaining({
          name: "mock-project",
          root_path: workDir,
        }),
      ]),
    });
    expect(readChildCwds()).toEqual([homedir()]);
  });

  it("retains the backend failure when restoring the lock also fails", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_LOSE_LOCK_RPC_ERROR", projectLockPath(canonicalPath(workDir)));
    const result = withFreshCodebaseMemoryProject(workDir, () =>
      callCodebaseMemoryTool("get_graph_schema", {}),
    );
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.reason).toContain("backend failed deliberately");
      expect(result.reason).toContain("cache lock ownership was lost after launch");
    }
  });

  it("reaps a timed-out backend before returning control and permits the next refresh", () => {
    const pidLog = path.join(workDir, "backend-pids.jsonl");
    vi.stubEnv("CODEBASE_MEMORY_MOCK_PID_LOG", pidLog);
    vi.stubEnv("CODEBASE_MEMORY_MOCK_OPERATION_ID", "deadline");
    vi.stubEnv("CODEBASE_MEMORY_MOCK_QUERY_DELAY_MS", "500");
    const result = withFreshCodebaseMemoryProject(workDir, () =>
      callCodebaseMemoryTool("get_graph_schema", {}, { timeoutMs: 150 }),
    );
    expect(result?.ok).toBe(false);
    if (result?.ok === false) expect(result.reason).toContain("timed out");
    const pid = Number(readFileSync(pidLog, "utf8").trim().split("\n").at(-1));
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    vi.stubEnv("CODEBASE_MEMORY_MOCK_QUERY_DELAY_MS", "0");
    expect(codebaseMemorySchema(workDir)).not.toBeNull();
  });

  it("indexes ready projects before use", () => {
    const project = withFreshCodebaseMemoryProject(workDir, (readyProject) => readyProject);

    expect(project).toMatchObject({
      name: "mock-project",
      status: "ready",
    });
    expect(readIndexCalls()).toEqual([
      {
        mode: "full",
        persistence: false,
        repo_path: workDir,
        ...responseArguments,
      },
    ]);
    expect(readDeleteCalls()).toEqual([{ project: "mock-project", ...responseArguments }]);
    expect(toolCallArguments("list_projects")).toEqual([
      { detail: "identity", limit: 500, offset: 0, ...responseArguments },
    ]);
  });

  it("performs one clean refresh per top-level operation", () => {
    expect(withFreshCodebaseMemoryProject(workDir, (project) => project)).toMatchObject({
      name: "mock-project",
      status: "ready",
    });
    expect(withFreshCodebaseMemoryProject(workDir, (project) => project)).toMatchObject({
      name: "mock-project",
      status: "ready",
    });
    expect(readIndexCalls()).toEqual([
      {
        mode: "full",
        persistence: false,
        repo_path: workDir,
        ...responseArguments,
      },
      {
        mode: "full",
        persistence: false,
        repo_path: workDir,
        ...responseArguments,
      },
    ]);
  });

  it("reuses one clean snapshot across nested backend operations", () => {
    const result = withFreshCodebaseMemoryProject(workDir, () => ({
      status: codebaseMemoryStatus(workDir),
      schema: codebaseMemorySchema(workDir),
    }));

    expect(result).toMatchObject({
      status: { projectName: "mock-project", status: "ready" },
      schema: { node_labels: [{ label: "Function", count: 7 }] },
    });
    expect(readDeleteCalls()).toHaveLength(1);
    expect(readIndexCalls()).toHaveLength(1);
  });

  it("rejects asynchronous nested operations before releasing the lock", () => {
    let invoked = false;
    expect(() =>
      withFreshCodebaseMemoryProject(workDir, () =>
        withFreshCodebaseMemoryProject(workDir, async () => {
          invoked = true;
        }),
      ),
    ).toThrow("Codebase Memory project operations must be synchronous");
    expect(invoked).toBe(false);
    expect(readDeleteCalls()).toHaveLength(1);
    expect(readIndexCalls()).toHaveLength(1);
  });

  it("serializes concurrent same-root refreshes through their queries", async () => {
    const [first, second] = await Promise.all([runSchemaCli("first"), runSchemaCli("second")]);

    expect(first).toMatchObject({ status: 0 });
    expect(second).toMatchObject({ status: 0 });
    expect(first.stdout).toContain("Codebase Memory schema");
    expect(second.stdout).toContain("Codebase Memory schema");
    const starts = readOperationEvents().filter((event) => event.phase === "start");
    const operationOrder = starts
      .map((event) => event.operationId)
      .filter((operationId, index, values) => index === 0 || operationId !== values[index - 1]);
    expect(operationOrder).toHaveLength(2);
    expect(new Set(operationOrder)).toEqual(new Set(["first", "second"]));
    for (const operationId of ["first", "second"]) {
      expect(
        starts.filter((event) => event.operationId === operationId).map((event) => event.toolName),
      ).toEqual(["list_projects", "delete_project", "index_repository", "get_graph_schema"]);
    }
  });

  it("keeps an orphaned MCP child serialized after its CLI parent dies", async () => {
    const first = startSchemaCli("orphan", { queryDelayMs: 1_000 });
    await waitForOperationStart("orphan", "get_graph_schema");
    expect(first.child.kill("SIGKILL")).toBe(true);
    await first.result;

    const successor = startSchemaCli("successor");
    await delay(150);
    expect(readOperationEvents().some((event) => event.operationId === "successor")).toBe(false);
    expect(await successor.result).toMatchObject({ status: 0 });

    const events = readOperationEvents();
    const orphanEnd = events.findIndex(
      (event) =>
        event.operationId === "orphan" &&
        event.toolName === "get_graph_schema" &&
        event.phase === "end",
    );
    const successorStart = events.findIndex(
      (event) => event.operationId === "successor" && event.phase === "start",
    );
    expect(orphanEnd).toBeGreaterThanOrEqual(0);
    expect(successorStart).toBeGreaterThan(orphanEnd);
  });

  it("rejects index responses without a project name", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_NO_INDEX_PROJECT", "1");

    expect(withFreshCodebaseMemoryProject(workDir, (project) => project)).toBeNull();
  });

  it("rejects missing, nonterminal, and unknown index statuses", () => {
    for (const status of ["", "indexing", "queued", "mystery"]) {
      vi.stubEnv("CODEBASE_MEMORY_MOCK_INDEX_STATUS", status);

      expect(withFreshCodebaseMemoryProject(workDir, (project) => project)).toBeNull();
    }
  });

  it("marks indexes with skipped files as partial", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_SKIPPED_COUNT", "2");

    expect(withFreshCodebaseMemoryProject(workDir, (project) => project)).toMatchObject({
      name: "mock-project",
      status: "partial",
    });
  });

  it("treats decoded tool error payloads as failed tool calls", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "search_code");

    expect(
      callCodebaseMemoryTool("search_code", {
        project: "mock-project",
        pattern: "needle",
      }),
    ).toEqual({
      ok: false,
      reason: "project not found or not indexed",
    });
  });

  it("prefers structured tool content over text fallbacks", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_STRUCTURED_CONTENT", "1");

    const result = callCodebaseMemoryTool("list_projects", {});
    expect(result).toMatchObject({
      ok: true,
      value: {
        projects: expect.arrayContaining([expect.objectContaining({ name: "mock-project" })]),
      },
    });
  });

  it("rejects MCP results marked as tool errors", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_IS_ERROR", "1");

    expect(callCodebaseMemoryTool("search_code", {})).toEqual({
      ok: false,
      reason: "pattern is required",
    });
  });

  it("rejects plain-text backend validation errors", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_PLAIN_ERROR", "1");

    expect(callCodebaseMemoryTool("search_code", {})).toEqual({
      ok: false,
      reason: "unknown tool: search_code",
    });
  });

  it("lets backend rendering fall back when a Codebase Memory tool returns an error payload", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "search_code");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 1)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets backend rendering fall back when Codebase Memory search returns no matches", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_SEARCH", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 1)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets backend rendering fall back on unknown search payloads", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_UNKNOWN_SEARCH", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 1)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact backend code search rows", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 1)).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory code matches:");
      expect(output).toContain("results: 1");
      expect(output).toContain("grep matches: 3");
      expect(output).toContain(
        "- needle (src/needle.ts:4-8, Function) — export function needle() {",
      );
      expect(output).not.toContain("mock-project.src.needle");
      expect(output).not.toContain('"rows"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps documentation-only evidence when backend code search has no answer", async () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_SEARCH", "1");
    writeFileSync(
      path.join(workDir, "README.md"),
      "The zzzzDocumentationOnlyConcept is documented here.\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["zzzzDocumentationOnlyConcept"], {
          projectRoot: workDir,
          limit: "1",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("README.md");
      expect(output).not.toContain("Codebase Memory code matches:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority when working-tree query terms are scattered", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "approval-policy.ts"),
      "export const approvalPolicy = true;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "command.ts"),
      "export const command = true;\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).toContain("- needle");
      expect(output).not.toContain("src/approval-policy.ts");
      expect(output).not.toContain("src/command.ts");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses complete working-tree term coverage before backend search", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "cohesive.ts"),
      [
        "export const command = true;",
        ...Array.from({ length: 48 }, (_, index) => `const filler${index} = ${index};`),
        "export const approvalPolicy = true;",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Working-tree source candidates:");
      expect(output).toContain("src/cohesive.ts");
      expect(output).toContain("[terms 3/3: command, approval, policy]");
      expect(output).toContain("1:14 export const command = true;");
      expect(output).toContain("50:14 export const approvalPolicy = true;");
      expect(output.indexOf("1:14")).toBeLessThan(output.indexOf("50:14"));
      expect(output).not.toContain("Codebase Memory code matches:");
      expect(readIndexCalls()).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps fast-path eligibility independent from a smaller display limit", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `candidate-${index}.ts`),
        `export const commandApprovalPolicy${index} = true;\n`,
        "utf8",
      );
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "1",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Working-tree source candidates:");
      expect(output.match(/\[terms 3\/3: command, approval, policy]/g)).toHaveLength(1);
      expect(output).toContain("... 2 more candidates");
      expect(readIndexCalls()).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses one source-backed path owner despite broader complete candidates", async () => {
    mkdirSync(path.join(workDir, "src", "tool", "retry"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "tool", "retry", "middleware.ts"),
      "export const toolRetryMiddleware = true;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "tool", "retry", "middleware-path-only.ts"),
      "export const tool = true;\n",
      "utf8",
    );
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `generic-${index}.ts`),
        `export const toolRetryMiddleware${index} = true;\n`,
        "utf8",
      );
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["tool", "retry", "middleware"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Working-tree source candidates:");
      expect(output).toContain("src/tool/retry/middleware.ts");
      expect(output).not.toContain("src/generic-");
      expect(output).toContain("... 4 more candidates");
      expect(readIndexCalls()).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses bounded exact implementation text before backend search", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "exact.ts"),
      "// Apply command approval policy before execution.\n",
      "utf8",
    );
    for (let index = 0; index < 3; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `scattered-${index}.ts`),
        `export const commandApprovalPolicy${index} = true;\n`,
        "utf8",
      );
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Source matches:");
      expect(output).toContain("src/exact.ts");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses the narrowest cohesive source window for fast-path anchors", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "cohesive-owner.ts"),
      [
        "export const command = true;",
        ...Array.from({ length: 18 }, (_, index) => `const early${index} = ${index};`),
        "export const approvalPolicy = true;",
        ...Array.from({ length: 39 }, (_, index) => `const later${index} = ${index};`),
        "export const commandApprovalPolicy = true;",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Working-tree source candidates:");
      expect(output).toContain("60:14 export const commandApprovalPolicy = true;");
      expect(output).not.toContain("1:14 export const command = true;");
      expect(readIndexCalls()).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority when path text supplies missing query terms", async () => {
    mkdirSync(path.join(workDir, "src", "callbacks"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "callbacks", "base.ts"),
      "export const config = true;\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["callback", "config"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority for complete terms split across incidental lines", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "imports.ts"),
      [
        "import { commitments } from './commitments.js';",
        "import { sqlite } from './sqlite.js';",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["commitments", "sqlite"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority when complete source coverage exceeds the fast-path bound", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `candidate-${index}.ts`),
        `export const commandApprovalPolicy${index} = true;\n`,
        "utf8",
      );
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("bounds ambiguous multi-term fallback after an empty backend search", async () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_SEARCH", "1");
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    for (let index = 0; index < 10; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `candidate-${index}.ts`),
        `export const alphaBeta${index} = true;\n`,
        "utf8",
      );
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["alpha", "beta"], {
          projectRoot: workDir,
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("No whole-query source match; partial candidates:");
      expect(output.match(/\[terms 2\/2: alpha, beta]/g)).toHaveLength(8);
      expect(output).toContain("... 2 more candidates");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority when same-file query terms are far apart", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "mixed-concerns.ts"),
      [
        "export const command = true;",
        ...Array.from({ length: 60 }, (_, index) => `const filler${index} = ${index};`),
        "export const approvalPolicy = true;",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["command", "approval", "policy"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority when the query exceeds the preflight term bound", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "bounded-terms.ts"),
      "export const terms = 'alpha beta gamma delta epsilon zeta theta kappa';\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(
          ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "theta", "kappa", "missingterm"],
          {
            projectRoot: workDir,
            limit: "3",
          },
        ),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps backend priority when the working-tree scan fails with partial output", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "partial.ts"),
      "export const partial = 'alpha beta';\n",
      "utf8",
    );
    const rgPath = path.join(workDir, "rg");
    writeFileSync(
      rgPath,
      [
        "#!/usr/bin/env node",
        'process.stdout.write("./src/partial.ts\\n");',
        "process.exitCode = 2;",
      ].join("\n"),
      "utf8",
    );
    chmodSync(rgPath, 0o755);
    vi.stubEnv("PATH", `${workDir}${path.delimiter}${process.env.PATH ?? ""}`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["alpha", "beta"], {
          projectRoot: workDir,
          limit: "3",
        }),
      ).resolves.toBe(0);

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Codebase Memory code matches:");
      expect(output).not.toContain("Working-tree source candidates:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("hides backend test search rows by default", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_FIRST", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 2)).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("- needle");
      expect(output).toContain("hidden tests: 1 (use --include-tests)");
      expect(output).not.toContain("testNeedle");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("hides camelCase test names without hiding words that start with test", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_WORDS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 5)).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("- testament");
      expect(output).toContain("- needle");
      expect(output).not.toContain("testParser");
      expect(output).toContain("hidden tests: 1 (use --include-tests)");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("falls back when default filters hide all backend matches", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_ONLY", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 2)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints backend test search rows when explicitly included", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_FIRST", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        printCodebaseMemorySearch(workDir, "needle", 2, {
          includeTests: true,
        }),
      ).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("testNeedle");
      expect(output).toContain("- needle");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets graph rendering fall back when Codebase Memory graph search returns no matches", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_GRAPH", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBe(
        "Codebase Memory graph search returned no answer",
      );
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 1)).toBe(
        "Codebase Memory semantic search returned no answer",
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact backend graph search rows", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBeNull();
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory graph matches:");
      expect(output).toContain("mode: bm25");
      expect(output).toContain("results: 1");
      expect(output).toContain("- needle (src/needle.ts:4-8, Function)");
      expect(output).not.toContain('"rows"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("applies graph filters to backend rows before rendering", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        printCodebaseMemoryGraphSearch(workDir, "Runner", 3, {
          label: "Class",
          namePattern: "^Runner$",
        }),
      ).toBeNull();
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(toolCallArguments("search_graph")).toEqual([
        {
          project: "mock-project",
          query: "Runner",
          label: "Class",
          limit: 100,
          ...responseArguments,
        },
      ]);
      expect(output).toContain("results: 1");
      expect(output).toContain("hidden filtered: 1");
      expect(output).toContain("- Runner (");
      expect(output).toContain(", Class)");
      expect(output).not.toContain("- __init__");
      expect(output).not.toContain("RunnerConfig");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("skips ranked backend graph search for relationship and degree filters", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        printCodebaseMemoryGraphSearch(workDir, "Runner", 3, {
          minDegree: 2,
          relationship: "CALLS",
        }),
      ).toBe("Codebase Memory ranked graph search cannot apply --relationship, --min-degree");
      expect(logSpy).not.toHaveBeenCalled();
      expect(readToolCalls()).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("answers structural graph filters from the working-tree graph", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "runner.ts"),
      "export function runRunner() {\n  return 1;\n}\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        commandSearch(["runRunner"], {
          projectRoot: workDir,
          graph: true,
          maxDegree: 0,
          excludeEntryPoints: true,
        }),
      ).resolves.toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain(
        "Graph fallback: Codebase Memory ranked graph search cannot apply --max-degree, --exclude-entry-points; used working-tree relationship graph.",
      );
      expect(output).not.toContain("Codebase Memory graph matches:");
      expect(toolCallArguments("search_graph")).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("falls back when graph filters hide every backend row", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        printCodebaseMemoryGraphSearch(workDir, "Runner", 3, {
          label: "Variable",
        }),
      ).toBe("Codebase Memory graph search returned no answer");
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("never shows the BM25 rank as a graph search score", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBeNull();
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("- needle (");
      expect(output).toContain(", Function)");
      expect(output).not.toContain("score=");
      expect(output).not.toContain("-19");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact backend architecture summaries", () => {
    const sourceDir = path.join(workDir, "src");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      path.join(sourceDir, "needle.ts"),
      "export function needle() {}\nexport function callerOne() { needle(); }\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain(`# ${path.basename(workDir)}`);
      expect(output).toContain("## Most Called");
      expect(output).toContain("needle · src/needle.ts · 33.3%");
      expect(output).toContain("## Clusters");
      expect(output).toContain("core · 57.1% · 75%");
      expect(output).toContain("└─ needle, callerOne");
      expect(output).not.toContain("hiddenTestHelper");
      expect(output).not.toContain("`get`");
      expect(output).not.toContain("nodes: 12");
      expect(output).not.toContain("edges: 34");
      expect(output).not.toContain('"file_tree"');
      expect(output).not.toContain('"node_labels"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("preserves backend architecture responses larger than the child pipe buffer", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_LARGE_ARCHITECTURE", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("## Most Called");
      expect(output).not.toContain("Codebase Memory unavailable");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("reports the backend reason when architecture is genuinely unavailable", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "get_architecture");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain(
        "Codebase Memory unavailable; most-called symbols and clusters omitted.",
      );
      expect(output).toContain("Reason: project not found or not indexed.");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("omits sparse backend inventory without inventing symbol insights", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_SPARSE_ARCHITECTURE", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain(`# ${path.basename(workDir)}`);
      expect(output).not.toContain("File 12");
      expect(output).not.toContain("Module 12");
      expect(output).not.toContain("## Most Called");
      expect(output).not.toContain("## Clusters");
      expect(output).not.toContain("Codebase Memory unavailable");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact semantic graph search rows from the semantic table", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBeNull();
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory semantic matches:");
      expect(output).toContain("mode: semantic");
      expect(output).toContain("semantic results: 1");
      expect(output).toContain("- semanticNeedle (src/semantic-needle.ts, Function, score=0.987)");
      expect(output).not.toContain('"rows"');
      expect(toolCallArguments("search_graph")).toEqual([
        {
          project: "mock-project",
          semantic_query: ["needle"],
          semantic_limit: 100,
          ...responseArguments,
        },
      ]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("defaults semantic search to fifteen results", async () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_MANY_SEMANTIC", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        await commandSearch(["needle"], {
          projectRoot: workDir,
          semantic: true,
        }),
      ).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("semantic results: 15");
      expect(output).toContain("semanticNeedle14");
      expect(output).not.toContain("semanticNeedle15");
      expect(output).toContain("- ...");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets low-score semantic graph rows fall back instead of printing noise", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_LOW_SEMANTIC", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(
        "Codebase Memory semantic search returned no answer",
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("falls back when default filters hide every semantic match", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_ONLY", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(
        "Codebase Memory semantic search matched only tests, which are hidden (use --include-tests)",
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets summary fall back on unknown architecture payloads", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_UNKNOWN_ARCHITECTURE", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("# codebase-memory-integration-");
      expect(output).toContain(
        "Codebase Memory unavailable; most-called symbols and clusters omitted.",
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("treats plain-text Codebase Memory validation failures as failed tool calls", () => {
    expect(
      callCodebaseMemoryTool("search_graph", {
        project: "mock-project",
        semantic_query: "needle",
      }),
    ).toEqual({
      ok: false,
      reason:
        'semantic_query must be an array of keyword strings, e.g. ["send","pubsub","publish"]',
    });
  });

  it("normalizes Codebase Memory inspect payloads behind the query adapter", () => {
    expect(codebaseMemoryInspect(workDir, "needle", 2)).toMatchObject({
      name: "needle",
      filePath: "src/needle.ts",
      startLine: 4,
      endLine: 8,
      metricFacts: ["cyclomatic=2", "cognitive=3", "lines=5", "callers=1", "callees=1"],
      signature: "function needle(): string",
      source: "export function needle() {\n  return 'needle';\n}",
      callers: ["callerOne"],
      callees: ["calleeOne"],
    });
    const inspectCalls = readToolCalls().slice(-4);
    expect(inspectCalls.map((call) => call.name)).toEqual([
      "search_graph",
      "get_code_snippet",
      "query_graph",
      "trace_path",
    ]);
    expect(inspectCalls[0]?.arguments).toEqual({
      project: "mock-project",
      query: "needle",
      limit: 2,
      ...responseArguments,
    });
    expect(inspectCalls[1]?.arguments).toEqual({
      project: "mock-project",
      qualified_name: "mock-project.src.needle",
      source_mode: "full",
      ...responseArguments,
    });
    expect(inspectCalls[2]?.arguments).toMatchObject({
      query: expect.stringContaining('WHERE n.qualified_name = "mock-project.src.needle"'),
    });
    expect(inspectCalls[3]?.arguments).toMatchObject({
      function_name: "mock-project.src.needle",
      depth: 2,
      limit: 5000,
    });
    expect(readDeleteCalls()).toHaveLength(1);
    expect(readIndexCalls()).toHaveLength(1);
  });

  it("lets inspect fall back on unknown snippet payloads", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_UNKNOWN_SNIPPET", "1");

    expect(codebaseMemoryInspect(workDir, "needle", 2)).toBeNull();
  });

  it("rejects ambiguous exact backend symbol matches", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_AMBIGUOUS_INSPECT", "1");

    expect(codebaseMemoryInspect(workDir, "needle", 2)).toBeNull();
  });

  it("renders compact Codebase Memory inspect output without graph internals", () => {
    const result = codebaseMemoryInspect(workDir, "needle", 2);

    if (result === null) {
      throw new Error("expected backend inspect result");
    }
    const output = renderCodebaseMemoryInspect(result, { limit: 2 });

    expect(output).toContain("Source: src/needle.ts:4-8");
    expect(output).toContain("Metrics: cyclomatic=2, cognitive=3, lines=5, callers=1, callees=1");
    expect(output).toContain("## Calls");
    expect(output).not.toContain("Qualified:");
    expect(output).not.toContain("Match:");
    expect(output).not.toContain("Graph Neighborhood");
  });

  it("renders bare return types as proper arrow signatures", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_BARE_RETURN_TYPE", "1");
    const result = codebaseMemoryInspect(workDir, "needle", 2);

    if (result === null) {
      throw new Error("expected backend inspect result");
    }
    const output = renderCodebaseMemoryInspect(result, { limit: 2 });

    expect(output).toContain("Signature: function needle() -> string");
    expect(output).not.toContain("needle()string");
  });

  it("prefixes backend argument-only signatures with the symbol name", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ARGUMENT_SIGNATURE", "1");
    vi.stubEnv("CODEBASE_MEMORY_MOCK_BARE_RETURN_TYPE", "1");
    const result = codebaseMemoryInspect(workDir, "needle", 2);

    if (result === null) {
      throw new Error("expected backend inspect result");
    }
    const output = renderCodebaseMemoryInspect(result, { limit: 2 });

    expect(output).toContain("Signature: needle(*, value: string) -> string");
    expect(output).not.toContain("( *,");
    expect(output).not.toContain(", )");
  });

  it("keeps successful backend inspection concise by default", () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "needle.ts"),
      [
        "export function needle() {",
        "  return helper();",
        "}",
        "",
        "export function helper() {",
        "  return 'ok';",
        "}",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandInspect("needle", { projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("# Inspect: needle");
      expect(output).toContain("Source: src/needle.ts:4-8");
      expect(output).not.toContain("## Current Tree Evidence");
      expect(output).not.toContain("calls: helper in src/needle.ts:5");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses local inspection first for path targets even when backend is available", () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "needle.ts"),
      "export function needle() {\n  return 'ok';\n}\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandInspect(".", { projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Directory profile");
      expect(output).not.toContain("Backend: Codebase Memory");
      expect(output).not.toContain("(source not available)");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints status through the backend command surface", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandBackendStatus({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory index: mock-project");
      expect(output).toContain("status: ready");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints project lists through the backend command surface", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_PROJECTS_PAGE_SIZE", "4");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandBackendProjects({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory projects: 11 (hidden work: 1)");
      expect(output).toContain("current: mock-project");
      expect(output).toContain("nodes=12");
      expect(output).toContain("other projects:");
      expect(output).not.toContain("mock-work");
      expect(output).toContain("other-8");
      expect(
        toolCallArguments("list_projects")
          .filter((args) => args.detail === "stats")
          .map((args) => args.offset),
      ).toEqual([0, 4, 8]);
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("normalizes backend paths against symlinked project roots", () => {
    const aliasRoot = `${workDir}-alias`;
    symlinkSync(workDir, aliasRoot, process.platform === "win32" ? "junction" : "dir");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(codebaseMemoryInspect(aliasRoot, "needle", 2)?.filePath).toBe("src/needle.ts");
      expect(commandBackendProjects({ projectRoot: aliasRoot })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("current: mock-project");
    } finally {
      logSpy.mockRestore();
      rmSync(aliasRoot, { force: true });
    }
  });

  it("prints graph schema through the backend command surface", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandBackendSchema({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory schema: 1 node labels, 1 edge types");
      expect(output).toContain("- node: Function (7)");
      expect(output).toContain("- edge: CALLS (9)");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("runs graph queries through the backend command surface", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendQuery(["MATCH", "(f:Function)", "RETURN", "f.name"], {
          projectRoot: workDir,
          maxRows: 2,
        }),
      ).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory query rows: 1");
      expect(output).toContain("mock-project.src.needle");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints nested backend failures from backend commands", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "query_graph");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendQuery(["MATCH", "(f:Function)", "RETURN", "f.name"], {
          projectRoot: workDir,
        }),
      ).toBe(1);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Could not run Codebase Memory query.");
      expect(output).toContain("reason: project not found or not indexed");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("retries one missing read-only graph query response", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_RETRY_QUERY", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendQuery(["MATCH", "(f:Function)", "RETURN", "f.name"], {
          projectRoot: workDir,
        }),
      ).toBe(0);

      expect(readQueryCalls()).toHaveLength(2);
      expect(codebaseMemoryFailureReason(workDir)).toBeNull();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("renders JSON-encoded query scalar cells without bracket noise", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_JSON_STRING_QUERY", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendQuery(["MATCH", "(n)", "RETURN", "labels(n)"], {
          projectRoot: workDir,
          maxRows: 1,
        }),
      ).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("- Variable");
      expect(output).not.toContain('["Variable"]');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("deduplicates rendered backend query rows", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_DUPLICATE_QUERY", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendQuery(["MATCH", "(n)", "RETURN", "labels(n), n.name"], {
          projectRoot: workDir,
          maxRows: 5,
        }),
      ).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory query rows: 3 (hidden duplicates: 1)");
      expect(output.match(/- Variable \| hashes/g)).toHaveLength(1);
      expect(output).toContain("- File | app.ts");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rejects mutating backend graph queries", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendQuery(["MATCH", "(f)", "DELETE", "f"], {
          projectRoot: workDir,
        }),
      ).toBe(2);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("read-oriented Cypher only");
      expect(readIndexCalls()).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints change impact through the backend command surface", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendChanges({
          projectRoot: workDir,
          since: "HEAD~1",
          depth: 2,
        }),
      ).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain(
        [
          "Codebase Memory changed-code impact:",
          "changed files: 1",
          "- src/needle.ts",
          "impacted symbols: 3",
          "- calleeOne (Function, src/callee.ts)",
          "- ...",
        ].join("\n"),
      );
      expect(toolCallArguments("detect_changes")).toEqual([
        {
          project: "mock-project",
          changed_limit: 5000,
          limit: 5000,
          depth: 2,
          since: "HEAD~1",
          ...responseArguments,
        },
      ]);
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints empty backend change impact without raw JSON", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_CHANGES", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        commandBackendChanges({
          projectRoot: workDir,
          depth: 2,
        }),
      ).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory changed-code impact:");
      expect(output).toContain("none");
      expect(output).not.toContain('"changed_files"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints explicit top-level index refresh timing", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandIndex({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Codebase Memory refresh complete");
      expect(output).toContain("elapsed:");
      expect(output).toContain("Codebase Memory index: mock-project");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints the backend reason when an index refresh fails", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "index_repository");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandBackendStatus({ projectRoot: workDir })).toBe(1);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("Could not read Codebase Memory status.");
      expect(output).toContain("reason: Index refresh failed: project not found or not indexed");
      expect(codebaseMemoryFailureReason(workDir)).toBe(
        "Index refresh failed: project not found or not indexed",
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("opens a fallback answer's stderr with the outage reason and the sandbox remedy", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(path.join(workDir, "src", "needle.ts"), "export const needle = 1;\n", "utf8");
    stubSocketDeniedBackend();

    const result = await runFreshMain(["search", "--graph", "--project-root", workDir, "needle"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "codemap: Codebase Memory could not run, so nothing below comes from it.",
    );
    expect(result.stderr).toContain("socket_bind failed with EPERM");
    expect(result.stderr).toContain("rerun codemap outside the sandbox");
    expect(result.stdout).toContain("Graph fallback: Codebase Memory is unavailable");
  });

  it("names the sandbox remedy in a backend diagnostic's own failure instead of a separate notice", async () => {
    stubSocketDeniedBackend();

    const result = await runFreshMain(["backend", "status", "--project-root", workDir]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Could not read Codebase Memory status.");
    expect(result.stdout).toContain("socket_bind failed with EPERM");
    expect(result.stdout).toContain("rerun codemap outside the sandbox");
    expect(result.stderr).not.toContain("codemap: Codebase Memory could not run");
  });

  it("adds bounded backend function metrics without graph decoration", () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      "export function app() {\n  return 'ok';\n}\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSignals("top", { projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("## Function Metrics");
      expect(output).toContain("src/app.ts:1 app");
      expect(output).toContain("cognitive=20");
      expect(output).not.toContain("exported");
      expect(output).not.toContain("## Backend Graph");
      expect(output).toContain("# Ranked Source Metrics");
      expect(readQueryCalls()[0]).toMatchObject({
        max_rows: 100,
        query: expect.stringContaining("f.is_test = false"),
      });
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("ranks backend function metrics in a language the working tree cannot parse", () => {
    mkdirSync(path.join(workDir, "cmd"), { recursive: true });
    writeFileSync(path.join(workDir, "cmd", "run.go"), "package cmd\n\nfunc Run() {}\n", "utf8");
    vi.stubEnv("CODEBASE_MEMORY_MOCK_GO_METRICS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSignals("top", { projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("coverage: backend only for go; working tree not parsed");
      expect(output).toContain("cmd/run.go:3 Run: cognitive=12, cyclomatic=7, lines=9");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps local function metrics when backend query shape is unknown", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_UNKNOWN_QUERY", "1");
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "app.ts"),
      [
        "function localMetric() {",
        ...Array.from({ length: 18 }, (_, index) => `  const value${index} = ${index};`),
        "  return value17;",
        "}",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSignals("top", { projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("backend: unavailable");
      expect(output).toContain(
        "backend reason: Codebase Memory returned an unknown function-metrics payload.",
      );
      expect(output).toContain("src/app.ts:1 localMetric");
      expect(output).toContain("lines=21, mentions=1");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("merges partial backend and local function metrics before output budgeting", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_SKIPPED_COUNT", "1");
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TWENTY_METRICS", "1");
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `backend${index}.ts`),
        `export function backend${index}() { return ${index}; }\n`,
        "utf8",
      );
    }
    writeFileSync(
      path.join(workDir, "src", "local.ts"),
      [
        "function localMetric() {",
        ...Array.from({ length: 18 }, (_, index) => `  const value${index} = ${index};`),
        "  return value17;",
        "}",
      ].join("\n"),
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSignals("top", { json: true, projectRoot: workDir })).toBe(0);
      const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}"));

      expect(payload.freshness).toBe("partial");
      expect(payload.functionMetrics.length).toBeGreaterThan(20);
      expect(
        payload.functionMetrics.some((row: Record<string, unknown>) => row.name === "localMetric"),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("filters test-heavy backend candidates before applying the final row limit", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_HEAVY_METRICS", "1");
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "candidate.test.ts"),
      "export function testCandidate() { return 'test'; }\n",
      "utf8",
    );
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(
        path.join(workDir, "src", `production${index}.ts`),
        `export function production${index}() { return ${index}; }\n`,
        "utf8",
      );
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSignals("top", { json: true, projectRoot: workDir })).toBe(0);
      const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}"));

      expect(payload.functionMetrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "production0",
            path: "src/production0.ts",
          }),
        ]),
      );
      expect(
        payload.functionMetrics.some(
          (row: Record<string, unknown>) => row.path === "src/candidate.test.ts",
        ),
      ).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});

/** Replaces the backend with one that fails as Codebase Memory 0.12 does inside a command sandbox. */
function stubSocketDeniedBackend(): void {
  const backendPath = path.join(workDir, "denied-backend");
  writeFileSync(
    backendPath,
    [
      "#!/usr/bin/env node",
      'process.stderr.write("codebase-memory-mcp: CBM daemon failed to start: socket_bind failed with EPERM (Operation not permitted)\\n");',
      "process.exitCode = 1;",
    ].join("\n"),
    "utf8",
  );
  chmodSync(backendPath, 0o755);
  vi.stubEnv("CODEMAP_CODEBASE_MEMORY_COMMAND", backendPath);
}

/** Runs the CLI entry on a fresh module graph, because the outage is recorded once per process and earlier tests' backend calls would otherwise hide it. */
async function runFreshMain(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  vi.resetModules();
  const { main } = await import("../src/codemap/commands/cli.js");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const exitCode = await main(["node", "codemap", ...args]);
    return {
      exitCode,
      stdout: logSpy.mock.calls.map((call) => call.join(" ")).join("\n"),
      stderr: stderrSpy.mock.calls.map((call) => String(call[0])).join(""),
    };
  } finally {
    logSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

function readIndexCalls(): unknown[] {
  const logPath = path.join(workDir, "index-calls.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readDeleteCalls(): unknown[] {
  const logPath = path.join(workDir, "delete-calls.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Arguments of every call to one tool, in call order. */
function toolCallArguments(name: string): Record<string, unknown>[] {
  return readToolCalls()
    .filter((call) => call.name === name)
    .map((call) => call.arguments);
}

/** Outside the project root, so working-tree search cannot match logged query arguments. */
function toolLogPath(): string {
  return `${workDir}-tool-calls.jsonl`;
}

function readToolCalls(): { name: string; arguments: Record<string, unknown> }[] {
  const logPath = toolLogPath();
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readQueryCalls(): unknown[] {
  const logPath = path.join(workDir, "query-calls.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readChildCwds(): string[] {
  const logPath = path.join(workDir, "child-cwds.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

type OperationEvent = {
  operationId: string;
  phase: "start" | "end";
  toolName: string;
};

type SchemaCliResult = {
  status: number | null;
  stderr: string;
  stdout: string;
};

function readOperationEvents(): OperationEvent[] {
  const logPath = path.join(workDir, "operation-events.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Runs the public schema command in a separate process for lock verification. */
function runSchemaCli(operationId: string): Promise<SchemaCliResult> {
  return startSchemaCli(operationId).result;
}

/** Starts a schema command and exposes its process for crash-path tests. */
function startSchemaCli(
  operationId: string,
  { queryDelayMs = 200 }: { queryDelayMs?: number } = {},
) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(workspaceRoot, "src", "codemap", "cli.ts"),
      "backend",
      "schema",
      "--project-root",
      workDir,
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CBM_CACHE_DIR: path.join(workDir, "cbm-cache"),
        CODEBASE_MEMORY_MOCK_INDEX_DELAY_MS: "100",
        CODEBASE_MEMORY_MOCK_OPERATION_ID: operationId,
        CODEBASE_MEMORY_MOCK_QUERY_DELAY_MS: String(queryDelayMs),
        CODEMAP_CODEBASE_MEMORY: "1",
        CODEMAP_CODEBASE_MEMORY_COMMAND: serverPath,
      },
    },
  );
  const result = new Promise<SchemaCliResult>((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolve({ status, stderr, stdout });
    });
  });
  return { child, result };
}

/** Waits until one mock backend tool has entered its delayed work. */
async function waitForOperationStart(operationId: string, toolName: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    if (
      readOperationEvents().some(
        (event) =>
          event.operationId === operationId &&
          event.toolName === toolName &&
          event.phase === "start",
      )
    ) {
      return;
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${operationId}:${toolName}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Builds a tiny newline JSON-RPC server for Codebase Memory tool calls. */
function mockServerSource(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");

const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    console.log(JSON.stringify({
      jsonrpc: "2.0", id: message.id,
      result: { protocolVersion: "2024-11-05", serverInfo: { name: "mock-codebase-memory-mcp", version: "0.0.0" }, capabilities: { tools: {} } },
    }));
  } else if (message.method === "tools/call") {
    handleTool(message);
  }
});
function handleTool(toolCall) {
const toolName = toolCall?.params?.name;
const toolArgs = toolCall?.params?.arguments ?? {};
if (toolName === "get_graph_schema" && process.env.CODEBASE_MEMORY_MOCK_LOSE_LOCK_RPC_ERROR) {
  const lockPath = process.env.CODEBASE_MEMORY_MOCK_LOSE_LOCK_RPC_ERROR;
  const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  fs.writeFileSync(lockPath, JSON.stringify({ ...owner, token: "replacement-owner" }));
  console.log(JSON.stringify({ jsonrpc: "2.0", id: toolCall.id, error: { code: -32603, message: "backend failed deliberately" } }));
  return;
}

const root = process.env.CODEBASE_MEMORY_MOCK_ROOT ?? ${JSON.stringify(workDir)};
const indexLogPath = ${JSON.stringify(path.join(workDir, "index-calls.jsonl"))};
const deleteLogPath = ${JSON.stringify(path.join(workDir, "delete-calls.jsonl"))};
const queryLogPath = ${JSON.stringify(path.join(workDir, "query-calls.jsonl"))};
const cwdLogPath = ${JSON.stringify(path.join(workDir, "child-cwds.jsonl"))};
fs.appendFileSync(cwdLogPath, JSON.stringify(process.cwd()) + "\\n");
if (process.env.CODEBASE_MEMORY_MOCK_PID_LOG) fs.appendFileSync(process.env.CODEBASE_MEMORY_MOCK_PID_LOG, String(process.pid) + String.fromCharCode(10));
const operationId = process.env.CODEBASE_MEMORY_MOCK_OPERATION_ID;
if (operationId) {
  const eventLogPath = ${JSON.stringify(path.join(workDir, "operation-events.jsonl"))};
  const appendEvent = (phase) =>
    fs.appendFileSync(
      eventLogPath,
      JSON.stringify({ operationId, phase, toolName }) + "\\n",
    );
  appendEvent("start");
  const delayMs = Number(
    toolName === "index_repository"
      ? process.env.CODEBASE_MEMORY_MOCK_INDEX_DELAY_MS ?? 0
      : toolName === "get_graph_schema"
        ? process.env.CODEBASE_MEMORY_MOCK_QUERY_DELAY_MS ?? 0
        : 0,
  );
  if (delayMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }
  appendEvent("end");
}
fs.appendFileSync(${JSON.stringify(toolLogPath())}, JSON.stringify({ name: toolName, arguments: toolArgs }) + "\\n");
const allProjects = [
  { name: "mock-project", root_path: root, nodes: 12, edges: 34 },
  { name: "mock-work", root_path: ${JSON.stringify(path.join(workDir, "test", ".work", "old"))}, nodes: 4, edges: 3 },
  ...Array.from({ length: 9 }, (_, index) => ({
    name: "other-" + index,
    root_path: ${JSON.stringify(workspaceRoot)} + "/other-" + index,
    nodes: index,
    edges: index + 1,
  })),
];
const projectOffset = toolArgs.offset ?? 0;
const projectPageSize = Number(process.env.CODEBASE_MEMORY_MOCK_PROJECTS_PAGE_SIZE ?? toolArgs.limit ?? allProjects.length);
const codeColumns = ["qn", "label", "file", "lines", "matches", "matches_omitted", "in", "out", "context"];
const codeRow = (qn, file) => [qn, "Function", file, "4-8", [5], 0, 1, 1, { context: "export function needle() {\\n  return 'needle';\\n", context_start: 4 }];
const graphColumns = ["qn", "label", "file", "lines", "rank"];
const graphRows =
  process.env.CODEBASE_MEMORY_MOCK_EMPTY_GRAPH === "1"
    ? []
    : process.env.CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS === "1"
      ? [
          ["mock-project.src.Runner.__init__", "Method", "src/runner.ts", "2-4", -12.5],
          ["mock-project.src.Runner", "Class", "src/runner.ts", "1-9", -11.25],
          ["mock-project.src.RunnerConfig", "Class", "src/runner.ts", "11-14", -10.5],
        ].filter((row) => toolArgs.label === undefined || row[1] === toolArgs.label)
      : [
          ["mock-project.src.needle", "Function", "src/needle.ts", "4-8", -19.05778987685244],
          ...(process.env.CODEBASE_MEMORY_MOCK_AMBIGUOUS_INSPECT === "1"
            ? [["mock-project.other.needle", "Function", "src/other.ts", "1-3", -18.5]]
            : []),
        ];
const semanticRows =
  process.env.CODEBASE_MEMORY_MOCK_EMPTY_GRAPH === "1"
    ? []
    : process.env.CODEBASE_MEMORY_MOCK_MANY_SEMANTIC === "1"
      ? Array.from({ length: 20 }, (_, index) => [
          "mock-project.src.semanticNeedle" + index,
          "Function",
          "src/semantic-needle.ts",
          0.987 - index / 1000,
        ])
      : [
          [
            process.env.CODEBASE_MEMORY_MOCK_TEST_ONLY === "1"
              ? "mock-project.tests.semanticNeedle"
              : "mock-project.src.semanticNeedle",
            "Function",
            process.env.CODEBASE_MEMORY_MOCK_TEST_ONLY === "1"
              ? "tests/semantic-needle.test.ts"
              : "src/semantic-needle.ts",
            process.env.CODEBASE_MEMORY_MOCK_LOW_SEMANTIC === "1" ? 0.49 : 0.987,
          ],
        ];
const traceRule = 'qn = qn_prefix == "" ? name : qn_prefix + "." + name';
const payloads = {
  index_repository: {
	project: process.env.CODEBASE_MEMORY_MOCK_NO_INDEX_PROJECT === "1" ? null : "mock-project",
	nodes: 12,
	edges: 34,
	skipped_count: Number(process.env.CODEBASE_MEMORY_MOCK_SKIPPED_COUNT ?? 0),
    status: process.env.CODEBASE_MEMORY_MOCK_INDEX_FAIL === "1" ? "failed" : process.env.CODEBASE_MEMORY_MOCK_INDEX_STATUS === "" ? undefined : process.env.CODEBASE_MEMORY_MOCK_INDEX_STATUS ?? "ready",
  },
  list_projects: {
    projects: allProjects.slice(projectOffset, projectOffset + projectPageSize),
    has_more: projectOffset + projectPageSize < allProjects.length,
  },
  delete_project: {
    project: "mock-project",
    status: "deleted",
  },
  get_graph_schema: {
    node_labels: [
      {
        label: "Function",
        count: 7,
      },
    ],
    edge_types: [
      {
        type: "CALLS",
        count: 9,
      },
    ],
  },
  get_architecture:
    process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_ARCHITECTURE === "1"
      ? { message: "ok" }
      : process.env.CODEBASE_MEMORY_MOCK_SPARSE_ARCHITECTURE === "1"
      ? {
          project: "mock-project",
          total_nodes: 24,
          total_edges: 32,
          node_labels: { cols: ["label", "count"], rows: [["File", 12], ["Module", 12]] },
          edge_types: { cols: ["type", "count"], rows: [["DEFINES", 12]] },
        }
      : {
          project: "mock-project",
          total_nodes: 12,
          total_edges: 34,
          node_labels: { cols: ["label", "count"], rows: [["Function", 7], ["File", 5]] },
          edge_types: { cols: ["type", "count"], rows: [["CALLS", 9]] },
          languages: { cols: ["language", "files"], rows: [["TypeScript", 2]] },
          hotspots: {
            cols: ["qn", "fan_in"],
            rows: [
              ["mock-project.store.get", 9],
              ["mock-project.src.needle", 3],
            ],
          },
          clusters: {
            cols: ["id", "label", "members", "cohesion", "top_nodes", "packages", "edge_types"],
            rows: [
              [1, "core", 4, 0.75, ["needle", "get", "needle", "callerOne", "hiddenTestHelper"], ["src"], ["CALLS"]],
            ],
          },
          entry_points: { cols: ["qn", "file"], rows: [["mock-project.src.main", "src/main.ts"]] },
          file_tree: { cols: ["path", "type", "children"], rows: [["src/needle.ts", "file", 0]] },
          ...(process.env.CODEBASE_MEMORY_MOCK_LARGE_ARCHITECTURE === "1"
            ? { transport_padding: "x".repeat(128 * 1024) }
            : {}),
        },
  search_code:
	process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_SEARCH === "1"
	  ? { status: "ambiguous", suggestions: ["mock-project.src.needle"] }
	  : process.env.CODEBASE_MEMORY_MOCK_EMPTY_SEARCH === "1"
      ? { cols: codeColumns, rows: [], total_grep_matches: 0, has_more: false }
      : {
          cols: codeColumns,
          rows: [
            ...(process.env.CODEBASE_MEMORY_MOCK_TEST_WORDS === "1"
              ? [
                  codeRow("mock-project.src.testament", "src/testament.ts"),
                  codeRow("mock-project.src.testParser", "src/parser.ts"),
                ]
              : []),
            ...(process.env.CODEBASE_MEMORY_MOCK_TEST_FIRST === "1"
              ? [codeRow("mock-project.tests.testNeedle", "tests/needle.test.ts")]
              : []),
            ...(process.env.CODEBASE_MEMORY_MOCK_TEST_ONLY === "1"
              ? [codeRow("mock-project.tests.testNeedle", "tests/needle.test.ts")]
              : [codeRow("mock-project.src.needle", "src/needle.ts")]),
          ],
          total_grep_matches: 3,
          has_more: false,
        },
  search_graph:
    typeof toolArgs.semantic_query === "string"
      ? 'semantic_query must be an array of keyword strings, e.g. ["send","pubsub","publish"]'
      : Array.isArray(toolArgs.semantic_query)
      ? {
          groups: [],
          semantic: { cols: ["qn", "label", "file", "score"], rows: semanticRows },
          semantic_has_more: process.env.CODEBASE_MEMORY_MOCK_MANY_SEMANTIC === "1",
        }
      : { cols: graphColumns, rows: graphRows, search_mode: "bm25", has_more: false },
  get_code_snippet:
    process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_SNIPPET === "1"
      ? { message: "ok" }
      : {
          name: "needle",
          qualified_name: "mock-project.src.needle",
          label: "Function",
          file_path: ${JSON.stringify(path.join(workDir, "src", "needle.ts"))},
          start_line: 4,
          end_line: 8,
          source_mode: "full",
          source: "export function needle() {\\n  return 'needle';\\n}",
          callers: 1,
          callees: 1,
        },
  trace_path: {
    function: toolArgs.function_name,
    direction: toolArgs.direction,
    mode: toolArgs.mode,
    callers: {
      qn_rule: traceRule,
      cols: ["name", "hop"],
      groups: [{ qn_prefix: "mock-project.src", rows: [["needle", 1], ["callerOne", 1], ["callerOne", 1]] }],
    },
    callees: {
      qn_rule: traceRule,
      cols: ["name", "hop"],
      groups: [{ qn_prefix: "mock-project.src", rows: [["needle", 1], ["calleeOne", 1]] }],
    },
  },
  query_graph:
	process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_QUERY === "1"
	  ? { message: "ok" }
	  : toolArgs.query?.includes("WHERE n.qualified_name =")
	  ? {
	      columns: ["signature", "return_type", "complexity", "cognitive", "lines"],
	      rows: [
	        [
	          process.env.CODEBASE_MEMORY_MOCK_ARGUMENT_SIGNATURE === "1"
	            ? "(\\\\n  *,\\\\n  value: string,\\\\n)"
	            : "function needle()",
	          process.env.CODEBASE_MEMORY_MOCK_BARE_RETURN_TYPE === "1" ? "string" : ": string",
	          "2",
	          "3",
	          "5",
	        ],
	      ],
	      total: 1,
	    }
	  : toolArgs.query?.includes("f.cognitive") &&
	toolArgs.max_rows === 100 &&
	toolArgs.query?.includes("MATCH (f:Function|Method)") &&
	toolArgs.query?.includes("ORDER BY") &&
	!toolArgs.query?.includes("LIMIT")
	  ? {
	      columns: [
	        "name",
	        "file_path",
	        "start_line",
	        "end_line",
	        "lines",
	        "complexity",
	        "cognitive",
	        "linear_scan_in_loop",
	      ],
	      rows: process.env.CODEBASE_MEMORY_MOCK_TEST_HEAVY_METRICS === "1"
	        ? [
	            ...Array.from({ length: 80 }, (_, index) => [
	              "testCandidate" + index,
	              "src/candidate.test.ts",
	              1,
	              1,
	              1,
	              200 - index,
	              300 - index,
	              0,
	            ]),
	            ...Array.from({ length: 20 }, (_, index) => [
	              "production" + index,
	              "src/production" + index + ".ts",
	              1,
	              1,
	              1,
	              20 - index,
	              30 - index,
	              0,
	            ]),
	          ]
	        : process.env.CODEBASE_MEMORY_MOCK_TWENTY_METRICS === "1"
	        ? Array.from({ length: 20 }, (_, index) => [
	            "backend" + index,
	            "src/backend" + index + ".ts",
	            1,
	            1,
	            1,
	            11 + index,
	            20 + index,
	            0,
	          ])
	        : process.env.CODEBASE_MEMORY_MOCK_GO_METRICS === "1"
	        ? [["Run", "cmd/run.go", 3, 11, 0, 7, 12, 0]]
	        : [["app", "src/app.ts", 1, 3, 3, 11, 20, 0]],
	      total: 1,
	    }
	  : process.env.CODEBASE_MEMORY_MOCK_JSON_STRING_QUERY === "1"
      ? {
          total: 1,
          rows: [["[\\"Variable\\"]"]],
        }
      : process.env.CODEBASE_MEMORY_MOCK_DUPLICATE_QUERY === "1"
        ? {
            total: 3,
            rows: [
              ["Variable", "hashes"],
              ["Variable", "hashes"],
              ["[\\"File\\"]", "app.ts"],
            ],
          }
        : {
          total: 1,
          rows: [
            {
              qualified_name: "mock-project.src.needle",
              complexity: 2,
            },
          ],
        },
  detect_changes:
    process.env.CODEBASE_MEMORY_MOCK_EMPTY_CHANGES === "1"
      ? {
          changed_files: [],
          changed_total: 0,
          changed_has_more: false,
          impacted: [],
          impacted_total: 0,
          impacted_has_more: false,
        }
      : {
          changed_files: ["src/needle.ts"],
          changed_total: 1,
          changed_has_more: false,
          impacted: [{ qn: "mock-project.src.calleeOne", label: "Function", file: "src/callee.ts", hop: 1 }],
          impacted_total: 3,
          impacted_has_more: true,
        },
};
if (toolName === "index_repository") {
  fs.appendFileSync(indexLogPath, JSON.stringify(toolCall?.params?.arguments ?? {}) + "\\n");
}
if (toolName === "delete_project") {
  fs.appendFileSync(deleteLogPath, JSON.stringify(toolCall?.params?.arguments ?? {}) + "\\n");
}
if (toolName === "query_graph") {
  fs.appendFileSync(queryLogPath, JSON.stringify(toolCall?.params?.arguments ?? {}) + "\\n");
}
const omitToolResponse =
  process.env.CODEBASE_MEMORY_MOCK_RETRY_QUERY === "1" &&
  toolName === "query_graph" &&
  fs.readFileSync(queryLogPath, "utf8").split(/\\r?\\n/).filter(Boolean).length === 1;
const payload =
  process.env.CODEBASE_MEMORY_MOCK_ERROR_TOOL === toolName
    ? { error: "project not found or not indexed" }
    : payloads[toolName] ?? {};

const toolResult =
  process.env.CODEBASE_MEMORY_MOCK_IS_ERROR === "1"
    ? {
        isError: true,
        content: [{ type: "text", text: "pattern is required" }],
      }
    : process.env.CODEBASE_MEMORY_MOCK_STRUCTURED_CONTENT === "1"
      ? {
          structuredContent: payload,
          content: [{ type: "text", text: "non-json fallback" }],
        }
      : {
          content: [
            {
              type: "text",
              text:
                process.env.CODEBASE_MEMORY_MOCK_PLAIN_ERROR === "1"
                  ? "unknown tool: search_code"
                  : JSON.stringify(payload),
            },
          ],
        };

if (!omitToolResponse) {
  console.log(JSON.stringify({
    jsonrpc: "2.0",
    id: toolCall.id,
    result: toolResult,
  }));
} else {
  process.exit(0);
}
}
`;
}
