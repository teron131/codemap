/** Working-tree graph construction, per-file structure, and the file-count limit above which commands skip detailed analysis; nothing analyzed is persisted. */
export {
  DETAILED_ANALYSIS_FILE_LIMIT,
  buildWorkingTreeGraph,
  workingTreeGraph,
  edgeRelationshipLabel,
  inventoryFileNodes,
  relatedEdges,
} from "./working-tree.js";
export type { GraphEdge, GraphNode, GraphPayload } from "./schema.js";
export { structureForFile } from "./structure.js";
