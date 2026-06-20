/** Loads embedding configuration and calls the embedding provider. */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const EMBEDDING_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_EMBED_MODEL = "gemini-embedding-2";
export const DEFAULT_OUTPUT_DIMENSIONALITY = 768;
export const DEFAULT_BATCH_SIZE = 100;

/** Signals that semantic search cannot continue because embeddings failed. */
export class EmbeddingSearchError extends Error {
	/** Creates a named error for embedding setup or provider failures. */
	constructor(message: string) {
		super(message);
		this.name = "EmbeddingSearchError";
	}
}

export type EmbeddingConfig = {
	apiKey: string;
	model: string;
	outputDimensionality: number;
};

/** Loads embedding settings from environment variables and project dotenv. */
export function loadEmbeddingConfig(
	projectRoot: string,
	env: Record<string, string | undefined> = process.env,
): EmbeddingConfig | null {
	const apiKey = embeddingApiKeyFromEnv(env, `${projectRoot}/.env`);
	if (apiKey === null) {
		return null;
	}
	return {
		apiKey,
		model: env.CODEMAP_EMBED_MODEL || DEFAULT_EMBED_MODEL,
		outputDimensionality: embeddingOutputDimensionality(env),
	};
}

/** Finds the Gemini API key in environment or dotenv settings. */
export function embeddingApiKeyFromEnv(
	env: Record<string, string | undefined>,
	dotenvPath = ".env",
): string | null {
	const value = (env.GEMINI_API_KEY ?? "").trim();
	if (value) {
		return value;
	}
	const dotenvValue = (dotenvValues(dotenvPath).GEMINI_API_KEY ?? "").trim();
	return dotenvValue || null;
}

/** Parses the configured embedding vector dimensionality. */
export function embeddingOutputDimensionality(
	env: Record<string, string | undefined>,
): number {
	const rawValue =
		env.CODEMAP_EMBED_DIM ?? String(DEFAULT_OUTPUT_DIMENSIONALITY);
	const parsed = Number.parseInt(rawValue, 10);
	if (Number.isNaN(parsed)) {
		throw new EmbeddingSearchError("CODEMAP_EMBED_DIM must be an integer");
	}
	return parsed;
}

/** Reads simple KEY=value pairs from a dotenv file. */
export function dotenvValues(filePath: string): Record<string, string> {
	if (!existsSync(filePath)) {
		return {};
	}
	try {
		return Object.fromEntries(
			Object.entries(parseEnv(readFileSync(filePath, "utf8"))).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		);
	} catch {
		return {};
	}
}

/** Embeds texts in provider-sized request batches. */
export async function batchEmbedTexts(
	texts: string[],
	{ config }: { config: EmbeddingConfig },
): Promise<number[][]> {
	const embeddings: number[][] = [];
	for (let start = 0; start < texts.length; start += DEFAULT_BATCH_SIZE) {
		embeddings.push(
			...(await embedBatch(texts.slice(start, start + DEFAULT_BATCH_SIZE), {
				config,
			})),
		);
	}
	if (embeddings.length !== texts.length) {
		throw new EmbeddingSearchError(
			"Embedding provider returned an unexpected embedding count",
		);
	}
	return embeddings;
}

/** Sends one batch embedding request and extracts vectors. */
export async function embedBatch(
	texts: string[],
	{ config }: { config: EmbeddingConfig },
): Promise<number[][]> {
	const payload = {
		requests: texts.map((text) => ({
			model: `models/${config.model}`,
			content: { parts: [{ text }] },
			output_dimensionality: config.outputDimensionality,
		})),
	};
	const response = await postEmbeddingJson(
		`${EMBEDDING_BASE_URL}/models/${config.model}:batchEmbedContents`,
		config.apiKey,
		payload,
	);
	const embeddings = Array.isArray(response.embeddings)
		? response.embeddings
		: [];
	return embeddings.map((item) => embeddingValues(isRecord(item) ? item : {}));
}

/** Posts JSON to the embedding provider with timeout and compact errors. */
export async function postEmbeddingJson(
	url: string,
	apiKey: string,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			body: JSON.stringify(payload),
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": apiKey,
			},
			signal: AbortSignal.timeout(60_000),
		});
	} catch (error) {
		throw new EmbeddingSearchError(errorMessage(error));
	}
	if (!response.ok) {
		const message = await response.text();
		throw new EmbeddingSearchError(
			compactError(message) || `Embedding provider HTTP ${response.status}`,
		);
	}
	try {
		const value = await response.json();
		return isRecord(value) ? value : {};
	} catch (error) {
		throw new EmbeddingSearchError(errorMessage(error));
	}
}

/** Extracts numeric vector values from embedding response shapes. */
export function embeddingValues(item: Record<string, unknown>): number[] {
	let values = item.values;
	if (values === undefined || values === null) {
		const embedding =
			item.embedding !== null &&
			typeof item.embedding === "object" &&
			!Array.isArray(item.embedding)
				? (item.embedding as Record<string, unknown>)
				: {};
		values = embedding.values;
	}
	if (!Array.isArray(values)) {
		throw new EmbeddingSearchError("Embedding response did not include values");
	}
	return values.map((value) => Number(value));
}

/** Compacts provider error payloads into one readable line. */
export function compactError(text: string): string {
	try {
		const payload = JSON.parse(text);
		const message = payload?.error?.message;
		return String(message || "")
			.split(/\s+/)
			.filter(Boolean)
			.join(" ")
			.slice(0, 500);
	} catch {
		return text.split(/\s+/).filter(Boolean).join(" ").slice(0, 500);
	}
}

/** Checks whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Converts unknown embedding failures into a readable error message. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
