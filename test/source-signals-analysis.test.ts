/** Checks signal analysis row shaping. */
import { describe, expect, it } from "vitest";

import type { FileMetrics, FunctionSpan } from "../src/codemap/source/scanner/index.js";
import {
  fileProfileRow,
  functionLengthSection,
  functionUsageRows,
  usageBins,
  usageRows,
} from "../src/codemap/source/signals/analysis.js";

describe("signal analysis", () => {
  it("uses automatic bins for lexical mentions", () => {
    const rows = usageRows(
      ["unused", "pair", "few", "many"],
      new Map([
        ["unused", 1],
        ["pair", 2],
        ["few", 5],
        ["many", 8],
      ]),
    );

    expect(usageBins(rows)).toEqual({
      "1-3": 2,
      "4-6": 1,
      "7-8": 1,
    });
  });

  it("deduplicates repeated function spans by keeping the widest row", () => {
    const spans = [
      functionSpan("src/app.py::target", "target", 32, 20),
      functionSpan("src/app.py::target", "target", 40, 18),
      functionSpan("src/app.py::helper", "helper", 12, 70),
    ];

    expect(functionLengthSection(spans).items).toEqual([
      { identifier: "src/app.py::target", count: 40 },
      { identifier: "src/app.py::helper", count: 12 },
    ]);

    const rows = functionUsageRows(
      [
        {
          suffix: ".py",
          relPath: "src/app.py",
          exportedNames: [],
          functionSpans: spans,
        } as unknown as FileMetrics,
      ],
      new Set([".py"]),
      new Map([
        ["target", 9],
        ["helper", 2],
      ]),
    );

    expect(rows.filter((row) => row.identifier === "src/app.py::target")).toEqual([
      {
        name: "target",
        identifier: "src/app.py::target",
        file: "src/app.py",
        count: 9,
        line: 18,
        lines: 40,
        exported: false,
      },
    ]);
  });

  it("carries file line counts into file profile rows", () => {
    const row = fileProfileRow({
      relPath: "src/large.ts",
      lines: 420,
      defines: 0,
      importsLocal: 0,
      exports: 0,
      reexportsLocal: 0,
      extends: 0,
      inherits: 0,
      decorators: 0,
      samples: [],
    } as unknown as FileMetrics);

    expect(row).toMatchObject({
      file: "src/large.ts",
      total: 0,
      lines: 420,
    });
  });
});

function functionSpan(
  identifier: string,
  name: string,
  span: number,
  startLine: number,
): FunctionSpan {
  return {
    name,
    identifier,
    span,
    startLine,
  };
}
