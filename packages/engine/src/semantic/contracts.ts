import type { EventId, LogLevel, Result, SessionId } from "@logview/core";

export const JEV_MODEL_ID = "jev-1.13.0";

export const PROMPT_VERSION = "log-relevance-noul-v1";

export const REDACTION_VERSION = "tag-level-message-v1";

export const DEFAULT_SEMANTIC_BATCH_ITEMS = 100;

export const DEFAULT_SEMANTIC_FLUSH_MS = 50;

export const DEFAULT_SEMANTIC_MAX_IN_FLIGHT = 2;

export const DEFAULT_SEMANTIC_MAX_QUEUED = 2_000;

export const DEFAULT_SEMANTIC_MAX_REQUEST_BYTES = 128 * 1024;

export const DEFAULT_SEMANTIC_THRESHOLD = 0.5;

export type SemanticQuery = Readonly<{
	revision: number;
	text: string;
	threshold: number;
	promptVersion: string;
	redactionVersion: string;
}>;

export type ClassifierItem = Readonly<{
	eventId: EventId;
	tag: string | null;
	level: LogLevel | null;
	message: string;
}>;

export type ClassifyRequest = Readonly<{
	sessionId: SessionId;
	requestId: string;
	query: SemanticQuery;
	modelId: string;
	items: readonly ClassifierItem[];
}>;

export type Relevance =
	| { eventId: EventId; kind: "scored"; relevance: number }
	| { eventId: EventId; kind: "unknown"; reason: "unsupported" | "too-large" };

export type ClassifyResponse = Readonly<{
	sessionId: SessionId;
	requestId: string;
	queryRevision: number;
	resolvedModelId: string;
	results: readonly Relevance[];
}>;

export type ClassifierError = Readonly<{
	kind: "cancelled" | "timeout" | "rate-limited" | "auth" | "invalid-response" | "unavailable";
	retryAfterMs?: number;
}>;

export interface LogClassifier {
	classifyBatch(
		request: ClassifyRequest,
		signal: AbortSignal,
	): Promise<Result<ClassifyResponse, ClassifierError>>;
}

export type SemanticOptions = Readonly<{
	maxBatchItems: number;
	flushDelayMs: number;
	maxInFlight: number;
	maxQueuedIds: number;
	maxRequestBytes: number;
	threshold: number;
	modelId: string;
	promptVersion: string;
	redactionVersion: string;
}>;

export type SemanticStats = Readonly<{
	queryText: string;
	queryRevision: number;
	threshold: number;
	classifiedEvents: number;
	pendingEvents: number;
	skippedEvents: number;
	failedEvents: number;
	inFlight: number;
}>;

export function defaultSemanticOptions(): SemanticOptions {
	return {
		maxBatchItems: DEFAULT_SEMANTIC_BATCH_ITEMS,
		flushDelayMs: DEFAULT_SEMANTIC_FLUSH_MS,
		maxInFlight: DEFAULT_SEMANTIC_MAX_IN_FLIGHT,
		maxQueuedIds: DEFAULT_SEMANTIC_MAX_QUEUED,
		maxRequestBytes: DEFAULT_SEMANTIC_MAX_REQUEST_BYTES,
		threshold: DEFAULT_SEMANTIC_THRESHOLD,
		modelId: JEV_MODEL_ID,
		promptVersion: PROMPT_VERSION,
		redactionVersion: REDACTION_VERSION,
	};
}

export function queryIdentity(query: SemanticQuery): string {
	return `${query.text}\n${query.threshold}\n${query.promptVersion}\n${query.redactionVersion}`;
}
