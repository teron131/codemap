/** Checks syntax command handler output controls. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildParser,
	commandSyntaxRecipe,
	dispatch,
} from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	process.exitCode = undefined;
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`commands-syntax-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	logSpy.mockRestore();
	rmSync(workDir, { recursive: true, force: true });
});

describe("syntax command handlers", () => {
	it("limits recipe text matches and marks hidden rows", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"console.log('one');",
				"console.log('two');",
				"console.log('three');",
			].join("\n"),
			"utf8",
		);

		expect(
			commandSyntaxRecipe({
				projectRoot: workDir,
				name: "typescript-console-log",
				paths: ["src"],
				limit: "2",
			}),
		).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("console.log('one')");
		expect(output).toContain("console.log('two')");
		expect(output).not.toContain("console.log('three')");
		expect(output).toContain("\n...");
	});

	it("wires recipe limit through the CLI parser", async () => {
		writeFileSync(
			path.join(workDir, "src", "parser.ts"),
			[
				"console.log('one');",
				"console.log('two');",
				"console.log('three');",
			].join("\n"),
			"utf8",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"recipe",
				"typescript-console-log",
				"--project-root",
				workDir,
				"--limit",
				"2",
				"src",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("console.log('one')");
		expect(output).toContain("console.log('two')");
		expect(output).not.toContain("console.log('three')");
		expect(output).toContain("\n...");
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
