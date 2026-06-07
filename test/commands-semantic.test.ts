/** Checks semantic command handlers with a stubbed embedding provider. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	commandSemanticInit,
	commandSemanticStatus,
} from "../src/codemap/commands/index.js";
import { semanticIndexPath } from "../src/codemap/common.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`commands-semantic-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	logSpy.mockRestore();
	vi.unstubAllGlobals();
	rmSync(workDir, { recursive: true, force: true });
});

describe("semantic command handlers", () => {
	it("prints missing status, creates an index, then prints saved status", async () => {
		writeFileSync(path.join(workDir, ".env"), "GEMINI_API_KEY='key'\n", "utf8");
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			"export function app() {\n  return 'ok';\n}\n",
			"utf8",
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string | URL | Request, init) => {
				const body = JSON.parse(String(init?.body ?? "{}"));
				const requests = Array.isArray(body.requests) ? body.requests : [];
				return new Response(
					JSON.stringify({
						embeddings: requests.map(() => ({ values: [1, 0] })),
					}),
				);
			}),
		);

		expect(commandSemanticStatus({ projectRoot: workDir })).toBe(1);
		expect(logLines()).toEqual([
			`No semantic index at ${semanticIndexPath(workDir)}`,
		]);

		logSpy.mockClear();
		await expect(
			commandSemanticInit({ projectRoot: workDir, cardLimit: "2" }),
		).resolves.toBe(0);
		expect(logLines()).toEqual([
			`${createdLinePrefix(workDir)}: 2 cards`,
			semanticIndexPath(workDir),
		]);

		logSpy.mockClear();
		expect(commandSemanticStatus({ projectRoot: workDir })).toBe(0);
		expect(logLines()).toEqual([
			`${path.basename(workDir)}: 2 semantic cards`,
			"model: gemini-embedding-2 (768 dimensions)",
			expect.stringMatching(/^generated: /),
			`index: ${semanticIndexPath(workDir)}`,
		]);
	});

	it("prints the Python setup message when no embedding key is configured", async () => {
		vi.stubEnv("GEMINI_API_KEY", "");
		await expect(commandSemanticInit({ projectRoot: workDir })).resolves.toBe(
			1,
		);
		expect(logLines()).toEqual([
			"Semantic index requires embedding setup. Set GEMINI_API_KEY in the environment or project .env.",
		]);
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): unknown[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}

/** Builds the semantic-index creation line expected for a workspace. */
function createdLinePrefix(root: string): string {
	return `Created semantic index for ${path.basename(root)}`;
}
