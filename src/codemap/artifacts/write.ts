/** Writes canonical graph payloads and rendered artifact views. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalDir, viewsDir, writeJson } from "../common.js";
import { buildViews } from "../rendering/index.js";
import type { GraphPayload } from "../source/graph/index.js";
import type { ArtifactFingerprints, ArtifactRefreshSummary } from "./schema.js";

/** Normalizes graph payloads before artifact persistence. */
export function normalizeCanonicalGraph(graph: GraphPayload): GraphPayload {
	const canonical = { ...graph } as GraphPayload & {
		layers?: unknown;
		views?: unknown;
	};
	delete canonical.layers;
	delete canonical.views;
	return canonical;
}

/** Writes graph, fingerprint, and rendered view artifacts. */
export function writeArtifacts(
	root: string,
	graph: GraphPayload,
	fingerprints: ArtifactFingerprints,
	{
		meta,
		refreshSummary = null,
	}: {
		meta: Record<string, unknown>;
		refreshSummary?: ArtifactRefreshSummary | null;
	},
): Record<string, unknown> {
	const canonical = normalizeCanonicalGraph(graph);
	const renderedViews = buildViews(canonical, {
		root,
		refreshSummary,
	});
	writeJson(path.join(canonicalDir(root), "graph.json"), canonical);
	writeJson(path.join(canonicalDir(root), "fingerprints.json"), fingerprints);
	writeJson(path.join(canonicalDir(root), "meta.json"), meta);
	writeJson(
		path.join(viewsDir(root), "architecture.json"),
		renderedViews.architecture,
	);
	writeJson(path.join(viewsDir(root), "metrics.json"), renderedViews.metrics);
	writeJson(path.join(viewsDir(root), "update.json"), renderedViews.update);
	writeJson(path.join(viewsDir(root), "overview.json"), renderedViews.overview);
	writeText(
		path.join(viewsDir(root), "agent-brief.md"),
		renderedViews.agentBrief,
	);
	writeText(path.join(viewsDir(root), "summary.md"), renderedViews.summaryText);
	writeText(
		path.join(viewsDir(root), "hotspots.md"),
		renderedViews.hotspotsText,
	);
	writeText(path.join(viewsDir(root), "index.html"), renderedViews.htmlReport);
	return renderedViews;
}

/** Writes text content after ensuring the parent directory exists. */
function writeText(filePath: string, value: unknown): void {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, String(value), "utf8");
}
