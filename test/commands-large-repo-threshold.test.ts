/** Checks large-repo fallback behavior with a tiny mocked analysis threshold. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/codemap/common.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/codemap/common.js")>();
  return {
    ...actual,
    DETAILED_ANALYSIS_FILE_LIMIT: 2,
  };
});

import { commandInspect, commandSearch } from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `commands-large-repo-${process.pid}-${Date.now()}`,
  );
  mkdirSync(path.join(workDir, "src"), { recursive: true });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(workDir, { recursive: true, force: true });
});

describe("large-repo command fallbacks", () => {
  it("uses text-only partial search without building a mass filesystem fixture", async () => {
    writeFileSync(
      path.join(workDir, "src", "policy.ts"),
      ["export function resolveAttestation() {", "  return 'attestation source';", "}"].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "extra-one.ts"),
      "export const extraOne = 1;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "extra-two.ts"),
      "export const extraTwo = 2;\n",
      "utf8",
    );

    await expect(
      commandSearch(["policy", "attestation", "mismatch"], {
        projectRoot: workDir,
        limit: "3",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("\nNo whole-query source match; partial candidates:");
    expect(output).toContain("  Fallback: large repo; structural partial search skipped.");
    expect(output).toContain("./src/policy.ts [terms 2/3: policy, attestation]");
    expect(output).toContain("1:24 export function resolveAttestation()");
    expect(output).not.toContain("ast-grep");
  });

  it("skips structural search for large-repo identifier misses", async () => {
    writeFileSync(
      path.join(workDir, "src", "extra-one.ts"),
      "export const extraOne = 1;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "extra-two.ts"),
      "export const extraTwo = 2;\n",
      "utf8",
    );
    writeFileSync(
      path.join(workDir, "src", "extra-three.ts"),
      "export const extraThree = 3;\n",
      "utf8",
    );

    await expect(
      commandSearch(["definitelyNoSuchIdentifierXyz"], {
        projectRoot: workDir,
        limit: "3",
      }),
    ).resolves.toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("\nSource matches:");
    expect(output).toContain("  Fallback: large repo; structural search skipped.");
    expect(output).toContain("  none");
    expect(output).not.toContain("ast-grep");
  });

  it("uses honest path-ranked context for large-repo file inspection", () => {
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
    writeFileSync(path.join(workDir, "src", "extra.ts"), "export const extra = 1;\n", "utf8");

    expect(commandInspect("src/large.ts", { projectRoot: workDir })).toBe(0);

    const output = logLines().join("\n");
    expect(output).toContain("# src/large.ts");
    expect(output).toContain(
      "Fallback: detailed graph skipped above 2 files; incoming imports not computed.",
    );
    expect(output).toContain("## Navigation Context");
    expect(output).toContain("- role: source file");
    expect(output).toContain("- why: selected by source/path evidence");
    expect(output).toContain("## Imports From File");
    expect(output).toContain("- ./helper");
    expect(output).toContain("## Contains");
    expect(output).toContain("- run in src/large.ts:3");
    expect(output).toContain("local_imports=1");
    expect(output).not.toContain("imported by:");
  });
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
