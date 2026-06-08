/** Checks saved artifact command output formatting. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandArtifactsView } from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`commands-artifacts-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, ".context-graph", "views"), {
		recursive: true,
	});
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	logSpy.mockRestore();
	rmSync(workDir, { recursive: true, force: true });
});

describe("artifact command handlers", () => {
	it("marks truncated JSON views with an ellipsis", () => {
		writeFileSync(
			path.join(workDir, ".context-graph", "views", "overview.json"),
			'{"alpha":"1234567890","beta":true}\n',
			"utf8",
		);

		expect(
			commandArtifactsView("overview", {
				projectRoot: workDir,
				maxChars: "18",
			}),
		).toBe(0);

		const output = String(logLines()[0] ?? "");
		expect(output).toHaveLength(18);
		expect(output).toMatch(/\.\.\.$/);
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
