/** Checks focused inspect command output for source relationship hints. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandInspect } from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`commands-inspect-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	logSpy.mockRestore();
	rmSync(workDir, { recursive: true, force: true });
});

describe("inspect command handler", () => {
	it("prints TypeScript function call relationships", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"export function run(value: string) {",
				"  const cleaned = value.trim();",
				"  return helper(cleaned);",
				"}",
				"",
				"export function helper(value: string) {",
				"  return value.toUpperCase();",
				"}",
			].join("\n"),
			"utf8",
		);

		expect(commandInspect("run", { projectRoot: workDir })).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("# run in src/app.ts:1");
		expect(output).not.toContain("Type:");
		expect(output).not.toContain("Complexity:");
		expect(output).toContain("## Calls");
		expect(output).toContain("calls: helper in src/app.ts:6");
	});

	it("does not repeat contained symbols as other matches for file inspection", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"export function run(value: string) {",
				"  return helper(value);",
				"}",
				"",
				"export function helper(value: string) {",
				"  return value.toUpperCase();",
				"}",
			].join("\n"),
			"utf8",
		);

		expect(commandInspect("src/app.ts", { projectRoot: workDir })).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("## Navigation Context");
		expect(output).toContain("- role: entry file");
		expect(output).toContain(
			"- why: conventional app, main, or index filename",
		);
		expect(output).toContain("## Contains");
		expect(output).not.toContain("## Other Matches");
	});

	it("marks limited directory sections with an ellipsis", () => {
		for (const name of ["a", "b", "c"]) {
			writeFileSync(
				path.join(workDir, "src", `${name}.ts`),
				`export function ${name}() {\n  return "${name}";\n}\n`,
				"utf8",
			);
		}

		expect(commandInspect("src", { projectRoot: workDir, limit: "2" })).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("## Dense Files");
		expect(output).toContain("## Files");
		expect(output).toContain("- ...");
	});

	it("uses a file-local fallback for large repo file inspection", () => {
		mkdirSync(path.join(workDir, "bulk"), { recursive: true });
		for (let index = 0; index < 5001; index += 1) {
			writeFileSync(
				path.join(workDir, "bulk", `filler-${index}.ts`),
				`export const filler${index} = ${index};\n`,
				"utf8",
			);
		}
		writeFileSync(
			path.join(workDir, "src", "helper.ts"),
			"export function helper() {\n  return 'ok';\n}\n",
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "large.ts"),
			[
				"import { helper } from './helper';",
				"",
				"export function run() {",
				"  return helper();",
				"}",
			].join("\n"),
			"utf8",
		);

		expect(commandInspect("src/large.ts", { projectRoot: workDir })).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("# src/large.ts");
		expect(output).toContain(
			"Fallback: detailed graph skipped above 5000 files; incoming imports not computed.",
		);
		expect(output).toContain("## Navigation Context");
		expect(output).toContain("- role: high-centrality source");
		expect(output).toContain("- why: selected by import relationship evidence");
		expect(output).toContain("## Imports From File");
		expect(output).toContain("- ./helper");
		expect(output).toContain("## Contains");
		expect(output).toContain("- run in src/large.ts:3");
		expect(output).toContain("local_imports=1");
		expect(output).not.toContain("imported by:");
	}, 10000);
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
