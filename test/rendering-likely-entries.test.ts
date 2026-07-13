/** Checks current-tree summary entry ranking behavior. */
import { describe, expect, it } from "vitest";

import {
	buildLikelyEntries,
	buildPathRankedLikelyEntries,
} from "../src/codemap/rendering/index.js";
import type {
	GraphNode,
	GraphPayload,
} from "../src/codemap/source/graph/index.js";

describe("likely entry rendering", () => {
	it("prefers production entry files over test files in normal graph rankings", () => {
		const entries = buildLikelyEntries(
			[node("src/index.ts"), node("src/index.test.ts"), node("src/helpers.ts")],
			[
				{
					source: "src/helpers.ts",
					target: "src/index.test.ts",
					type: "imports",
				},
				{ source: "src/index.ts", target: "src/helpers.ts", type: "imports" },
			],
		);

		expect(entries.map((entry) => entry.title)).not.toContain(
			"src/index.test.ts",
		);
		expect(entries[0]?.title).toBe("src/index.ts");
	});

	it("prefers core large-repo fallback entries over alphabetical extension entries", () => {
		const entries = buildPathRankedLikelyEntries([
			node("extensions/acpx/index.ts"),
			node("extensions/active-memory/index.ts"),
			node("extensions/admin-http-rpc/index.ts"),
			node("src/index.ts"),
			node("src/cli/acp-cli.ts"),
			node("src/cli/run-main.test.ts"),
			node("src/cli/run-main.ts"),
			node("src/gateway/server.ts"),
			node("src/tools/index.ts"),
			node("ui/src/main.ts"),
			node("test/helpers/index.ts"),
		]);
		expect(entries.map((entry) => entry.title).slice(0, 5)).toEqual([
			"src/index.ts",
			"src/cli/run-main.ts",
			"src/gateway/server.ts",
			"ui/src/main.ts",
			"src/tools/index.ts",
		]);
		expect(entries.map((entry) => entry.role).slice(0, 5)).toEqual([
			"package surface",
			"cli entry",
			"server entry",
			"entry file",
			"package surface",
		]);
		expect(entries.map((entry) => entry.reason).slice(0, 3)).toEqual([
			"public index or package initializer",
			"conventional CLI path or filename",
			"conventional server or gateway filename",
		]);
		expect(entries[0]?.description).toBe(
			"Fallback entry candidate; detailed graph skipped.",
		);
		expect(entries[0]?.role).toBe("package surface");
	});

	it("prefers package and implementation surfaces over utility centrality", () => {
		const entries = buildLikelyEntries(
			[
				pythonNode("libs/langchain/langchain_classic/tools/ainetwork/app.py"),
				pythonNode("libs/langchain/langchain_classic/_api/__init__.py"),
				pythonNode("libs/core/langchain_core/exceptions.py"),
				pythonNode("libs/core/langchain_core/language_models/chat_models.py"),
				pythonNode("libs/langchain_v1/langchain/agents/middleware/types.py"),
				pythonNode("libs/core/langchain_core/agents.py"),
				pythonNode("libs/core/langchain_core/runnables/config.py"),
				pythonNode("libs/langchain_v1/langchain/agents/factory.py"),
				pythonNode("libs/langchain_v1/langchain/agents/__init__.py"),
			],
			[
				...incomingEdges(
					"libs/langchain/langchain_classic/_api/__init__.py",
					800,
				),
				...outgoingEdges(
					"libs/langchain/langchain_classic/_api/__init__.py",
					2,
				),
				...incomingEdges("libs/core/langchain_core/exceptions.py", 72),
				...incomingEdges(
					"libs/core/langchain_core/language_models/chat_models.py",
					39,
				),
				...outgoingEdges(
					"libs/core/langchain_core/language_models/chat_models.py",
					26,
				),
				...incomingEdges(
					"libs/langchain_v1/langchain/agents/middleware/types.py",
					55,
				),
				...outgoingEdges(
					"libs/langchain_v1/langchain/agents/middleware/types.py",
					7,
				),
				...incomingEdges("libs/core/langchain_core/agents.py", 59),
				...outgoingEdges("libs/core/langchain_core/agents.py", 2),
				...incomingEdges("libs/core/langchain_core/runnables/config.py", 41),
				...incomingEdges("libs/langchain_v1/langchain/agents/factory.py", 22),
				...outgoingEdges("libs/langchain_v1/langchain/agents/factory.py", 9),
				...incomingEdges("libs/langchain_v1/langchain/agents/__init__.py", 42),
				...outgoingEdges("libs/langchain_v1/langchain/agents/__init__.py", 2),
				{
					source: "libs/langchain/langchain_classic/tools/ainetwork/app.py",
					target: "libs/core/langchain_core/tools/__init__.py",
					type: "imports",
				},
			],
		);

		expect(entries.map((entry) => entry.title).slice(0, 5)).toEqual([
			"libs/langchain_v1/langchain/agents/__init__.py",
			"libs/core/langchain_core/language_models/chat_models.py",
			"libs/core/langchain_core/agents.py",
			"libs/langchain_v1/langchain/agents/factory.py",
			"libs/core/langchain_core/runnables/config.py",
		]);
		expect(entries.map((entry) => entry.title).slice(0, 5)).not.toContain(
			"libs/core/langchain_core/exceptions.py",
		);
		expect(entries.map((entry) => entry.title).slice(0, 5)).not.toContain(
			"libs/langchain/langchain_classic/_api/__init__.py",
		);
		expect(entries.map((entry) => entry.title)).toContain(
			"libs/langchain/langchain_classic/_api/__init__.py",
		);
		expect(entries.slice(0, 4).map((entry) => entry.role)).toEqual([
			"package surface",
			"high-centrality source",
			"high-centrality source",
			"implementation surface",
		]);
		expect(entries[0]?.reason).toBe("public index or package initializer");
		expect(entries[3]?.reason).toBe("workflow-owning implementation filename");
	});

	it("limits package surfaces before filling likely entries with implementations", () => {
		const entries = buildLikelyEntries(
			[
				pythonNode("libs/core/langchain_core/messages/__init__.py"),
				pythonNode("libs/core/langchain_core/language_models/__init__.py"),
				pythonNode("libs/core/langchain_core/callbacks/__init__.py"),
				pythonNode("libs/core/langchain_core/runnables/__init__.py"),
				pythonNode("libs/core/langchain_core/language_models/chat_models.py"),
				node("libs/langchain-classic/src/load/import_map.ts"),
				pythonNode("libs/langchain_v1/langchain/agents/factory.py"),
			],
			[
				...incomingEdges("libs/core/langchain_core/messages/__init__.py", 80),
				...incomingEdges(
					"libs/core/langchain_core/language_models/__init__.py",
					70,
				),
				...incomingEdges("libs/core/langchain_core/callbacks/__init__.py", 60),
				...incomingEdges("libs/core/langchain_core/runnables/__init__.py", 50),
				...incomingEdges(
					"libs/core/langchain_core/language_models/chat_models.py",
					45,
				),
				...outgoingEdges("libs/langchain-classic/src/load/import_map.ts", 100),
				...incomingEdges("libs/langchain_v1/langchain/agents/factory.py", 30),
			],
		);

		const titles = entries.map((entry) => entry.title);
		expect(titles.slice(0, 2)).toEqual([
			"libs/core/langchain_core/messages/__init__.py",
			"libs/core/langchain_core/language_models/__init__.py",
		]);
		expect(titles.slice(2, 4).sort()).toEqual([
			"libs/core/langchain_core/language_models/chat_models.py",
			"libs/langchain_v1/langchain/agents/factory.py",
		]);
		expect(entries.slice(0, 4).map((entry) => entry.role)).toEqual([
			"package surface",
			"package surface",
			"implementation surface",
			"high-centrality source",
		]);
		expect(entries[2]?.reason).toBe("workflow-owning implementation filename");
		expect(titles.slice(0, 5)).not.toContain(
			"libs/langchain-classic/src/load/import_map.ts",
		);
	});
});

