/** Defines graph node, edge, payload, and stats shapes. */
export type GraphNode = {
	id: string;
	type: string;
	name: string;
	filePath: string;
	summary: string;
	tags: string[];
	complexity: string;
	metrics?: Record<string, unknown>;
	lineRange?: Array<number | null>;
};

export type GraphEdge = {
	source: string;
	target: string;
	type: string;
	evidence?: string;
};

export type GraphStats = {
	files: number;
	nodes: number;
	edges: number;
	nodeTypes: Record<string, number>;
	edgeTypes: Record<string, number>;
	languages: Record<string, number>;
	categories: Record<string, number>;
};

export type GraphPayload = {
	stats: GraphStats;
	nodes: GraphNode[];
	edges: GraphEdge[];
	evidence: {
		importMap: Record<string, unknown>;
		codeSignals?: Record<string, unknown>;
	};
};
