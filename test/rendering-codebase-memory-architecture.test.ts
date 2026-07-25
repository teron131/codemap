/** Checks Codebase Memory architecture presentation policy with normalized payload examples. */
import { describe, expect, it } from "vitest";

import { renderCodebaseMemoryArchitectureSummary } from "../src/codemap/rendering/architecture.js";

describe("Codebase Memory architecture rendering", () => {
  it("notes when architecture summaries only have file-level nodes", () => {
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "sparse-project",
      total_nodes: 10,
      total_edges: 8,
      node_labels: [
        { label: "Folder", count: 3 },
        { label: "File", count: 2 },
        { label: "Module", count: 2 },
      ],
      edge_types: [{ type: "DEFINES", count: 4 }],
    });

    expect(output).toContain("project: sparse-project");
    expect(output).toContain("note: no function/class/method nodes; summary is file-level only.");
  });

  it("hides generic architecture hotspots and cluster names", () => {
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "busy-project",
      total_nodes: 100,
      total_edges: 200,
      node_labels: [{ label: "Function", count: 10 }],
      hotspots: [
        { name: "get", fan_in: 30 },
        {
          name: "handleRequest",
          fan_in: 12,
          qualified_name: "app.server.handleRequest",
        },
      ],
      clusters: [
        {
          label: "server",
          members: 5,
          top_nodes: ["get", "send", "handleRequest", "routeRequest"],
        },
      ],
    });

    expect(output).toContain("## Hotspots (hidden generic: 1)");
    expect(output).toContain("- handleRequest");
    expect(output).not.toContain("- get");
    expect(output).toContain("top: handleRequest, routeRequest");
    expect(output).not.toContain("top: get");
  });

  it("replaces repeated cluster labels with their top symbols", () => {
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "clustered-project",
      node_labels: [{ label: "Function", count: 10 }],
      clusters: [
        { label: "src", members: 5, top_nodes: ["alpha", "beta"] },
        { label: "src", members: 4, top_nodes: ["gamma", "delta"] },
      ],
    });

    expect(output).toContain("- alpha, beta (5 nodes)");
    expect(output).toContain("- gamma, delta (4 nodes)");
    expect(output).not.toContain("- src");
  });

  it("omits generic utility hotspots and unreliable backend entry points", () => {
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "utility-project",
      node_labels: [{ label: "Function", count: 10 }],
      hotspots: [
        { name: "recordValue", fan_in: 30 },
        { name: "runWorkflow", fan_in: 8 },
      ],
      entry_points: [{ name: "syntaxMatches", file: "src/search.ts" }],
    });

    expect(output).not.toContain("- recordValue");
    expect(output).toContain("- runWorkflow");
    expect(output).not.toContain("## Entry Points");
  });
});
