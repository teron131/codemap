/** Defines the current-tree graph node, edge, and payload shapes shared by search fallback and inspection. */
export type GraphNode = {
  id: string;
  type: string;
  name: string;
  filePath: string;
  summary: string;
  tags: string[];
  lineRange?: Array<number | null>;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
