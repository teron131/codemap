/** Checks search command handler output and semantic fallback status. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandSearch } from "../src/codemap/commands/index.js";
import { semanticIndexPath } from "../src/codemap/common.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
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
	rmSync(workDir, { recursive: true, force: true });
});

describe("search command handler", () => {
	it("prints source matches and unavailable semantic search status", async () => {
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
		).resolves.toBe(1);

		const output = logLines().join("\n");
		expect(output).toContain("Search: needle");
		expect(output).toContain("\nSource matches:");
		expect(output).toContain("[symbol]");
		expect(output).toContain("\nSemantic card matches:");
		expect(output).toContain(
			`  unavailable: semantic index not found at ${semanticIndexPath(workDir)}`,
		);
		expect(output).toContain(
			`  run: codemap semantic init --project-root ${workDir}`,
		);
	});

	it("matches Python's missing query message", async () => {
		await expect(commandSearch([], { projectRoot: workDir })).resolves.toBe(2);
		expect(logLines()).toEqual([
			"Search requires text or a search subcommand: match, calls, or rule.",
		]);
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
