/** Working-tree graph shapes shared by graph search fallback and inspection. Node ids are `type:path` for files and `type:path:name` for definitions. */
export type GraphNode = {
  id: string;
  type: string;
  name: string;
  filePath: string;
  summary: string;
  tags: string[];
  /** First and last line of a function or class; absent on file nodes. */
  lineRange?: [number, number];
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
