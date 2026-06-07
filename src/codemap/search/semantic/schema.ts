/** Defines semantic index cards, indexes, and search result shapes. */
import type { GraphStats } from "../../source/graph/index.js";

export type IndexedSemanticCard = {
	id: string;
	kind: string;
	title: string;
	filePath: string;
	lineRange: Array<number | null>;
	snippet: string;
	embedding: number[];
};

export type SemanticIndex = {
	version: string | number;
	generatedAt: string;
	model: string;
	outputDimensionality: number;
	cardLimit: number;
	cardCount: number;
	graphStats: GraphStats;
	cards: IndexedSemanticCard[];
};

export type SemanticSearchResult = {
	id: string;
	kind: string;
	title: string;
	filePath: string;
	lineRange: Array<number | null>;
	score: number;
	snippet: string;
};
