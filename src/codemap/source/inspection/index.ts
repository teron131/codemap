/** Re-exports source inspection graph, target, metric, profile, and render APIs. */
export {
	type CodebaseMemoryInspectResult,
	codebaseMemoryInspect,
	renderCodebaseMemoryInspect,
} from "./codebase-memory.js";
export {
	currentTreeInspectGraph,
	emptyUsageMetrics,
	functionDefinitionRows,
	importBoundaryRows,
	metricsForFiles,
	uniqueRows,
	variableDefinitionRows,
} from "./graph.js";
export {
	appendBoundaryRows,
	appendFileProfile,
	appendFileProfileRow,
	appendLikelyEntryContext,
	appendMentionRows,
	appendSymbolProfile,
	directoryFileRows,
	type FileInspectMetrics,
	fileMetricsForPath,
	type LikelyEntryContext,
	type MetricRow,
	matchingIdentifierItems,
	renderDirectoryProfile,
	renderVariableProfile,
} from "./profiles.js";
export {
	appendContainsSection,
	appendEdgeSection,
	appendRelatedSections,
	edgeEndpoint,
	renderCurrentTreeInspection,
	renderInspection,
} from "./render.js";
export {
	directoryFilePaths,
	inspectCandidates,
	inspectEmitPaths,
	inspectPathTargetKind,
	nodeLabel,
	normalizeTarget,
	symbolFilePaths,
	targetFilePaths,
} from "./targets.js";
