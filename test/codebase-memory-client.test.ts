/** Checks CodebaseMemory readiness and status behavior with mocked MCP output. */
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	callCodebaseMemoryTool,
	codebaseMemoryInspect,
	codebaseMemoryReadyProject,
} from "../src/codemap/codebase-memory/index.js";
import {
	printCodebaseMemoryCallTrace,
	printCodebaseMemoryGraphSearch,
	printCodebaseMemorySearch,
	printCodebaseMemorySemanticSearch,
	renderCodebaseMemoryInspect,
} from "../src/codemap/codebase-memory/render.js";
import {
	commandIndex,
	commandInspect,
	commandMemoryChanges,
	commandMemoryProjects,
	commandMemoryQuery,
	commandMemorySchema,
	commandMemoryStatus,
	commandSignals,
} from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let serverPath: string;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`codebase-memory-client-${process.pid}-${Date.now()}`,
	);
	mkdirSync(workDir, { recursive: true });
	serverPath = path.join(workDir, "mock-codebase-memory-mcp.cjs");
	writeFileSync(serverPath, mockServerSource(), "utf8");
	chmodSync(serverPath, 0o755);
	vi.stubEnv("CODEMAP_CODEBASE_MEMORY", "1");
	vi.stubEnv("CODEMAP_CODEBASE_MEMORY_COMMAND", serverPath);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(workDir, { recursive: true, force: true });
});

