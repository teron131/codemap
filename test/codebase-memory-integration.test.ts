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
  printCodebaseMemoryGraphSearch,
  printCodebaseMemorySearch,
  printCodebaseMemorySemanticSearch,
} from "../src/codemap/search/codebase-memory.js";
import {
  codebaseMemoryInspect,
  renderCodebaseMemoryInspect,
} from "../src/codemap/source/inspection/index.js";

const workspaceRoot = process.cwd();
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

  it("reads tool payloads outside upstream session discovery", () => {
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
      },
    ]);
    expect(readDeleteCalls()).toEqual([{ project: "mock-project" }]);
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
      },
      {
        mode: "full",
        persistence: false,
        repo_path: workDir,
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
    ).toThrow("CodebaseMemory project operations must be synchronous");
    expect(invoked).toBe(false);
    expect(readDeleteCalls()).toHaveLength(1);
    expect(readIndexCalls()).toHaveLength(1);
  });

  it("serializes concurrent same-root refreshes through their queries", async () => {
    const [first, second] = await Promise.all([runSchemaCli("first"), runSchemaCli("second")]);

    expect(first).toMatchObject({ status: 0 });
    expect(second).toMatchObject({ status: 0 });
    expect(first.stdout).toContain("CodebaseMemory schema");
    expect(second.stdout).toContain("CodebaseMemory schema");
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

  it("lets backend rendering fall back when a CodebaseMemory tool returns an error payload", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "search_code");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySearch(workDir, "needle", 1)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets backend rendering fall back when CodebaseMemory search returns no matches", () => {
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

      expect(output).toContain("CodebaseMemory code matches:");
      expect(output).toContain("results: 1");
      expect(output).toContain("- needle");
      expect(output).not.toContain('"results"');
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
      expect(output).not.toContain("CodebaseMemory code matches:");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prioritizes backend code search over ordinary current-tree evidence", async () => {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "approval-policy.ts"),
      "export const commandApprovalPolicy = true;\n",
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
      expect(output).toContain("CodebaseMemory code matches:");
      expect(output).toContain("- needle");
      expect(output).not.toContain("src/approval-policy.ts");
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

  it("lets graph rendering fall back when CodebaseMemory graph search returns no matches", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_GRAPH", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBe(false);
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 1)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact backend graph search rows", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("CodebaseMemory graph matches:");
      expect(output).toContain("mode: graph");
      expect(output).toContain("results: 1");
      expect(output).toContain("- needle");
      expect(output).not.toContain('"results"');
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
        }),
      ).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("results: 1");
      expect(output).toContain("hidden filtered: 1");
      expect(output).toContain("- Runner (");
      expect(output).toContain(", Class)");
      expect(output).not.toContain("- __init__");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("applies relationship and degree filters to backend graph rows before rendering", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        printCodebaseMemoryGraphSearch(workDir, "Runner", 3, {
          minDegree: 2,
          relationship: "CALLS",
        }),
      ).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("results: 1");
      expect(output).toContain("hidden filtered: 1");
      expect(output).toContain("- Runner");
      expect(output).not.toContain("- __init__");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("falls back when backend graph degree filters hide every row", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        printCodebaseMemoryGraphSearch(workDir, "Runner", 3, {
          maxDegree: 0,
        }),
      ).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
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
      ).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("suppresses negative backend scores in graph search rows", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_SCORE_LIKE_RANK", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("- needle (");
      expect(output).toContain(", Function)");
      expect(output).not.toContain("score=-19.058");
      expect(output).not.toContain("rank=-19");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact backend architecture summaries", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("# CodebaseMemory Architecture");
      expect(output).toContain("nodes: 12, edges: 34");
      expect(output).toContain("node labels: Function 7");
      expect(output).toContain("## Hotspots (hidden generic: 1)");
      expect(output).toContain("- needle (fan-in 3, mock-project.src.needle)");
      expect(output).toContain("top: needle, callerOne");
      expect(output).not.toContain("top: needle, needle");
      expect(output).not.toContain("- get (fan-in");
      expect(output).not.toContain('"file_tree"');
      expect(output).not.toContain('"node_labels"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("notes sparse backend architecture summaries without symbol nodes", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_SPARSE_ARCHITECTURE", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandSummary({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("node labels: File 12, Module 12");
      expect(output).toContain("note: no function/class/method nodes; summary is file-level only.");
      expect(output).not.toContain("## Hotspots");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints compact semantic graph search rows from semantic_results", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(true);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("CodebaseMemory semantic matches:");
      expect(output).toContain("mode: semantic");
      expect(output).toContain("semantic results: 1");
      expect(output).toContain("- semanticNeedle");
      expect(output).toContain("score=0.987");
      expect(output).not.toContain('"results"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lets low-score semantic graph rows fall back instead of printing noise", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_LOW_SEMANTIC", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("falls back when default filters hide every semantic match", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_TEST_ONLY", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(false);
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
      expect(output).not.toContain("# CodebaseMemory Architecture");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("treats plain-text CodebaseMemory validation failures as failed tool calls", () => {
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

  it("normalizes CodebaseMemory inspect payloads behind the query adapter", () => {
    expect(codebaseMemoryInspect(workDir, "needle", 2)).toMatchObject({
      name: "needle",
      filePath: "src/needle.ts",
      startLine: 4,
      endLine: 8,
      signalFacts: ["complexity=2", "cognitive=3", "lines=5"],
      signature: "function needle(): string",
      source: "export function needle() {\n  return 'needle';\n}",
      callers: ["callerOne"],
      callees: ["calleeOne"],
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

  it("renders compact CodebaseMemory inspect output without graph internals", () => {
    const result = codebaseMemoryInspect(workDir, "needle", 2);

    if (result === null) {
      throw new Error("expected backend inspect result");
    }
    const output = renderCodebaseMemoryInspect(result, { limit: 2 });

    expect(output).toContain("Source: src/needle.ts:4-8");
    expect(output).toContain("Signals: complexity=2, cognitive=3, lines=5");
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

      expect(output).toContain("CodebaseMemory index: mock-project");
      expect(output).toContain("status: ready");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints project lists through the backend command surface", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandBackendProjects({ projectRoot: workDir })).toBe(0);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("CodebaseMemory projects: 11 (hidden work: 1)");
      expect(output).toContain("current: mock-project");
      expect(output).toContain("nodes=12");
      expect(output).toContain("other projects:");
      expect(output).not.toContain("mock-work");
      expect(output).toContain("other-8");
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

      expect(output).toContain("CodebaseMemory schema: 1 node labels, 1 edge types");
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

      expect(output).toContain("CodebaseMemory query rows: 1");
      expect(output).toContain("mock-project.src.needle");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints nested provider failures from backend commands", () => {
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

      expect(output).toContain("CodebaseMemory query rows: 3 (hidden duplicates: 1)");
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

      expect(output).toContain("CodebaseMemory changed-code impact:");
      expect(output).toContain("src/needle.ts");
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

      expect(output).toContain("CodebaseMemory changed-code impact:");
      expect(output).toContain("none");
      expect(output).toContain("depth: 2");
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

      expect(output).toContain("CodebaseMemory refresh complete");
      expect(output).toContain("elapsed:");
      expect(output).toContain("CodebaseMemory index: mock-project");
      expect(readIndexCalls()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints the provider reason when an index refresh fails", () => {
    vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "index_repository");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(commandBackendStatus({ projectRoot: workDir })).toBe(1);
      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(output).toContain("No Codebase Memory index for this project.");
      expect(output).toContain("reason: Index refresh failed: project not found or not indexed");
      expect(codebaseMemoryFailureReason(workDir)).toBe(
        "Index refresh failed: project not found or not indexed",
      );
    } finally {
      logSpy.mockRestore();
    }
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
      });
      expect(readIndexCalls()).toHaveLength(1);
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

/** Reads mock index_repository call records written by the MCP test server. */
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

/** Reads mock delete_project call records written by the MCP test server. */
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

/** Reads mock query_graph call records written by the MCP test server. */
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

/** Reads child working directories recorded by the MCP test server. */
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

/** Reads cross-process tool events emitted by the MCP test server. */
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

/** Yields briefly while process-level test fixtures make progress. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Builds a tiny newline JSON-RPC server for CodebaseMemory tool calls. */
function mockServerSource(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");

const input = fs.readFileSync(0, "utf8");
const lines = input
  .split(/\\r?\\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const calls = lines.map((line) => JSON.parse(line));
const toolCall = calls.find((call) => call.method === "tools/call");
const toolName = toolCall?.params?.name;
const toolArgs = toolCall?.params?.arguments ?? {};
const root = process.env.CODEBASE_MEMORY_MOCK_ROOT ?? ${JSON.stringify(workDir)};
const indexLogPath = ${JSON.stringify(path.join(workDir, "index-calls.jsonl"))};
const deleteLogPath = ${JSON.stringify(path.join(workDir, "delete-calls.jsonl"))};
const queryLogPath = ${JSON.stringify(path.join(workDir, "query-calls.jsonl"))};
const cwdLogPath = ${JSON.stringify(path.join(workDir, "child-cwds.jsonl"))};
fs.appendFileSync(cwdLogPath, JSON.stringify(process.cwd()) + "\\n");
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
const payloads = {
  index_repository: {
	project: process.env.CODEBASE_MEMORY_MOCK_NO_INDEX_PROJECT === "1" ? null : "mock-project",
	nodes: 12,
	edges: 34,
	skipped_count: Number(process.env.CODEBASE_MEMORY_MOCK_SKIPPED_COUNT ?? 0),
    status: process.env.CODEBASE_MEMORY_MOCK_INDEX_FAIL === "1" ? "failed" : process.env.CODEBASE_MEMORY_MOCK_INDEX_STATUS === "" ? undefined : process.env.CODEBASE_MEMORY_MOCK_INDEX_STATUS ?? "ready",
  },
  list_projects: {
    projects: [
      {
        name: "mock-project",
        root_path: root,
        nodes: 12,
        edges: 34,
      },
      {
        name: "mock-work",
        root_path: ${JSON.stringify(path.join(workDir, "test", ".work", "old"))},
        nodes: 4,
        edges: 3,
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        name: "other-" + index,
        root_path: ${JSON.stringify(workspaceRoot)} + "/other-" + index,
        nodes: index,
        edges: index + 1,
      })),
    ],
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
          node_labels: [
            {
              label: "File",
              count: 12,
            },
            {
              label: "Module",
              count: 12,
            },
          ],
          edge_types: [
            {
              type: "DEFINES",
              count: 12,
            },
          ],
        }
      : {
          project: "mock-project",
          total_nodes: 12,
          total_edges: 34,
          node_labels: [
            {
              label: "Function",
              count: 7,
            },
            {
              label: "File",
              count: 5,
            },
          ],
          edge_types: [
            {
              type: "CALLS",
              count: 9,
            },
          ],
          languages: [
            {
              language: "TypeScript",
              file_count: 2,
            },
          ],
          hotspots: [
            {
              name: "get",
              fan_in: 9,
              qualified_name: "mock-project.store.get",
            },
            {
              name: "needle",
              fan_in: 3,
              qualified_name: "mock-project.src.needle",
            },
          ],
          clusters: [
            {
              label: "core",
              members: 4,
              cohesion: 0.75,
              top_nodes: ["needle", "get", "needle", "callerOne"],
            },
          ],
          entry_points: [
            {
              name: "main",
              file: "src/main.ts",
            },
          ],
          file_tree: [
            {
              path: "src/needle.ts",
              type: "file",
            },
          ],
        },
  search_code:
	process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_SEARCH === "1"
	  ? { status: "ambiguous", suggestions: ["mock-project.src.needle"] }
	  : process.env.CODEBASE_MEMORY_MOCK_EMPTY_SEARCH === "1"
      ? {
          results: [],
          raw_matches: [],
          total_results: 0,
          raw_match_count: 0,
        }
      : {
          results: [
            ...(process.env.CODEBASE_MEMORY_MOCK_TEST_FIRST === "1"
              ? [
                  {
                    node: "testNeedle",
                    qualified_name: "mock-project.tests.testNeedle",
                    file: ${JSON.stringify(path.join(workDir, "tests", "needle.test.ts"))},
                  },
                ]
              : []),
            ...(process.env.CODEBASE_MEMORY_MOCK_TEST_ONLY === "1"
              ? [
                  {
                    node: "testNeedle",
                    qualified_name: "mock-project.tests.testNeedle",
                    file: ${JSON.stringify(path.join(workDir, "tests", "needle.test.ts"))},
                  },
                ]
              : [
                  {
                    node: "needle",
                    qualified_name: "mock-project.src.needle",
                  },
                ]),
          ],
          raw_matches: [],
          total_results:
            process.env.CODEBASE_MEMORY_MOCK_TEST_FIRST === "1" ? 2 : 1,
          raw_match_count: 0,
        },
  search_graph:
    typeof toolArgs.semantic_query === "string"
      ? 'semantic_query must be an array of keyword strings, e.g. ["send","pubsub","publish"]'
      : process.env.CODEBASE_MEMORY_MOCK_EMPTY_GRAPH === "1"
      ? {
          results: [],
          semantic_results: [],
          total_results: 0,
        }
      : Array.isArray(toolArgs.semantic_query)
      ? {
          search_mode: "semantic",
          total: 1,
          results: [],
          semantic_results: [
            {
              name: "semanticNeedle",
              qualified_name:
                process.env.CODEBASE_MEMORY_MOCK_TEST_ONLY === "1"
                  ? "mock-project.tests.semanticNeedle"
                  : "mock-project.src.semanticNeedle",
			  label: "Function",
              file_path:
                process.env.CODEBASE_MEMORY_MOCK_TEST_ONLY === "1"
                  ? ${JSON.stringify(path.join(workDir, "tests", "semantic-needle.test.ts"))}
                  : ${JSON.stringify(path.join(workDir, "src", "semantic-needle.ts"))},
              score: process.env.CODEBASE_MEMORY_MOCK_LOW_SEMANTIC === "1" ? 0 : 0.987,
            },
          ],
          has_more: false,
        }
      : process.env.CODEBASE_MEMORY_MOCK_MIXED_GRAPH_ROWS === "1"
      ? {
          search_mode: "graph",
          results: [
            {
              name: "__init__",
              qualified_name: "mock-project.src.Runner.__init__",
              file_path: ${JSON.stringify(path.join(workDir, "src", "runner.ts"))},
              label: "Method",
              relationships: [{ type: "DEFINES" }],
              degree: 1,
            },
            {
              name: "Runner",
              qualified_name: "mock-project.src.Runner",
              file_path: ${JSON.stringify(path.join(workDir, "src", "runner.ts"))},
              label: "Class",
              relationships: [{ type: "CALLS" }, { type: "DEFINES" }],
              degree: 2,
            },
          ],
          semantic_results: [],
          total_results: 2,
        }
      : {
          results: [
            {
              name: "needle",
              qualified_name: "mock-project.src.needle",
              file_path: ${JSON.stringify(path.join(workDir, "src", "needle.ts"))},
              start_line: 4,
              end_line: 8,
              rank: process.env.CODEBASE_MEMORY_MOCK_SCORE_LIKE_RANK === "1" ? -19.05778987685244 : 1,
              rerank_score: process.env.CODEBASE_MEMORY_MOCK_SCORE_LIKE_RANK === "1" ? undefined : 0.87,
              label: "Function",
              language: "TypeScript",
            },
			...(process.env.CODEBASE_MEMORY_MOCK_AMBIGUOUS_INSPECT === "1"
			  ? [
			      {
			        name: "needle",
			        qualified_name: "mock-project.other.needle",
			        file_path: ${JSON.stringify(path.join(workDir, "src", "other.ts"))},
			        start_line: 1,
			        end_line: 3,
			        label: "Function",
			      },
			    ]
			  : []),
          ],
          connected_nodes: [
            {
              relationship: "CALLS",
              qualified_name: "mock-project.src.calleeOne",
            },
          ],
          semantic_results: [],
          total_results: 1,
        },
  get_code_snippet:
    process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_SNIPPET === "1"
      ? { message: "ok" }
      : {
    name: "needle",
    qualified_name: "mock-project.src.needle",
    file_path: ${JSON.stringify(path.join(workDir, "src", "needle.ts"))},
    start_line: 4,
    end_line: 8,
    complexity: 2,
    cognitive: 3,
    lines: 5,
    signature:
      process.env.CODEBASE_MEMORY_MOCK_ARGUMENT_SIGNATURE === "1"
        ? "( *, value: string, )"
        : "function needle()",
    return_type: process.env.CODEBASE_MEMORY_MOCK_BARE_RETURN_TYPE === "1" ? "string" : ": string",
    source: "export function needle() {\\n  return 'needle';\\n}",
		  caller_names: ["callerOne"],
		  callee_names: ["calleeOne"],
		},
  trace_path:
    process.env.CODEBASE_MEMORY_MOCK_EMPTY_TRACE === "1"
      ? {
          paths: [],
          total_paths: 0,
        }
      : {
          function: toolArgs.function_name,
          direction: toolArgs.direction,
          mode: toolArgs.mode,
          callers: [
            {
              name: toolArgs.function_name,
              hop: 1,
              risk: "HIGH",
            },
            {
              name: "callerOne",
              hop: 1,
              risk: "HIGH",
            },
            {
              name: "callerOne",
              hop: 1,
              risk: "HIGH",
            },
          ],
          callees: [
            {
              name: toolArgs.function_name,
              hop: 1,
              risk: "MEDIUM",
            },
            {
              name: "calleeOne",
              hop: 1,
              risk: "MEDIUM",
            },
            ...(process.env.CODEBASE_MEMORY_MOCK_GENERIC_TRACE === "1"
              ? [
                  {
                    name: "append",
                    hop: 2,
                    risk: "HIGH",
                  },
                  {
                    name: "get",
                    hop: 2,
                    risk: "HIGH",
                  },
                ]
              : []),
          ],
          paths: [
            {
              from: "mock-project.src.caller",
              to: "mock-project.src.needle",
            },
          ],
          total_paths: 1,
        },
  query_graph:
	process.env.CODEBASE_MEMORY_MOCK_UNKNOWN_QUERY === "1"
	  ? { message: "ok" }
	  : toolArgs.query?.includes("f.cognitive") &&
	toolArgs.max_rows === 100 &&
	toolArgs.query?.includes("MATCH (f:Function)") &&
	toolArgs.query?.includes("ORDER BY") &&
	!toolArgs.query?.includes("LIMIT")
	  ? {
	      columns: [
	        "name",
	        "file_path",
	        "start_line",
	        "lines",
	        "complexity",
	        "cognitive",
	        "linear_scan_in_loop",
	        "is_exported",
	        "is_test",
	      ],
	      rows: process.env.CODEBASE_MEMORY_MOCK_TEST_HEAVY_METRICS === "1"
	        ? [
	            ...Array.from({ length: 80 }, (_, index) => [
	              "testCandidate" + index,
	              "src/candidate.test.ts",
	              1,
	              1,
	              200 - index,
	              300 - index,
	              0,
	              false,
	              false,
	            ]),
	            ...Array.from({ length: 20 }, (_, index) => [
	              "production" + index,
	              "src/production" + index + ".ts",
	              1,
	              1,
	              20 - index,
	              30 - index,
	              0,
	              true,
	              false,
	            ]),
	          ]
	        : process.env.CODEBASE_MEMORY_MOCK_TWENTY_METRICS === "1"
	        ? Array.from({ length: 20 }, (_, index) => [
	            "backend" + index,
	            "src/backend" + index + ".ts",
	            1,
	            1,
	            11 + index,
	            20 + index,
	            0,
	            true,
	            false,
	          ])
	        : [["app", "src/app.ts", 1, 3, 11, 20, 0, true, false]],
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
          changed_count: 0,
          impacted_symbols: [],
          depth: 2,
        }
      : {
          changes: [
            {
              file: "src/needle.ts",
              impact: "calleeOne",
            },
          ],
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

console.log(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "mock-codebase-memory-mcp", version: "0.0.0" },
    capabilities: { tools: {} },
  },
}));
if (!omitToolResponse) {
  console.log(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    result: toolResult,
  }));
}
`;
}
