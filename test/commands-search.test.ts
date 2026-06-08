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
			`  unavailable: no semantic index: ${semanticIndexPath(workDir)}`,
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

	it("prints partial fallback matches when the full phrase misses", async () => {
		writeFileSync(
			path.join(workDir, "package.json"),
			'{ "artifact": true }\n',
			"utf8",
		);
		writeFileSync(path.join(workDir, "README.md"), "artifact docs\n", "utf8");
		writeFileSync(
			path.join(workDir, "src", "pdf.ts"),
			[
				"export function writeManifest() {",
				"  return 'artifact manifest source path';",
				"}",
				"",
				"export function matchRows() {",
				"  return 'match result rows';",
				"}",
			].join("\n"),
			"utf8",
		);

		await expect(
			commandSearch(["where", "artifacts", "matches", "saved"], {
				projectRoot: workDir,
				limit: "3",
			}),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("Search: where artifacts matches saved");
		expect(output).not.toContain("\nSource matches:");
		expect(output).toContain("\nNo matches, fallback to partial matches:");
		expect(output).toContain("  artifact:");
		expect(output).toContain("src/pdf.ts");
		expect(output).not.toContain("package.json");
		expect(output).toContain("artifact manifest source path");
		expect(output).toContain("    ...");
		expect(output).toContain("  match:");
		expect(output).not.toContain("  matche:");
	});

	it("prints graph search relationships without internal edge syntax", async () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"import { helper } from './helper';",
				"export function run(value: string) {",
				"  return helper(value);",
				"}",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "helper.ts"),
			"export function helper(value: string) {\n  return value;\n}\n",
			"utf8",
		);

		await expect(
			commandSearch(["helper"], {
				graph: true,
				projectRoot: workDir,
				limit: "2",
			}),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("\nRelationship matches:");
		expect(output).toContain("helper in src/helper.ts");
		expect(output).toContain("imported by: src/app.ts");
		expect(output).not.toContain("--imports-->");
		expect(output).not.toContain("function:src/");
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