function node(filePath: string): GraphNode {
	const name = filePath.split("/").at(-1) ?? filePath;
	const entryNames = new Set([
		"app.ts",
		"app.tsx",
		"index.ts",
		"index.tsx",
		"main.ts",
		"main.tsx",
		"server.ts",
	]);
	const tags = ["code", "typescript"];
	if (filePath.includes("test")) {
		tags.push("test");
	}
	if (entryNames.has(name)) {
		tags.push("entry-candidate");
	}
	return {
		id: filePath,
		type: "file",
		name,
		filePath,
		summary: "",
		tags,
		complexity: "low",
	};
}

function pythonNode(filePath: string): GraphNode {
	const name = filePath.split("/").at(-1) ?? filePath;
	const tags = ["code", "python"];
	if (filePath.includes("test")) {
		tags.push("test");
	}
	if (["__main__.py", "app.py", "main.py"].includes(name)) {
		tags.push("entry-candidate");
	}
	return {
		id: filePath,
		type: "file",
		name,
		filePath,
		summary: "",
		tags,
		complexity: "low",
	};
}

function incomingEdges(target: string, count: number): GraphPayload["edges"] {
	return Array.from({ length: count }, (_, index) => ({
		source: `source-${target}-${index}`,
		target,
		type: "imports",
	}));
}

function outgoingEdges(source: string, count: number): GraphPayload["edges"] {
	return Array.from({ length: count }, (_, index) => ({
		source,
		target: `target-${source}-${index}`,
		type: "imports",
	}));
}
