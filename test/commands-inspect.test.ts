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
        "/** Runs the public app workflow. */",
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
    expect(output).toContain("# run in src/app.ts:2");
    expect(output).not.toContain("Type:");
    expect(output).not.toContain("Complexity:");
    expect(output).toContain("## Docstring");
    expect(output).toContain("Runs the public app workflow.");
    expect(output).toContain("## Calls");
    expect(output).toContain("calls: helper in src/app.ts:7");
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
    expect(output).toContain("- why: conventional app, main, or index filename");
    expect(output).toContain("## Contains");
    expect(output).not.toContain("## Other Matches");
  });

  it("does not call zero-edge wrapper files high-centrality", () => {
    writeFileSync(
      path.join(workDir, "src", "wrapper.ts"),
      "export { helper } from './helper';\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "helper.ts"),
      "export function helper() {\n  return 'ok';\n}\n",
      "utf8",
    );

    expect(commandInspect("src/wrapper.ts", { projectRoot: workDir })).toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("## Navigation Context");
    expect(output).toContain("- role: source file");
    expect(output).toContain("- why: selected by source/path evidence");
    expect(output).toContain(
      "- evidence: Low-relationship source file with 0 incoming import edges and 1 outgoing import edge.",
    );
    expect(output).not.toContain("high-centrality source");
    expect(output).not.toContain("0 incoming and 0 outgoing import edges");
  });

  it("prints file-local Python classes in a dedicated section", () => {
    writeFileSync(
      path.join(workDir, "src", "app.py"),
      [
        "class Runner:",
        '    """Runs the Python workflow."""',
        "    def run(self):",
        "        return helper()",
        "",
        "def helper():",
        "    return 'ok'",
      ].join("\n"),
      "utf8",
    );

    expect(commandInspect("src/app.py", { projectRoot: workDir })).toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("## Classes In File");
    expect(output).toContain("Runner");
    expect(output).toContain("## Contains");
  });

  it("prints Python class docstrings for symbol inspection", () => {
    writeFileSync(
      path.join(workDir, "src", "app.py"),
      [
        "class Runner:",
        '    """Runs the Python workflow."""',
        "    def run(self):",
        "        return helper()",
        "",
        "def helper():",
        "    return 'ok'",
      ].join("\n"),
      "utf8",
    );

    expect(commandInspect("Runner", { projectRoot: workDir })).toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("# Runner in src/app.py:1");
    expect(output).toContain("## Docstring");
    expect(output).toContain("Runs the Python workflow.");
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
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
