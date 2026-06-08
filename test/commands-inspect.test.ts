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
		expect(output).toContain("## Contains");
		expect(output).not.toContain("## Other Matches");
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
