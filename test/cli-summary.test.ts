/** Checks summary CLI markdown output on a small fixture project. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandSummary } from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`cli-summary-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
	process.chdir(workspaceRoot);
	rmSync(workDir, { recursive: true, force: true });
});

describe("summary CLI", () => {
	it("prints the current-tree markdown summary", () => {
		writeFileSync(
			path.join(workDir, "README.md"),
			["# Example Project", "", "Fixture docs."].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "app.py"),
			[
				'"""App entry docs."""',
				"import json",
				"",
				"def main():",
				"    return json.dumps({'ok': True})",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "tool.ts"),
			[
				"/** Tool docs. */",
				"export function tool() {",
				"  return 'ok';",
				"}",
			].join("\n"),
			"utf8",
		);
		mkdirSync(path.join(workDir, "src", "_generated"), { recursive: true });
		writeFileSync(
			path.join(workDir, "src", "_generated", "client.ts"),
			"export function generatedClient() {\n  return 'skip me';\n}\n",
			"utf8",
		);

		const result = spawnSync(
			"pnpm",
			[
				"exec",
				"tsx",
				"src/codemap/cli.ts",
				"summary",
				"--project-root",
				workDir,
			],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("# ");
		expect(result.stdout).toContain("3 files analyzed from the current tree.");
		expect(result.stdout).toContain("## Source Shape");
		expect(result.stdout).toContain("## Inventory");
		expect(result.stdout).toContain("## Likely Entries");
		expect(result.stdout).toContain("## Intent Clues");
		expect(result.stdout).toContain("- README: # Example Project");
	});

	it("defaults to the nearest git root and uses project-root as an explicit scope", () => {
		writeFileSync(
			path.join(workDir, "README.md"),
			["# Root Project", "", "Fixture docs."].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			"export function app() {\n  return 'ok';\n}\n",
			"utf8",
		);
		expect(spawnSync("git", ["init"], { cwd: workDir }).status).toBe(0);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			process.chdir(path.join(workDir, "src"));
			expect(commandSummary({})).toBe(0);
			const defaultOutput = logLines(logSpy).join("\n");
			expect(defaultOutput).toContain("# ");
			expect(defaultOutput).toContain(
				"2 files analyzed from the current tree.",
			);
			expect(defaultOutput).toContain("- README: # Root Project");

			logSpy.mockClear();
			expect(commandSummary({ projectRoot: "." })).toBe(0);
			const scopedOutput = logLines(logSpy).join("\n");
			expect(scopedOutput).toContain("1 file analyzed from the current tree.");
			expect(scopedOutput).not.toContain("- README: # Root Project");
		} finally {
			logSpy.mockRestore();
		}
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(logSpy: ReturnType<typeof vi.spyOn>): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
