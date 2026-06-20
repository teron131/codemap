/** Re-exports semantic card, embedding, index, and search APIs. */
export {
	asIntOrNull,
	cardFromNode,
	nodeTitle,
	normalizedLineRange,
	relationshipsByNode,
	type SemanticCard,
	semanticCardsFromGraph,
} from "./cards.js";
export {
	batchEmbedTexts,
	compactError,
	DEFAULT_BATCH_SIZE,
	DEFAULT_EMBED_MODEL,
	DEFAULT_OUTPUT_DIMENSIONALITY,
	dotenvValues,
	EMBEDDING_BASE_URL,
	type EmbeddingConfig,
	EmbeddingSearchError,
	embedBatch,
	embeddingApiKeyFromEnv,
	embeddingOutputDimensionality,
	embeddingValues,
	loadEmbeddingConfig,
	postEmbeddingJson,
} from "./embeddings.js";
export type {
	IndexedSemanticCard,
	SemanticIndex,
	SemanticSearchResult,
} from "./schema.js";
export {
	buildSemanticIndex,
	buildSemanticIndexPayload,
	cardEmbeddingText,
	cosineSimilarity,
	DEFAULT_SEMANTIC_INDEX_CARD_LIMIT,
	ensureMatchingConfig,
	indexedCard,
	loadSemanticIndex,
	semanticIndexExists,
	semanticMatches,
	semanticResultsForEmbedding,
	writeSemanticIndex,
} from "./search-index.js";
