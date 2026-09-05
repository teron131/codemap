/** Verifies syntax-backed TypeScript-family documentation and its source-inspection callers. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectReports, docstringForSymbol } from "../src/codemap/source/docstrings/index.js";
import { scanFile } from "../src/codemap/source/scanner/index.js";

let root: string;
beforeEach(() => {
  root = path.join(process.cwd(), "test", ".work", `typescript-docs-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("TypeScript-family documentation", () => {
  it("keeps generator declarations and bindings inspectable with their calls", () => {
    const file = path.join(root, "generators.ts");
    writeFileSync(
      file,
      [
        "function helper() { return 1; }",
        "/** Streams values. */",
        "export function* values(): Generator<number> {",
        "  yield helper();",
        "}",
        "/** Streams more. */",
        "export const more = function* () { yield helper(); };",
      ].join("\n"),
    );
    const metrics = scanFile(file, { displayRoot: root });
    expect(metrics.functionNames).toEqual(["helper", "values", "more"]);
    expect(metrics.exportedNames).toEqual(["values", "more"]);
    expect(metrics.callSites).toEqual([
      { caller: "values", callee: "helper", lineNumber: 4 },
      { caller: "more", callee: "helper", lineNumber: 7 },
    ]);
    expect(
      docstringForSymbol(file, {
        displayPath: "generators.ts",
        kind: "function",
        name: "more",
        line: 7,
      }),
    ).toBe("Streams more.");
  });
  it("keeps generic signatures, callback types, and nested declarations attached to their owner", () => {
    const file = path.join(root, "api.ts");
    writeFileSync(
      file,
      [
        "/** Runs a callback. */",
        "export function run<T>(",
        "  callback: (input: T) => T,",
        "  value: T,",
        "): T {",
        "  /** Normalizes the result. */",
        "  function normalize(value: T): T { return value; }",
        "  return normalize(callback(value));",
        "}",
        "const example = `function fabricated() {}`;",
      ].join("\n"),
    );
    const [, reports] = collectReports(file);
    expect(reports[0]?.parseError).toBeNull();
    expect(reports[0]?.functions).toMatchObject([
      {
        name: "run",
        lineno: 2,
        inputs: "callback: (input: T) => T, value: T,",
        outputs: "T",
        docstring: "Runs a callback.",
        nestedFunctions: [
          { name: "normalize", lineno: 7, outputs: "T", docstring: "Normalizes the result." },
        ],
      },
    ]);
    expect(reports[0]?.functions).toHaveLength(1);
  });

  it.each(["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"])(
    "exposes documented methods and arrow fields consistently in %s",
    (suffix) => {
      const file = path.join(root, `worker.${suffix}`);
      writeFileSync(
        file,
        [
          "/** Worker contract. */",
          "export class Worker {",
          "  /** Runs one job. */",
          "  run(value) { return value; }",
          "  /** Handles a queued job. */",
          "  handle = (value) => this.run(value);",
          "}",
        ].join("\n"),
      );
      const [, reports] = collectReports(file);
      expect(reports[0]?.classes[0]).toMatchObject({
        name: "Worker",
        docstring: "Worker contract.",
        methods: [
          { name: "run", lineno: 4, docstring: "Runs one job." },
          { name: "handle", lineno: 6, docstring: "Handles a queued job." },
        ],
      });
      const metrics = scanFile(file, { displayRoot: root });
      const method = metrics.functionSpans.find((span) => span.name === "handle")!;
      expect(
        docstringForSymbol(file, {
          displayPath: `worker.${suffix}`,
          kind: "function",
          name: method.name,
          line: method.startLine,
        }),
      ).toBe("Handles a queued job.");
      expect(metrics.callSites).toContainEqual({ caller: "handle", callee: "run", lineNumber: 6 });
    },
  );

  it("preserves documented values while excluding trailing comments and interface type members", () => {
    const file = path.join(root, "surface.ts");
    writeFileSync(
      file,
      [
        "/** Public constant. */",
        "export const version = '1';",
        "const other = 1; // Belongs to other.",
        "function undocumented() {}",
        "interface API { declaredOnly(): void; }",
      ].join("\n"),
    );
    const [, reports] = collectReports(file);
    expect(reports[0]?.functions.map((item) => item.name)).toEqual(["version", "undocumented"]);
    expect(reports[0]?.functions[0]?.docstring).toBe("Public constant.");
    expect(reports[0]?.functions[1]?.docstring).toBeNull();
  });
});
