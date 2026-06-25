/** Builds compact overview metadata for current graph views. */
import { languageMetricItems } from "../source/signals/index.js";

type Row = Record<string, unknown>;

const SAMPLE_LIMIT = 8;

/** Selects a bounded sample of paths for overview output. */
export function samplePaths(
	paths: string[],
	{ limit = SAMPLE_LIMIT }: { limit?: number } = {},
): Row {
	return {
		count: paths.length,
		items: paths.slice(0, limit),
		truncated: Math.max(paths.length - limit, 0),
	};
}

/** Builds compact refresh-plan samples for overview output. */
export function compactRefreshPlan(plan: Row): Row {
	if (Object.keys(plan).length === 0) {
		return {};
	}
	const direct = recordValue(plan.direct);
	const classified = recordValue(plan.classified);
	const expanded = recordValue(plan.expanded);
	const directSamples: Row = {};
	for (const key of ["added", "changed", "deleted"]) {
		directSamples[key] = samplePaths(stringArray(direct[key]));
	}
	const classifiedSamples: Row = {};
	for (const key of ["structural", "cosmetic"]) {
		classifiedSamples[key] = samplePaths(stringArray(classified[key]));
	}
	const expandedSamples: Row = {};
	for (const key of ["importDependents", "importDependencies", "reanalyzed"]) {
		expandedSamples[key] = samplePaths(stringArray(expanded[key]));
	}
	return {
		policy: plan.policy ?? "",
		summary: plan.summary ?? {},
		directSamples,
		classifiedSamples,
		expandedSamples,
	};
}

/** Builds current graph overview metadata and refresh summaries. */
export function buildOverviewView(
	architecture: Row,
	metrics: Row,
	update: Row,
): Row {
	const stats = recordValue(architecture.stats);
	const project = recordValue(architecture.project);
	const relationships = recordValue(architecture.relationships);
	const longFunctions = recordValue(metrics.longFunctions);
	const usageSignals = recordValue(metrics.usageSignals);
	const layers = rowArray(architecture.layers);
	return {
		project: {
			name: project.name,
		},
		counts: {
			files: stats.files ?? 0,
			nodes: stats.nodes ?? 0,
			edges: stats.edges ?? 0,
			layers: layers.length,
		},
		relationships: {
			pythonImportEdges: relationships.pythonImportEdges ?? 0,
			typescriptImportEdges: relationships.typescriptImportEdges ?? 0,
			entrypointLikeFiles: relationships.entrypointLikeFiles ?? 0,
			importCountsUnavailable: relationships.importCountsUnavailable ?? false,
			importCountsNote: relationships.importCountsNote ?? "",
		},
		inventory: architecture.inventory ?? {},
		intent: architecture.intent ?? {},
		likelyEntries: rowArray(architecture.likelyEntries)
			.slice(0, 8)
			.map((entry) => ({
				title: entry.title,
				role: entry.role,
				reason: entry.reason,
				description: entry.description,
			})),
		topLayers: layers.slice(0, 12).map((layer) => ({
			name: layer.name,
			files: arrayValue(layer.nodeIds).length,
		})),
		topLongFunctions: languageMetricItems(longFunctions).slice(0, 12),
		topLowUseInternalFunctions: languageMetricItems(
			recordValue(usageSignals.lowUsageFunctions),
		).slice(0, 12),
		topLowUseInternalVariables: languageMetricItems(
			recordValue(usageSignals.lowUsageVariables),
		).slice(0, 12),
		topNoisyVariables: languageMetricItems(
			recordValue(usageSignals.noisyVariables),
		).slice(0, 12),
		refresh: update.refresh ?? {},
		refreshPlan: compactRefreshPlan(recordValue(update.refreshPlan)),
	};
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Reads table rows from unknown section data. */
function rowArray(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

/** Coerces unknown overview payload values into printable string lists. */
function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
