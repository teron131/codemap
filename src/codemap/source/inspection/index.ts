/** Re-exports source inspection graph, target, metric, profile, and render APIs. */
export {
	currentTreeInspectGraph,
	importBoundaryRows,
	uniqueRows,
} from "./graph.js";
export {
	emptyUsageMetrics,
	functionDefinitionRows,
	metricsForFiles,
	variableDefinitionRows,
} from "./metrics.js";
export {
	appendBoundaryRows,
	appendFileProfile,
	appendFileProfileRow,
	appendMentionRows,
	appendSymbolProfile,
	directoryFileRows,
	type FileInspectMetrics,
	fileMetricsForPath,
	type MetricRow,
	matchingIdentifierItems,
	renderDirectoryProfile,
	renderVariableProfile,
} from "./profiles.js";
export {
	appendContainsSection,
	appendEdgeSection,
	appendLikelyEntryContext,
	appendRelatedSections,
	edgeEndpoint,
	type LikelyEntryContext,
	renderInspection,
} from "./render.js";
export {
	directoryFilePaths,
	inspectCandidates,
	inspectEmitPaths,
	nodeLabel,
	normalizeTarget,
	symbolFilePaths,
	targetFilePaths,
} from "./targets.js";
