/** Checks summary CLI markdown output on a small fixture project. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
		expect(result.stdout).toContain("files analyzed from the current tree.");
		expect(result.stdout).toContain("## Source Shape");
		expect(result.stdout).toContain("## Inventory");
		expect(result.stdout).toContain("## Likely Entries");
		expect(result.stdout).toContain("## Intent Clues");
		expect(result.stdout).toContain("- README: # Example Project");
	});
});
