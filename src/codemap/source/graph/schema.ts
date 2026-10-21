/** Current-tree graph shapes shared by graph search fallback and inspection. Node ids are `type:path` for files and `type:path:name` for definitions. */
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
