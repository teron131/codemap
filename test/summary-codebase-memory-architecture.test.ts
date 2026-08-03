/** Checks meaningful Codebase Memory percentages and presentation filtering. */
import { describe, expect, it } from "vitest";

import { renderCodebaseMemoryArchitectureSummary } from "../src/codemap/summary/architecture/pipeline.js";

describe("Codebase Memory architecture rendering", () => {
  it("omits raw inventory when architecture only has file-level nodes", () => {
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

    expect(output).toBe("# sparse-project\n");
    expect(output).not.toContain("nodes");
    expect(output).not.toContain("edges");
  });

  it("shows call share and cluster meaning while hiding generic symbols", () => {
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "busy-project",
      total_nodes: 100,
      total_edges: 200,
      node_labels: [
        { label: "Function", count: 6 },
        { label: "Method", count: 3 },
        { label: "Class", count: 1 },
      ],
      edge_types: [{ type: "CALLS", count: 40 }],
      hotspots: [
        { name: "get", fan_in: 30 },
        { name: "reject", fan_in: 20 },
        { name: "expect", fan_in: 18 },
        { name: "describe", fan_in: 17 },
        { name: "lower", fan_in: 16 },
        { name: "#runExclusive", fan_in: 15 },
        {
          name: "handleRequest",
          fan_in: 12,
          qualified_name: "app.server.handleRequest",
        },
      ],
      clusters: [
        {
          label: "tests",
          members: 2,
          cohesion: 1,
          top_nodes: ["testRequest"],
        },
        {
          label: "server",
          members: 5,
          cohesion: 0.8,
          top_nodes: ["get", "send", "handleRequest", "routeRequest"],
        },
      ],
    });

    expect(output).toContain("handleRequest · — · 30%");
    expect(output).not.toContain("`get`");
    expect(output).not.toContain("`reject`");
    expect(output).not.toContain("expect");
    expect(output).not.toContain("describe");
    expect(output).not.toContain("lower");
    expect(output).not.toContain("#runExclusive");
    expect(output).not.toContain("testRequest");
    expect(output).toContain("server · 50% · 80%");
    expect(output).toContain("└─ handleRequest, routeRequest");
    expect(output).not.toContain("total_nodes");
    expect(output).not.toContain("fan_in");
  });

  it("keeps every supplied row instead of imposing a second display limit", () => {
    const hotspots = Array.from({ length: 14 }, (_, index) => ({
      name: `operation${index + 1}`,
      fan_in: 1,
    }));
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "complete-project",
      node_labels: [{ label: "Function", count: 14 }],
      edge_types: [{ type: "CALLS", count: 14 }],
      hotspots,
    });

    expect(output).toContain("operation1 · — · 7.1%");
    expect(output).toContain("operation14 · — · 7.1%");
  });

  it("disambiguates repeated cluster labels with representative symbols", () => {
    const output = renderCodebaseMemoryArchitectureSummary({
      project: "clustered-project",
      node_labels: [{ label: "Function", count: 10 }],
      clusters: [
        { label: "src", members: 5, top_nodes: ["alpha", "beta"] },
        { label: "src", members: 4, top_nodes: ["gamma", "delta"] },
      ],
    });

    expect(output).toContain("src — alpha · 50% · —");
    expect(output).toContain("src — gamma · 40% · —");
  });
});
