/** Checks search command handler output and backend search fallback status. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildParser,
	commandSearch,
	dispatch,
} from "../src/codemap/commands/index.js";

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
	rmSync(workDir, {
		recursive: true,
		force: true,
		maxRetries: 3,
		retryDelay: 10,
	});
});

describe("search command handler", () => {
	it("infers language for call search from target files", async () => {
		writeFileSync(
			path.join(workDir, "src", "calls.ts"),
			[
				"helper('one');",
				"const value = helper('two');",
				"const untouched = helper;",
			].join("\n"),
			"utf8",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"search",
				"calls",
				"--project-root",
				workDir,
				"helper",
				"src/calls.ts",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("src/calls.ts:1:1: helper('one')");
		expect(output).toContain("src/calls.ts:2:15: helper('two')");
		expect(output).not.toContain("const untouched = helper;");
	});

	it("accepts cwd-relative call search target paths when project root is inferred", async () => {
		const cwd = process.cwd();
		const nestedDir = path.join(workDir, "src", "nested");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(
			path.join(nestedDir, "local.ts"),
			[
				"helper('one');",
				"const value = helper('two');",
				"const untouched = helper;",
			].join("\n"),
			"utf8",
		);

		try {
			process.chdir(nestedDir);
			await expect(
				dispatch(buildParser(), [
					"node",
					"codemap",
					"search",
					"calls",
					"helper",
					"local.ts",
				]),
			).resolves.toBe(0);
		} finally {
			process.chdir(cwd);
		}

		const output = logLines().join("\n");
		expect(output).toContain("local.ts");
		expect(output).toContain("helper('one')");
		expect(output).toContain("helper('two')");
		expect(output).not.toContain("const untouched = helper;");
	});

	it("prints no matches for empty call search results", async () => {
		writeFileSync(path.join(workDir, "src", "calls.ts"), "const value = 1;\n");

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"search",
				"calls",
				"--project-root",
				workDir,
				"missingCall",
				"src/calls.ts",
			]),
		).resolves.toBe(1);

		expect(logLines()).toEqual(["No matches"]);
	});

	it("rejects invalid backend trace flags for call search", async () => {
		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"search",
				"calls",
				"--project-root",
				workDir,
				"--mode",
				"sideways",
				"helper",
			]),
		).resolves.toBe(2);

		expect(logLines()).toEqual([
			"Invalid trace mode: sideways. Choose one of: calls, data_flow, cross_service.",
		]);
	});

	it("prints source matches and backend semantic fallback status", async () => {
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
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("Search: needle");
		expect(output).toContain("\nSource matches:");
		expect(output).toContain("[symbol]");
		expect(output).toContain("\nSemantic graph matches:");
		expect(output).toContain(
			"  unavailable: Codebase Memory semantic search returned no answer; used current-tree search fallback.",
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
			'{ "manifest": true }\n',
			"utf8",
		);
		writeFileSync(path.join(workDir, "README.md"), "manifest docs\n", "utf8");
		writeFileSync(
			path.join(workDir, "src", "pdf.ts"),
			[
				"export function writeManifest() {",
				"  return 'manifest source path';",
				"}",
				"",
				"export function matchRows() {",
				"  return 'match result rows';",
				"}",
			].join("\n"),
			"utf8",
		);

		await expect(
			commandSearch(["where", "manifest", "matches", "saved"], {
				projectRoot: workDir,
				limit: "3",
			}),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("Search: where manifest matches saved");
		expect(output).not.toContain("\nSource matches:");
		expect(output).toContain("\nNo matches, fallback to partial matches:");
		expect(output).toContain("  manifest:");
		expect(output).toContain("src/pdf.ts");
		expect(output).not.toContain("package.json");
		expect(output).toContain("manifest source path");
		expect(output).toContain("    ...");
		expect(output).toContain("  match:");
		expect(output).not.toContain("  matche:");
	});

	it("uses text-only partial fallback for large repositories", async () => {
		mkdirSync(path.join(workDir, "bulk"), { recursive: true });
		for (let index = 0; index < 5001; index += 1) {
			writeFileSync(
				path.join(workDir, "bulk", `filler-${index}.ts`),
				`export const filler${index} = ${index};\n`,
				"utf8",
			);
		}
		writeFileSync(
			path.join(workDir, "src", "policy.ts"),
			[
				"export function resolveAttestation() {",
				"  return 'attestation source';",
				"}",
			].join("\n"),
			"utf8",
		);

		await expect(
			commandSearch(["policy", "attestation", "mismatch"], {
				projectRoot: workDir,
				limit: "3",
			}),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("\nNo matches, fallback to partial matches:");
		expect(output).toContain(
			"  Fallback: large repo; structural partial search skipped.",
		);
		expect(output).toContain("  attestation:");
		expect(output).toContain("    - rg ./src/policy.ts:");
		expect(output).not.toContain("ast-grep");
	}, 10000);

	it("skips structural search for large repository identifier misses", async () => {
		mkdirSync(path.join(workDir, "bulk"), { recursive: true });
		for (let index = 0; index < 5001; index += 1) {
			writeFileSync(
				path.join(workDir, "bulk", `filler-${index}.ts`),
				`export const filler${index} = ${index};\n`,
				"utf8",
			);
		}

		await expect(
			commandSearch(["definitelyNoSuchIdentifierXyz"], {
				projectRoot: workDir,
				limit: "3",
			}),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("\nSource matches:");
		expect(output).toContain(
			"  Fallback: large repo; structural search skipped.",
		);
		expect(output).toContain("  none");
		expect(output).not.toContain("ast-grep");
	}, 10000);

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
