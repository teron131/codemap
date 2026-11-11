/** Checks that file and directory inspection profiles report source line counts. */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendFileProfileRow, renderDirectoryProfile } from "../src/codemap/inspect/profiles.js";
import type { FileProfileRow } from "../src/codemap/signals/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
  workDir = path.join(
    workspaceRoot,
    "test",
    ".work",
    `source-inspection-profiles-${process.pid}-${Date.now()}`,
  );
  mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("inspection profile rendering", () => {
  it("shows source line counts in file profiles", () => {
    const lines: string[] = [];

    appendFileProfileRow(lines, emptyProfile("src/large.ts", 420));

    expect(lines.join("\n")).toContain(
      "- declarations=0, lines=420, defines=0, local_imports=0, exports=0",
    );
  });

  it("shows source line counts in directory profiles", () => {
    const output = renderDirectoryProfile(
      workDir,
      { nodes: [], edges: [] },
      {
        fileProfiles: [emptyProfile("src/large.ts", 420)],
      },
      "src",
      { limit: 4 },
    );

    expect(output).toContain(
      "- src/large.ts: declarations=0, lines=420, defines=0, local_imports=0",
    );
  });
});

function emptyProfile(file: string, lines: number): FileProfileRow {
  return {
    file,
    total: 0,
    lines,
    defines: 0,
    imports_local: 0,
    exports: 0,
    reexports_local: 0,
    extends: 0,
    inherits: 0,
    jsx_components: 0,
    decorators: 0,
    samples: [],
  };
}
