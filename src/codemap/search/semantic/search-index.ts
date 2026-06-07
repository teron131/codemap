/** Builds, stores, loads, and queries saved semantic indexes. */
import { existsSync } from "node:fs";

import {
	GRAPH_VERSION,
	readJson,
	semanticIndexPath,
	utcNow,
	writeJson,
} from "../../common.js";
import type { GraphPayload } from "../../source/graph/index.js";
import { type SemanticCard, semanticCardsFromGraph } from "./cards.js";
import {
	batchEmbedTexts,
	type EmbeddingConfig,
	EmbeddingSearchError,
} from "./embeddings.js";
import type {
	IndexedSemanticCard,
	SemanticIndex,
	SemanticSearchResult,
} from "./schema.js";

export const DEFAULT_SEMANTIC_INDEX_CARD_LIMIT = 1000;

/** Combines semantic cards and embeddings into a saved index payload. */
export function buildSemanticIndexPayload(
	graph: GraphPayload,
	embeddings: number[][],
	{
		config,
		cardLimit = DEFAULT_SEMANTIC_INDEX_CARD_LIMIT,
		generatedAt = utcNow(),
	}: {
		config: EmbeddingConfig;
		cardLimit?: number;
		generatedAt?: string;
	},
): SemanticIndex {
	const cards = semanticCardsFromGraph(graph).slice(0, cardLimit);
	if (embeddings.length !== cards.length) {
		throw new EmbeddingSearchError(
			"Embedding provider returned an unexpected embedding count",
		);
	}
	return {
		version: GRAPH_VERSION,
		generatedAt,
		model: config.model,
		outputDimensionality: config.outputDimensionality,
		cardLimit,
		cardCount: cards.length,
		graphStats: graph.stats,
		cards: cards.map((card, index) =>
			indexedCard(card, embeddings[index] ?? []),
		),
	};
}

/** Embeds semantic cards, writes the saved index, and returns it. */
export async function buildSemanticIndex(
	root: string,
	graph: GraphPayload,
	{
		config,
		cardLimit = DEFAULT_SEMANTIC_INDEX_CARD_LIMIT,
	}: {
		config: EmbeddingConfig;
		cardLimit?: number;
	},
): Promise<SemanticIndex> {
	const cards = semanticCardsFromGraph(graph).slice(0, cardLimit);
	const texts = cards.map((card) => cardEmbeddingText(card));
	const embeddings = texts.length
		? await batchEmbedTexts(texts, { config })
		: [];
	const payload = buildSemanticIndexPayload(graph, embeddings, {
		config,
		cardLimit,
	});
	writeSemanticIndex(root, payload);
	return payload;
}

/** Writes a semantic index payload to disk. */
export function writeSemanticIndex(root: string, payload: SemanticIndex): void {
	writeJson(semanticIndexPath(root), payload);
}

/** Checks whether the saved semantic index exists. */
export function semanticIndexExists(root: string): boolean {
	return existsSync(semanticIndexPath(root));
}

/** Reads a saved semantic index from disk. */
export function loadSemanticIndex(root: string): SemanticIndex {
	return readJson(semanticIndexPath(root)) as SemanticIndex;
}

/** Embeds a query and returns ranked semantic index matches. */
export async function semanticMatches(
	index: SemanticIndex,
	searchText: string,
	{
		config,
		limit,
	}: {
		config: EmbeddingConfig;
		limit: number;
	},
): Promise<SemanticSearchResult[]> {
	ensureMatchingConfig(index, config);
	const embeddings = await batchEmbedTexts(
		[`task: code retrieval | search: ${searchText}`],
		{ config },
	);
	return semanticResultsForEmbedding(index, embeddings[0] ?? [], { limit });
}

/** Ranks semantic cards against a query embedding. */
export function semanticResultsForEmbedding(
	index: SemanticIndex,
	queryEmbedding: number[],
	{ limit }: { limit: number },
): SemanticSearchResult[] {
	return index.cards
		.map((item) => ({
			id: item.id ?? "",
			kind: item.kind ?? "",
			title: item.title ?? "",
			filePath: item.filePath ?? "",
			lineRange: item.lineRange ?? [],
			score: cosineSimilarity(
				queryEmbedding,
				(item.embedding ?? []).map((value) => Number(value)),
			),
			snippet: item.snippet ?? "",
		}))
		.sort(
			(left, right) =>
				right.score - left.score ||
				compareText(left.filePath, right.filePath) ||
				compareText(left.id, right.id),
		)
		.slice(0, limit);
}

/** Verifies a semantic index matches the active embedding config. */
export function ensureMatchingConfig(
	index: SemanticIndex,
	config: EmbeddingConfig,
): void {
	const indexModel = String(index.model ?? "");
	const indexDimension = Number(index.outputDimensionality ?? 0);
	if (
		indexModel !== config.model ||
		indexDimension !== config.outputDimensionality
	) {
		throw new Error(
			`Semantic index was built with ${indexModel}/${indexDimension}; current embedding config is ${config.model}/${config.outputDimensionality}.`,
		);
	}
}

/** Attaches an embedding vector to a semantic card. */
export function indexedCard(
	card: SemanticCard,
	embedding: number[],
): IndexedSemanticCard {
	return {
		id: card.id,
		kind: card.kind,
		title: card.title,
		filePath: card.filePath,
		lineRange: card.lineRange,
		snippet: card.text
			.split(/\r?\n/)
			.slice(0, 4)
			.map((line) => line.trim())
			.filter(Boolean)
			.join(" "),
		embedding,
	};
}

/** Builds the text sent to the embedding provider for one semantic card. */
export function cardEmbeddingText(card: SemanticCard): string {
	return `title: ${card.title} | text: ${card.text}`;
}

/** Calculates cosine similarity between embedding vectors. */
export function cosineSimilarity(left: number[], right: number[]): number {
	let dot = 0;
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		dot += (left[index] ?? 0) * (right[index] ?? 0);
	}
	const leftNorm = Math.sqrt(
		left.reduce((sum, value) => sum + value * value, 0),
	);
	const rightNorm = Math.sqrt(
		right.reduce((sum, value) => sum + value * value, 0),
	);
	if (!leftNorm || !rightNorm) {
		return 0;
	}
	return dot / (leftNorm * rightNorm);
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
