/** Re-exports source graph builders, canonical payloads, and schemas. */
export {
	addCallEdges,
	addEdge,
	addImportEdges,
	addStructureNodes,
	buildGraphFragment,
	buildNodesAndEdges,
	classifyTags,
	classNode,
	complexityForLines,
	fileNode,
	fileSummary,
	functionNode,
	lineSpan,
	nodeTypeForFile,
	SIGNIFICANT_CLASS_LINES,
	SIGNIFICANT_FUNCTION_LINES,
} from "./builder.js";
export {
	buildGraphPayload,
	currentTreeGraph,
	graphStats,
	relatedEdges,
} from "./canonical.js";
export type {
	GraphEdge,
	GraphNode,
	GraphPayload,
	GraphStats,
} from "./schema.js";
