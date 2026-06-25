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
	codebaseMemoryReadyProject,
} from "../src/codemap/codebaseMemory/index.js";
import {
	tryPrintCodebaseMemoryCallTrace,
	tryPrintCodebaseMemoryGraphSearch,
	tryPrintCodebaseMemorySearch,
	tryPrintCodebaseMemorySemanticSearch,
} from "../src/codemap/codebaseMemory/renderers.js";

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

	it("indexes ready projects before use when detect_changes reports dirty-tree changes", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_CHANGED_COUNT", "7");

		const project = codebaseMemoryReadyProject(workDir);

		expect(project).toMatchObject({
			name: "mock-project",
			rootPath: workDir,
			status: "ready",
			changedCount: 0,
		});
		expect(readIndexCalls()).toEqual([
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

	it("lets renderers fall back when a CodebaseMemory tool returns an error payload", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_ERROR_TOOL", "search_code");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(tryPrintCodebaseMemorySearch(workDir, "needle", 1)).toBe(false);
			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("lets renderers fall back when CodebaseMemory search returns no matches", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_SEARCH", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(tryPrintCodebaseMemorySearch(workDir, "needle", 1)).toBe(false);
			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("lets graph renderers fall back when CodebaseMemory graph search returns no matches", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_GRAPH", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(tryPrintCodebaseMemoryGraphSearch(workDir, "needle", 1)).toBe(
				false,
			);
			expect(tryPrintCodebaseMemorySemanticSearch(workDir, "needle", 1)).toBe(
				false,
			);
			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("lets call trace renderers fall back when CodebaseMemory trace search returns no paths", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_TRACE", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(tryPrintCodebaseMemoryCallTrace(workDir, "needle")).toBe(false);
			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("indexes projects when index_status is not ready", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_STATUS", "indexing");

		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
			name: "mock-project",
			rootPath: workDir,
			status: "ready",
			changedCount: 0,
		});
		expect(readIndexCalls()).toHaveLength(1);
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
const root = process.env.CODEBASE_MEMORY_MOCK_ROOT ?? ${JSON.stringify(workDir)};
const indexLogPath = ${JSON.stringify(path.join(workDir, "index-calls.jsonl"))};
const indexed = fs.existsSync(indexLogPath);
const status =
  indexed && process.env.CODEBASE_MEMORY_MOCK_INDEX_FAIL !== "1"
    ? "ready"
    : process.env.CODEBASE_MEMORY_MOCK_STATUS ?? "ready";
const changedCount = indexed
  ? 0
  : Number.parseInt(process.env.CODEBASE_MEMORY_MOCK_CHANGED_COUNT ?? "0", 10);

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
  detect_changes: {
    changed_files: changedCount > 0 ? ["src/dirty.ts"] : [],
    changed_count: changedCount,
    impacted_symbols: [],
    depth: 1,
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
    process.env.CODEBASE_MEMORY_MOCK_EMPTY_GRAPH === "1"
      ? {
          results: [],
          semantic_results: [],
          total_results: 0,
        }
      : {
          results: [
            {
              qualified_name: "mock-project.src.needle",
            },
          ],
          semantic_results: [],
          total_results: 1,
        },
  trace_path:
    process.env.CODEBASE_MEMORY_MOCK_EMPTY_TRACE === "1"
      ? {
          paths: [],
          total_paths: 0,
        }
      : {
          paths: [
            {
              from: "mock-project.src.caller",
              to: "mock-project.src.needle",
            },
          ],
          total_paths: 1,
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
