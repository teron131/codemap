/** Checks signals CLI JSON output on a small fixture project. */
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
		`cli-signals-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

describe("signals CLI", () => {
	it("prints selected signal payload JSON", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"/** App docs. */",
				"export function run(value: string) {",
				"  return helper(value);",
				"}",
				"function helper(value: string) {",
				"  return value;",
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
				"signals",
				"--project-root",
				workDir,
				"--json",
				"files",
			],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			files: [
				{
					file: "src/app.ts",
					total: 3,
					defines: 2,
					imports_local: 0,
					exports: 1,
					reexports_local: 0,
					extends: 0,
					inherits: 0,
					jsx_components: 0,
					decorators: 0,
					samples: ["run", "helper"],
				},
			],
		});
	});
});