describe("CodebaseMemory client", () => {
	it("reads mocked CodebaseMemory tool payloads", () => {
		const result = callCodebaseMemoryTool("list_projects", {});
		if (!result.ok) {
			throw new Error(result.reason);
		}
		expect(result).toMatchObject({
			ok: true,
			value: {
				projects: [
					{
						name: "mock-project",
						root_path: workDir,
					},
				],
			},
		});
	});

	it("indexes ready projects before use", () => {
		const project = codebaseMemoryReadyProject(workDir);

		expect(project).toMatchObject({
			name: "mock-project",
			rootPath: workDir,
			status: "ready",
		});
		expect(readIndexCalls()).toEqual([
			{
				mode: "full",
				repo_path: workDir,
			},
		]);
	});

	it("indexes before every backend readiness check", () => {
		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
			name: "mock-project",
			rootPath: workDir,
			status: "ready",
		});
		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
			name: "mock-project",
			rootPath: workDir,
			status: "ready",
		});
		expect(readIndexCalls()).toEqual([
			{
				mode: "full",
				repo_path: workDir,
			},
			{
				mode: "full",
				repo_path: workDir,
			},
		]);
	});

	it("does not match list_projects entries with empty roots", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_ROOT", "");

		expect(codebaseMemoryReadyProject(workDir)).toBeNull();
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

	it("lets graph rendering fall back when CodebaseMemory graph search returns no matches", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_GRAPH", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(printCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBe(false);
			expect(printCodebaseMemorySemanticSearch(workDir, "needle", 1)).toBe(
				false,
			);
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

	it("prints compact semantic graph search rows from semantic_results", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(
				true,
			);
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

	it("lets call trace rendering fall back when CodebaseMemory trace search returns no paths", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_TRACE", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(printCodebaseMemoryCallTrace(workDir, "needle")).toBe(false);
			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints compact backend call traces", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(printCodebaseMemoryCallTrace(workDir, "needle")).toBe(true);
			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

			expect(output).toContain("CodebaseMemory call trace:");
			expect(output).toContain("function: needle");
			expect(output).toContain("Callers: 1");
			expect(output).toContain("- callerOne (hop 1, high)");
			expect(output).not.toContain('"callers"');
		} finally {
			logSpy.mockRestore();
		}
	});

	it("normalizes CodebaseMemory inspect payloads behind the query adapter", () => {
		expect(codebaseMemoryInspect(workDir, "needle", 2)).toMatchObject({
			name: "needle",
			qualifiedName: "mock-project.src.needle",
			filePath: "src/needle.ts",
			startLine: 4,
			endLine: 8,
			matchRank: 1,
			matchScore: 0.87,
			signalFacts: ["complexity=2", "cognitive=3", "lines=5"],
			graphFacts: ["label=Function", "language=TypeScript"],
			signature: "function needle(): string",
			source: "export function needle() {\n  return 'needle';\n}",
			callers: ["callerOne (hop 1, high)"],
			callees: ["calleeOne (hop 1, medium)"],
			related: ["callerOne", "calleeOne"],
			graphNeighbors: ["CALLS: mock-project.src.calleeOne"],
		});
	});

	it("renders enriched CodebaseMemory inspect output with graph rank and neighbors", () => {
		const result = codebaseMemoryInspect(workDir, "needle", 2);

		if (result === null) {
			throw new Error("expected backend inspect result");
		}
		const output = renderCodebaseMemoryInspect(result, { limit: 2 });

		expect(output).toContain("Match: rank=1, score=0.87");
		expect(output).toContain("label=Function");
		expect(output).toContain("## Graph Neighborhood");
		expect(output).toContain("- CALLS: mock-project.src.calleeOne");
	});

	it("renders score-like graph rank values as scores", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_SCORE_LIKE_RANK", "1");
		const result = codebaseMemoryInspect(workDir, "needle", 2);

		if (result === null) {
			throw new Error("expected backend inspect result");
		}
		const output = renderCodebaseMemoryInspect(result, { limit: 2 });

		expect(result.matchRank).toBeNull();
		expect(result.matchScore).toBe(-19.05778987685244);
		expect(output).toContain("Match: score=-19.058");
		expect(output).not.toContain("rank=-19");
	});

	it("combines backend inspect and current-tree evidence by default", () => {
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

			expect(output).toContain("Backend: Codebase Memory");
			expect(output).toContain("## Current Tree Evidence");
			expect(output).toContain("### needle in src/needle.ts:1");
			expect(output).toContain("calls: helper in src/needle.ts:5");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("returns ready project metadata after the required index pass", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_STATUS", "indexing");

		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
			name: "mock-project",
			rootPath: workDir,
			status: "ready",
		});
		expect(readIndexCalls()).toHaveLength(1);
	});

	it("prints memory status through the backend command surface", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(commandMemoryStatus({ projectRoot: workDir })).toBe(0);
			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

			expect(output).toContain("CodebaseMemory index: mock-project");
			expect(output).toContain("status: ready");
			expect(readIndexCalls()).toHaveLength(1);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints backend project list through the memory command surface", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(commandMemoryProjects({ projectRoot: workDir })).toBe(0);
			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

			expect(output).toContain("CodebaseMemory projects: 1");
			expect(output).toContain("- mock-project");
			expect(output).toContain("nodes=12");
			expect(readIndexCalls()).toHaveLength(1);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints backend graph schema through the memory command surface", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(commandMemorySchema({ projectRoot: workDir })).toBe(0);
			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

			expect(output).toContain(
				"CodebaseMemory schema: 1 node labels, 1 edge types",
			);
			expect(output).toContain("- node: Function (7)");
			expect(output).toContain("- edge: CALLS (9)");
			expect(readIndexCalls()).toHaveLength(1);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("runs backend graph queries through the memory command surface", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				commandMemoryQuery(["MATCH", "(f:Function)", "RETURN", "f.name"], {
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

	it("rejects mutating backend graph queries", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				commandMemoryQuery(["MATCH", "(f)", "DELETE", "f"], {
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

	it("prints backend change impact through the memory command surface", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				commandMemoryChanges({
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

	it("adds backend graph context to signal output when available", () => {
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

			expect(output).toContain("## Backend Graph");
			expect(output).toContain("- backend: Codebase Memory");
			expect(output).toContain("- project: mock-project");
			expect(output).toContain("# Refactor Signals");
			expect(readIndexCalls()).toHaveLength(1);
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
const indexed = fs.existsSync(indexLogPath);
const status =
  indexed && process.env.CODEBASE_MEMORY_MOCK_INDEX_FAIL !== "1"
    ? "ready"
    : process.env.CODEBASE_MEMORY_MOCK_STATUS ?? "ready";

const payloads = {
  index_repository: {
    project: "mock-project",
    status: process.env.CODEBASE_MEMORY_MOCK_INDEX_FAIL === "1" ? "failed" : "ready",
  },
  list_projects: {
    projects: [
      {
        name: "mock-project",
        root_path: root,
        nodes: 12,
        edges: 34,
      },
    ],
  },
  index_status: {
    project: "mock-project",
    nodes: 12,
    edges: 34,
    status,
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
  search_code:
    process.env.CODEBASE_MEMORY_MOCK_EMPTY_SEARCH === "1"
      ? {
          results: [],
          raw_matches: [],
          total_results: 0,
          raw_match_count: 0,
        }
      : {
          results: [
            {
              node: "needle",
              qualified_name: "mock-project.src.needle",
            },
          ],
          raw_matches: [],
          total_results: 1,
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
              qualified_name: "mock-project.src.semanticNeedle",
              label: "Function",
              file_path: ${JSON.stringify(path.join(workDir, "src", "semantic-needle.ts"))},
              score: 0.987,
            },
          ],
          has_more: false,
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
  get_code_snippet: {
    name: "needle",
    qualified_name: "mock-project.src.needle",
    file_path: ${JSON.stringify(path.join(workDir, "src", "needle.ts"))},
    start_line: 4,
    end_line: 8,
    complexity: 2,
    cognitive: 3,
    lines: 5,
    signature: "function needle()",
    return_type: ": string",
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
              name: "callerOne",
              hop: 1,
              risk: "HIGH",
            },
          ],
          callees: [
            {
              name: "calleeOne",
              hop: 1,
              risk: "MEDIUM",
            },
          ],
          paths: [
            {
              from: "mock-project.src.caller",
              to: "mock-project.src.needle",
            },
          ],
          total_paths: 1,
        },
  query_graph: {
    total: 1,
    rows: [
      {
        qualified_name: "mock-project.src.needle",
        complexity: 2,
      },
    ],
  },
  detect_changes: {
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
const payload =
  process.env.CODEBASE_MEMORY_MOCK_ERROR_TOOL === toolName
    ? { error: "project not found or not indexed" }
    : payloads[toolName] ?? {};

console.log(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "mock-codebase-memory-mcp", version: "0.0.0" },
    capabilities: { tools: {} },
  },
}));
console.log(JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  result: {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  },
}));
`;
}
