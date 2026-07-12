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
	codebaseMemoryQueryRows,
	codebaseMemoryReadyProject,
} from "../src/codemap/codebase-memory/index.js";
import {
	printCodebaseMemoryArchitectureSummary,
	printCodebaseMemoryGraphSearch,
	printCodebaseMemorySearch,
	printCodebaseMemorySemanticSearch,
	renderCodebaseMemoryArchitectureSummary,
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

	it("reads mocked CodebaseMemory tool payloads", () => {
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
	});

	it("indexes ready projects before use", () => {
		const project = codebaseMemoryReadyProject(workDir);

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

	it("indexes before every backend readiness check", () => {
		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
			name: "mock-project",
			status: "ready",
		});
		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
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

	it("rejects index responses without a project name", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_NO_INDEX_PROJECT", "1");

		expect(codebaseMemoryReadyProject(workDir)).toBeNull();
	});

	it("rejects missing, nonterminal, and unknown index statuses", () => {
		for (const status of ["", "indexing", "queued", "mystery"]) {
			vi.stubEnv("CODEBASE_MEMORY_MOCK_INDEX_STATUS", status);

			expect(codebaseMemoryReadyProject(workDir)).toBeNull();
		}
	});

	it("marks indexes with skipped files as partial", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_SKIPPED_COUNT", "2");

		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
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
				projects: expect.arrayContaining([
					expect.objectContaining({ name: "mock-project" }),
				]),
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
			expect(printCodebaseMemoryArchitectureSummary(workDir)).toBe(true);
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
			expect(printCodebaseMemoryArchitectureSummary(workDir)).toBe(true);
			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

			expect(output).toContain("node labels: File 12, Module 12");
			expect(output).toContain(
				"note: no function/class/method nodes; summary is file-level only.",
			);
			expect(output).not.toContain("## Hotspots");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("notes when architecture summaries only have file-level nodes", () => {
		const output = renderCodebaseMemoryArchitectureSummary({
			project: "sparse-project",
			total_nodes: 10,
			total_edges: 8,
			node_labels: [
				{ label: "Folder", count: 3 },
				{ label: "File", count: 2 },
				{ label: "Module", count: 2 },
			],
			edge_types: [{ type: "DEFINES", count: 4 }],
		});

		expect(output).toContain("project: sparse-project");
		expect(output).toContain(
			"note: no function/class/method nodes; summary is file-level only.",
		);
	});

	it("hides generic architecture hotspots and cluster names", () => {
		const output = renderCodebaseMemoryArchitectureSummary({
			project: "busy-project",
			total_nodes: 100,
			total_edges: 200,
			node_labels: [{ label: "Function", count: 10 }],
			hotspots: [
				{ name: "get", fan_in: 30 },
				{
					name: "handleRequest",
					fan_in: 12,
					qualified_name: "app.server.handleRequest",
				},
			],
			clusters: [
				{
					label: "server",
					members: 5,
					top_nodes: ["get", "send", "handleRequest", "routeRequest"],
				},
			],
		});

		expect(output).toContain("## Hotspots (hidden generic: 1)");
		expect(output).toContain("- handleRequest");
		expect(output).not.toContain("- get");
		expect(output).toContain("top: handleRequest, routeRequest");
		expect(output).not.toContain("top: get");
	});

	it("replaces repeated cluster labels with their top symbols", () => {
		const output = renderCodebaseMemoryArchitectureSummary({
			project: "clustered-project",
			node_labels: [{ label: "Function", count: 10 }],
			clusters: [
				{ label: "src", members: 5, top_nodes: ["alpha", "beta"] },
				{ label: "src", members: 4, top_nodes: ["gamma", "delta"] },
			],
		});

		expect(output).toContain("- alpha, beta (5 nodes)");
		expect(output).toContain("- gamma, delta (4 nodes)");
		expect(output).not.toContain("- src");
	});

	it("omits generic utility hotspots and unreliable backend entry points", () => {
		const output = renderCodebaseMemoryArchitectureSummary({
			project: "utility-project",
			node_labels: [{ label: "Function", count: 10 }],
			hotspots: [
				{ name: "recordValue", fan_in: 30 },
				{ name: "runWorkflow", fan_in: 8 },
			],
			entry_points: [{ name: "syntaxMatches", file: "src/search.ts" }],
		});

		expect(output).not.toContain("- recordValue");
		expect(output).toContain("- runWorkflow");
		expect(output).not.toContain("## Entry Points");
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

	it("lets low-score semantic graph rows fall back instead of printing noise", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_LOW_SEMANTIC", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(printCodebaseMemorySemanticSearch(workDir, "needle", 2)).toBe(
				false,
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
				false,
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
			expect(printCodebaseMemoryArchitectureSummary(workDir)).toBe(false);
			expect(logSpy).not.toHaveBeenCalled();
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

	it("returns ready project metadata after the required index pass", () => {
		expect(codebaseMemoryReadyProject(workDir)).toMatchObject({
			name: "mock-project",
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

			expect(output).toContain("CodebaseMemory projects: 11 (hidden work: 1)");
			expect(output).toContain("current: mock-project");
			expect(output).toContain("nodes=12");
			expect(output).toContain("other projects:");
			expect(output).not.toContain("mock-work");
			expect(output).toContain("- ... 1 more");
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

	it("renders JSON-encoded query scalar cells without bracket noise", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_JSON_STRING_QUERY", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				commandMemoryQuery(["MATCH", "(n)", "RETURN", "labels(n)"], {
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
				commandMemoryQuery(["MATCH", "(n)", "RETURN", "labels(n), n.name"], {
					projectRoot: workDir,
					maxRows: 5,
				}),
			).toBe(0);
			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

			expect(output).toContain(
				"CodebaseMemory query rows: 3 (hidden duplicates: 1)",
			);
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

	it("prints empty backend change impact without raw JSON", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_EMPTY_CHANGES", "1");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				commandMemoryChanges({
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

	it("adds bounded backend function pressure without graph decoration", () => {
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

			expect(output).toContain("## Function Pressure");
			expect(output).toContain("src/app.ts:1 app");
			expect(output).toContain("cognitive=20");
			expect(output).not.toContain("exported");
			expect(output).not.toContain("## Backend Graph");
			expect(output).toContain("# Refactor Signals");
			expect(output.split("\n").length).toBeLessThanOrEqual(20);
			expect(readIndexCalls()).toHaveLength(1);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("keeps local function pressure when backend query shape is unknown", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_UNKNOWN_QUERY", "1");
		mkdirSync(path.join(workDir, "src"), { recursive: true });
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"function localPressure() {",
				...Array.from(
					{ length: 18 },
					(_, index) => `  const value${index} = ${index};`,
				),
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
			expect(output).toContain("src/app.ts:1 localPressure");
			expect(output).toContain("lines=21, mentions=1");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("caps partial backend and local pressure after merging", () => {
		vi.stubEnv("CODEBASE_MEMORY_MOCK_SKIPPED_COUNT", "1");
		vi.stubEnv("CODEBASE_MEMORY_MOCK_FOUR_PRESSURE", "1");
		mkdirSync(path.join(workDir, "src"), { recursive: true });
		for (let index = 0; index < 4; index += 1) {
			writeFileSync(
				path.join(workDir, "src", `backend${index}.ts`),
				`export function backend${index}() { return ${index}; }\n`,
				"utf8",
			);
		}
		writeFileSync(
			path.join(workDir, "src", "local.ts"),
			[
				"function localPressure() {",
				...Array.from(
					{ length: 18 },
					(_, index) => `  const value${index} = ${index};`,
				),
				"  return value17;",
				"}",
			].join("\n"),
			"utf8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(commandSignals("top", { json: true, projectRoot: workDir })).toBe(
				0,
			);
			const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}"));

			expect(payload.freshness).toBe("partial");
			expect(payload.functionPressure).toHaveLength(4);
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
	toolArgs.max_rows === undefined &&
	!toolArgs.query?.includes("ORDER BY") &&
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
	      rows: process.env.CODEBASE_MEMORY_MOCK_FOUR_PRESSURE === "1"
	        ? Array.from({ length: 4 }, (_, index) => [
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
console.log(JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  result: toolResult,
}));
`;
}
